import { NextResponse } from "next/server";
import sharp from "sharp";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import type { FieldAggregation, TrainingField } from "@/lib/training";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PREVIEW_MODEL = process.env.OPENAI_PREVIEW_MODEL || process.env.OPENAI_PRIMARY_MODEL || "gpt-5-mini";
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "minimal";

const ALLOWED_FIELDS = new Set<TrainingField>([
  "date",
  "route",
  "driver",
  "taskCode",
  "total",
  "unscanned",
  "exceptions",
  "waybillStatus",
  "stationTeam",
]);

const FIELD_CN: Record<TrainingField, string> = {
  date: "日期",
  route: "抽查路线",
  driver: "抽查司机",
  taskCode: "任务编码",
  total: "运单数量",
  unscanned: "未收数量",
  exceptions: "错扫数量",
  waybillStatus: "响应更新状态",
  stationTeam: "站点车队",
};

const NUMERIC_FIELDS: TrainingField[] = ["total", "unscanned", "exceptions"];

type BoxPayload = {
  field?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
};

function normalizeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeBoxes(raw: unknown): Array<{
  field: TrainingField;
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ field: TrainingField; x: number; y: number; width: number; height: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as BoxPayload;
    const field = typeof b.field === "string" ? b.field : "";
    if (!ALLOWED_FIELDS.has(field as TrainingField)) continue;
    const x = normalizeNumber(b.x);
    const y = normalizeNumber(b.y);
    const width = normalizeNumber(b.width);
    const height = normalizeNumber(b.height);
    if (x === null || y === null || width === null || height === null) continue;
    out.push({ field: field as TrainingField, x, y, width, height });
  }
  return out;
}

function normalizeAggregations(raw: unknown): Partial<Record<TrainingField, FieldAggregation>> {
  const allowed = new Set<FieldAggregation>(["sum", "join_comma", "join_newline", "first"]);
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<TrainingField, FieldAggregation>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_FIELDS.has(k as TrainingField)) continue;
    if (typeof v === "string" && allowed.has(v as FieldAggregation)) {
      out[k as TrainingField] = v as FieldAggregation;
    }
  }
  return out;
}

function inferAgg(field: TrainingField, count: number): FieldAggregation {
  if (count <= 1) return "first";
  return NUMERIC_FIELDS.includes(field) ? "sum" : "join_comma";
}

function describeAgg(mode: FieldAggregation): string {
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
  const t = dataUrl.trim();
  const i = t.indexOf("base64,");
  if (i < 0) {
    return null;
  }
  try {
    return Buffer.from(t.slice(i + "base64,".length), "base64");
  } catch {
    return null;
  }
}

/** 按位图 0~1 坐标裁剪；返回与 boxes 同序的 PNG data URL（仅含框内像素，不再附整图）。 */
async function cropsToPngDataUrls(
  imageBuffer: Buffer,
  boxes: Array<{ field: TrainingField; x: number; y: number; width: number; height: number }>,
): Promise<string[]> {
  const meta = await sharp(imageBuffer).metadata();
  const iw = meta.width ?? 0;
  const ih = meta.height ?? 0;
  if (!iw || !ih) {
    throw new Error("无法读取图片宽高");
  }

  const out: string[] = [];
  for (const b of boxes) {
    let left = Math.floor(b.x * iw);
    let top = Math.floor(b.y * ih);
    let width = Math.ceil(b.width * iw);
    let height = Math.ceil(b.height * ih);
    left = Math.max(0, Math.min(iw - 1, left));
    top = Math.max(0, Math.min(ih - 1, top));
    width = Math.max(1, Math.min(iw - left, width));
    height = Math.max(1, Math.min(ih - top, height));

    const cropBuf = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .png()
      .toBuffer();
    out.push(`data:image/png;base64,${cropBuf.toString("base64")}`);
  }
  return out;
}

function buildCropInstructionText(
  boxes: Array<{ field: TrainingField; x: number; y: number; width: number; height: number }>,
  aggs: Partial<Record<TrainingField, FieldAggregation>>,
): string {
  const byField = new Map<TrainingField, typeof boxes>();
  for (const b of boxes) {
    const list = byField.get(b.field) || [];
    list.push(b);
    byField.set(b.field, list);
  }

  const lines: string[] = [
    `下面会附上 ${boxes.length} 张**裁剪小图**（PNG），顺序固定：第 1 张对应第 1 个框，以此类推。`,
    `每张图里**只有**原截图上该矩形区域内的像素，图外没有任何内容；你必须只根据这些小图做 OCR，禁止臆造框外文字（例如其它位置的司机编号、站点车队）。`,
    "",
    "字段与图片对应关系：",
  ];

  boxes.forEach((b, i) => {
    lines.push(`图${i + 1} → 【${FIELD_CN[b.field]}】（JSON 键名 ${b.field}）`);
  });

  lines.push("", "同字段多张小图时的合并规则：");
  for (const [field, list] of byField) {
    if (list.length <= 1) {
      continue;
    }
    const indices: number[] = [];
    boxes.forEach((b, idx) => {
      if (b.field === field) {
        indices.push(idx + 1);
      }
    });
    const mode = aggs[field] ?? inferAgg(field, list.length);
    lines.push(
      `- ${field}（${FIELD_CN[field]}）：对应 图${indices.join("、图")}；${describeAgg(mode)}`,
    );
  }

  lines.push(
    "",
    "请输出一个 JSON 对象，键包括（无对应小图的键可省略或 null）：",
    "date, route, driver, taskCode, total, totalSourceLabel, unscanned, exceptions, waybillStatus, stationTeam, previewNote",
    "数字字段用整数或 null；文本用字符串。previewNote 可说明读数不确定之处。",
  );

  return lines.join("\n");
}

function parsePreviewJson(content: string): {
  record: Record<string, unknown>;
  previewNote: string;
} {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const previewNote = typeof parsed.previewNote === "string" ? parsed.previewNote.trim() : "";
  const record = { ...parsed };
  delete record.previewNote;
  return { record, previewNote };
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "未配置 OPENAI_API_KEY。" }, { status: 503 });
    }

    const body = (await request.json()) as {
      imageDataUrl?: unknown;
      boxes?: unknown;
      fieldAggregations?: unknown;
    };

    const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";
    if (!imageDataUrl.startsWith("data:") || imageDataUrl.length > 14 * 1024 * 1024) {
      return NextResponse.json({ error: "图片无效或过大。" }, { status: 400 });
    }

    const boxes = normalizeBoxes(body.boxes);
    if (boxes.length === 0) {
      return NextResponse.json({ error: "请至少提供一个有效字段框。" }, { status: 400 });
    }

    const fieldAggregations = normalizeAggregations(body.fieldAggregations);

    const imageBuffer = parseDataUrlToBuffer(imageDataUrl);
    if (!imageBuffer || imageBuffer.length === 0) {
      return NextResponse.json({ error: "无法解析图片数据。" }, { status: 400 });
    }

    let cropUrls: string[];
    try {
      cropUrls = await cropsToPngDataUrls(imageBuffer, boxes);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "裁剪标注区域失败。" },
        { status: 400 },
      );
    }

    const userText = buildCropInstructionText(boxes, fieldAggregations);

    const systemText = `你是 OrSight 训练标注预览助手。用户只会发来多张**已经裁剪好**的小图（每图仅含一个矩形框内的像素）和文字说明。
你必须只根据这些小图里的可见像素做 OCR 并按要求合并；**绝对禁止**引用未出现在这些小图里的任何文字（例如整屏其它位置的司机编号、站点代码）。
抽查路线 (route)：只输出**该小图内**可见的路线文本（如 IAH01-030-C），不要用记忆中或其它字段的常见格式替换。
输出合法 JSON。`;

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: userText }];
    for (const url of cropUrls) {
      userContent.push({ type: "image_url", image_url: { url } });
    }

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
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
          {
            role: "user",
            content: userContent,
          },
        ],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: `模型错误 ${res.status}: ${t.slice(0, 400)}` }, { status: 502 });
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "模型未返回内容。" }, { status: 502 });
    }

    let record: Record<string, unknown>;
    let previewNote: string;
    try {
      const p = parsePreviewJson(content);
      record = p.record;
      previewNote = p.previewNote;
    } catch {
      return NextResponse.json({ error: "模型返回的 JSON 无法解析。" }, { status: 502 });
    }

    const out: Record<string, string | number | ""> = {};
    if (typeof record.date === "string") out.date = record.date;
    if (typeof record.route === "string") out.route = record.route;
    if (typeof record.driver === "string") out.driver = record.driver;
    if (typeof record.taskCode === "string") out.taskCode = record.taskCode;
    if (typeof record.waybillStatus === "string") out.waybillStatus = record.waybillStatus;
    if (typeof record.stationTeam === "string") out.stationTeam = record.stationTeam;
    if (typeof record.totalSourceLabel === "string") out.totalSourceLabel = record.totalSourceLabel;

    const tn = normalizeNumber(record.total);
    out.total = tn !== null ? tn : "";
    const un = normalizeNumber(record.unscanned);
    out.unscanned = un !== null ? un : "";
    const ex = normalizeNumber(record.exceptions);
    out.exceptions = ex !== null ? ex : "";

    return NextResponse.json({
      record: out,
      previewNote: previewNote || undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "预览失败。" },
      { status: 500 },
    );
  }
}
