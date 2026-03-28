import { NextResponse } from "next/server";

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

function buildBoxSpec(
  boxes: Array<{ field: TrainingField; x: number; y: number; width: number; height: number }>,
  aggs: Partial<Record<TrainingField, FieldAggregation>>,
): string {
  const byField = new Map<TrainingField, typeof boxes>();
  for (const b of boxes) {
    const list = byField.get(b.field) || [];
    list.push(b);
    byField.set(b.field, list);
  }
  const lines: string[] = [];
  for (const [field, list] of byField) {
    const mode = aggs[field] ?? inferAgg(field, list.length);
    lines.push(
      `【${FIELD_CN[field]}】字段键=${field}；合并方式：${describeAgg(mode)}`,
    );
    list.forEach((b, i) => {
      const x2 = b.x + b.width;
      const y2 = b.y + b.height;
      lines.push(
        `  子区域 ${i + 1}：归一化矩形 x∈[${(b.x * 100).toFixed(2)}%, ${(x2 * 100).toFixed(2)}%]，y∈[${(b.y * 100).toFixed(2)}%, ${(y2 * 100).toFixed(2)}%]`,
      );
    });
  }
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
    const spec = buildBoxSpec(boxes, fieldAggregations);

    const systemText = `你是 OrSight 训练标注预览助手。用户在同一张截图上为业务字段画了矩形框（坐标为相对整图 0～1 的归一化值，原点左上）。
你必须只根据下方附带图片里、各框对应区域内的可见内容读取，禁止用框外数字顶替。
对「数字相加」类字段：每个子区域单独读数后再按规则合并。
输出必须是合法 JSON 对象，字段如下（数字字段用整数或 null，文本用字符串）：
date, route, driver, total, totalSourceLabel, unscanned, exceptions, waybillStatus, stationTeam, previewNote（previewNote 为可选字符串，说明不确定之处）。

若某字段没有任何框选，对应键可省略或填 null/空字符串。`;

    const userText = `请根据框选说明读取并合并：\n\n${spec}\n\n然后输出 JSON。`;

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
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
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
