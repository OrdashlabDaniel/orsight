import fs from "node:fs";
import path from "node:path";

import { DEFAULT_FORM_ID, STARTER_FORM_2_ID, STANDARD_FINANCE_STARTER_TABLE_FIELDS, normalizeFormId } from "@/lib/forms";
import { normalizeTableFields, type TableFieldDefinition } from "@/lib/table-fields";

function localFieldConfigPath(formId = DEFAULT_FORM_ID) {
  if (normalizeFormId(formId) !== DEFAULT_FORM_ID) {
    return path.join(process.cwd(), "training", "forms", formId, "table-fields.json");
  }
  return path.join(process.cwd(), "training", "table-fields.json");
}

function isGiftStarterFormId(formId = DEFAULT_FORM_ID) {
  const id = normalizeFormId(formId);
  return id === DEFAULT_FORM_ID || id === STARTER_FORM_2_ID;
}

function fallbackTableFields(formId = DEFAULT_FORM_ID): TableFieldDefinition[] {
  return isGiftStarterFormId(formId) ? STANDARD_FINANCE_STARTER_TABLE_FIELDS.map((field) => ({ ...field })) : [];
}

function normalizeStoredTableFields(raw: unknown, formId = DEFAULT_FORM_ID): TableFieldDefinition[] {
  const normalized = normalizeTableFields(raw, {
    preserveEmpty: true,
    appendMissingBuiltIns: false,
  });
  if (normalized.length === 0 && isGiftStarterFormId(formId)) {
    return fallbackTableFields(formId);
  }
  return normalized;
}

export function loadLocalTableFields(formId = DEFAULT_FORM_ID): TableFieldDefinition[] {
  const filePath = localFieldConfigPath(formId);
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

export function saveLocalTableFields(fields: TableFieldDefinition[], formId = DEFAULT_FORM_ID) {
  const filePath = localFieldConfigPath(formId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ tableFields: fields }, null, 2), "utf8");
}
