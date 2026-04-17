import fs from "node:fs";
import path from "node:path";

import { DEFAULT_FORM_ID, STARTER_FORM_2_ID, normalizeFormId } from "@/lib/forms";
import { loadRemoteFormConfig, saveRemoteFormConfig } from "@/lib/form-config-db";
import { hasTenantDbAccess } from "@/lib/tenant-db";
import { DEFAULT_TABLE_FIELDS, normalizeTableFields, type TableFieldDefinition } from "@/lib/table-fields";

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

function cloneDefaultTableFields() {
  return DEFAULT_TABLE_FIELDS.map((field) => ({ ...field }));
}

function shouldUseBlankFieldConfig(formId = DEFAULT_FORM_ID) {
  const id = normalizeFormId(formId);
  return id !== DEFAULT_FORM_ID && id !== STARTER_FORM_2_ID;
}

function loadLocalTableFields(formId = DEFAULT_FORM_ID): TableFieldDefinition[] {
  const filePath = resolveLocalFieldConfigPath(formId);
  if (!fs.existsSync(filePath)) {
    return shouldUseBlankFieldConfig(formId) ? [] : cloneDefaultTableFields();
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { tableFields?: unknown };
    return normalizeTableFields(payload.tableFields, {
      preserveEmpty: shouldUseBlankFieldConfig(formId),
      appendMissingBuiltIns: !shouldUseBlankFieldConfig(formId),
    });
  } catch {
    return shouldUseBlankFieldConfig(formId) ? [] : cloneDefaultTableFields();
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
      return shouldUseBlankFieldConfig(normalizedFormId) ? [] : cloneDefaultTableFields();
    }
    return normalizeTableFields(config.tableFields, {
      preserveEmpty: shouldUseBlankFieldConfig(normalizedFormId),
      appendMissingBuiltIns: !shouldUseBlankFieldConfig(normalizedFormId),
    });
  } catch {
    return shouldUseBlankFieldConfig(normalizedFormId) ? [] : cloneDefaultTableFields();
  }
}

export async function saveTableFields(fields: TableFieldDefinition[], formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  const blankFieldConfig = shouldUseBlankFieldConfig(normalizedFormId);
  const normalized = normalizeTableFields(fields, {
    preserveEmpty: blankFieldConfig,
    appendMissingBuiltIns: !blankFieldConfig,
  });
  if (!hasTenantDbAccess()) {
    saveLocalTableFields(normalized, normalizedFormId);
    return normalized;
  }

  await saveRemoteFormConfig({ tableFields: normalized }, normalizedFormId);
  return normalized;
}
