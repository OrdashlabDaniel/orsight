import { DEFAULT_FORM_ID, getFormGlobalRulesStorageKey, normalizeFormId } from "@/lib/forms";
import { scopeTrainingExamplesImageName, tenantActive } from "@/lib/storage-tenant";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hasTenantDbAccess, requireTenantDbAccess } from "@/lib/tenant-db";

const FORM_CONFIGS_TABLE = "app_form_configs";
const GLOBAL_RULES_KEY = "__global_rules__";

export type StoredFormConfig = {
  instructions: string;
  documents: unknown[];
  guidanceHistory: unknown[];
  agentThread: unknown[];
  workingRules?: string;
  tableFields?: unknown;
};

type RemoteFormConfigRow = {
  owner_id: string;
  form_id: string;
  instructions: string | null;
  documents: unknown;
  guidance_history: unknown;
  agent_thread: unknown;
  working_rules: string | null;
  table_fields: unknown;
};

function normalizeStoredFormConfig(raw: Partial<StoredFormConfig> | null | undefined): StoredFormConfig {
  return {
    instructions: typeof raw?.instructions === "string" ? raw.instructions : "",
    documents: Array.isArray(raw?.documents) ? raw.documents : [],
    guidanceHistory: Array.isArray(raw?.guidanceHistory) ? raw.guidanceHistory : [],
    agentThread: Array.isArray(raw?.agentThread) ? raw.agentThread : [],
    ...(typeof raw?.workingRules === "string" ? { workingRules: raw.workingRules } : {}),
    ...(raw && Object.prototype.hasOwnProperty.call(raw, "tableFields") ? { tableFields: raw.tableFields } : {}),
  };
}

function mapRemoteFormConfigRow(row: RemoteFormConfigRow): StoredFormConfig {
  return normalizeStoredFormConfig({
    instructions: row.instructions || "",
    documents: Array.isArray(row.documents) ? row.documents : [],
    guidanceHistory: Array.isArray(row.guidance_history) ? row.guidance_history : [],
    agentThread: Array.isArray(row.agent_thread) ? row.agent_thread : [],
    workingRules: typeof row.working_rules === "string" ? row.working_rules : "",
    tableFields: row.table_fields,
  });
}

function buildRemoteFormConfigRow(ownerId: string, formId: string, config: StoredFormConfig): RemoteFormConfigRow {
  const normalized = normalizeStoredFormConfig(config);
  return {
    owner_id: ownerId,
    form_id: normalizeFormId(formId),
    instructions: normalized.instructions,
    documents: normalized.documents,
    guidance_history: normalized.guidanceHistory,
    agent_thread: normalized.agentThread,
    working_rules: normalized.workingRules ?? "",
    table_fields: normalized.tableFields ?? [],
  };
}

async function loadRemoteFormConfigFromTable(formId = DEFAULT_FORM_ID): Promise<StoredFormConfig | null> {
  const normalizedFormId = normalizeFormId(formId);
  const { ownerId, client } = requireTenantDbAccess();
  const { data, error } = await client
    .from(FORM_CONFIGS_TABLE)
    .select("owner_id,form_id,instructions,documents,guidance_history,agent_thread,working_rules,table_fields")
    .eq("owner_id", ownerId)
    .eq("form_id", normalizedFormId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return mapRemoteFormConfigRow(data as RemoteFormConfigRow);
}

async function upsertRemoteFormConfigRaw(config: StoredFormConfig, formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  const { ownerId, client } = requireTenantDbAccess();
  const { error } = await client
    .from(FORM_CONFIGS_TABLE)
    .upsert(buildRemoteFormConfigRow(ownerId, normalizedFormId, config), { onConflict: "owner_id,form_id" });

  if (error) {
    throw new Error(`Failed to save form config: ${error.message}`);
  }
}

async function loadLegacyFormConfig(formId: string): Promise<StoredFormConfig | null> {
  if (!tenantActive()) {
    return null;
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return null;
  }
  const normalizedFormId = normalizeFormId(formId);
  const legacyStorageKey = scopeTrainingExamplesImageName(
    normalizedFormId === DEFAULT_FORM_ID ? GLOBAL_RULES_KEY : getFormGlobalRulesStorageKey(normalizedFormId),
  );
  const { data, error } = await admin.from("training_examples").select("data").eq("image_name", legacyStorageKey).single();
  if (error || !data?.data || typeof data.data !== "object") {
    return null;
  }

  const legacy = data.data as {
    instructions?: unknown;
    documents?: unknown;
    guidanceHistory?: unknown;
    agentThread?: unknown;
    workingRules?: unknown;
    tableFields?: unknown;
  };

  return normalizeStoredFormConfig({
    instructions: typeof legacy.instructions === "string" ? legacy.instructions : "",
    documents: Array.isArray(legacy.documents) ? legacy.documents : [],
    guidanceHistory: Array.isArray(legacy.guidanceHistory) ? legacy.guidanceHistory : [],
    agentThread: Array.isArray(legacy.agentThread) ? legacy.agentThread : [],
    workingRules: typeof legacy.workingRules === "string" ? legacy.workingRules : "",
    tableFields: legacy.tableFields,
  });
}

export async function loadRemoteFormConfig(formId = DEFAULT_FORM_ID): Promise<StoredFormConfig | null> {
  if (!hasTenantDbAccess()) {
    return null;
  }

  const direct = await loadRemoteFormConfigFromTable(formId);
  if (direct) {
    return direct;
  }

  const legacy = await loadLegacyFormConfig(formId);
  if (!legacy) {
    return null;
  }

  await upsertRemoteFormConfigRaw(legacy, formId);
  return legacy;
}

export async function saveRemoteFormConfig(
  patch: Partial<StoredFormConfig>,
  formId = DEFAULT_FORM_ID,
): Promise<StoredFormConfig> {
  const normalizedFormId = normalizeFormId(formId);
  const current =
    (await loadRemoteFormConfigFromTable(normalizedFormId)) ||
    (await loadLegacyFormConfig(normalizedFormId)) ||
    normalizeStoredFormConfig(null);
  const next = normalizeStoredFormConfig({
    ...current,
    ...patch,
    documents: Object.prototype.hasOwnProperty.call(patch, "documents") ? patch.documents : current.documents,
    guidanceHistory: Object.prototype.hasOwnProperty.call(patch, "guidanceHistory")
      ? patch.guidanceHistory
      : current.guidanceHistory,
    agentThread: Object.prototype.hasOwnProperty.call(patch, "agentThread") ? patch.agentThread : current.agentThread,
    tableFields: Object.prototype.hasOwnProperty.call(patch, "tableFields") ? patch.tableFields : current.tableFields,
  });

  await upsertRemoteFormConfigRaw(next, normalizedFormId);
  return next;
}
