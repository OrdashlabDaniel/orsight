import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_FORM_ID,
  FORMS_MANIFEST_KEY,
  FORM_RECYCLE_RETENTION_MS,
  buildBlankTableFields,
  buildTenantStarterForms,
  cloneTableFields,
  createDefaultFormDefinition,
  createFormId,
  isUnmodifiedTenantGiftStub,
  normalizeFormId,
  normalizeForms,
  type FormDefinition,
} from "@/lib/forms";
import { scopeTrainingExamplesImageName, tenantActive } from "@/lib/storage-tenant";
import { DEFAULT_TABLE_FIELDS } from "@/lib/table-fields";
import { loadTableFields, saveTableFields } from "@/lib/table-fields-store";
import { cloneFormFilePools } from "@/lib/form-file-pools";
import { hasTenantDbAccess, requireTenantDbAccess } from "@/lib/tenant-db";
import {
  getManagedImageDataUrl,
  getTrainingImageDataUrl,
  isAgentContextImageName,
  loadGlobalRules,
  loadTrainingExamples,
  saveAgentContextImageDataUrl,
  saveGlobalRules,
  saveTrainingImageDataUrl,
  upsertTrainingExample,
} from "@/lib/training";
import {
  isMissingSupabaseTableError,
  isSupabaseTableMarkedUnavailable,
  markSupabaseTableUnavailable,
} from "@/lib/supabase-compat";
import { getSupabaseAdmin } from "@/lib/supabase";

function formsCandidatePaths() {
  return [
    path.join(process.cwd(), "training", "forms.json"),
    path.resolve(process.cwd(), "..", "training", "forms.json"),
  ];
}

function resolveFormsPath() {
  return formsCandidatePaths().find((filePath) => fs.existsSync(filePath)) || formsCandidatePaths()[1];
}

function loadLocalForms(): FormDefinition[] {
  const filePath = resolveFormsPath();
  if (!fs.existsSync(filePath)) {
    return normalizeForms([createDefaultFormDefinition()]);
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { forms?: unknown };
    return normalizeForms(payload.forms);
  } catch {
    return normalizeForms([createDefaultFormDefinition()]);
  }
}

function saveLocalForms(forms: FormDefinition[]) {
  const normalized = normalizeForms(forms);
  const filePath = resolveFormsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ forms: normalized }, null, 2), "utf8");
  return normalized;
}

function formsManifestImageName() {
  return scopeTrainingExamplesImageName(FORMS_MANIFEST_KEY);
}

const FORMS_TABLE = "app_forms";

type FormRow = {
  owner_id: string;
  form_id: string;
  name: string;
  description: string;
  status: "draft" | "ready";
  ready: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  template_source: FormDefinition["templateSource"];
  source_form_id: string | null;
};

function mapFormRow(row: FormRow): FormDefinition {
  return {
    id: normalizeFormId(row.form_id),
    name: row.name,
    description: row.description,
    status: row.status,
    ready: row.ready,
    createdAt: Date.parse(row.created_at) || Date.now(),
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    deletedAt: row.deleted_at ? Date.parse(row.deleted_at) || null : null,
    templateSource: row.template_source,
    sourceFormId: row.source_form_id,
  };
}

function buildFormRow(ownerId: string, form: FormDefinition): FormRow {
  return {
    owner_id: ownerId,
    form_id: normalizeFormId(form.id),
    name: form.name,
    description: form.description,
    status: form.status,
    ready: form.ready,
    created_at: new Date(form.createdAt).toISOString(),
    updated_at: new Date(form.updatedAt).toISOString(),
    deleted_at: form.deletedAt ? new Date(form.deletedAt).toISOString() : null,
    template_source: form.templateSource ?? "blank",
    source_form_id: form.sourceFormId ?? null,
  };
}

function mergeLegacyForms(currentForms: FormDefinition[], legacyForms: FormDefinition[]) {
  const currentById = new Map(currentForms.map((form) => [form.id, form] as const));
  const merged: FormDefinition[] = [];
  const used = new Set<string>();

  for (const legacyForm of legacyForms) {
    const current = currentById.get(legacyForm.id);
    merged.push(current && !isUnmodifiedTenantGiftStub(current) ? current : legacyForm);
    used.add(legacyForm.id);
  }

  for (const current of currentForms) {
    if (!used.has(current.id)) {
      merged.push(current);
    }
  }

  return normalizeForms(merged, { injectBuiltinDefault: false });
}

async function loadRemoteManifestByKey(imageName: string) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return null;
  }

  const { data, error } = await admin
    .from("training_examples")
    .select("data")
    .eq("image_name", imageName)
    .single();

  if (error || !data?.data || typeof data.data !== "object") {
    return null;
  }

  return data.data as Record<string, unknown>;
}

async function fetchRemoteFormsRows(): Promise<FormDefinition[] | null> {
  if (isSupabaseTableMarkedUnavailable(FORMS_TABLE)) {
    return null;
  }
  const { ownerId, client } = requireTenantDbAccess();
  const { data, error } = await client
    .from(FORMS_TABLE)
    .select(
      "owner_id,form_id,name,description,status,ready,created_at,updated_at,deleted_at,template_source,source_form_id",
    )
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingSupabaseTableError(error, FORMS_TABLE)) {
      markSupabaseTableUnavailable(FORMS_TABLE);
      return null;
    }
    throw new Error(`Failed to load forms: ${error?.message || "unknown error"}`);
  }
  if (!data) {
    return [];
  }

  return normalizeForms((data as FormRow[]).map((row) => mapFormRow(row)), { injectBuiltinDefault: false });
}

async function persistRemoteForms(forms: FormDefinition[]) {
  if (isSupabaseTableMarkedUnavailable(FORMS_TABLE)) {
    return null;
  }
  const normalized = normalizeForms(forms, { injectBuiltinDefault: false });
  const { ownerId, client } = requireTenantDbAccess();
  const nextIds = new Set(normalized.map((form) => form.id));

  if (normalized.length > 0) {
    const { error } = await client
      .from(FORMS_TABLE)
      .upsert(normalized.map((form) => buildFormRow(ownerId, form)), { onConflict: "owner_id,form_id" });

    if (error) {
      if (isMissingSupabaseTableError(error, FORMS_TABLE)) {
        markSupabaseTableUnavailable(FORMS_TABLE);
        return null;
      }
      throw new Error(`Failed to save forms: ${error.message}`);
    }
  }

  const existing = await fetchRemoteFormsRows();
  if (existing == null) {
    return null;
  }
  const deleteIds = existing.map((form) => form.id).filter((formId) => !nextIds.has(formId));
  for (const formId of deleteIds) {
    const { error } = await client.from(FORMS_TABLE).delete().eq("owner_id", ownerId).eq("form_id", formId);
    if (error) {
      if (isMissingSupabaseTableError(error, FORMS_TABLE)) {
        markSupabaseTableUnavailable(FORMS_TABLE);
        return null;
      }
      throw new Error(`Failed to delete removed form: ${error.message}`);
    }
  }

  return normalized;
}

async function saveLegacyRemoteForms(
  forms: FormDefinition[],
  extraData?: Record<string, unknown> | null,
): Promise<FormDefinition[]> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return saveLocalForms(forms);
  }
  const normalized = normalizeForms(forms, { injectBuiltinDefault: !tenantActive() });
  const currentManifest = await loadRemoteManifestByKey(formsManifestImageName());
  const { error } = await admin.from("training_examples").upsert(
    {
      image_name: formsManifestImageName(),
      data: {
        ...(currentManifest || {}),
        ...(extraData || {}),
        forms: normalized,
      },
    },
    { onConflict: "image_name" },
  );

  if (error) {
    throw new Error(`Failed to save legacy forms manifest: ${error.message}`);
  }

  return normalized;
}

async function maybeRestoreLegacyFormsIntoLegacyManifest(
  currentManifestData: Record<string, unknown> | null,
  currentForms: FormDefinition[],
) {
  if (!tenantActive() || typeof currentManifestData?.legacyMigratedAt === "number") {
    return null;
  }

  const legacyManifest = await loadRemoteManifestByKey(FORMS_MANIFEST_KEY);
  if (!legacyManifest) {
    return null;
  }

  const legacyForms = normalizeForms(legacyManifest.forms, { injectBuiltinDefault: true });
  if (legacyForms.length === 0) {
    return null;
  }

  const mergedForms = mergeLegacyForms(currentForms, legacyForms);
  await saveLegacyRemoteForms(mergedForms, {
    ...(currentManifestData || {}),
    legacyMigratedAt: Date.now(),
  });
  return mergedForms;
}

async function loadLegacyRemoteForms() {
  const currentManifest = await loadRemoteManifestByKey(formsManifestImageName());
  if (currentManifest) {
    const forms = normalizeForms(currentManifest.forms, { injectBuiltinDefault: !tenantActive() });
    const restored = await maybeRestoreLegacyFormsIntoLegacyManifest(currentManifest, forms);
    return restored || forms;
  }

  if (!tenantActive()) {
    return normalizeForms([createDefaultFormDefinition()]);
  }

  const starter = normalizeForms(buildTenantStarterForms(), { injectBuiltinDefault: false });
  const restored = await maybeRestoreLegacyFormsIntoLegacyManifest(null, starter);
  if (restored) {
    return restored;
  }
  await saveLegacyRemoteForms(starter);
  await seedStarterTableAndRules(starter);
  return starter;
}

async function maybeRestoreLegacyFormsIntoTenant(currentForms: FormDefinition[]) {
  if (!tenantActive()) {
    return null;
  }

  const legacyManifest = await loadRemoteManifestByKey(FORMS_MANIFEST_KEY);
  if (!legacyManifest) {
    return null;
  }

  const legacyForms = normalizeForms(legacyManifest.forms, { injectBuiltinDefault: true });
  if (legacyForms.length === 0) {
    return null;
  }

  const mergedForms = mergeLegacyForms(currentForms, legacyForms);
  const persisted = await persistRemoteForms(mergedForms);
  if (!persisted) {
    return null;
  }
  return mergedForms;
}

async function seedStarterTableAndRules(forms: FormDefinition[]) {
  const fields = DEFAULT_TABLE_FIELDS.map((field) => ({ ...field }));
  for (const form of forms) {
    await saveGlobalRules(
      {
        instructions: "",
        documents: [],
        guidanceHistory: [],
        agentThread: [],
        workingRules: "",
        tableFields: fields.map((field) => ({ ...field })),
      },
      form.id,
    );
  }
}

/**
 * 从发布版租户表读取用户自己的填表清单。用户数据按 owner_id + form_id 存储，
 * 代码发布（git push）不会覆盖；仅在该租户尚无任何行时才会写入两份赠送模板。
 */
async function loadRemoteForms() {
  if (!hasTenantDbAccess()) {
    return loadLocalForms();
  }

  const current = await fetchRemoteFormsRows();
  if (current == null) {
    return await loadLegacyRemoteForms();
  }
  if (current.length > 0) {
    return current;
  }

  if (!tenantActive()) {
    return normalizeForms([createDefaultFormDefinition()]);
  }

  const starter = normalizeForms(buildTenantStarterForms(), { injectBuiltinDefault: false });
  const restored = await maybeRestoreLegacyFormsIntoTenant(starter);
  if (restored) {
    return restored;
  }
  const persisted = await persistRemoteForms(starter);
  if (!persisted) {
    return await loadLegacyRemoteForms();
  }
  await seedStarterTableAndRules(starter);
  return starter;
}

/** 写回时直接写租户表，不再依赖单行 manifest blob；缺失项会被安全删除，不会碰到其他用户数据。 */
async function saveRemoteForms(forms: FormDefinition[]) {
  if (!hasTenantDbAccess()) {
    saveLocalForms(forms);
    return normalizeForms(forms);
  }

  const persisted = await persistRemoteForms(forms);
  if (persisted) {
    return persisted;
  }
  return await saveLegacyRemoteForms(forms);
}

export async function loadForms() {
  return hasTenantDbAccess() ? loadRemoteForms() : loadLocalForms();
}

export async function saveForms(forms: FormDefinition[]) {
  return hasTenantDbAccess() ? saveRemoteForms(forms) : saveLocalForms(forms);
}

export async function getFormById(formId: string) {
  const normalizedId = normalizeFormId(formId);
  const forms = await loadForms();
  return forms.find((form) => form.id === normalizedId) || null;
}

export async function initializeBlankFormSpace(formId: string) {
  const blankFields = buildBlankTableFields();
  await saveTableFields(blankFields, formId);
  await saveGlobalRules(
    {
      instructions: "",
      documents: [],
      guidanceHistory: [],
      agentThread: [],
      workingRules: "",
      tableFields: blankFields,
    },
    formId,
  );
}

export async function createForm(name?: string) {
  const forms = await loadForms();
  const now = Date.now();
  const form: FormDefinition = {
    id: createFormId(),
    name: name?.trim().slice(0, 48) || `新建填表 ${forms.filter((item) => !item.deletedAt).length + 1}`,
    description: "待配置：请先设置表格模板并补充训练样本。",
    status: "draft",
    ready: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    templateSource: "blank",
    sourceFormId: null,
  };
  const nextForms = [...forms, form];
  await saveForms(nextForms);
  await initializeBlankFormSpace(form.id);
  return form;
}

export async function updateForm(formId: string, patch: Partial<FormDefinition>) {
  const normalizedId = normalizeFormId(formId);
  const forms = await loadForms();
  const nextForms = forms.map((form) =>
    form.id === normalizedId
      ? {
          ...form,
          ...patch,
          id: normalizedId,
          updatedAt: Date.now(),
        }
      : form,
  );
  await saveForms(nextForms);
  return nextForms.find((form) => form.id === normalizedId) || null;
}

export async function softDeleteForm(formId: string) {
  if (!tenantActive() && normalizeFormId(formId) === DEFAULT_FORM_ID) {
    throw new Error("默认填表不能删除。");
  }
  return updateForm(formId, { deletedAt: Date.now() });
}

export async function restoreForm(formId: string) {
  return updateForm(formId, { deletedAt: null });
}

export async function permanentlyDeleteForm(formId: string) {
  if (!tenantActive() && normalizeFormId(formId) === DEFAULT_FORM_ID) {
    throw new Error("默认填表不能删除。");
  }
  const forms = await loadForms();
  const nextForms = forms.filter((form) => form.id !== normalizeFormId(formId));
  await saveForms(nextForms);
}

export async function markFormReady(formId: string) {
  return updateForm(formId, {
    ready: true,
    status: "ready",
    description: "已完成配置，可直接进入填表模式。",
  });
}

export async function cloneFormSpace(sourceFormId: string, targetFormId: string) {
  const [tableFields, rules, examples] = await Promise.all([
    loadTableFields(sourceFormId),
    loadGlobalRules(sourceFormId),
    loadTrainingExamples(sourceFormId),
  ]);

  await saveTableFields(cloneTableFields(tableFields), targetFormId);
  await saveGlobalRules(
    {
      ...rules,
      tableFields: cloneTableFields(rules.tableFields || tableFields),
      guidanceHistory: rules.guidanceHistory ? [...rules.guidanceHistory] : [],
      agentThread: rules.agentThread ? rules.agentThread.map((turn) => ({ ...turn })) : [],
      documents: Array.isArray(rules.documents) ? rules.documents.map((doc) => ({ ...doc })) : [],
    },
    targetFormId,
  );

  const copiedImages = new Set<string>();
  for (const example of examples) {
    const dataUrl = await getTrainingImageDataUrl(example.imageName, sourceFormId);
    if (dataUrl) {
      await saveTrainingImageDataUrl(example.imageName, dataUrl, targetFormId);
      copiedImages.add(example.imageName);
    }
    await upsertTrainingExample(
      {
        ...example,
        boxes: example.boxes?.map((box) => ({ ...box })),
        fieldAggregations: example.fieldAggregations ? { ...example.fieldAggregations } : undefined,
        output: {
          ...example.output,
          customFieldValues: example.output.customFieldValues
            ? { ...example.output.customFieldValues }
            : undefined,
        },
        tableOutput: example.tableOutput?.fieldValues
          ? {
              fieldValues: Object.fromEntries(
                Object.entries(example.tableOutput.fieldValues).map(([fieldId, series]) => [fieldId, [...series]]),
              ),
            }
          : undefined,
      },
      targetFormId,
    );
  }

  const rulesWithAssets = rules.agentThread || [];
  for (const turn of rulesWithAssets) {
    for (const asset of turn.assets || []) {
      if (asset.kind !== "image" || copiedImages.has(asset.imageName)) {
        continue;
      }
      const dataUrl = await getManagedImageDataUrl(asset.imageName, sourceFormId);
      if (!dataUrl) {
        continue;
      }
      if (isAgentContextImageName(asset.imageName)) {
        await saveAgentContextImageDataUrl(asset.imageName, dataUrl, targetFormId);
      } else {
        await saveTrainingImageDataUrl(asset.imageName, dataUrl, targetFormId);
      }
      copiedImages.add(asset.imageName);
    }
  }

  await cloneFormFilePools(sourceFormId, targetFormId);
}

export async function duplicateForm(sourceFormId: string) {
  const source = await getFormById(sourceFormId);
  if (!source) {
    throw new Error("源填表不存在。");
  }

  const forms = await loadForms();
  const now = Date.now();
  const duplicate: FormDefinition = {
    ...source,
    id: createFormId(),
    name: `${source.name} 副本`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    templateSource: "copied",
    sourceFormId: source.id,
  };

  await saveForms([...forms, duplicate]);
  await cloneFormSpace(source.id, duplicate.id);
  return duplicate;
}

export function getFormStatusLabel(form: FormDefinition) {
  return form.ready ? "已完成" : "新建中";
}

export function getRemainingRecycleDays(deletedAt: number | null | undefined) {
  if (!deletedAt) {
    return null;
  }
  const expireAt = deletedAt + FORM_RECYCLE_RETENTION_MS;
  const remaining = expireAt - Date.now();
  if (remaining <= 0) {
    return 0;
  }
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}
