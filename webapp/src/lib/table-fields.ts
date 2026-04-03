import type { PodRecord } from "@/lib/pod";

export type BuiltInFieldId =
  | "date"
  | "route"
  | "driver"
  | "taskCode"
  | "total"
  | "unscanned"
  | "exceptions"
  | "waybillStatus"
  | "stationTeam";

export type TableFieldType = "text" | "number";

export type TableFieldDefinition = {
  id: string;
  label: string;
  type: TableFieldType;
  active: boolean;
  builtIn: boolean;
};

export const TABLE_FIELDS_SYNC_EVENT = "orsight:table-fields-changed";
export const TABLE_FIELDS_SYNC_STORAGE_KEY = "orsight:table-fields-sync";

export const DEFAULT_TABLE_FIELDS: TableFieldDefinition[] = [
  { id: "date", label: "日期", type: "text", active: true, builtIn: true },
  { id: "route", label: "抽查路线", type: "text", active: true, builtIn: true },
  { id: "driver", label: "抽查司机", type: "text", active: true, builtIn: true },
  { id: "taskCode", label: "任务编码", type: "text", active: true, builtIn: true },
  { id: "total", label: "运单数量", type: "number", active: true, builtIn: true },
  { id: "unscanned", label: "未收数量", type: "number", active: true, builtIn: true },
  { id: "exceptions", label: "错扫数量", type: "number", active: true, builtIn: true },
  { id: "waybillStatus", label: "响应更新状态", type: "text", active: true, builtIn: true },
  { id: "stationTeam", label: "站点车队", type: "text", active: true, builtIn: true },
];

export function isBuiltInFieldId(fieldId: string): fieldId is BuiltInFieldId {
  return DEFAULT_TABLE_FIELDS.some((field) => field.id === fieldId && field.builtIn);
}

export function getDefaultFieldDefinition(fieldId: string): TableFieldDefinition | undefined {
  return DEFAULT_TABLE_FIELDS.find((field) => field.id === fieldId);
}

export function normalizeTableFields(raw: unknown): TableFieldDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_TABLE_FIELDS.map((field) => ({ ...field }));
  }

  const normalized: TableFieldDefinition[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }

    const fallback = getDefaultFieldDefinition(id);
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim().slice(0, 40)
        : fallback?.label || id;
    const type =
      record.type === "number" || record.type === "text"
        ? (record.type as TableFieldType)
        : fallback?.type || "text";
    const builtIn = typeof record.builtIn === "boolean" ? record.builtIn : Boolean(fallback?.builtIn);
    const active = typeof record.active === "boolean" ? record.active : true;

    normalized.push({
      id,
      label,
      type,
      active,
      builtIn,
    });
    seen.add(id);
  }

  return normalized.length > 0
    ? normalized
    : DEFAULT_TABLE_FIELDS.map((field) => ({ ...field }));
}

export function getActiveTableFields(fields: TableFieldDefinition[]) {
  return fields.filter((field) => field.active);
}

export function getFieldLabelMap(fields: TableFieldDefinition[]) {
  return Object.fromEntries(fields.map((field) => [field.id, field.label]));
}

export function getFieldTypeMap(fields: TableFieldDefinition[]) {
  return Object.fromEntries(fields.map((field) => [field.id, field.type])) as Record<string, TableFieldType>;
}

export function createCustomField(label: string): TableFieldDefinition {
  return {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: label.trim().slice(0, 40) || "新项目",
    type: "text",
    active: true,
    builtIn: false,
  };
}

export function getRecordFieldValue(record: PodRecord, field: TableFieldDefinition): string | number | "" {
  if (isBuiltInFieldId(field.id)) {
    return (record[field.id] as string | number | "" | undefined) ?? "";
  }
  return record.customFieldValues?.[field.id] ?? "";
}

export function broadcastTableFieldsChanged(fields: TableFieldDefinition[]) {
  if (typeof window === "undefined") {
    return;
  }

  const detail = {
    tableFields: fields,
    timestamp: Date.now(),
  };

  window.dispatchEvent(new CustomEvent(TABLE_FIELDS_SYNC_EVENT, { detail }));

  try {
    window.localStorage.setItem(TABLE_FIELDS_SYNC_STORAGE_KEY, JSON.stringify(detail));
  } catch {
    // Ignore storage write failures; same-tab custom event already covers live sync.
  }
}

export function hasRecordFieldValue(record: PodRecord, field: TableFieldDefinition): boolean {
  const value = getRecordFieldValue(record, field);
  return value !== "" && value !== undefined && value !== null;
}

export function setRecordFieldValue(
  record: PodRecord,
  field: TableFieldDefinition,
  rawValue: string,
): PodRecord {
  const value =
    field.type === "number"
      ? rawValue === ""
        ? ""
        : Number.isFinite(Number(rawValue))
          ? Number(rawValue)
          : ""
      : rawValue;

  if (isBuiltInFieldId(field.id)) {
    return {
      ...record,
      [field.id]: value,
    };
  }

  return {
    ...record,
    customFieldValues: {
      ...(record.customFieldValues || {}),
      [field.id]: value,
    },
  };
}
