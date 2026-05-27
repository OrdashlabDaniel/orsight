import { DEFAULT_FORM_ID, STANDARD_FINANCE_STARTER_TABLE_FIELDS, STARTER_FORM_2_ID, normalizeFormId } from "@/lib/forms";
import { loadRemoteFormConfig, saveRemoteFormConfig } from "@/lib/form-config-db";
import { tenantActive } from "@/lib/storage-tenant";
import { hasTenantDbAccess } from "@/lib/tenant-db";
import { normalizeTableFields, type TableFieldDefinition } from "@/lib/table-fields";

function isGiftStarterFormId(formId = DEFAULT_FORM_ID) {
  const id = normalizeFormId(formId);
  return id === DEFAULT_FORM_ID || id === STARTER_FORM_2_ID;
}

function cloneGiftStarterTableFields() {
  return STANDARD_FINANCE_STARTER_TABLE_FIELDS.map((field) => ({ ...field }));
}

function fallbackTableFields(formId = DEFAULT_FORM_ID): TableFieldDefinition[] {
  return isGiftStarterFormId(formId) ? cloneGiftStarterTableFields() : [];
}

function normalizeStoredTableFields(raw: unknown, formId = DEFAULT_FORM_ID): TableFieldDefinition[] {
  const normalized = normalizeTableFields(raw, {
    preserveEmpty: true,
    appendMissingBuiltIns: false,
  });
  if (normalized.length === 0 && isGiftStarterFormId(formId)) {
    return cloneGiftStarterTableFields();
  }
  return normalized;
}

export async function loadTableFields(formId = DEFAULT_FORM_ID): Promise<TableFieldDefinition[]> {
  const normalizedFormId = normalizeFormId(formId);
  if (!hasTenantDbAccess()) {
    if (tenantActive() || process.env.NODE_ENV === "production") {
      return fallbackTableFields(normalizedFormId);
    }

    const { loadLocalTableFields } = await import("@/lib/table-fields-local-store");
    return loadLocalTableFields(normalizedFormId);
  }

  try {
    const config = await loadRemoteFormConfig(normalizedFormId);
    if (!config) {
      return fallbackTableFields(normalizedFormId);
    }
    return normalizeStoredTableFields(config.tableFields, normalizedFormId);
  } catch {
    return fallbackTableFields(normalizedFormId);
  }
}

export async function saveTableFields(fields: TableFieldDefinition[], formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  const normalized = normalizeStoredTableFields(fields, normalizedFormId);
  if (!hasTenantDbAccess()) {
    if (tenantActive() || process.env.NODE_ENV === "production") {
      throw new Error("Tenant-scoped table field storage is unavailable.");
    }

    const { saveLocalTableFields } = await import("@/lib/table-fields-local-store");
    saveLocalTableFields(normalized, normalizedFormId);
    return normalized;
  }

  await saveRemoteFormConfig({ tableFields: normalized }, normalizedFormId);
  return normalized;
}
