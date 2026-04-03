import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getActiveTableFields } from "@/lib/table-fields";
import { loadTableFields } from "@/lib/table-fields-store";
import {
  saveTrainingImageDataUrl,
  type FieldAggregation,
  type TrainingBox,
  type TrainingField,
  type TrainingExample,
  upsertTrainingExample,
  loadTrainingExamples,
} from "@/lib/training";

type SaveTrainingPayload = {
  imageName?: unknown;
  imageDataUrl?: unknown;
  notes?: unknown;
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
    const hasField = (fieldId: string) => activeFieldIds.has(fieldId);

    const output = payload.output;
    const example: TrainingExample = {
      imageName,
      notes: normalizeText(payload.notes),
      output: {
        date: hasField("date") ? normalizeText(output?.date) : "",
        route: hasField("route") ? normalizeText(output?.route) : "",
        driver: hasField("driver") ? normalizeText(output?.driver) : "",
        taskCode: hasField("taskCode") ? normalizeText(output?.taskCode) || undefined : undefined,
        total: hasField("total") ? normalizeNumber(output?.total) || 0 : 0,
        totalSourceLabel: hasField("total") ? normalizeText(output?.totalSourceLabel) || undefined : undefined,
        unscanned: hasField("unscanned") ? normalizeNumber(output?.unscanned) || 0 : 0,
        exceptions: hasField("exceptions") ? normalizeNumber(output?.exceptions) || 0 : 0,
        waybillStatus: hasField("waybillStatus") ? normalizeText(output?.waybillStatus) || undefined : undefined,
        stationTeam: hasField("stationTeam") ? normalizeText(output?.stationTeam) || undefined : undefined,
        customFieldValues: normalizeCustomFieldValues(output?.customFieldValues, activeCustomFieldIds),
      },
      boxes: normalizeBoxes(payload.boxes, activeFieldIds),
      fieldAggregations: normalizeFieldAggregations(payload.fieldAggregations, activeFieldIds),
    };

    if (imageDataUrl) {
      await saveTrainingImageDataUrl(imageName, imageDataUrl);
    }

    // Only upsert the example to the database if it actually has some data (i.e. it's not just a raw image upload)
    let nextExamples = await loadTrainingExamples();
    if (
      example.output.date ||
      example.output.route ||
      example.output.driver ||
      example.output.taskCode ||
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
