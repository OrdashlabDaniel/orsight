import crypto from "node:crypto";

import type { User } from "@supabase/supabase-js";

import { isFormShareEmailConfigured, sendFormShareInviteEmail } from "@/lib/form-share-email";
import { FORM_FILE_POOLS, getFormFileFromPool, listFormFilePool, saveFormFileToPool } from "@/lib/form-file-pools";
import { getFormById, loadForms, saveForms } from "@/lib/forms-store";
import { createFormId, normalizeFormId, type FormDefinition } from "@/lib/forms";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runWithStorageContext } from "@/lib/storage-tenant";
import { loadTableFields, saveTableFields } from "@/lib/table-fields-store";
import {
  getManagedImageDataUrl,
  isAgentContextImageName,
  loadGlobalRules,
  loadTrainingExamples,
  saveAgentContextImageDataUrl,
  saveGlobalRules,
  saveTrainingImageDataUrl,
  type GlobalRules,
  type TrainingExample,
  withTrainingImageRequestCache,
  upsertTrainingExample,
} from "@/lib/training";

const FORM_SHARE_STORAGE_PREFIX = "__form_share__:";
const FORM_SHARE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type StoredFormShareInvite = {
  kind: "form-share";
  version: 1;
  tokenHash: string;
  sourceOwnerId: string;
  sourceOwnerEmail: string;
  sourceFormId: string;
  sourceFormName: string;
  sourceFormDescription: string;
  targetEmail: string | null;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  targetOwnerId: string | null;
  targetOwnerEmail: string | null;
  targetFormId: string | null;
  revokedAt: number | null;
};

export type FormSharePreview = {
  formName: string;
  formDescription: string;
  inviterEmail: string;
  targetEmail: string | null;
  expiresAt: number;
  acceptedAt: number | null;
  targetOwnerId: string | null;
  targetFormId: string | null;
  revokedAt: number | null;
  status: "active" | "accepted" | "expired" | "revoked";
};

function normalizeEmail(value: string | null | undefined) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email && email.includes("@") ? email : "";
}

function createShareToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashShareToken(token: string) {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

function buildShareStorageKey(tokenHash: string) {
  return `${FORM_SHARE_STORAGE_PREFIX}${tokenHash}`;
}

export function buildFormShareAcceptUrl(origin: string, token: string) {
  const base = origin.replace(/\/+$/, "");
  return `${base}/share?token=${encodeURIComponent(token)}`;
}

function normalizeStoredFormShareInvite(raw: unknown): StoredFormShareInvite | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const tokenHash = typeof record.tokenHash === "string" ? record.tokenHash.trim() : "";
  const sourceOwnerId = typeof record.sourceOwnerId === "string" ? record.sourceOwnerId.trim() : "";
  const sourceFormId = typeof record.sourceFormId === "string" ? normalizeFormId(record.sourceFormId) : "";
  if (!tokenHash || !sourceOwnerId || !sourceFormId) {
    return null;
  }
  return {
    kind: "form-share",
    version: 1,
    tokenHash,
    sourceOwnerId,
    sourceOwnerEmail: typeof record.sourceOwnerEmail === "string" ? record.sourceOwnerEmail.trim() : "",
    sourceFormId,
    sourceFormName: typeof record.sourceFormName === "string" ? record.sourceFormName.trim().slice(0, 120) : "Shared form",
    sourceFormDescription:
      typeof record.sourceFormDescription === "string" ? record.sourceFormDescription.trim().slice(0, 200) : "",
    targetEmail: normalizeEmail(typeof record.targetEmail === "string" ? record.targetEmail : null) || null,
    createdAt: typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    expiresAt:
      typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt)
        ? record.expiresAt
        : Date.now() + FORM_SHARE_TTL_MS,
    acceptedAt:
      typeof record.acceptedAt === "number" && Number.isFinite(record.acceptedAt) ? record.acceptedAt : null,
    targetOwnerId: typeof record.targetOwnerId === "string" && record.targetOwnerId.trim() ? record.targetOwnerId.trim() : null,
    targetOwnerEmail:
      typeof record.targetOwnerEmail === "string" && record.targetOwnerEmail.trim()
        ? record.targetOwnerEmail.trim().toLowerCase()
        : null,
    targetFormId: typeof record.targetFormId === "string" && record.targetFormId.trim() ? normalizeFormId(record.targetFormId) : null,
    revokedAt: typeof record.revokedAt === "number" && Number.isFinite(record.revokedAt) ? record.revokedAt : null,
  };
}

function getInviteStatus(invite: StoredFormShareInvite): FormSharePreview["status"] {
  if (invite.revokedAt) {
    return "revoked";
  }
  if (invite.acceptedAt) {
    return "accepted";
  }
  if (invite.expiresAt <= Date.now()) {
    return "expired";
  }
  return "active";
}

async function loadStoredInviteByHash(tokenHash: string): Promise<StoredFormShareInvite | null> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("分享服务未配置（缺少 Supabase service role）。");
  }
  const { data, error } = await admin
    .from("training_examples")
    .select("data")
    .eq("image_name", buildShareStorageKey(tokenHash))
    .maybeSingle();
  if (error || !data?.data) {
    return null;
  }
  return normalizeStoredFormShareInvite(data.data);
}

async function saveStoredInvite(invite: StoredFormShareInvite) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("分享服务未配置（缺少 Supabase service role）。");
  }
  const { error } = await admin.from("training_examples").upsert(
    {
      image_name: buildShareStorageKey(invite.tokenHash),
      data: invite,
    },
    { onConflict: "image_name" },
  );
  if (error) {
    throw new Error(`保存分享邀请失败：${error.message}`);
  }
}

function cloneRules(rules: GlobalRules): GlobalRules {
  return JSON.parse(JSON.stringify(rules)) as GlobalRules;
}

function cloneExamples(examples: TrainingExample[]): TrainingExample[] {
  return JSON.parse(JSON.stringify(examples)) as TrainingExample[];
}

async function cloneFormSpaceAcrossUsers(
  sourceOwnerId: string,
  sourceFormId: string,
  targetOwnerId: string,
  targetFormId: string,
) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("分享服务未配置（缺少 Supabase service role）。");
  }

  const [tableFields, rules, examples, poolFiles] = await Promise.all([
    runWithStorageContext(sourceOwnerId, admin, async () => await loadTableFields(sourceFormId)),
    runWithStorageContext(sourceOwnerId, admin, async () => await loadGlobalRules(sourceFormId)),
    runWithStorageContext(sourceOwnerId, admin, async () => await loadTrainingExamples(sourceFormId)),
    Promise.all(
      FORM_FILE_POOLS.map(async (pool) => ({
        pool,
        items: await runWithStorageContext(sourceOwnerId, admin, async () => await listFormFilePool(pool, sourceFormId)),
      })),
    ),
  ]);

  await runWithStorageContext(targetOwnerId, admin, async () => {
    await saveTableFields(tableFields.map((field) => ({ ...field })), targetFormId);
    await saveGlobalRules(
      {
        ...cloneRules(rules),
        tableFields: tableFields.map((field) => ({ ...field })),
      },
      targetFormId,
    );
  });

  await withTrainingImageRequestCache(async () => {
    const copiedImages = new Set<string>();
    for (const example of cloneExamples(examples)) {
      const dataUrl = await runWithStorageContext(sourceOwnerId, admin, async () =>
        getManagedImageDataUrl(example.imageName, sourceFormId),
      );
      if (dataUrl) {
        await runWithStorageContext(targetOwnerId, admin, async () =>
          saveTrainingImageDataUrl(example.imageName, dataUrl, targetFormId),
        );
        copiedImages.add(example.imageName);
      }
      await runWithStorageContext(targetOwnerId, admin, async () => upsertTrainingExample(example, targetFormId));
    }

    for (const turn of rules.agentThread || []) {
      for (const asset of turn.assets || []) {
        if (asset.kind !== "image" || copiedImages.has(asset.imageName)) {
          continue;
        }
        const dataUrl = await runWithStorageContext(sourceOwnerId, admin, async () =>
          getManagedImageDataUrl(asset.imageName, sourceFormId),
        );
        if (!dataUrl) {
          continue;
        }
        await runWithStorageContext(targetOwnerId, admin, async () => {
          if (isAgentContextImageName(asset.imageName)) {
            await saveAgentContextImageDataUrl(asset.imageName, dataUrl, targetFormId);
          } else {
            await saveTrainingImageDataUrl(asset.imageName, dataUrl, targetFormId);
          }
        });
        copiedImages.add(asset.imageName);
      }
    }
  });

  for (const { pool, items } of poolFiles) {
    for (const file of items) {
      const binary = await runWithStorageContext(sourceOwnerId, admin, async () =>
        getFormFileFromPool(pool, file.id, sourceFormId),
      );
      if (!binary) {
        continue;
      }
      await runWithStorageContext(targetOwnerId, admin, async () =>
        saveFormFileToPool(
          {
            pool,
            fileName: binary.fileName,
            mimeType: binary.mimeType,
            buffer: binary.buffer,
            source: file.source || `shared-from:${sourceOwnerId}:${normalizeFormId(sourceFormId)}`,
          },
          targetFormId,
        ),
      );
    }
  }
}

function pickSharedCopyName(source: FormDefinition, existingForms: FormDefinition[]) {
  const activeNames = new Set(existingForms.filter((form) => !form.deletedAt).map((form) => form.name.trim()));
  if (!activeNames.has(source.name.trim())) {
    return source.name;
  }
  let index = 1;
  while (true) {
    const suffix = index === 1 ? " 共享副本" : ` 共享副本 ${index}`;
    const base = source.name.slice(0, Math.max(1, 48 - suffix.length));
    const candidate = `${base}${suffix}`.trim();
    if (!activeNames.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

async function cloneSharedFormToUser(sourceOwnerId: string, sourceFormId: string, targetUser: User) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("分享服务未配置（缺少 Supabase service role）。");
  }

  const source = await runWithStorageContext(sourceOwnerId, admin, async () => await getFormById(sourceFormId));
  if (!source || source.deletedAt) {
    throw new Error("该分享对应的填表不存在，或已被删除。");
  }

  const targetForms = await runWithStorageContext(targetUser.id, admin, async () => await loadForms());
  const now = Date.now();
  const cloned: FormDefinition = {
    ...source,
    id: createFormId(),
    name: pickSharedCopyName(source, targetForms),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    templateSource: "copied",
    sourceFormId: source.id,
  };

  await runWithStorageContext(targetUser.id, admin, async () => {
    await saveForms([...targetForms, cloned]);
  });
  await cloneFormSpaceAcrossUsers(sourceOwnerId, source.id, targetUser.id, cloned.id);
  return cloned;
}

export async function createFormShareInvite(input: {
  sourceFormId: string;
  sourceOwnerId: string;
  sourceOwnerEmail: string | null | undefined;
  recipientEmail?: string | null | undefined;
  origin: string;
}) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("分享服务未配置（缺少 Supabase service role）。");
  }

  const sourceForm = await runWithStorageContext(input.sourceOwnerId, admin, async () =>
    getFormById(input.sourceFormId),
  );
  if (!sourceForm || sourceForm.deletedAt) {
    throw new Error("要分享的填表不存在，或已被删除。");
  }

  const token = createShareToken();
  const tokenHash = hashShareToken(token);
  const invite: StoredFormShareInvite = {
    kind: "form-share",
    version: 1,
    tokenHash,
    sourceOwnerId: input.sourceOwnerId,
    sourceOwnerEmail: normalizeEmail(input.sourceOwnerEmail) || "",
    sourceFormId: normalizeFormId(sourceForm.id),
    sourceFormName: sourceForm.name,
    sourceFormDescription: sourceForm.description,
    targetEmail: normalizeEmail(input.recipientEmail) || null,
    createdAt: Date.now(),
    expiresAt: Date.now() + FORM_SHARE_TTL_MS,
    acceptedAt: null,
    targetOwnerId: null,
    targetOwnerEmail: null,
    targetFormId: null,
    revokedAt: null,
  };

  if (invite.targetEmail && !isFormShareEmailConfigured()) {
    throw new Error("服务器发信未配置，当前不能直接发送邮箱邀请。请先配置 SMTP。");
  }

  await saveStoredInvite(invite);

  const acceptUrl = buildFormShareAcceptUrl(input.origin, token);
  let emailSent = false;
  let emailError: string | null = null;

  if (invite.targetEmail) {
    try {
      const result = await sendFormShareInviteEmail({
        to: invite.targetEmail,
        inviterEmail: invite.sourceOwnerEmail || "OrSight user",
        formName: invite.sourceFormName,
        acceptUrl,
        expiresAt: invite.expiresAt,
      });
      emailSent = result.sent;
      if (!result.sent) {
        emailError = result.reason === "unconfigured" ? "email_unconfigured" : "email_not_sent";
      }
    } catch (error) {
      emailError = error instanceof Error ? error.message : "email_not_sent";
    }
  }

  return {
    acceptUrl,
    emailSent,
    emailError,
    expiresAt: invite.expiresAt,
    targetEmail: invite.targetEmail,
  };
}

export async function getFormSharePreview(token: string): Promise<FormSharePreview | null> {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }
  const invite = await loadStoredInviteByHash(hashShareToken(normalized));
  if (!invite) {
    return null;
  }
  return {
    formName: invite.sourceFormName,
    formDescription: invite.sourceFormDescription,
    inviterEmail: invite.sourceOwnerEmail,
    targetEmail: invite.targetEmail,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    targetOwnerId: invite.targetOwnerId,
    targetFormId: invite.targetFormId,
    revokedAt: invite.revokedAt,
    status: getInviteStatus(invite),
  };
}

export async function acceptFormShareInvite(token: string, targetUser: User) {
  const invite = await loadStoredInviteByHash(hashShareToken(token));
  if (!invite) {
    throw new Error("分享链接无效，或已失效。");
  }
  const status = getInviteStatus(invite);
  if (status === "revoked") {
    throw new Error("该分享已被撤销。");
  }
  if (status === "expired") {
    throw new Error("该分享链接已过期。");
  }
  if (status === "accepted") {
    if (invite.targetOwnerId === targetUser.id && invite.targetFormId) {
      const admin = getSupabaseAdmin();
      if (!admin) {
        throw new Error("分享服务未配置（缺少 Supabase service role）。");
      }
      const existing = await runWithStorageContext(targetUser.id, admin, async () => getFormById(invite.targetFormId!));
      if (existing) {
        return { form: existing, alreadyAccepted: true as const };
      }
    }
    throw new Error("该分享链接已被使用。");
  }

  const normalizedTargetEmail = normalizeEmail(targetUser.email);
  if (invite.targetEmail && normalizedTargetEmail !== invite.targetEmail) {
    throw new Error("该分享仅允许指定邮箱接受，请使用受邀邮箱登录。");
  }

  const form = await cloneSharedFormToUser(invite.sourceOwnerId, invite.sourceFormId, targetUser);
  await saveStoredInvite({
    ...invite,
    acceptedAt: Date.now(),
    targetOwnerId: targetUser.id,
    targetOwnerEmail: normalizedTargetEmail || null,
    targetFormId: form.id,
  });
  return { form, alreadyAccepted: false as const };
}
