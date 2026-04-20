import fs from "node:fs";
import path from "node:path";

import { DEFAULT_FORM_ID, STANDARD_FINANCE_STARTER_TABLE_FIELDS, STARTER_FORM_2_ID, normalizeFormId } from "@/lib/forms";
import { loadRemoteFormConfig, saveRemoteFormConfig } from "@/lib/form-config-db";
import { hasTenantDbAccess } from "@/lib/tenant-db";
import { normalizeTableFields, type TableFieldDefinition } from "@/lib/table-fields";

function localFieldConfigCandidatePaths(formId = DEFAULT_FORM_ID) {
  if (normalizeFormId(formId) !== DEFAULT_FORM_ID) {
    return [
      path.join(process.cwd(), "training", "forms", formId, "table-fields.json"),
      path.resolve(process.cwd(), "..", "training", "forms", formId, "table-fields.json"),
    ];
  }
  return [
    path.join(process.cwd(), "training", "table-fields.json"),
    path.resolve(process.cwd(), "..", "training", "table-fields.json"),
  ];
}

function resolveLocalFieldConfigPath(formId = DEFAULT_FORM_ID) {
  return (
    localFieldConfigCandidatePaths(formId).find((filePath) => fs.existsSync(filePath)) ||
    localFieldConfigCandidatePaths(formId)[1]
  );
}

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

function loadLocalTableFields(formId = DEFAULT_FORM_ID): TableFieldDefinition[] {
  const filePath = resolveLocalFieldConfigPath(formId);
  if (!fs.existsSync(filePath)) {
    return fallbackTableFields(formId);
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { tableFields?: unknown };
    return normalizeStoredTableFields(payload.tableFields, formId);
  } catch {
    return fallbackTableFields(formId);
  }
}

function saveLocalTableFields(fields: TableFieldDefinition[], formId = DEFAULT_FORM_ID) {
  const filePath = resolveLocalFieldConfigPath(formId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ tableFields: fields }, null, 2), "utf8");
}

export async function loadTableFields(formId = DEFAULT_FORM_ID): Promise<TableFieldDefinition[]> {
  const normalizedFormId = normalizeFormId(formId);
  if (!hasTenantDbAccess()) {
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
    saveLocalTableFields(normalized, normalizedFormId);
    return normalized;
  }

  await saveRemoteFormConfig({ tableFields: normalized }, normalizedFormId);
  return normalized;
}
