import fs from "node:fs";
import path from "node:path";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { DEFAULT_TABLE_FIELDS, normalizeTableFields, type TableFieldDefinition } from "@/lib/table-fields";

const GLOBAL_RULES_KEY = "__global_rules__";

function localFieldConfigCandidatePaths() {
  return [
    path.join(process.cwd(), "training", "table-fields.json"),
    path.resolve(process.cwd(), "..", "training", "table-fields.json"),
  ];
}

function resolveLocalFieldConfigPath() {
  return localFieldConfigCandidatePaths().find((filePath) => fs.existsSync(filePath)) || localFieldConfigCandidatePaths()[1];
}

function cloneDefaultTableFields() {
  return DEFAULT_TABLE_FIELDS.map((field) => ({ ...field }));
}

function loadLocalTableFields(): TableFieldDefinition[] {
  const filePath = resolveLocalFieldConfigPath();
  if (!fs.existsSync(filePath)) {
    return cloneDefaultTableFields();
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { tableFields?: unknown };
    return normalizeTableFields(payload.tableFields);
  } catch {
    return cloneDefaultTableFields();
  }
}

function saveLocalTableFields(fields: TableFieldDefinition[]) {
  const filePath = resolveLocalFieldConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ tableFields: fields }, null, 2), "utf8");
}

export async function loadTableFields(): Promise<TableFieldDefinition[]> {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    return loadLocalTableFields();
  }

  try {
    const { data, error } = await admin
      .from("training_examples")
      .select("data")
      .eq("image_name", GLOBAL_RULES_KEY)
      .single();

    if (error || !data) {
      return cloneDefaultTableFields();
    }

    const row = data.data as { tableFields?: unknown };
    return normalizeTableFields(row.tableFields);
  } catch {
    return cloneDefaultTableFields();
  }
}

export async function saveTableFields(fields: TableFieldDefinition[]) {
  const normalized = normalizeTableFields(fields);
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    saveLocalTableFields(normalized);
    return normalized;
  }

  const { data } = await admin
    .from("training_examples")
    .select("data")
    .eq("image_name", GLOBAL_RULES_KEY)
    .single();

  const current = data?.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : {};

  const { error } = await admin
    .from("training_examples")
    .upsert(
      {
        image_name: GLOBAL_RULES_KEY,
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
