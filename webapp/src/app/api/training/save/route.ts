import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getActiveTableFields, type TableFieldDefinition } from "@/lib/table-fields";
import { loadTableFields } from "@/lib/table-fields-store";
import {
  saveTrainingImageDataUrl,
  type FieldAggregation,
  type TrainingAnnotationMode,
  type TrainingBox,
  type TrainingField,
  type TrainingExample,
  type TrainingScalarValue,
  upsertTrainingExample,
  loadTrainingExamples,
} from "@/lib/training";

type SaveTrainingPayload = {
  imageName?: unknown;
  imageDataUrl?: unknown;
  notes?: unknown;
  annotationMode?: unknown;
  output?: {
    date?: unknown;
    route?: unknown;
    driver?: unknown;
    taskCode?: unknown;
    total?: unknown;
    totalSourceLabel?: unknown;
    unscanned?: unknown;
    exceptions?: unknown;
    waybillStatus?: unknown;
    stationTeam?: unknown;
    customFieldValues?: unknown;
  };
  boxes?: unknown;
  fieldAggregations?: unknown;
  tableOutput?: unknown;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeBoxes(value: unknown, allowedFieldIds?: ReadonlySet<string>): TrainingBox[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const box = item as Record<string, unknown>;
      const x = normalizeNumber(box.x);
      const y = normalizeNumber(box.y);
      const width = normalizeNumber(box.width);
      const height = normalizeNumber(box.height);
      const field = normalizeText(box.field);
      const boxValue = normalizeText(box.value);
      const idRaw = normalizeText(box.id);
      const cs = normalizeText(box.coordSpace);
      const coordSpace = cs === "image" || cs === "container" ? (cs as TrainingBox["coordSpace"]) : undefined;

      if (!field || (allowedFieldIds && !allowedFieldIds.has(field)) || x === null || y === null || width === null || height === null) {
        return null;
      }

      const out: TrainingBox = {
        field: field as TrainingBox["field"],
        value: boxValue,
        x,
        y,
        width,
        height,
      };
      if (coordSpace) {
        out.coordSpace = coordSpace;
      }
      if (idRaw) {
        out.id = idRaw.slice(0, 64);
      }
      return out;
    })
    .filter((box): box is TrainingBox => Boolean(box));
}

const AGGREGATION_VALUES = new Set<FieldAggregation>(["sum", "join_comma", "join_newline", "first"]);

function normalizeFieldAggregations(
  raw: unknown,
  allowedFieldIds?: ReadonlySet<string>,
): Partial<Record<TrainingField, FieldAggregation>> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: Partial<Record<TrainingField, FieldAggregation>> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (allowedFieldIds && !allowedFieldIds.has(key)) continue;
    if (typeof val !== "string" || !AGGREGATION_VALUES.has(val as FieldAggregation)) continue;
    out[key as TrainingField] = val as FieldAggregation;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeCustomFieldValues(
  raw: unknown,
  allowedFieldIds?: ReadonlySet<string>,
): Record<string, string | number | ""> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: Record<string, string | number | ""> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey || (allowedFieldIds && !allowedFieldIds.has(normalizedKey))) continue;
    const num = normalizeNumber(value);
    if (num !== null) {
      out[normalizedKey] = num;
      continue;
    }
    const text = normalizeText(value);
    if (text) {
      out[normalizedKey] = text;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeAnnotationMode(value: unknown): TrainingAnnotationMode {
  return value === "table" ? "table" : "record";
}

function trimTrailingEmptyEntries(values: TrainingScalarValue[]) {
  const next = [...values];
  while (next.length > 0 && next[next.length - 1] === "") {
    next.pop();
  }
  return next;
}

function normalizeTableFieldValues(
  raw: unknown,
  fieldMap: ReadonlyMap<string, TableFieldDefinition>,
): Record<string, TrainingScalarValue[]> | undefined {
  const source =
    raw && typeof raw === "object" && "fieldValues" in (raw as Record<string, unknown>)
      ? (raw as { fieldValues?: unknown }).fieldValues
      : raw;
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const out: Record<string, TrainingScalarValue[]> = {};
  for (const [fieldId, value] of Object.entries(source as Record<string, unknown>)) {
    const field = fieldMap.get(fieldId);
    if (!field) {
      continue;
    }

    const rawSeries =
      Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.replace(/\r/g, "").split("\n")
          : [];
    if (rawSeries.length === 0) {
      continue;
    }

    const normalized = trimTrailingEmptyEntries(
      rawSeries.map((item) => {
        if (typeof item === "number" && Number.isFinite(item)) {
          return item;
        }
        const text = normalizeText(item);
        if (!text) {
          return "";
        }
        if (field.type === "number") {
          const asNumber = normalizeNumber(text);
          return asNumber ?? text;
        }
        return text;
      }),
    );
    if (normalized.length > 0) {
      out[fieldId] = normalized;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function getFirstTableValue(
  fieldValues: Record<string, TrainingScalarValue[]> | undefined,
  fieldId: string,
): TrainingScalarValue {
  return fieldValues?.[fieldId]?.[0] ?? "";
}

function hasTableFieldValues(fieldValues: Record<string, TrainingScalarValue[]> | undefined) {
  return Boolean(
    fieldValues &&
      Object.values(fieldValues).some((series) => series.some((value) => value !== "" && value !== undefined && value !== null)),
  );
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const payload = (await request.json()) as SaveTrainingPayload;
    const imageName = normalizeText(payload.imageName);
    const imageDataUrl = normalizeText(payload.imageDataUrl);

    if (!imageName) {
      return NextResponse.json({ error: "Missing imageName." }, { status: 400 });
    }

    const tableFields = getActiveTableFields(await loadTableFields());
    const activeFieldIds = new Set(tableFields.map((field) => field.id));
    const activeCustomFieldIds = new Set(tableFields.filter((field) => !field.builtIn).map((field) => field.id));
    const fieldMap = new Map(tableFields.map((field) => [field.id, field] as const));
    const hasField = (fieldId: string) => activeFieldIds.has(fieldId);
    const annotationMode = normalizeAnnotationMode(payload.annotationMode);
    const tableFieldValues = normalizeTableFieldValues(payload.tableOutput, fieldMap);
    const firstValue = (fieldId: string) => getFirstTableValue(tableFieldValues, fieldId);
    const output = payload.output;
    const explicitCustomFieldValues = normalizeCustomFieldValues(output?.customFieldValues, activeCustomFieldIds);
    const mergedCustomFieldValues: Record<string, string | number | ""> = {
      ...(explicitCustomFieldValues || {}),
    };
    for (const field of tableFields.filter((field) => !field.builtIn)) {
      if (mergedCustomFieldValues[field.id] !== undefined) {
        continue;
      }
      const value = firstValue(field.id);
      if (value !== "") {
        mergedCustomFieldValues[field.id] = value;
      }
    }

    const example: TrainingExample = {
      imageName,
      notes: normalizeText(payload.notes),
      annotationMode,
      output: {
        date: hasField("date") ? normalizeText(output?.date) || normalizeText(firstValue("date")) : "",
        route: hasField("route") ? normalizeText(output?.route) || normalizeText(firstValue("route")) : "",
        driver: hasField("driver") ? normalizeText(output?.driver) || normalizeText(firstValue("driver")) : "",
        taskCode:
          hasField("taskCode") ? normalizeText(output?.taskCode) || normalizeText(firstValue("taskCode")) || undefined : undefined,
        total: hasField("total") ? normalizeNumber(output?.total) ?? normalizeNumber(firstValue("total")) ?? 0 : 0,
        totalSourceLabel: hasField("total") ? normalizeText(output?.totalSourceLabel) || undefined : undefined,
        unscanned: hasField("unscanned") ? normalizeNumber(output?.unscanned) ?? normalizeNumber(firstValue("unscanned")) ?? 0 : 0,
        exceptions: hasField("exceptions") ? normalizeNumber(output?.exceptions) ?? normalizeNumber(firstValue("exceptions")) ?? 0 : 0,
        waybillStatus:
          hasField("waybillStatus")
            ? normalizeText(output?.waybillStatus) || normalizeText(firstValue("waybillStatus")) || undefined
            : undefined,
        stationTeam:
          hasField("stationTeam")
            ? normalizeText(output?.stationTeam) || normalizeText(firstValue("stationTeam")) || undefined
            : undefined,
        customFieldValues: Object.keys(mergedCustomFieldValues).length > 0 ? mergedCustomFieldValues : undefined,
      },
      boxes: normalizeBoxes(payload.boxes, activeFieldIds),
      fieldAggregations: normalizeFieldAggregations(payload.fieldAggregations, activeFieldIds),
      tableOutput: annotationMode === "table" && tableFieldValues ? { fieldValues: tableFieldValues } : undefined,
    };

    if (imageDataUrl) {
      await saveTrainingImageDataUrl(imageName, imageDataUrl);
    }

    // Only upsert the example to the database if it actually has some data (i.e. it's not just a raw image upload)
    let nextExamples = await loadTrainingExamples();
    if (
      example.boxes?.length ||
      example.output.date ||
      example.output.route ||
      example.output.driver ||
      example.output.taskCode ||
      hasTableFieldValues(tableFieldValues) ||
      (example.output.customFieldValues && Object.keys(example.output.customFieldValues).length > 0) ||
      example.notes
    ) {
      nextExamples = await upsertTrainingExample(example);
    }
    return NextResponse.json({
      ok: true,
      saved: example,
      totalExamples: nextExamples.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save training example.",
      },
      { status: 500 },
    );
  }
}
