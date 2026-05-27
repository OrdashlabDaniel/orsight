import type { User } from "@supabase/supabase-js";

import {
  EMAIL_VERIFICATION_CONFIRMED_AT_METADATA_KEY,
  EMAIL_VERIFICATION_CONFIRMED_SOURCE_METADATA_KEY,
  EMAIL_VERIFICATION_FLOW_METADATA_KEY,
  EMAIL_VERIFICATION_REQUESTED_AT_METADATA_KEY,
} from "@/lib/auth-email-verified";
import { getSupabaseAdmin } from "@/lib/supabase";

function normalizeEmail(value: string | null | undefined) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.includes("@") ? email : "";
}

function normalizeFlowId(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function metadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

export function isAuthUserEmailConfirmed(user: User | null | undefined) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

export function getAuthUserEmail(user: User | null | undefined) {
  return normalizeEmail(user?.email);
}

export async function findAuthUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return null;
  }

  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[auth-email-verification] failed to inspect auth users", error.message);
      return null;
    }

    const users = data.users ?? [];
    const user = users.find((candidate) => normalizeEmail(candidate.email) === normalizedEmail);
    if (user) {
      return user;
    }
    if (users.length < perPage) {
      break;
    }
  }

  return null;
}

export async function findAuthUserById(userId: string | null | undefined) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) {
    return null;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return null;
  }

  const { data, error } = await admin.auth.admin.getUserById(normalizedUserId);
  if (error) {
    return null;
  }

  return data.user ?? null;
}

export function hasConfirmedEmailVerificationFlow(user: User | null | undefined, flowId: string | null | undefined) {
  const normalizedFlowId = normalizeFlowId(flowId);
  if (!normalizedFlowId || !isAuthUserEmailConfirmed(user)) {
    return false;
  }

  const appMetadata = metadataRecord(user?.app_metadata);
  const confirmedSource = appMetadata[EMAIL_VERIFICATION_CONFIRMED_SOURCE_METADATA_KEY];
  return (
    appMetadata[EMAIL_VERIFICATION_FLOW_METADATA_KEY] === normalizedFlowId &&
    typeof appMetadata[EMAIL_VERIFICATION_CONFIRMED_AT_METADATA_KEY] === "string" &&
    Boolean((appMetadata[EMAIL_VERIFICATION_CONFIRMED_AT_METADATA_KEY] as string).trim()) &&
    confirmedSource === "confirm_page"
  );
}

export function hasEmailVerificationFlow(user: User | null | undefined, flowId: string | null | undefined) {
  const normalizedFlowId = normalizeFlowId(flowId);
  if (!normalizedFlowId) {
    return false;
  }

  const appMetadata = metadataRecord(user?.app_metadata);
  return appMetadata[EMAIL_VERIFICATION_FLOW_METADATA_KEY] === normalizedFlowId;
}

export async function rememberPendingEmailVerificationFlow(
  user: User | null | undefined,
  flowId: string | null | undefined,
  startedAt: number | null | undefined,
) {
  const normalizedFlowId = normalizeFlowId(flowId);
  if (!user?.id || !normalizedFlowId) {
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return;
  }

  const requestedAt =
    typeof startedAt === "number" && Number.isFinite(startedAt)
      ? new Date(startedAt).toISOString()
      : new Date().toISOString();

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...metadataRecord(user.app_metadata),
      [EMAIL_VERIFICATION_FLOW_METADATA_KEY]: normalizedFlowId,
      [EMAIL_VERIFICATION_REQUESTED_AT_METADATA_KEY]: requestedAt,
    },
  });

  if (error) {
    console.error("[auth-email-verification] failed to remember pending verification flow", error.message);
  }
}

export async function markEmailVerificationFlow(
  user: User | null | undefined,
  flowId: string | null | undefined,
  source: "confirm_page" | "legacy_callback" = "confirm_page",
) {
  const normalizedFlowId = normalizeFlowId(flowId);
  if (!user?.id || !normalizedFlowId) {
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return;
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...metadataRecord(user.app_metadata),
      [EMAIL_VERIFICATION_FLOW_METADATA_KEY]: normalizedFlowId,
      [EMAIL_VERIFICATION_CONFIRMED_AT_METADATA_KEY]: new Date().toISOString(),
      [EMAIL_VERIFICATION_CONFIRMED_SOURCE_METADATA_KEY]: source,
    },
  });

  if (error) {
    console.error("[auth-email-verification] failed to mark verification flow", error.message);
  }
}
