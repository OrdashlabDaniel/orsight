import { NextResponse } from "next/server";
import sharp from "sharp";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import type { FieldAggregation, TrainingField } from "@/lib/training";
import {
  DEFAULT_TABLE_FIELDS,
  getActiveTableFields,
  getFieldLabelMap,
  getFieldTypeMap,
  isBuiltInFieldId,
  normalizeTableFields,
  type TableFieldDefinition,
} from "@/lib/table-fields";
import { loadTableFields } from "@/lib/table-fields-store";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PREVIEW_MODEL = process.env.OPENAI_PREVIEW_MODEL || process.env.OPENAI_PRIMARY_MODEL || "gpt-5-mini";
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "minimal";

const DEFAULT_FIELD_LABELS = getFieldLabelMap(DEFAULT_TABLE_FIELDS);
const DEFAULT_FIELD_TYPES = getFieldTypeMap(DEFAULT_TABLE_FIELDS);

type BoxPayload = {
  field?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
};

type PreviewRequestBody = {
  imageDataUrl?: unknown;
  boxes?: unknown;
  fieldAggregations?: unknown;
  tableFields?: unknown;
  annotationMode?: unknown;
};

type AnnotationMode = "record" | "table";
type PreviewTableFieldValues = Record<string, Array<string | number | "">>;

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAnnotationMode(value: unknown): AnnotationMode {
  return value === "table" ? "table" : "record";
}

function normalizeBoxes(
  raw: unknown,
  allowedFieldIds: Set<string>,
): Array<{ field: TrainingField; x: number; y: number; width: number; height: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ field: TrainingField; x: number; y: number; width: number; height: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const box = item as BoxPayload;
    const field = normalizeText(box.field);
    if (!field || !allowedFieldIds.has(field)) continue;
    const x = normalizeNumber(box.x);
    const y = normalizeNumber(box.y);
    const width = normalizeNumber(box.width);
    const height = normalizeNumber(box.height);
    if (x === null || y === null || width === null || height === null) continue;
    out.push({ field, x, y, width, height });
  }
  return out;
}

function normalizeAggregations(
  raw: unknown,
  allowedFieldIds: Set<string>,
): Partial<Record<TrainingField, FieldAggregation>> {
  const allowed = new Set<FieldAggregation>(["sum", "join_comma", "join_newline", "first"]);
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<TrainingField, FieldAggregation>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedFieldIds.has(key)) continue;
    if (typeof value === "string" && allowed.has(value as FieldAggregation)) {
      out[key] = value as FieldAggregation;
    }
  }
  return out;
}

function inferAggregation(
  field: TrainingField,
  boxCount: number,
  fieldTypeMap: Record<string, "text" | "number">,
): FieldAggregation {
  if (boxCount <= 1) return "first";
  return fieldTypeMap[field] === "number" ? "sum" : "join_comma";
}

function describeAggregation(mode: FieldAggregation): string {
  switch (mode) {
    case "sum":
      return "数字相加：每个子区域读出一个数（读不出视为 0），再求和作为该字段值";
    case "join_comma":
      return "逗号并列：按子区域顺序用英文逗号连接读到的文本";
    case "join_newline":
      return "换行并列：按子区域顺序用换行符连接读到的文本";
    case "first":
      return "仅采用第一个子区域的读数，忽略其余同字段框";
    default:
      return "";
  }
}

function parseDataUrlToBuffer(dataUrl: string): Buffer | null {
  const trimmed = dataUrl.trim();
  const index = trimmed.indexOf("base64,");
  if (index < 0) return null;
  try {
    return Buffer.from(trimmed.slice(index + "base64,".length), "base64");
  } catch {
    return null;
  }
}

async function cropsToPngDataUrls(
  imageBuffer: Buffer,
  boxes: Array<{ field: TrainingField; x: number; y: number; width: number; height: number }>,
): Promise<string[]> {
  const meta = await sharp(imageBuffer).metadata();
  const imageWidth = meta.width ?? 0;
  const imageHeight = meta.height ?? 0;
  if (!imageWidth || !imageHeight) {
    throw new Error("无法读取图片宽高");
  }

  const out: string[] = [];
  for (const box of boxes) {
    let left = Math.floor(box.x * imageWidth);
    let top = Math.floor(box.y * imageHeight);
    let width = Math.ceil(box.width * imageWidth);
    let height = Math.ceil(box.height * imageHeight);

    left = Math.max(0, Math.min(imageWidth - 1, left));
    top = Math.max(0, Math.min(imageHeight - 1, top));
    width = Math.max(1, Math.min(imageWidth - left, width));
    height = Math.max(1, Math.min(imageHeight - top, height));

    const cropBuffer = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .png()
      .toBuffer();
    out.push(`data:image/png;base64,${cropBuffer.toString("base64")}`);
  }
  return out;
}

function buildCropInstructionText(
  boxes: Array<{ field: TrainingField; x: number; y: number; width: number; height: number }>,
  aggregations: Partial<Record<TrainingField, FieldAggregation>>,
  tableFields: TableFieldDefinition[],
  fieldLabels: Record<string, string>,
  fieldTypeMap: Record<string, "text" | "number">,
): string {
  const byField = new Map<TrainingField, typeof boxes>();
  for (const box of boxes) {
    const list = byField.get(box.field) || [];
    list.push(box);
    byField.set(box.field, list);
  }

  const customFields = tableFields.filter((field) => !isBuiltInFieldId(field.id));
  const builtInKeys = tableFields.filter((field) => isBuiltInFieldId(field.id)).map((field) => field.id);
  const boxedCustomFields = customFields.filter((field) => byField.has(field.id));

  const lines: string[] = [
    `下面会附上 ${boxes.length} 张裁剪小图（PNG），顺序固定：第 1 张对应第 1 个框，以此类推。`,
    "每张图里只包含原图中该矩形框内的像素，禁止臆造框外文字。",
    "",
    "字段与图片对应关系：",
  ];

  boxes.forEach((box, index) => {
    lines.push(`图${index + 1} -> 【${fieldLabels[box.field] || DEFAULT_FIELD_LABELS[box.field] || box.field}】（JSON 键名 ${box.field}）`);
  });

  lines.push("", "同字段多张小图时的合并规则：");
  for (const [field, fieldBoxes] of byField) {
    if (fieldBoxes.length <= 1) continue;
    const indices = boxes
      .map((box, index) => (box.field === field ? index + 1 : -1))
      .filter((index) => index > 0);
    const mode = aggregations[field] ?? inferAggregation(field, fieldBoxes.length, fieldTypeMap);
    lines.push(
      `- ${field}（${fieldLabels[field] || DEFAULT_FIELD_LABELS[field] || field}）：对应 图${indices.join("、图")}；${describeAggregation(mode)}`,
    );
  }

  lines.push(
    "",
    "请输出一个 JSON 对象。",
    `内置字段可直接作为顶层键输出：${builtInKeys.join(", ")}。`,
    "若某个字段在这些小图里读不出来，请输出 null、空字符串，或直接省略。",
    "previewNote 可选，用来说明哪些字段还不确定。",
  );

  if (boxedCustomFields.length > 0) {
    lines.push(
      `自定义字段请统一写入 customFieldValues 对象，键必须严格使用字段 id。当前参与试填的自定义字段有：${boxedCustomFields
        .map((field) => `${field.id}（${field.label}）`)
        .join("、")}。`,
    );
  }

  return lines.join("\n");
}

function buildTableCropInstructionText(
  boxes: Array<{ field: TrainingField; x: number; y: number; width: number; height: number }>,
  aggregations: Partial<Record<TrainingField, FieldAggregation>>,
  tableFields: TableFieldDefinition[],
  fieldLabels: Record<string, string>,
  fieldTypeMap: Record<string, "text" | "number">,
): string {
  const byField = new Map<TrainingField, typeof boxes>();
  for (const box of boxes) {
    const list = byField.get(box.field) || [];
    list.push(box);
    byField.set(box.field, list);
  }

  const lines: string[] = [
    `下面会附上 ${boxes.length} 张裁剪小图（PNG），每张图通常对应整张表格中的一列或一段列区域。`,
    "请对每张小图只做列内 OCR：按表格从上到下读取当前列每一行的值，返回数组。",
    "不要把列标题、分页、按钮（如查看/打印）、序号、空白装饰当成数据行。",
    "如果同一字段有多张小图，请分别为每张图返回数组；服务器会按字段聚合规则合并它们。",
    "",
    "图片与字段对应关系：",
  ];

  boxes.forEach((box, index) => {
    lines.push(`图${index + 1} -> 【${fieldLabels[box.field] || box.field}】（JSON 键名 ${box.field}）`);
  });

  lines.push("", "同字段多张图时的聚合规则：");
  for (const [field, fieldBoxes] of byField) {
    if (fieldBoxes.length <= 1) {
      continue;
    }
    const indices = boxes
      .map((box, index) => (box.field === field ? index + 1 : -1))
      .filter((index) => index > 0);
    const mode = aggregations[field] ?? inferAggregation(field, fieldBoxes.length, fieldTypeMap);
    lines.push(
      `- ${fieldLabels[field] || field}：图${indices.join("、图")}；${describeAggregation(mode)}。在完整表格模式下，这表示按“同一行”对齐后再聚合。`,
    );
  }

  const customFields = tableFields.filter((field) => !isBuiltInFieldId(field.id));
  if (customFields.length > 0) {
    lines.push(
      "",
      `自定义字段同样直接用字段 id 输出。当前可能出现的自定义字段有：${customFields
        .map((field) => `${field.id}（${field.label}）`)
        .join("、")}。`,
    );
  }

  lines.push(
    "",
    "请只返回合法 JSON，格式如下：",
    `{`,
    `  "imageValues": {`,
    `    "1": ["第1行值", "第2行值"],`,
    `    "2": ["第1行值", "第2行值"]`,
    `  },`,
    `  "previewNote": "可选说明"`,
    `}`,
  );

  return lines.join("\n");
}

function parsePreviewJson(content: string): { record: Record<string, unknown>; previewNote: string } {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const previewNote = typeof parsed.previewNote === "string" ? parsed.previewNote.trim() : "";
  const record = { ...parsed };
  delete record.previewNote;
  return { record, previewNote };
}

function parseTablePreviewJson(content: string): {
  imageValues: Record<string, unknown>;
  previewNote: string;
} {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const previewNote = typeof parsed.previewNote === "string" ? parsed.previewNote.trim() : "";
  const imageValues =
    parsed.imageValues && typeof parsed.imageValues === "object"
      ? (parsed.imageValues as Record<string, unknown>)
      : {};
  return { imageValues, previewNote };
}

function normalizeCustomFieldPreviewValue(
  field: TableFieldDefinition,
  value: unknown,
): string | number | "" {
  if (field.type === "number") {
    return normalizeNumber(value) ?? "";
  }
  const text = normalizeText(value);
  if (text) return text;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function trimTrailingEmptyEntries(values: Array<string | number | "">) {
  const next = [...values];
  while (next.length > 0 && next[next.length - 1] === "") {
    next.pop();
  }
  return next;
}

function normalizeTablePreviewSeries(
  field: TableFieldDefinition,
  raw: unknown,
): Array<string | number | ""> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return trimTrailingEmptyEntries(raw.map((value) => normalizeCustomFieldPreviewValue(field, value)));
}

function mergeTablePreviewSeries(
  seriesList: Array<Array<string | number | "">>,
  mode: FieldAggregation,
  fieldType: "text" | "number",
): Array<string | number | ""> {
  if (seriesList.length === 0) {
    return [];
  }
  if (seriesList.length === 1 || mode === "first") {
    return trimTrailingEmptyEntries(seriesList[0] || []);
  }

  const maxLength = seriesList.reduce((max, series) => Math.max(max, series.length), 0);
  const merged: Array<string | number | ""> = [];
  for (let index = 0; index < maxLength; index += 1) {
    const values = seriesList.map((series) => series[index] ?? "");
    if (mode === "sum" && fieldType === "number") {
      const total = values.reduce<number>((sum, value) => {
        if (typeof value === "number" && Number.isFinite(value)) {
          return sum + value;
        }
        const parsed = normalizeNumber(value);
        return parsed !== null ? sum + parsed : sum;
      }, 0);
      merged.push(total);
      continue;
    }

    const textValues = values
      .map((value) => (typeof value === "number" ? String(value) : normalizeText(value)))
      .filter(Boolean);
    if (textValues.length === 0) {
      merged.push("");
      continue;
    }
    merged.push(mode === "join_newline" ? textValues.join("\n") : textValues.join(","));
  }

  return trimTrailingEmptyEntries(merged);
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "??? OPENAI_API_KEY?" }, { status: 503 });
    }

    const body = (await request.json()) as PreviewRequestBody;
    const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";
    if (!imageDataUrl.startsWith("data:") || imageDataUrl.length > 14 * 1024 * 1024) {
      return NextResponse.json({ error: "缺少图片数据。" }, { status: 400 });
    }

    const requestedFields = Array.isArray(body.tableFields)
      ? normalizeTableFields(body.tableFields)
      : await loadTableFields();
    const activeTableFields = getActiveTableFields(requestedFields.length ? requestedFields : DEFAULT_TABLE_FIELDS);
    const fieldLabels = {
      ...DEFAULT_FIELD_LABELS,
      ...getFieldLabelMap(activeTableFields),
    };
    const fieldTypeMap = {
      ...DEFAULT_FIELD_TYPES,
      ...getFieldTypeMap(activeTableFields),
    };
    const allowedFieldIds = new Set(activeTableFields.map((field) => field.id));

    const boxes = normalizeBoxes(body.boxes, allowedFieldIds);
    if (boxes.length === 0) {
      return NextResponse.json({ error: "请至少提供一个有效标注框。" }, { status: 400 });
    }

    const fieldAggregations = normalizeAggregations(body.fieldAggregations, allowedFieldIds);
    const annotationMode = normalizeAnnotationMode(body.annotationMode);
    const fieldMap = new Map(activeTableFields.map((field) => [field.id, field] as const));
    const imageBuffer = parseDataUrlToBuffer(imageDataUrl);
    if (!imageBuffer || imageBuffer.length === 0) {
      return NextResponse.json({ error: "无法解析图片内容。" }, { status: 400 });
    }

    let cropUrls: string[];
    try {
      cropUrls = await cropsToPngDataUrls(imageBuffer, boxes);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "裁剪图片失败。" },
        { status: 400 },
      );
    }

    const userText =
      annotationMode === "table"
        ? buildTableCropInstructionText(boxes, fieldAggregations, activeTableFields, fieldLabels, fieldTypeMap)
        : buildCropInstructionText(boxes, fieldAggregations, activeTableFields, fieldLabels, fieldTypeMap);

    const systemText =
      annotationMode === "table"
        ? "你是 OrSight 的训练标注辅助模型。当前任务是完整表格模式，请只根据每张裁剪小图读出该列从上到下的所有行值，并严格返回 JSON。不要臆造缺失行，不要把列标题、按钮、分页、操作链接当成数据。"
        : "你是 OrSight 的训练标注辅助模型。当前任务是单条记录模式，请只根据每张裁剪小图读出对应字段的值，并严格返回 JSON。不要臆造框外文字，不要把邻近字段误填进当前字段。";

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: userText }];
    for (const url of cropUrls) {
      userContent.push({ type: "image_url", image_url: { url } });
    }

    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: PREVIEW_MODEL,
        reasoning_effort: OPENAI_REASONING_EFFORT,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `模型预览调用失败 ${response.status}: ${text.slice(0, 400)}` }, { status: 502 });
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "模型未返回可用内容" }, { status: 502 });
    }

    if (annotationMode === "table") {
      let parsedImageValues: Record<string, unknown>;
      let previewNote = "";
      try {
        const parsed = parseTablePreviewJson(content);
        parsedImageValues = parsed.imageValues;
        previewNote = parsed.previewNote;
      } catch {
        return NextResponse.json({ error: "完整表格试填返回的 JSON 无法解析" }, { status: 502 });
      }

      const byField = new Map<TrainingField, Array<Array<string | number | "">>>();
      boxes.forEach((box, index) => {
        const field = fieldMap.get(box.field);
        if (!field) {
          return;
        }
        const series = normalizeTablePreviewSeries(field, parsedImageValues[String(index + 1)]);
        const current = byField.get(box.field) || [];
        current.push(series);
        byField.set(box.field, current);
      });

      const tableFieldValues: PreviewTableFieldValues = {};
      for (const field of activeTableFields) {
        const seriesList = byField.get(field.id) || [];
        if (seriesList.length === 0) {
          continue;
        }
        const mode = fieldAggregations[field.id] ?? inferAggregation(field.id, seriesList.length, fieldTypeMap);
        const merged = mergeTablePreviewSeries(seriesList, mode, field.type);
        if (merged.length > 0) {
          tableFieldValues[field.id] = merged;
        }
      }

      return NextResponse.json({
        tableFieldValues,
        previewNote: previewNote || undefined,
      });
    }

    let parsedRecord: Record<string, unknown>;
    let previewNote = "";
    try {
      const parsed = parsePreviewJson(content);
      parsedRecord = parsed.record;
      previewNote = parsed.previewNote;
    } catch {
        return NextResponse.json({ error: "单条记录试填返回的 JSON 无法解析" }, { status: 502 });
    }

    const boxedFields = new Set(boxes.map((box) => box.field));
    const out: Record<string, unknown> = {};

    const textBuiltIns = ["date", "route", "driver", "taskCode", "waybillStatus", "stationTeam", "totalSourceLabel"];
    for (const key of textBuiltIns) {
      if (boxedFields.has(key) || key in parsedRecord) {
        out[key] = normalizeText(parsedRecord[key]);
      }
    }

    for (const key of ["total", "unscanned", "exceptions"]) {
      if (boxedFields.has(key) || key in parsedRecord) {
        out[key] = normalizeNumber(parsedRecord[key]) ?? "";
      }
    }

    const rawCustomFieldValues =
      parsedRecord.customFieldValues && typeof parsedRecord.customFieldValues === "object"
        ? (parsedRecord.customFieldValues as Record<string, unknown>)
        : {};
    const customFieldValues: Record<string, string | number | ""> = {};
    for (const field of activeTableFields.filter((item) => !isBuiltInFieldId(item.id))) {
      if (!boxedFields.has(field.id) && !(field.id in parsedRecord) && !(field.id in rawCustomFieldValues)) {
        continue;
      }
      const rawValue =
        rawCustomFieldValues[field.id] !== undefined ? rawCustomFieldValues[field.id] : parsedRecord[field.id];
      customFieldValues[field.id] = normalizeCustomFieldPreviewValue(field, rawValue);
    }
    if (Object.keys(customFieldValues).length > 0) {
      out.customFieldValues = customFieldValues;
    }

    return NextResponse.json({
      record: out,
      previewNote: previewNote || undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "试填失败" },
      { status: 500 },
    );
  }
}
