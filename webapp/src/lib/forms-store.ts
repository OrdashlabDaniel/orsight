import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_FORM_ID,
  FORMS_MANIFEST_KEY,
  FORM_RECYCLE_RETENTION_MS,
  STARTER_FORM_2_ID,
  buildBlankTableFields,
  buildTenantStarterForms,
  cloneTableFields,
  createDefaultFormDefinition,
  createFormId,
  getFormGlobalRulesStorageKey,
  isUnmodifiedTenantGiftStub,
  normalizeFormId,
  normalizeForms,
  STANDARD_FINANCE_STARTER_TABLE_FIELDS,
  type FormDefinition,
} from "@/lib/forms";
import { getAuthUserOrSkip } from "@/lib/auth-server";
import { scopeTrainingExamplesImageName, tenantActive } from "@/lib/storage-tenant";
import { DEFAULT_TABLE_FIELDS, normalizeTableFields, type TableFieldDefinition } from "@/lib/table-fields";
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
  type GlobalRules,
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

const SHARED_LEGACY_MANIFEST_CUTOFF_MS = Date.parse("2026-04-17T00:00:00Z");

const IAH_ROUTE_STARTER_FIELDS: TableFieldDefinition[] = [
  { id: "date", type: "text", label: "日期", active: true, builtIn: true },
  { id: "route", type: "text", label: "抽查路线", active: true, builtIn: true },
  { id: "driver", type: "text", label: "抽查司机", active: true, builtIn: true },
  { id: "total", type: "number", label: "运单数量", active: true, builtIn: true },
  { id: "unscanned", type: "number", label: "未收数量", active: true, builtIn: true },
  { id: "exceptions", type: "number", label: "错扫数量", active: true, builtIn: true },
  { id: "waybillStatus", type: "text", label: "响应更新状态", active: true, builtIn: true },
  { id: "custom_iah_waybill_number", type: "text", label: "运单号", active: true, builtIn: false },
  { id: "taskCode", type: "text", label: "任务编码", active: true, builtIn: true },
  { id: "stationTeam", type: "text", label: "站点车队", active: false, builtIn: true },
];

const SHARED_ROUTE_STARTER_FIELDS: TableFieldDefinition[] = [
  { id: "date", type: "text", label: "日期", active: true, builtIn: true },
  { id: "route", type: "text", label: "抽查路线", active: true, builtIn: true },
  { id: "driver", type: "text", label: "抽查司机", active: true, builtIn: true },
  { id: "total", type: "number", label: "运单数量", active: true, builtIn: true },
  { id: "unscanned", type: "number", label: "未收数量", active: true, builtIn: true },
  { id: "exceptions", type: "number", label: "错扫数量", active: true, builtIn: true },
  { id: "waybillStatus", type: "text", label: "响应更新状态", active: true, builtIn: true },
  { id: "taskCode", type: "text", label: "任务编码", active: true, builtIn: true },
  { id: "stationTeam", type: "text", label: "站点车队", active: false, builtIn: true },
];

/** 旧版财务种子「Reimbursement Status」文案，用于识别未改元数据的赠送模板并同步到当前标准列。 */
const LEGACY_FINANCE_STARTER_V1_FIELDS: TableFieldDefinition[] = STANDARD_FINANCE_STARTER_TABLE_FIELDS.map((field) =>
  field.id === "custom_reimbursement_status"
    ? { ...field, label: "Reimbursement Status" }
    : field,
);

type StarterSeed = {
  forms: FormDefinition[];
  rulesByFormId: Map<string, GlobalRules>;
};

function cloneGlobalRules(rules: GlobalRules): GlobalRules {
  return JSON.parse(JSON.stringify(rules)) as GlobalRules;
}

function normalizeStarterFieldSet(raw: unknown) {
  return normalizeTableFields(raw, {
    preserveEmpty: true,
    appendMissingBuiltIns: false,
  });
}

function tableFieldSetsEqual(left: TableFieldDefinition[], right: TableFieldDefinition[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((field, index) => {
    const other = right[index];
    return (
      other != null &&
      field.id === other.id &&
      field.label === other.label &&
      field.type === other.type &&
      field.active === other.active &&
      field.builtIn === other.builtIn
    );
  });
}

function buildBlankStarterRules(tableFields: TableFieldDefinition[]): GlobalRules {
  return {
    instructions: "",
    documents: [],
    guidanceHistory: [],
    agentThread: [],
    workingRules: "",
    tableFields: cloneTableFields(tableFields),
  };
}

function normalizeStarterRulesPayload(raw: unknown): GlobalRules | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  return {
    instructions: typeof record.instructions === "string" ? record.instructions : "",
    documents: Array.isArray(record.documents)
      ? (JSON.parse(JSON.stringify(record.documents)) as GlobalRules["documents"])
      : [],
    guidanceHistory: Array.isArray(record.guidanceHistory)
      ? (JSON.parse(JSON.stringify(record.guidanceHistory)) as GlobalRules["guidanceHistory"])
      : [],
    agentThread: Array.isArray(record.agentThread)
      ? (JSON.parse(JSON.stringify(record.agentThread)) as GlobalRules["agentThread"])
      : [],
    workingRules: typeof record.workingRules === "string" ? record.workingRules : "",
    tableFields: normalizeStarterFieldSet(record.tableFields),
  };
}

function hasStarterRuleCustomizations(rules: GlobalRules) {
  return Boolean(
    rules.instructions.trim() ||
      rules.workingRules?.trim() ||
      (rules.documents?.length ?? 0) > 0 ||
      (rules.guidanceHistory?.length ?? 0) > 0 ||
      (rules.agentThread?.length ?? 0) > 0,
  );
}

function getLegacyStarterFieldSets(formId: string) {
  const normalizedId = normalizeFormId(formId);
  const financeV1 = normalizeStarterFieldSet(LEGACY_FINANCE_STARTER_V1_FIELDS);
  if (normalizedId === DEFAULT_FORM_ID) {
    return [
      normalizeStarterFieldSet(DEFAULT_TABLE_FIELDS),
      normalizeStarterFieldSet(SHARED_ROUTE_STARTER_FIELDS),
      normalizeStarterFieldSet(IAH_ROUTE_STARTER_FIELDS),
      financeV1,
    ];
  }
  if (normalizedId === STARTER_FORM_2_ID) {
    return [
      normalizeStarterFieldSet(DEFAULT_TABLE_FIELDS),
      normalizeStarterFieldSet(SHARED_ROUTE_STARTER_FIELDS),
      normalizeStarterFieldSet(IAH_ROUTE_STARTER_FIELDS),
      financeV1,
    ];
  }
  return [];
}

const ROUTE_AUDIT_FIELD_IDS = new Set([
  "route",
  "driver",
  "taskCode",
  "total",
  "unscanned",
  "exceptions",
  "waybillStatus",
  "stationTeam",
]);

function shouldForceFinanceGiftColumnResync(
  formId: string,
  currentFields: TableFieldDefinition[],
  desiredFields: TableFieldDefinition[],
): boolean {
  if (formId !== DEFAULT_FORM_ID && formId !== STARTER_FORM_2_ID) {
    return false;
  }
  const desiredNorm = normalizeStarterFieldSet(desiredFields);
  const standardFinance = normalizeStarterFieldSet(STANDARD_FINANCE_STARTER_TABLE_FIELDS);
  if (!tableFieldSetsEqual(desiredNorm, standardFinance)) {
    return false;
  }
  if (currentFields.some((field) => field.active && ROUTE_AUDIT_FIELD_IDS.has(field.id))) {
    return true;
  }
  if (formId === STARTER_FORM_2_ID && currentFields.length > standardFinance.length) {
    return true;
  }
  return false;
}

function shouldAutoSyncStarterRules(form: FormDefinition, currentRules: GlobalRules, desiredRules: GlobalRules) {
  if (form.deletedAt || !isUnmodifiedTenantGiftStub(form) || hasStarterRuleCustomizations(currentRules)) {
    return false;
  }

  const currentFields = normalizeStarterFieldSet(currentRules.tableFields);
  const desiredFields = normalizeStarterFieldSet(desiredRules.tableFields);
  if (tableFieldSetsEqual(currentFields, desiredFields)) {
    return false;
  }
  if (currentFields.length === 0) {
    return true;
  }
  if (getLegacyStarterFieldSets(form.id).some((legacyFields) => tableFieldSetsEqual(currentFields, legacyFields))) {
    return true;
  }
  return shouldForceFinanceGiftColumnResync(form.id, currentFields, desiredFields);
}

async function buildPreferredTenantStarterSeed(): Promise<StarterSeed> {
  const sharedManifest = await loadRemoteManifestByKey(FORMS_MANIFEST_KEY);
  const forms =
    buildTenantStarterFormsFromSharedManifest(sharedManifest) ||
    normalizeForms(buildTenantStarterForms(), { injectBuiltinDefault: false });
  const financeRules = buildBlankStarterRules(STANDARD_FINANCE_STARTER_TABLE_FIELDS);

  return {
    forms,
    rulesByFormId: new Map<string, GlobalRules>([[DEFAULT_FORM_ID, cloneGlobalRules(financeRules)]]),
  };
}

async function syncGiftStarterRuleConfigs(currentForms: FormDefinition[], rulesByFormId: Map<string, GlobalRules>) {
  for (const form of currentForms) {
    const desiredRules = rulesByFormId.get(form.id);
    if (!desiredRules) {
      continue;
    }
    const currentRules = await loadGlobalRules(form.id);
    if (!shouldAutoSyncStarterRules(form, currentRules, desiredRules)) {
      continue;
    }
    await saveGlobalRules(cloneGlobalRules(desiredRules), form.id);
  }
}

function buildTenantStarterFormsFromSharedManifest(manifest: Record<string, unknown> | null): FormDefinition[] | null {
  const active = manifest
    ? normalizeForms(manifest.forms, { injectBuiltinDefault: true }).filter((form) => !form.deletedAt)
    : [];
  if (active.length < 1) {
    return null;
  }

  const starter1 = createDefaultFormDefinition();
  return normalizeForms(
    [
      {
        ...starter1,
      },
    ],
    { injectBuiltinDefault: false },
  );
}

async function shouldRestoreSharedLegacyManifestIntoTenant() {
  if (!tenantActive()) {
    return false;
  }
  const { user, skipAuth } = await getAuthUserOrSkip();
  if (skipAuth || !user) {
    return true;
  }
  const createdAt = typeof user.created_at === "string" ? Date.parse(user.created_at) : Number.NaN;
  if (!Number.isFinite(createdAt)) {
    return true;
  }
  return createdAt < SHARED_LEGACY_MANIFEST_CUTOFF_MS;
}

function syncUnmodifiedGiftStarterForms(currentForms: FormDefinition[], starterForms: FormDefinition[]) {
  const starterById = new Map(starterForms.map((form) => [form.id, form] as const));
  let changed = false;
  const next = currentForms.map((form) => {
    if (form.deletedAt || !isUnmodifiedTenantGiftStub(form)) {
      return form;
    }
    const desired = starterById.get(form.id);
    if (!desired) {
      return form;
    }
    if (
      form.name === desired.name &&
      form.description === desired.description &&
      form.status === desired.status &&
      form.ready === desired.ready &&
      form.templateSource === desired.templateSource &&
      form.sourceFormId === desired.sourceFormId
    ) {
      return form;
    }
    changed = true;
    return {
      ...form,
      name: desired.name,
      description: desired.description,
      status: desired.status,
      ready: desired.ready,
      templateSource: desired.templateSource,
      sourceFormId: desired.sourceFormId ?? null,
      updatedAt: Date.now(),
    };
  });
  return {
    forms: normalizeForms(next, { injectBuiltinDefault: false }),
    changed,
  };
}

async function maybeSyncLegacyGiftStarterForms(
  currentForms: FormDefinition[],
  currentManifestData: Record<string, unknown> | null,
) {
  const starterSeed = await buildPreferredTenantStarterSeed();
  const synced = syncUnmodifiedGiftStarterForms(currentForms, starterSeed.forms);
  const nextForms = synced.changed ? synced.forms : currentForms;
  if (synced.changed) {
    await saveLegacyRemoteForms(nextForms, {
      ...(currentManifestData || {}),
      starterTemplatesSyncedAt: Date.now(),
    });
  }
  await syncGiftStarterRuleConfigs(nextForms, starterSeed.rulesByFormId);
  return nextForms;
}

async function maybeSyncRemoteGiftStarterForms(currentForms: FormDefinition[]) {
  const starterSeed = await buildPreferredTenantStarterSeed();
  const synced = syncUnmodifiedGiftStarterForms(currentForms, starterSeed.forms);
  const nextForms = synced.changed ? synced.forms : currentForms;
  if (synced.changed) {
    const persisted = await persistRemoteForms(nextForms);
    if (persisted) {
      await syncGiftStarterRuleConfigs(persisted, starterSeed.rulesByFormId);
      return persisted;
    }
  }
  await syncGiftStarterRuleConfigs(nextForms, starterSeed.rulesByFormId);
  return nextForms;
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
  if (!(await shouldRestoreSharedLegacyManifestIntoTenant())) {
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

  const starterSeed = await buildPreferredTenantStarterSeed();
  const starter = starterSeed.forms;
  const restored = await maybeRestoreLegacyFormsIntoLegacyManifest(null, starter);
  if (restored) {
    return restored;
  }
  await saveLegacyRemoteForms(starter);
  await seedStarterTableAndRules(starter, starterSeed.rulesByFormId);
  return starter;
}

async function maybeRestoreLegacyFormsIntoTenant(currentForms: FormDefinition[]) {
  if (!tenantActive()) {
    return null;
  }
  if (!(await shouldRestoreSharedLegacyManifestIntoTenant())) {
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

async function seedStarterTableAndRules(forms: FormDefinition[], rulesByFormId: Map<string, GlobalRules>) {
  for (const form of forms) {
    const starterRules = rulesByFormId.get(form.id) || buildBlankStarterRules(STANDARD_FINANCE_STARTER_TABLE_FIELDS);
    await saveGlobalRules(cloneGlobalRules(starterRules), form.id);
  }
}

/**
 * 从发布版租户表读取用户自己的填表清单。用户数据按 owner_id + form_id 存储，
 * 代码发布（git push）不会覆盖；仅在该租户尚无任何行时才会写入一份赠送模板。
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

  const starterSeed = await buildPreferredTenantStarterSeed();
  const starter = starterSeed.forms;
  const restored = await maybeRestoreLegacyFormsIntoTenant(starter);
  if (restored) {
    return restored;
  }
  const persisted = await persistRemoteForms(starter);
  if (!persisted) {
    return await loadLegacyRemoteForms();
  }
  await seedStarterTableAndRules(starter, starterSeed.rulesByFormId);
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
