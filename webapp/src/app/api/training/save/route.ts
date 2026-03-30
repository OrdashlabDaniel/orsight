import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
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
    total?: unknown;
    totalSourceLabel?: unknown;
    unscanned?: unknown;
    exceptions?: unknown;
    waybillStatus?: unknown;
    stationTeam?: unknown;
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

function normalizeBoxes(value: unknown): TrainingBox[] {
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

      if (!field || x === null || y === null || width === null || height === null) {
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

const TRAINING_FIELD_KEYS = new Set<string>([
  "date",
  "route",
  "driver",
  "total",
  "unscanned",
  "exceptions",
  "waybillStatus",
  "stationTeam",
]);

function normalizeFieldAggregations(raw: unknown): Partial<Record<TrainingField, FieldAggregation>> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: Partial<Record<TrainingField, FieldAggregation>> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!TRAINING_FIELD_KEYS.has(key)) continue;
    if (typeof val !== "string" || !AGGREGATION_VALUES.has(val as FieldAggregation)) continue;
    out[key as TrainingField] = val as FieldAggregation;
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

    const output = payload.output;
    const example: TrainingExample = {
      imageName,
      notes: normalizeText(payload.notes),
      output: {
        date: normalizeText(output?.date),
        route: normalizeText(output?.route),
        driver: normalizeText(output?.driver),
        total: normalizeNumber(output?.total) || 0,
        totalSourceLabel: normalizeText(output?.totalSourceLabel) || undefined,
        unscanned: normalizeNumber(output?.unscanned) || 0,
        exceptions: normalizeNumber(output?.exceptions) || 0,
        waybillStatus: normalizeText(output?.waybillStatus) || undefined,
        stationTeam: normalizeText(output?.stationTeam) || undefined,
      },
      boxes: normalizeBoxes(payload.boxes),
      fieldAggregations: normalizeFieldAggregations(payload.fieldAggregations),
    };

    if (imageDataUrl) {
      await saveTrainingImageDataUrl(imageName, imageDataUrl);
    }

    // Only upsert the example to the database if it actually has some data (i.e. it's not just a raw image upload)
    let nextExamples = await loadTrainingExamples();
    if (example.output.date || example.output.route || example.output.driver || example.notes) {
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
