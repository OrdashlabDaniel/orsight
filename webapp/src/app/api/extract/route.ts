import { NextResponse } from "next/server";
import sharp from "sharp";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  type ExtractionIssue,
  type PodRecord,
  isRouteFormatValid,
  isStationTeamCodeNotCourierRoute,
  normalizeNumber,
  normalizeText,
  validateRecord,
  visionPrompt,
} from "@/lib/pod";
import {
  buildAgentThreadReferenceImages,
  buildTrainingPromptSection,
  buildVisualReferencePack,
  loadTrainingExamples,
  loadGlobalRules,
  type GlobalRules,
  type TrainingExample,
  type TrainingField,
} from "@/lib/training";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_PRIMARY_MODEL = process.env.OPENAI_PRIMARY_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL || "gpt-5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "minimal";

/** 四次一致性识别次数；设为 3 可略提速，2 更快但更易不一致。默认 4。 */
function getConsistencyAttemptCount(): number {
  const raw = process.env.EXTRACT_CONSISTENCY_ATTEMPTS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n)) return Math.min(8, Math.max(2, n));
  return 4;
}

type ExtractVisionContext = {
  examples: TrainingExample[];
  globalRules: GlobalRules;
  visualPack: Awaited<ReturnType<typeof buildVisualReferencePack>>;
  agentRefs: Awaited<ReturnType<typeof buildAgentThreadReferenceImages>>;
};

async function buildExtractVisionContext(): Promise<ExtractVisionContext> {
  const examples = await loadTrainingExamples();
  const globalRules = await loadGlobalRules();
  const [visualPack, agentRefs] = await Promise.all([
    buildVisualReferencePack(examples),
    buildAgentThreadReferenceImages(globalRules.agentThread),
  ]);
  return { examples, globalRules, visualPack, agentRefs };
}

function mergeParallelRefineReasons(base: PodRecord, ...refined: PodRecord[]): string | null {
  const parts = new Set<string>();
  for (const s of (base.reviewReason || "").split("|").map((x) => x.trim()).filter(Boolean)) {
    parts.add(s);
  }
  for (const r of refined) {
    for (const s of (r.reviewReason || "").split("|").map((x) => x.trim()).filter(Boolean)) {
      parts.add(s);
    }
  }
  return parts.size ? Array.from(parts).join(" | ") : null;
}

// We'll load this asynchronously now per request
// const TRAINING_EXAMPLES = loadTrainingExamples();

type OpenAIMessageContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type RawModelRecord = {
  date?: unknown;
  route?: unknown;
  driver?: unknown;
  total?: unknown;
  totalSourceLabel?: unknown;
  unscanned?: unknown;
  exceptions?: unknown;
  waybillStatus?: unknown;
  stationTeam?: unknown;
  reviewRequired?: unknown;
  reviewReason?: unknown;
};

type CounterVerificationResult = {
  expectedCount?: unknown;
  actualCount?: unknown;
  pickedUpCount?: unknown;
  expectedCountVisible?: unknown;
  actualCountVisible?: unknown;
  pickedUpVisible?: unknown;
};

type CropRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const COUNTER_CROP_REGIONS: Record<"expected" | "actual" | "pickedUp", CropRegion> = {
  expected: { x: 0.14, y: 0.50, width: 0.28, height: 0.14 },
  actual: { x: 0.49, y: 0.50, width: 0.30, height: 0.14 },
  pickedUp: { x: 0.13, y: 0.68, width: 0.24, height: 0.16 },
};

function appendReviewReason(currentReason: string | null | undefined, nextReason: string): string {
  const parts = [currentReason, nextReason].filter(Boolean);
  return Array.from(new Set(parts)).join(" | ");
}

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Median bitmap-normalized box for a field across training examples (for Sharp crop). */
function medianFieldImageBox(examples: TrainingExample[], field: TrainingField): CropRegion | null {
  const boxes = examples.flatMap((ex) =>
    (ex.boxes || []).filter((b) => b.field === field && b.coordSpace === "image"),
  );
  if (boxes.length === 0) return null;
  return {
    x: medianOf(boxes.map((b) => b.x)),
    y: medianOf(boxes.map((b) => b.y)),
    width: medianOf(boxes.map((b) => b.width)),
    height: medianOf(boxes.map((b) => b.height)),
  };
}

function mostCommonTotalSourceLabel(examples: TrainingExample[]): string {
  const counts = new Map<string, number>();
  for (const ex of examples) {
    const l = ex.output.totalSourceLabel?.trim();
    if (l) counts.set(l, (counts.get(l) || 0) + 1);
  }
  let best = "应领件数";
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
}

async function cropRegionToDataUrl(bytes: Buffer, box: CropRegion, pad = 0.02): Promise<string | null> {
  const meta = await sharp(bytes).metadata();
  const iw = meta.width ?? 0;
  const ih = meta.height ?? 0;
  if (!iw || !ih) return null;
  const x0 = Math.max(0, box.x - pad);
  const y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(1, box.x + box.width + pad);
  const y1 = Math.min(1, box.y + box.height + pad);
  const w = Math.max(0.01, x1 - x0);
  const h = Math.max(0.01, y1 - y0);
  const left = Math.floor(x0 * iw);
  const top = Math.floor(y0 * ih);
  const width = Math.max(1, Math.floor(w * iw));
  const height = Math.max(1, Math.floor(h * ih));
  try {
    const cropBuf = await sharp(bytes).extract({ left, top, width, height }).png().toBuffer();
    return `data:image/png;base64,${cropBuf.toString("base64")}`;
  } catch {
    return null;
  }
}

function mergeRefineUsage(
  base: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  add?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
) {
  if (!add) return base;
  return {
    prompt_tokens: base.prompt_tokens + (add.prompt_tokens || 0),
    completion_tokens: base.completion_tokens + (add.completion_tokens || 0),
    total_tokens: base.total_tokens + (add.total_tokens || 0),
  };
}

function repairRouteVersusStationTeamRecord(record: PodRecord): PodRecord {
  const r = record.route.trim();
  if (!r || isRouteFormatValid(r)) return record;
  if (!isStationTeamCodeNotCourierRoute(r)) return record;
  const st = record.stationTeam?.trim() || "";
  return {
    ...record,
    stationTeam: st || r,
    route: "",
    reviewRequired: true,
    reviewReason: appendReviewReason(
      record.reviewReason,
      st && st !== r
        ? "抽查路线字段内容为站点车队样式，已清空路线；请根据画面确认站点车队与快递员路线。"
        : "站点车队代码曾被填在抽查路线中，已移入站点车队并清空路线，请根据画面补全快递员路线。",
    ),
  };
}

async function refinePODRouteFromTrainingCrop(
  file: File,
  examples: TrainingExample[],
  records: PodRecord[],
  model: string,
): Promise<{ records: PodRecord[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  if (!OPENAI_API_KEY || records.length !== 1) return { records };
  const box = medianFieldImageBox(examples, "route");
  if (!box) return { records };

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = await cropRegionToDataUrl(bytes, box);
  if (!dataUrl) return { records };

  const prompt = `图中仅为签退/POD 类屏幕的一小块裁剪，对应「快递员路线 / 抽查路线」文本区域。请只 OCR 图中可见的路线编码（典型形如 IAH01-030-C，含 IAH 后两位区域数字）。
不要输出站点车队样式（如单独的 IAH-BAA、IAH-FGI 等三字母段）。若图中没有此类路线编码，输出 {"route":null}。
只输出一个 JSON 对象，不要其它文字。`;

  const body = {
    model,
    reasoning_effort: OPENAI_REASONING_EFFORT,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ] as OpenAIMessageContent[],
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return { records };
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) return { records };

  let parsed: { route?: unknown };
  try {
    parsed = JSON.parse(content) as { route?: unknown };
  } catch {
    return { records };
  }

  const routeRaw = parsed?.route;
  if (routeRaw === null || routeRaw === undefined) return { records, usage: payload.usage };
  const route = normalizeText(String(routeRaw));
  if (!route || route.toLowerCase() === "null") return { records, usage: payload.usage };
  if (!isRouteFormatValid(route)) return { records, usage: payload.usage };

  const [rec] = records;
  const hadBadRoute = Boolean(rec.route.trim()) && !isRouteFormatValid(rec.route);
  return {
    records: [
      {
        ...rec,
        route,
        reviewRequired: hadBadRoute || rec.reviewRequired,
        reviewReason: hadBadRoute
          ? appendReviewReason(rec.reviewReason, "抽查路线已按训练池标注区域二次裁剪识别覆盖。")
          : rec.reviewReason,
      },
    ],
    usage: payload.usage,
  };
}

async function refinePODTotalFromTrainingCrop(
  file: File,
  examples: TrainingExample[],
  records: PodRecord[],
  model: string,
): Promise<{ records: PodRecord[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  if (!OPENAI_API_KEY || records.length !== 1) return { records };
  const box = medianFieldImageBox(examples, "total");
  if (!box) return { records };

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = await cropRegionToDataUrl(bytes, box);
  if (!dataUrl) return { records };

  const fallbackLabel = mostCommonTotalSourceLabel(examples);
  const prompt = `图中仅为签退/POD 屏幕上一小块裁剪，对应训练池中标注的「运单数量」相关区域（常见标签：应领件数、应收件数、运单数量等）。
请只根据图中**可见像素**读取与上述标签直接对应的**一个非负整数**；若图中有标签文字，请一并读出（尽量与图中文字一致）。
若无法读出整数，输出 {"total":null,"totalSourceLabel":null}。
只输出一个 JSON 对象，键为 total（整数或 null）、totalSourceLabel（字符串或 null）。不要输出其它文字。`;

  const body = {
    model,
    reasoning_effort: OPENAI_REASONING_EFFORT,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ] as OpenAIMessageContent[],
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return { records };

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) return { records };

  let parsed: { total?: unknown; totalSourceLabel?: unknown };
  try {
    parsed = JSON.parse(content) as { total?: unknown; totalSourceLabel?: unknown };
  } catch {
    return { records };
  }

  const total = normalizeNumber(parsed?.total);
  if (total === "" || typeof total !== "number") return { records, usage: payload.usage };

  let label = normalizeText(parsed?.totalSourceLabel);
  if (!label) label = fallbackLabel;

  const [rec] = records;
  const hadEmpty = rec.total === "";
  const hadMismatch = rec.total !== "" && rec.total !== total;
  return {
    records: [
      {
        ...rec,
        total,
        totalSourceLabel: label,
        reviewRequired: hadMismatch || rec.reviewRequired,
        reviewReason: hadMismatch
          ? appendReviewReason(rec.reviewReason, "运单数量已按训练池标注区域二次裁剪识别覆盖。")
          : hadEmpty
            ? appendReviewReason(rec.reviewReason, "运单数量由训练池标注区域裁剪识别补全。")
            : rec.reviewReason,
      },
    ],
    usage: payload.usage,
  };
}

async function refinePODUnscannedFromTrainingCrop(
  file: File,
  examples: TrainingExample[],
  records: PodRecord[],
  model: string,
): Promise<{ records: PodRecord[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  if (!OPENAI_API_KEY || records.length !== 1) return { records };
  const box = medianFieldImageBox(examples, "unscanned");
  if (!box) return { records };

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = await cropRegionToDataUrl(bytes, box);
  if (!dataUrl) return { records };

  const prompt = `图中仅为签退/POD 屏幕上一小块裁剪，对应「未领取」「未收」或未收数量相关数字。
只输出 JSON：{"unscanned": <非负整数>} 或 {"unscanned":null}。不要猜测图中没有的数字。`;

  const body = {
    model,
    reasoning_effort: OPENAI_REASONING_EFFORT,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ] as OpenAIMessageContent[],
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return { records };

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) return { records };

  let parsed: { unscanned?: unknown };
  try {
    parsed = JSON.parse(content) as { unscanned?: unknown };
  } catch {
    return { records };
  }

  const unscanned = normalizeNumber(parsed?.unscanned);
  if (unscanned === "" || typeof unscanned !== "number") return { records, usage: payload.usage };

  const [rec] = records;
  const hadEmpty = rec.unscanned === "";
  const hadMismatch = rec.unscanned !== "" && rec.unscanned !== unscanned;
  return {
    records: [
      {
        ...rec,
        unscanned,
        reviewRequired: hadMismatch || rec.reviewRequired,
        reviewReason: hadMismatch
          ? appendReviewReason(rec.reviewReason, "未收数量已按训练池标注区域二次裁剪识别覆盖。")
          : hadEmpty
            ? appendReviewReason(rec.reviewReason, "未收数量由训练池标注区域裁剪识别补全。")
            : rec.reviewReason,
      },
    ],
    usage: payload.usage,
  };
}

async function refinePODExceptionsFromTrainingCrop(
  file: File,
  examples: TrainingExample[],
  records: PodRecord[],
  model: string,
): Promise<{ records: PodRecord[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  if (!OPENAI_API_KEY || records.length !== 1) return { records };
  const box = medianFieldImageBox(examples, "exceptions");
  if (!box) return { records };

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = await cropRegionToDataUrl(bytes, box);
  if (!dataUrl) return { records };

  const prompt = `图中仅为签退/POD 屏幕上一小块裁剪，对应「错扫」「错分」「误扫」等异常件数（不是未领取、不是角标装饰）。
只输出 JSON：{"exceptions": <非负整数>} 或 {"exceptions":null}。若无此类列或读不出，输出 null。`;

  const body = {
    model,
    reasoning_effort: OPENAI_REASONING_EFFORT,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ] as OpenAIMessageContent[],
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return { records };

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) return { records };

  let parsed: { exceptions?: unknown };
  try {
    parsed = JSON.parse(content) as { exceptions?: unknown };
  } catch {
    return { records };
  }

  const rawEx = parsed?.exceptions;
  if (rawEx === null || rawEx === undefined) return { records, usage: payload.usage };
  const ex = normalizeNumber(rawEx);
  if (ex === "" || typeof ex !== "number") return { records, usage: payload.usage };

  const [rec] = records;
  const hadEmpty = rec.exceptions === "";
  const hadMismatch = rec.exceptions !== "" && rec.exceptions !== ex;
  return {
    records: [
      {
        ...rec,
        exceptions: ex,
        reviewRequired: hadMismatch || rec.reviewRequired,
        reviewReason: hadMismatch
          ? appendReviewReason(rec.reviewReason, "错扫数量已按训练池标注区域二次裁剪识别覆盖。")
          : hadEmpty
            ? appendReviewReason(rec.reviewReason, "错扫数量由训练池标注区域裁剪识别补全。")
            : rec.reviewReason,
      },
    ],
    usage: payload.usage,
  };
}

async function runPODTrainingRefinesParallel(
  file: File,
  examples: TrainingExample[],
  records: PodRecord[],
  model: string,
): Promise<{ records: PodRecord[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  if (!OPENAI_API_KEY || records.length !== 1) return { records };
  const base = records[0]!;

  const emptyUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const [rRoute, rTotal, rUnscanned, rExceptions] = await Promise.all([
    refinePODRouteFromTrainingCrop(file, examples, records, model),
    refinePODTotalFromTrainingCrop(file, examples, records, model),
    refinePODUnscannedFromTrainingCrop(file, examples, records, model),
    refinePODExceptionsFromTrainingCrop(file, examples, records, model),
  ]);

  let u = mergeRefineUsage(emptyUsage, rRoute.usage);
  u = mergeRefineUsage(u, rTotal.usage);
  u = mergeRefineUsage(u, rUnscanned.usage);
  u = mergeRefineUsage(u, rExceptions.usage);

  const routeR = rRoute.records[0] ?? base;
  const totalR = rTotal.records[0] ?? base;
  const unscannedR = rUnscanned.records[0] ?? base;
  const exceptionsR = rExceptions.records[0] ?? base;

  const reviewRequired =
    Boolean(base.reviewRequired) ||
    Boolean(routeR.reviewRequired) ||
    Boolean(totalR.reviewRequired) ||
    Boolean(unscannedR.reviewRequired) ||
    Boolean(exceptionsR.reviewRequired);

  const reviewReason = mergeParallelRefineReasons(base, routeR, totalR, unscannedR, exceptionsR);

  return {
    records: [
      {
        ...base,
        route: routeR.route,
        total: totalR.total,
        totalSourceLabel: totalR.totalSourceLabel,
        unscanned: unscannedR.unscanned,
        exceptions: exceptionsR.exceptions,
        reviewRequired,
        reviewReason,
      },
    ],
    usage: u,
  };
}

async function callVisionModel(
  file: File,
  model: string,
  ctx: ExtractVisionContext,
): Promise<{ records: RawModelRecord[]; imageType: string; usage?: any }> {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Please configure the AI model first.");
  }

  const { examples, globalRules, visualPack, agentRefs } = ctx;
  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}`;

  const baseText = `${visionPrompt}${buildTrainingPromptSection(examples, globalRules)}${visualPack.hintText}`;

  const userContent: OpenAIMessageContent[] = [{ type: "text", text: baseText }];
  for (const ref of visualPack.referenceImages) {
    userContent.push({ type: "text", text: ref.caption });
    userContent.push({ type: "image_url", image_url: { url: ref.dataUrl } });
  }

  for (const ref of agentRefs) {
    userContent.push({ type: "text", text: ref.caption });
    userContent.push({ type: "image_url", image_url: { url: ref.dataUrl } });
  }

  userContent.push({
    type: "text",
    text: "\n【当前待识别图片】仅根据下面这一张图输出 JSON 中的 records；上文训练参考图、Agent 参考图与坐标说明只用于理解布局规律，不得把参考图中的文字抄进结果。\n",
  });
  userContent.push({ type: "image_url", image_url: { url: dataUrl } });

  const body = {
    model,
    reasoning_effort: OPENAI_REASONING_EFFORT,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision API error: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
    usage?: any;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Vision API returned empty content.");
  }

  let parsed: { records?: RawModelRecord[], imageType?: string };
  try {
    parsed = JSON.parse(content) as { records?: RawModelRecord[], imageType?: string };
  } catch (error) {
    throw new Error(`Model did not return valid JSON: ${String(error)}`);
  }

  return {
    records: parsed.records || [],
    imageType: parsed.imageType || "OTHER",
    usage: payload.usage,
  };
}

async function callCounterVerifier(file: File, model: string): Promise<{ result: CounterVerificationResult, usage?: any }> {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Please configure the AI model first.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const image = sharp(bytes);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    return { result: {} };
  }

  async function cropToDataUrl(region: CropRegion) {
    const left = Math.max(0, Math.floor(metadata.width! * region.x));
    const top = Math.max(0, Math.floor(metadata.height! * region.y));
    const width = Math.max(1, Math.floor(metadata.width! * region.width));
    const height = Math.max(1, Math.floor(metadata.height! * region.height));
    const cropped = await sharp(bytes).extract({ left, top, width, height }).png().toBuffer();
    return `data:image/png;base64,${cropped.toString("base64")}`;
  }

  const expectedCrop = await cropToDataUrl(COUNTER_CROP_REGIONS.expected);
  const actualCrop = await cropToDataUrl(COUNTER_CROP_REGIONS.actual);
  const pickedUpCrop = await cropToDataUrl(COUNTER_CROP_REGIONS.pickedUp);
  const verificationPrompt = `你只做计数字段核验。读取这张 POD 签退截图，并返回 JSON。

要求：
1. 第一张裁剪图只对应 应领件数 区域，读取 expectedCount。如果看不清就返回 null。
2. 第二张裁剪图只对应 实领件数 区域，读取 actualCount。如果看不清就返回 null。
3. 第三张裁剪图只对应 左下角已领 区域，读取 pickedUpCount。如果看不清就返回 null。
4. expectedCountVisible / actualCountVisible / pickedUpVisible 表示对应区域数字是否清晰可辨。
5. 绝对不要猜数字。
6. 不要把一张裁剪图中的数字借给另一张。

返回格式：
{
  "expectedCount": 84,
  "actualCount": 83,
  "pickedUpCount": 83,
  "expectedCountVisible": true,
  "actualCountVisible": true,
  "pickedUpVisible": true
}`;

  const body = {
    model,
    reasoning_effort: "minimal",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: verificationPrompt },
          { type: "image_url", image_url: { url: expectedCrop } },
          { type: "image_url", image_url: { url: actualCrop } },
          { type: "image_url", image_url: { url: pickedUpCrop } },
        ] as OpenAIMessageContent[],
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Counter verifier API error: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
    usage?: any;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return { result: {} };
  }

  try {
    return { result: JSON.parse(content) as CounterVerificationResult, usage: payload.usage };
  } catch {
    return { result: {} };
  }
}

function mapRecord(imageName: string, raw: RawModelRecord, index: number): PodRecord {
  return {
    id: `${imageName}-${index}`,
    imageName,
    date: normalizeText(raw.date),
    route: normalizeText(raw.route),
    driver: normalizeText(raw.driver),
    total: normalizeNumber(raw.total),
    totalSourceLabel: normalizeText(raw.totalSourceLabel),
    unscanned: normalizeNumber(raw.unscanned),
    exceptions: normalizeNumber(raw.exceptions),
    waybillStatus: normalizeText(raw.waybillStatus),
    stationTeam: normalizeText(raw.stationTeam),
    reviewRequired: Boolean(raw.reviewRequired),
    reviewReason: normalizeText(raw.reviewReason) || null,
  };
}

function recordSignature(record: PodRecord): string {
  return JSON.stringify({
    date: record.date,
    route: record.route,
    driver: record.driver,
    total: record.total,
    totalSourceLabel: record.totalSourceLabel,
    unscanned: record.unscanned,
    exceptions: record.exceptions,
    waybillStatus: record.waybillStatus,
  });
}

function markSourceMismatchForReview(records: PodRecord[], validLabels: Set<string>) {
  return records.map((record) => {
    if (record.total !== "" && !record.totalSourceLabel) {
      return {
        ...record,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          record.reviewReason,
          "运单数量来源缺失：未能确认数字来源标签，必须人工检查。",
        ),
      };
    }

    if (record.total !== "" && record.totalSourceLabel && validLabels.size > 0 && !validLabels.has(record.totalSourceLabel)) {
      return {
        ...record,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          record.reviewReason,
          `运单数量来源异常：当前来源为“${record.totalSourceLabel}”，不在训练池已知的合法来源中，必须人工检查。`,
        ),
      };
    }

    return record;
  });
}

function toNullableNumber(value: unknown) {
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

function toBoolean(value: unknown) {
  return value === true;
}

function applyCounterVerification(
  fileName: string,
  records: PodRecord[],
  verification: CounterVerificationResult,
  validLabels: Set<string>,
) {
  const issues: ExtractionIssue[] = [];
  const expectedCount = toNullableNumber(verification.expectedCount);
  const actualCount = toNullableNumber(verification.actualCount);
  const pickedUpCount = toNullableNumber(verification.pickedUpCount);
  const expectedCountVisible = toBoolean(verification.expectedCountVisible);

  const nextRecords = records.map((record) => {
    let nextRecord = record;

    const sourceLabelNorm = nextRecord.totalSourceLabel?.trim() ?? "";
    const totalLabelTrusted =
      validLabels.size > 0 && sourceLabelNorm !== "" && validLabels.has(sourceLabelNorm);

    // 固定裁剪区读不到应领件数时，若运单数量已由主模型/训练池裁剪给出且来源标签在训练池合法列表中，则保留，避免误清空
    if (
      nextRecord.total !== "" &&
      (!expectedCountVisible || expectedCount === null) &&
      !totalLabelTrusted
    ) {
      nextRecord = {
        ...nextRecord,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          nextRecord.reviewReason,
          "应领件数区域未被清晰识别，运单数量无法自动确认，必须人工检查。",
        ),
      };
      issues.push({
        imageName: fileName,
        route: record.route,
        level: "error",
        code: "expected_count_unreadable",
        message: "应领件数区域看不清或未识别到，运单数量不能自动确认。",
      });
    }

    if (nextRecord.total !== "" && expectedCount !== null && nextRecord.total !== expectedCount) {
      const prevTotal = nextRecord.total;
      nextRecord = {
        ...nextRecord,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          nextRecord.reviewReason,
          `运单数量与应领件数不一致：当前为 ${prevTotal}，应领件数为 ${expectedCount}。`,
        ),
      };
      issues.push({
        imageName: fileName,
        route: record.route,
        level: "error",
        code: "total_conflicts_expected",
        message: `运单数量与应领件数不一致：当前为 ${prevTotal}，应领件数为 ${expectedCount}。`,
      });
    }

    if (
      nextRecord.total !== "" &&
      expectedCount === null &&
      ((actualCount !== null && nextRecord.total === actualCount) ||
        (pickedUpCount !== null && nextRecord.total === pickedUpCount))
    ) {
      nextRecord = {
        ...nextRecord,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          nextRecord.reviewReason,
          "运单数量疑似取自实领件数或已领，而不是应领件数，必须人工检查。",
        ),
      };
      issues.push({
        imageName: fileName,
        route: record.route,
        level: "error",
        code: "total_matches_wrong_counter",
        message: "运单数量疑似取自实领件数或已领，而不是应领件数。",
      });
    }

    // 主模型与训练裁剪均未给出运单数量时，若固定裁剪区能稳定读到应领件数，则补全（标签与训练池默认一致）
    if (nextRecord.total === "" && expectedCount !== null && expectedCountVisible) {
      nextRecord = {
        ...nextRecord,
        total: expectedCount,
        totalSourceLabel: nextRecord.totalSourceLabel || "应领件数",
      };
    }

    return nextRecord;
  });

  return {
    records: nextRecords,
    issues,
  };
}

async function runConsistencyCheck(file: File, model: string, ctx: ExtractVisionContext) {
  const attemptCount = getConsistencyAttemptCount();
  const attempts = await Promise.all(
    Array.from({ length: attemptCount }, () => callVisionModel(file, model, ctx)),
  );

  // We assume the imageType is consistent across attempts, take the first one
  const imageType = attempts[0]?.imageType || "OTHER";

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  for (const attempt of attempts) {
    if (attempt.usage) {
      totalPromptTokens += attempt.usage.prompt_tokens || 0;
      totalCompletionTokens += attempt.usage.completion_tokens || 0;
      totalTokens += attempt.usage.total_tokens || 0;
    }
  }

  const mappedAttempts = attempts.map((attempt, attemptIndex) =>
    attempt.records.map((rawRecord, recordIndex) => mapRecord(file.name, rawRecord, recordIndex + attemptIndex * 100)),
  );

  const firstAttemptRecords = mappedAttempts[0] || [];
  const issues: ExtractionIssue[] = [];

  const finalRecords = firstAttemptRecords.map((record) => {
    const sig = recordSignature(record);
    
    // Check if this exact record signature exists in all other attempts
    let isConsistent = true;
    for (let i = 1; i < attemptCount; i++) {
      const attemptRecords = mappedAttempts[i] || [];
      const hasMatch = attemptRecords.some(r => recordSignature(r) === sig);
      if (!hasMatch) {
        isConsistent = false;
        break;
      }
    }

    if (!isConsistent) {
      issues.push({
        imageName: file.name,
        route: record.route,
        level: "warning",
        code: "consistency_mismatch",
        message: "该条目在四次识别中存在不一致结果，请人工确认或再次识别。",
      });
      return {
        ...record,
        reviewRequired: true,
        reviewReason: appendReviewReason(record.reviewReason, "四次识别结果不一致，需要人工复核。"),
      };
    }

    return record;
  });

  return {
    records: finalRecords,
    issues,
    imageType,
    usage: {
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      total_tokens: totalTokens,
    }
  };
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录后再使用识别功能。" }, { status: 401 });
    }

    const formData = await request.formData();
    const mode = String(formData.get("mode") || "primary");
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const model = mode === "review" ? OPENAI_REVIEW_MODEL : OPENAI_PRIMARY_MODEL;

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    const records: PodRecord[] = [];
    const issues: ExtractionIssue[] = [];

    const visionCtx = await buildExtractVisionContext();
    const examples = visionCtx.examples;
    const validLabels = new Set<string>();
    for (const ex of examples) {
      if (ex.output.totalSourceLabel) {
        validLabels.add(ex.output.totalSourceLabel);
      }
    }
    // Also add some default valid labels just in case
    validLabels.add("应领件数");
    validLabels.add("应收件数");
    validLabels.add("运单数量");

    for (const file of files) {
      const consistencyResult = await runConsistencyCheck(file, model, visionCtx);
      let workingRecords = consistencyResult.records;

      if (consistencyResult.imageType === "POD" && examples.length > 0) {
        const refined = await runPODTrainingRefinesParallel(file, examples, workingRecords, model);
        workingRecords = refined.records;
        if (refined.usage) {
          consistencyResult.usage = mergeRefineUsage(
            {
              prompt_tokens: consistencyResult.usage?.prompt_tokens || 0,
              completion_tokens: consistencyResult.usage?.completion_tokens || 0,
              total_tokens: consistencyResult.usage?.total_tokens || 0,
            },
            refined.usage,
          );
        }
      }

      workingRecords = workingRecords.map(repairRouteVersusStationTeamRecord);
      const sourceCheckedRecords = markSourceMismatchForReview(workingRecords, validLabels);

      let checkedRecords = sourceCheckedRecords;
      let counterIssues: ExtractionIssue[] = [];

      let totalPromptTokens = consistencyResult.usage?.prompt_tokens || 0;
      let totalCompletionTokens = consistencyResult.usage?.completion_tokens || 0;
      let totalTokens = consistencyResult.usage?.total_tokens || 0;

      // Only run counter verification for POD images
      if (consistencyResult.imageType === "POD") {
        const counterVerification = await callCounterVerifier(file, model);
        const counterChecked = applyCounterVerification(
          file.name,
          sourceCheckedRecords,
          counterVerification.result,
          validLabels,
        );
        checkedRecords = counterChecked.records;
        counterIssues = counterChecked.issues;
        
        if (counterVerification.usage) {
          totalPromptTokens += counterVerification.usage.prompt_tokens || 0;
          totalCompletionTokens += counterVerification.usage.completion_tokens || 0;
          totalTokens += counterVerification.usage.total_tokens || 0;
        }
      }

      // Log usage to Supabase if user is logged in
      if (user && user.id) {
        const admin = getSupabaseAdmin();
        if (admin) {
          // Fire and forget, don't await to block the response
          admin.from('usage_logs').insert({
            user_id: user.id,
            action_type: 'extract_table',
            image_count: 1,
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            total_tokens: totalTokens,
            model_used: model,
          }).then(({ error }) => {
            if (error) console.error("Failed to log usage:", error);
          });
        }
      }

      if (!checkedRecords.length) {
        issues.push({
          imageName: file.name,
          message: "AI 没有返回任何记录，请人工复核。",
          level: "error",
          code: "empty_result",
        });
        issues.push(...consistencyResult.issues);
        issues.push(...counterIssues);
        continue;
      }

      checkedRecords.forEach((record) => {
        records.push(record);
        issues.push(...validateRecord(record));
      });
      issues.push(...consistencyResult.issues);
      issues.push(...counterIssues);
    }

    return NextResponse.json({
      records,
      issues,
      modelUsed: model,
      mode,
      trainingExamplesLoaded: examples.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown extraction error.",
      },
      { status: 500 },
    );
  }
}
