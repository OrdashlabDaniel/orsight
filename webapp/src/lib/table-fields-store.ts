import fs from "node:fs";
import path from "node:path";

import { DEFAULT_FORM_ID, STARTER_FORM_2_ID, getFormGlobalRulesStorageKey, normalizeFormId } from "@/lib/forms";
import { scopeTrainingExamplesImageName } from "@/lib/storage-tenant";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { DEFAULT_TABLE_FIELDS, normalizeTableFields, type TableFieldDefinition } from "@/lib/table-fields";

const GLOBAL_RULES_KEY = "__global_rules__";

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
  const storageKey = scopeTrainingExamplesImageName(
    normalizedFormId === DEFAULT_FORM_ID ? GLOBAL_RULES_KEY : getFormGlobalRulesStorageKey(normalizedFormId),
  );
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    return loadLocalTableFields(normalizedFormId);
  }

  try {
    const { data, error } = await admin
      .from("training_examples")
      .select("data")
      .eq("image_name", storageKey)
      .single();

    if (error || !data) {
      return shouldUseBlankFieldConfig(normalizedFormId) ? [] : cloneDefaultTableFields();
    }

    const row = data.data as { tableFields?: unknown };
    return normalizeTableFields(row.tableFields, {
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
  const storageKey = scopeTrainingExamplesImageName(
    normalizedFormId === DEFAULT_FORM_ID ? GLOBAL_RULES_KEY : getFormGlobalRulesStorageKey(normalizedFormId),
  );
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    saveLocalTableFields(normalized, normalizedFormId);
    return normalized;
  }

  const { data } = await admin
    .from("training_examples")
    .select("data")
    .eq("image_name", storageKey)
    .single();

  const current = data?.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : {};

  const { error } = await admin
    .from("training_examples")
    .upsert(
      {
        image_name: storageKey,
        data: {
          ...current,
          tableFields: normalized,
        },
      },
      { onConflict: "image_name" },
    );

  if (error) {
    throw new Error(`Failed to save table fields: ${error.message}`);
  }

  return normalized;
}
