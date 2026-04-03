import { NextResponse } from "next/server";
import sharp from "sharp";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  type ExtractionIssue,
  type PodRecord,
  isRouteFormatValid,
  isStationTeamCodeNotCourierRoute,
  normalizeRouteValue,
  normalizeNumber,
  normalizeText,
  validateRecord,
} from "@/lib/pod";
import {
  buildVisualReferencePack,
  type FieldAggregation,
  getTrainingImageDataUrl,
  loadTrainingExamples,
  type TrainingBox,
  type TrainingExample,
  type TrainingField,
} from "@/lib/training";
import {
  getActiveTableFields,
  getFieldLabelMap,
  isBuiltInFieldId,
  type TableFieldDefinition,
} from "@/lib/table-fields";
import { loadTableFields } from "@/lib/table-fields-store";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_PRIMARY_MODEL = process.env.OPENAI_PRIMARY_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL || "gpt-5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "minimal";

const SIMPLE_EXTRACTION_PROMPT = `你是 OrSight。你会先看到几张人工标注参考图，再看到最后一张当前待识别图片。请严格遵守：
1. 参考图只用于理解界面布局、字段标签和示例，不得抄参考图中的任何数字或文字。
2. 最终输出只能依据最后一张“当前待识别图片”的可见内容。
3. 不要猜测；看不清、标签不明确、值和字段对不上时，就留空并把 reviewRequired 设为 true，reviewReason 写清原因。
4. 如果当前图里存在多个任务或多行记录，请为每个清晰可见的任务输出一条 records。
5. route 只填写快递员路线；像 IAH-BAA、IAH-BCE 这类站点车队代码应写入 stationTeam，不要误填 route。
6. total 只填写与“应领件数 / 应收件数 / 运单数量”等直接对应的值，并把原标签写入 totalSourceLabel。
7. unscanned 只填写与“未领取 / 未收”直接对应的值。
8. exceptions 只填写与“错扫 / 错分 / 误扫”直接对应的值。
9. customFieldValues 只填写当前图中有清晰标签和值、且与当前表格项目对应的字段；键必须严格使用字段 id。

返回 JSON：
{
  "imageType": "POD" | "WEB_TABLE" | "OTHER",
  "records": []
}

不要输出 Markdown，不要额外解释。`;

/** 四次一致性识别次数；设为 3 可略提速，2 更快但更易不一致。默认 4。 */
function getConsistencyAttemptCount(): number {
  const raw = process.env.EXTRACT_CONSISTENCY_ATTEMPTS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n)) return Math.min(8, Math.max(2, n));
  return 4;
}

type ExtractVisionContext = {
  examples: TrainingExample[];
  visualPack: Awaited<ReturnType<typeof buildVisualReferencePack>>;
  imageGuidance: Array<{ example: TrainingExample; fingerprint: number[] }>;
  tableFields: TableFieldDefinition[];
};

async function buildExtractVisionContext(): Promise<ExtractVisionContext> {
  const [examples, rawTableFields] = await Promise.all([loadTrainingExamples(), loadTableFields()]);
  const tableFields = getActiveTableFields(rawTableFields);
  const visualPack = await buildVisualReferencePack(examples, {
    fieldLabels: getFieldLabelMap(tableFields),
    activeFieldIds: tableFields.map((field) => field.id),
  });
  return { examples, visualPack, imageGuidance: [], tableFields };
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

function mergeReviewReasonParts(records: PodRecord[]): string | null {
  const parts = new Set<string>();
  for (const record of records) {
    for (const value of (record.reviewReason || "").split("|").map((item) => item.trim()).filter(Boolean)) {
      parts.add(value);
    }
  }
  return parts.size > 0 ? Array.from(parts).join(" | ") : null;
}

function firstNonEmptyValue<T>(records: PodRecord[], pick: (record: PodRecord) => T | "" | undefined): T | "" {
  for (const record of records) {
    const value = pick(record);
    if (value !== "" && value != null) {
      return value;
    }
  }
  return "";
}

function firstStableNumberValue(
  records: PodRecord[],
  pick: (record: PodRecord) => number | "" | undefined,
): number | "" {
  const values = records
    .map((record) => pick(record))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return "";
  }

  const [first] = values;
  return values.every((value) => value === first) ? first : "";
}

function buildAggregationBaseRecord(records: PodRecord[]): PodRecord {
  const [first] = records;
  if (!first) {
    throw new Error("Cannot build aggregation base from empty records.");
  }

  const stableTotal = firstStableNumberValue(records, (record) => record.total);
  const stableUnscanned = firstStableNumberValue(records, (record) => record.unscanned);
  const stableExceptions = firstStableNumberValue(records, (record) => record.exceptions);

  return {
    ...first,
    date: String(firstNonEmptyValue(records, (record) => record.date) || ""),
    route: String(firstNonEmptyValue(records, (record) => record.route) || ""),
    driver: String(firstNonEmptyValue(records, (record) => record.driver) || ""),
    taskCode: String(firstNonEmptyValue(records, (record) => record.taskCode) || ""),
    total: stableTotal,
    totalSourceLabel: stableTotal !== "" ? String(firstNonEmptyValue(records, (record) => record.totalSourceLabel) || "") : "",
    unscanned: stableUnscanned,
    exceptions: stableExceptions,
    waybillStatus: String(firstNonEmptyValue(records, (record) => record.waybillStatus) || ""),
    stationTeam: String(firstNonEmptyValue(records, (record) => record.stationTeam) || ""),
    customFieldValues: records.reduce<Record<string, string | number | "">>((acc, record) => {
      for (const [key, value] of Object.entries(record.customFieldValues || {})) {
        if (!(key in acc) || acc[key] === "") {
          acc[key] = value;
        }
      }
      return acc;
    }, {}),
    reviewRequired: records.some((record) => Boolean(record.reviewRequired)),
    reviewReason: mergeReviewReasonParts(records),
    mergedSourceCount: first.mergedSourceCount,
  };
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
  taskCode?: unknown;
  total?: unknown;
  totalSourceLabel?: unknown;
  unscanned?: unknown;
  exceptions?: unknown;
  waybillStatus?: unknown;
  stationTeam?: unknown;
  customFieldValues?: unknown;
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

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

const TRAINING_FIELD_CN: Record<TrainingField, string> = {
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

function normalizeCustomFieldValues(value: unknown): Record<string, string | number | ""> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const out: Record<string, string | number | ""> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      continue;
    }
    const asNumber = normalizeNumber(raw);
    if (typeof asNumber === "number") {
      out[normalizedKey] = asNumber;
      continue;
    }
    const asText = normalizeText(raw);
    if (asText) {
      out[normalizedKey] = asText;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Legacy prompt builder kept only for rollback; current extraction uses buildRecognitionModeDynamicFieldPrompt instead.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildDynamicFieldPrompt(tableFields: TableFieldDefinition[]): string {
  if (!tableFields.length) {
    return "";
  }

  const activeCustomFields = tableFields.filter((field) => !isBuiltInFieldId(field.id));
  const lines = ["", "【当前表格项目配置】"];

  for (const field of tableFields) {
    lines.push(`- 字段 id: ${field.id}；当前显示名：「${field.label}」；类型：${field.type}`);
  }

  if (activeCustomFields.length > 0) {
    lines.push(
      `存在自定义表格项目时，请把识别结果写入 customFieldValues 对象；键必须严格使用字段 id。当前自定义字段有：${activeCustomFields
        .map((field) => `${field.id}（${field.label}）`)
        .join("、")}。`,
    );
  }

  return lines.join("\n");
}

function buildRecognitionModeDynamicFieldPrompt(tableFields: TableFieldDefinition[]): string {
  const activeCustomFields = tableFields.filter((field) => !isBuiltInFieldId(field.id));
  if (activeCustomFields.length === 0) {
    return "";
  }

  const lines = [
    "",
    "【附加自定义表格项目】",
    "下列字段是额外追加项，只有在当前图中能看到清晰标签且值确实对应时，才写入 customFieldValues。不要让自定义字段影响内置字段的判断。",
  ];

  for (const field of activeCustomFields) {
    lines.push(`- 字段 id: ${field.id}；当前显示名：「${field.label}」；类型：${field.type}`);
  }

  lines.push("识别结果写入 customFieldValues 对象，键必须严格使用上面的字段 id。");
  return lines.join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildRecognitionModePrompt(): string {
  return `

【当前识别模式覆盖规则】
1. 人工标注参考图只用于帮助你先看懂同类界面的字段标签与布局，不是要你抄写的规则答案。最终每个字段必须仅来自当前图片的可见像素。
2. 对 POD 界面，「未收数量」只能来自当前图中与「未领取 / 未收」等标签直接对应的数字。绝不能从「已领」、「实领件数」、「应领件数」、任务编码、时间戳或其他邻近数字里截取前缀或后缀来填值。
3. 如果当前图片看不清未收标签或对应数字，就把 unscanned 留空并设 reviewRequired=true，不要为了凑完整结果去猜。
4. 自定义表格项目只是附加输出，不得把内置字段的数字错分到自定义项，也不得反过来。`;
}

type FingerprintedTrainingExample = {
  example: TrainingExample;
  fingerprint: number[];
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

const TOTAL_REVIEW_REASON_PATTERNS = [
  "运单数量来源缺失",
  "运单数量来源异常",
  "应领件数区域未被清晰识别",
  "运单数量与应领件数不一致",
  "运单数量疑似取自实领件数或已领",
  "运单数量识别结果异常偏大",
];

const UNSCANNED_REVIEW_REASON_PATTERNS = [
  "æœªæ”¶æ•°é‡å¤§äºŽè¿å•æ•°é‡",
  "æœªæ”¶æ•°é‡è¯†åˆ«ç»“æžœå¼‚å¸¸åå¤§",
  "æœªæ”¶æ•°é‡ä¸Žå›ºå®šè®¡æ•°å™¨æŽ¨å¯¼ç»“æžœä¸ä¸€è‡´",
  "æœªæ”¶æ•°é‡ç–‘ä¼¼åŸç”¨äº†å·²é¢†/å®žé¢†ç­‰é‚»è¿‘æ•°å­—",
];

function clearResolvedTotalReviewFlags(record: PodRecord): PodRecord {
  if (!record.reviewRequired || !record.reviewReason) {
    return record;
  }

  const remainingReasons = record.reviewReason
    .split(" | ")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(
      (reason) => !TOTAL_REVIEW_REASON_PATTERNS.some((pattern) => reason.includes(pattern)),
    );

  if (remainingReasons.length === 0) {
    return {
      ...record,
      reviewRequired: false,
      reviewReason: null,
    };
  }

  return {
    ...record,
    reviewRequired: true,
    reviewReason: remainingReasons.join(" | "),
  };
}

function clearResolvedUnscannedReviewFlags(record: PodRecord): PodRecord {
  if (!record.reviewRequired || !record.reviewReason) {
    return record;
  }

  const remainingReasons = record.reviewReason
    .split(" | ")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(
      (reason) => !UNSCANNED_REVIEW_REASON_PATTERNS.some((pattern) => reason.includes(pattern)),
    );

  if (remainingReasons.length === 0) {
    return {
      ...record,
      reviewRequired: false,
      reviewReason: null,
    };
  }

  return {
    ...record,
    reviewRequired: true,
    reviewReason: remainingReasons.join(" | "),
  };
}

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function hasImageCoordBoxes(example: TrainingExample): boolean {
  return Boolean(example.boxes?.some((box) => box.coordSpace === "image"));
}

function imageCoordBoxes(example: TrainingExample): TrainingBox[] {
  return (example.boxes || []).filter((box) => box.coordSpace === "image");
}

function parseDataUrlToBuffer(dataUrl: string): Buffer | null {
  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) return null;
  try {
    return Buffer.from(matched[2]!, "base64");
  } catch {
    return null;
  }
}

async function imageFingerprintFromBuffer(bytes: Buffer): Promise<number[]> {
  const raw = await sharp(bytes)
    .rotate()
    .resize(24, 24, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();
  return Array.from(raw, (value) => value / 255);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function buildTrainingImageGuidance(examples: TrainingExample[]): Promise<FingerprintedTrainingExample[]> {
  const candidates = examples.filter(hasImageCoordBoxes);
  const loaded = await Promise.all(
    candidates.map(async (example) => {
      const dataUrl = await getTrainingImageDataUrl(example.imageName);
      if (!dataUrl) return null;
      const bytes = parseDataUrlToBuffer(dataUrl);
      if (!bytes) return null;
      try {
        const fingerprint = await imageFingerprintFromBuffer(bytes);
        return { example, fingerprint };
      } catch {
        return null;
      }
    }),
  );

  return loaded.filter((item): item is FingerprintedTrainingExample => Boolean(item));
}

function fingerprintDistance(left: number[], right: number[]): number {
  const n = Math.min(left.length, right.length);
  if (n === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += Math.abs(left[i]! - right[i]!);
  }
  return total / n;
}

async function selectMostSimilarTrainingExamples(
  file: File,
  ctx: ExtractVisionContext,
  limit = 3,
): Promise<TrainingExample[]> {
  if (ctx.imageGuidance.length === 0) {
    return ctx.examples;
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const currentFingerprint = await imageFingerprintFromBuffer(bytes);
    const ranked = [...ctx.imageGuidance]
      .map((item) => ({
        example: item.example,
        distance: fingerprintDistance(currentFingerprint, item.fingerprint),
      }))
      .sort((left, right) => left.distance - right.distance);

    const similar = ranked.slice(0, limit).map((item) => item.example);
    return similar.length > 0 ? similar : ctx.examples;
  } catch {
    return ctx.examples;
  }
}

const LIVE_SUPPORTED_AGGREGATIONS = new Set<FieldAggregation>(["sum", "join_comma"]);

function pickLiveAggregationExample(example: TrainingExample): TrainingExample | null {
  const imageBoxes = imageCoordBoxes(example);
  if (imageBoxes.length === 0) {
    return null;
  }

  const boxesByField = new Map<TrainingField, TrainingBox[]>();
  for (const box of imageBoxes) {
    const list = boxesByField.get(box.field) || [];
    list.push(box);
    boxesByField.set(box.field, list);
  }

  const selectedFields = new Set<TrainingField>();
  const selectedAggregations: Partial<Record<TrainingField, FieldAggregation>> = {};

  for (const [field, boxes] of boxesByField) {
    if (boxes.length <= 1) {
      continue;
    }
    const mode = example.fieldAggregations?.[field] ?? inferFieldAggregation(field, boxes.length);
    if (!LIVE_SUPPORTED_AGGREGATIONS.has(mode)) {
      continue;
    }
    selectedFields.add(field);
    selectedAggregations[field] = mode;
  }

  if (selectedFields.size === 0) {
    return null;
  }

  return {
    ...example,
    boxes: imageBoxes.filter((box) => selectedFields.has(box.field)),
    fieldAggregations: selectedAggregations,
  };
}

async function runLiveAggregationRefine(
  file: File,
  ctx: ExtractVisionContext,
  records: PodRecord[],
  model: string,
): Promise<{ records: PodRecord[]; usage?: OpenAIUsage; collapsed: boolean }> {
  if (!OPENAI_API_KEY || records.length === 0) {
    return { records, collapsed: false };
  }

  const similarExamples = await selectMostSimilarTrainingExamples(file, ctx, 3);
  const aggregationExample =
    similarExamples.map(pickLiveAggregationExample).find((example): example is TrainingExample => Boolean(example)) ||
    ctx.examples.map(pickLiveAggregationExample).find((example): example is TrainingExample => Boolean(example));

  if (!aggregationExample) {
    return { records, collapsed: false };
  }

  const refined = await refinePODFromTrainingExampleBoxes(file, aggregationExample, records, model);
  return {
    ...refined,
    collapsed: records.length > 1 && refined.records.length === 1,
  };
}

function inferFieldAggregation(field: TrainingField, boxCount: number): FieldAggregation {
  if (boxCount <= 1) return "first";
  return field === "total" || field === "unscanned" || field === "exceptions" ? "sum" : "join_comma";
}

function describeFieldAggregation(mode: FieldAggregation): string {
  switch (mode) {
    case "sum":
      return "若同字段有多张小图，只对明确属于该字段标签的数字求和。";
    case "join_comma":
      return "若同字段有多张小图，只拼接与该字段标签直接对应的文本，并用英文逗号连接。";
    case "join_newline":
      return "若同字段有多张小图，只拼接与该字段标签直接对应的文本，并用换行连接。";
    case "first":
      return "只采用第一个能够确认标签语义的读数。";
    default:
      return "";
  }
}

async function cropsToPngDataUrls(
  imageBuffer: Buffer,
  boxes: TrainingBox[],
): Promise<string[]> {
  const meta = await sharp(imageBuffer).metadata();
  const iw = meta.width ?? 0;
  const ih = meta.height ?? 0;
  if (!iw || !ih) {
    throw new Error("无法读取图片宽高");
  }

  const out: string[] = [];
  for (const box of boxes) {
    let left = Math.floor(box.x * iw);
    let top = Math.floor(box.y * ih);
    let width = Math.ceil(box.width * iw);
    let height = Math.ceil(box.height * ih);
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

function buildBoxGuidedCropInstructionText(
  boxes: TrainingBox[],
  aggs: Partial<Record<TrainingField, FieldAggregation>>,
): string {
  const byField = new Map<TrainingField, TrainingBox[]>();
  for (const box of boxes) {
    const list = byField.get(box.field) || [];
    list.push(box);
    byField.set(box.field, list);
  }

  const lines: string[] = [
    `下面会附上 ${boxes.length} 张裁剪小图，顺序固定：第 1 张对应第 1 个训练框，以此类推。`,
    "每张图只包含该矩形框内像素。你必须先识别图中可见的字段标签/文字项目，再读取与该标签直接对应的值；禁止只因数字在常见位置就认定字段。",
    "",
    "字段与图片对应关系：",
  ];

  boxes.forEach((box, index) => {
    lines.push(`图${index + 1} → 【${TRAINING_FIELD_CN[box.field]}】（JSON 键名 ${box.field}）`);
  });

  lines.push("", "同字段多张小图时的合并规则：");
  for (const [field, fieldBoxes] of byField) {
    if (fieldBoxes.length <= 1) continue;
    const mode = aggs[field] ?? inferFieldAggregation(field, fieldBoxes.length);
    lines.push(`- ${field}（${TRAINING_FIELD_CN[field]}）：${describeFieldAggregation(mode)}`);
  }

  lines.push(
    "",
    "输出一个 JSON 对象，键可包括：date, route, driver, taskCode, total, totalSourceLabel, unscanned, exceptions, stationTeam, previewNote。",
    "规则：只有当小图里可见标签足以证明字段语义时，才允许输出该字段值；否则输出 null 或省略。",
  );

  return lines.join("\n");
}

function mergeBoxGuidedRecord(
  base: PodRecord,
  parsed: Record<string, unknown>,
  boxedFields: Set<TrainingField>,
): PodRecord {
  const next = { ...base };
  const customFieldValues = normalizeCustomFieldValues(parsed.customFieldValues) || {};

  if (boxedFields.has("date")) {
    const value = normalizeText(parsed.date);
    next.date = value || "";
    if (!value) {
      next.reviewRequired = true;
      next.reviewReason = appendReviewReason(next.reviewReason, "训练池日期标注区域未能确认有效日期。");
    }
  }

  if (boxedFields.has("route")) {
    const value = normalizeRouteValue(normalizeText(parsed.route));
    next.route = value && isRouteFormatValid(value) ? value : "";
    if (!next.route) {
      next.reviewRequired = true;
      next.reviewReason = appendReviewReason(next.reviewReason, "训练池路线标注区域未能确认有效快递员路线。");
    }
  }

  if (boxedFields.has("driver")) {
    const value = normalizeText(parsed.driver);
    next.driver = value || "";
    if (!value) {
      next.reviewRequired = true;
      next.reviewReason = appendReviewReason(next.reviewReason, "训练池司机标注区域未能确认司机姓名。");
    }
  }

  if (boxedFields.has("taskCode")) {
    const value = normalizeText(parsed.taskCode);
    next.taskCode = value || "";
    if (!value) {
      next.reviewRequired = true;
      next.reviewReason = appendReviewReason(next.reviewReason, "训练池任务编码标注区域未能确认任务编码。");
    }
  }

  if (boxedFields.has("stationTeam")) {
    next.stationTeam = normalizeText(parsed.stationTeam) || "";
  }

  for (const field of boxedFields) {
    if (isBuiltInFieldId(field)) {
      continue;
    }
    const value = customFieldValues[field];
    next.customFieldValues = {
      ...(next.customFieldValues || {}),
      [field]: value ?? "",
    };
  }

  if (boxedFields.has("total")) {
    const total = normalizeNumber(parsed.total);
    const label =
      normalizeSafeTotalSourceLabel(parsed.totalSourceLabel) ||
      normalizeSafeTotalSourceLabel(base.totalSourceLabel) ||
      normalizeSafeTotalSourceLabel("应领件数");
    next.total = typeof total === "number" ? total : "";
    next.totalSourceLabel = typeof total === "number" ? label : "";
    if (next.total === "") {
      next.reviewRequired = true;
      next.reviewReason = appendReviewReason(next.reviewReason, "训练池运单数量标注区域未能确认合法标签和值。");
    }
  }

  if (boxedFields.has("unscanned")) {
    const unscanned = normalizeNumber(parsed.unscanned);
    next.unscanned = typeof unscanned === "number" ? unscanned : "";
    if (next.unscanned === "") {
      next.reviewRequired = true;
      next.reviewReason = appendReviewReason(next.reviewReason, "训练池未收数量标注区域未能确认合法标签和值。");
    }
  }

  if (boxedFields.has("exceptions")) {
    const exceptions = normalizeNumber(parsed.exceptions);
    next.exceptions = typeof exceptions === "number" ? exceptions : "";
    if (next.exceptions === "") {
      next.reviewRequired = true;
      next.reviewReason = appendReviewReason(next.reviewReason, "训练池错扫数量标注区域未能确认合法标签和值。");
    }
  }

  return next;
}

async function refinePODFromTrainingExampleBoxes(
  file: File,
  example: TrainingExample,
  records: PodRecord[],
  model: string,
): Promise<{ records: PodRecord[]; usage?: OpenAIUsage }> {
  if (!OPENAI_API_KEY || records.length === 0) return { records };

  const boxes = imageCoordBoxes(example);
  if (boxes.length === 0) return { records };

  const bytes = Buffer.from(await file.arrayBuffer());
  let cropUrls: string[];
  try {
    cropUrls = await cropsToPngDataUrls(bytes, boxes);
  } catch {
    return { records };
  }

  const userText = buildBoxGuidedCropInstructionText(boxes, example.fieldAggregations || {});
  const systemText = `你是 OrSight 的训练池强引导识别助手。你会收到多张已经按训练标注框裁剪好的小图。
你必须先识别每张小图中可见的字段标签/项目名称，再读取该标签直接对应的值；禁止仅凭坐标位置、数字大小或常见布局去猜字段。
若小图里没有足够标签语义证明字段归属，就输出 null 或省略该字段。只返回合法 JSON。`;

  const userContent: OpenAIMessageContent[] = [{ type: "text", text: userText }];
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
      model,
      reasoning_effort: OPENAI_REASONING_EFFORT,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) return { records };

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: OpenAIUsage;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return { records };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { records };
  }

  const boxedFields = new Set<TrainingField>(boxes.map((box) => box.field));
  const base = buildAggregationBaseRecord(records);
  const next = mergeBoxGuidedRecord(base, parsed, boxedFields);
  return {
    records: [next],
    usage: payload.usage,
  };
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
    const l = normalizeSafeTotalSourceLabel(ex.output.totalSourceLabel);
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

function compactLabelText(value: string): string {
  return value.replace(/[\s:：()（）【】\[\]\-_.。,'"`]/g, "");
}

function normalizeSafeTotalSourceLabel(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return "";
  const compact = compactLabelText(raw);
  if (compact.includes("应领")) return "应领件数";
  if (compact.includes("应收")) return "应收件数";
  if (compact.includes("运单") && compact.includes("数量")) return "运单数量";
  return raw;
}

function isUnsafeTotalSourceLabel(value: unknown): boolean {
  const compact = compactLabelText(normalizeText(value));
  if (!compact) return false;
  return (
    compact.includes("实领") ||
    compact.includes("已领") ||
    compact.includes("司机领取") ||
    compact.includes("领取量")
  );
}

function clearFieldFromTrainingMismatch(
  record: PodRecord,
  field: "route" | "total" | "unscanned" | "exceptions",
  label: string,
  reason: string,
): PodRecord {
  if (field === "route") {
    if (!record.route.trim()) return record;
    return {
      ...record,
      route: "",
      reviewRequired: true,
      reviewReason: appendReviewReason(record.reviewReason, `${label} 未能被训练池标注区域确认：${reason}`),
    };
  }

  if (field === "total") {
    if (record.total === "") return record;
    return {
      ...record,
      total: "" as const,
      totalSourceLabel: "",
      reviewRequired: true,
      reviewReason: appendReviewReason(record.reviewReason, `${label} 未能被训练池标注区域确认：${reason}`),
    };
  }

  if (record[field] === "") return record;
  return {
    ...record,
    [field]: "" as const,
    reviewRequired: true,
    reviewReason: appendReviewReason(record.reviewReason, `${label} 未能被训练池标注区域确认：${reason}`),
  };
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

  const prompt = `图中仅为签退/POD 类屏幕的一小块裁剪，对应任务列表里的「快递员路线 / 抽查路线」区域。请先根据当前裁剪图里可见的任务项、路线字段或与任务同行的语义关系，再读取路线编码（典型形如 IAH01-030-C，含 IAH 后两位区域数字）。
不要因为它“看起来在常见位置”就输出路线；不要输出站点车队样式（如单独的 IAH-BAA、IAH-FGI 等三字母段）。若图中没有可明确对应任务路线的编码，输出 {"route":null}。
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
  if (routeRaw === null || routeRaw === undefined) {
    const [rec] = records;
    return {
      records: [clearFieldFromTrainingMismatch(rec, "route", "抽查路线", "裁剪区域未读到有效路线编码。")],
      usage: payload.usage,
    };
  }
  const route = normalizeText(String(routeRaw));
  if (!route || route.toLowerCase() === "null" || !isRouteFormatValid(route)) {
    const [rec] = records;
    return {
      records: [clearFieldFromTrainingMismatch(rec, "route", "抽查路线", "裁剪区域结果不符合有效路线格式。")],
      usage: payload.usage,
    };
  }

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
请先在当前裁剪图中确认**可见的字段标签**，再读取与该标签直接对应的**一个非负整数**；如果只看到数字、看不到能证明它属于 total 的标签语义，必须返回 null。若图中有标签文字，请一并读出（尽量与图中文字一致）。
绝对不要把“实领件数”“已领”“司机领取量”等标签旁边的数字当作 total。
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
  if (total === "" || typeof total !== "number") {
    const [rec] = records;
    return {
      records: [clearFieldFromTrainingMismatch(rec, "total", "运单数量", "裁剪区域未读到稳定数字。")],
      usage: payload.usage,
    };
  }

  let label = normalizeSafeTotalSourceLabel(parsed?.totalSourceLabel);
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

  const prompt = `图中仅为签退/POD 屏幕上一小块裁剪。请先确认当前裁剪图里是否看得见「未领取」「未收」等明确表示未收数量的字段标签，再读取与该标签直接对应的数字。
如果数字旁边的标签不是未收语义，或者看不到标签语义，只输出 {"unscanned":null}。不要仅凭坐标或数字位置猜测。
只输出 JSON：{"unscanned": <非负整数>} 或 {"unscanned":null}。`;

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
  if (unscanned === "" || typeof unscanned !== "number") {
    const [rec] = records;
    return {
      records: [clearFieldFromTrainingMismatch(rec, "unscanned", "未收数量", "裁剪区域未读到稳定数字。")],
      usage: payload.usage,
    };
  }

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

  const prompt = `图中仅为签退/POD 屏幕上一小块裁剪。请先确认当前裁剪图里是否看得见「错扫」「错分」「误扫」等异常件数字段标签，再读取与该标签直接对应的数字。
不要把「未领取」「已退回」或无关角标数字当成错扫数量；若看不到异常件数字段标签，必须输出 null。
只输出 JSON：{"exceptions": <非负整数>} 或 {"exceptions":null}。`;

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
  if (rawEx === null || rawEx === undefined) {
    const [rec] = records;
    return {
      records: [clearFieldFromTrainingMismatch(rec, "exceptions", "错扫数量", "裁剪区域未读到稳定数字。")],
      usage: payload.usage,
    };
  }
  const ex = normalizeNumber(rawEx);
  if (ex === "" || typeof ex !== "number") {
    const [rec] = records;
    return {
      records: [clearFieldFromTrainingMismatch(rec, "exceptions", "错扫数量", "裁剪区域结果不是有效数字。")],
      usage: payload.usage,
    };
  }

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

// Legacy training-pool rule path kept only for rollback; current extraction flow no longer calls it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function runPODTrainingRefinesParallel(
  file: File,
  examples: TrainingExample[],
  records: PodRecord[],
  model: string,
): Promise<{ records: PodRecord[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
  if (!OPENAI_API_KEY || records.length !== 1) return { records };
  const boxGuidedExample = examples.find((example) => imageCoordBoxes(example).length > 0);
  if (boxGuidedExample) {
    return await refinePODFromTrainingExampleBoxes(file, boxGuidedExample, records, model);
  }

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
): Promise<{ records: RawModelRecord[]; imageType: string; usage?: OpenAIUsage }> {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Please configure the AI model first.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}`;
  const visualPack = ctx.visualPack;
  const baseText = `${SIMPLE_EXTRACTION_PROMPT}${buildRecognitionModeDynamicFieldPrompt(ctx.tableFields)}${visualPack.hintText}`;

  const userContent: OpenAIMessageContent[] = [{ type: "text", text: baseText }];
  for (const ref of visualPack.referenceImages) {
    userContent.push({ type: "text", text: ref.caption });
    userContent.push({ type: "image_url", image_url: { url: ref.dataUrl } });
  }

  userContent.push({
    type: "text",
    text: "\n【当前待识别图片】仅根据下面这一张图输出 JSON 中的 records；上面的人工标注参考图只用于帮助你先理解同类界面，不得把参考图中的文字或数字抄进结果。\n",
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
    usage?: OpenAIUsage;
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

async function callCounterVerifier(
  file: File,
  model: string,
): Promise<{ result: CounterVerificationResult; usage?: OpenAIUsage }> {
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
1. 第一张裁剪图只在看得见“应领件数/应收件数/运单数量”等 total 合法标签时，才读取 expectedCount。如果标签看不清、只剩数字或语义不确定，就返回 null。
2. 第二张裁剪图只在看得见“实领件数”等标签时，才读取 actualCount。如果看不清就返回 null。
3. 第三张裁剪图只在看得见“已领”等标签时，才读取 pickedUpCount。如果看不清就返回 null。
4. expectedCountVisible / actualCountVisible / pickedUpVisible 表示对应区域数字是否清晰可辨。
5. 绝对不要猜数字。
6. 不要把一张裁剪图中的数字借给另一张。
7. 不能因为数字正好在常见位置就认定字段，必须以当前裁剪图里可见的标签语义为准。

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
    usage?: OpenAIUsage;
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
    taskCode: normalizeText(raw.taskCode),
    total: normalizeNumber(raw.total),
    totalSourceLabel: normalizeText(raw.totalSourceLabel),
    unscanned: normalizeNumber(raw.unscanned),
    exceptions: normalizeNumber(raw.exceptions),
    waybillStatus: normalizeText(raw.waybillStatus),
    stationTeam: normalizeText(raw.stationTeam),
    customFieldValues: normalizeCustomFieldValues(raw.customFieldValues),
    reviewRequired: Boolean(raw.reviewRequired),
    reviewReason: normalizeText(raw.reviewReason) || null,
  };
}

function recordSignature(record: PodRecord): string {
  return JSON.stringify({
    date: record.date,
    route: record.route,
    driver: record.driver,
    taskCode: record.taskCode || "",
    total: record.total,
    totalSourceLabel: record.totalSourceLabel,
    unscanned: record.unscanned,
    exceptions: record.exceptions,
    waybillStatus: record.waybillStatus,
  });
}

function markSourceMismatchForReview(records: PodRecord[], validLabels: Set<string>) {
  return records.map((record) => {
    const normalizedSourceLabel = normalizeSafeTotalSourceLabel(record.totalSourceLabel);

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

    if (record.total !== "" && isUnsafeTotalSourceLabel(record.totalSourceLabel)) {
      return {
        ...record,
        total: "" as const,
        totalSourceLabel: "",
        reviewRequired: true,
        reviewReason: appendReviewReason(
          record.reviewReason,
          `运单数量来源异常：当前来源“${record.totalSourceLabel}”语义更像实领/已领，不允许作为运单数量。`,
        ),
      };
    }

    if (record.total !== "" && normalizedSourceLabel && validLabels.size > 0 && !validLabels.has(normalizedSourceLabel)) {
      return {
        ...record,
        total: "" as const,
        totalSourceLabel: normalizedSourceLabel,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          record.reviewReason,
          `运单数量来源异常：当前来源为“${record.totalSourceLabel}”，不是系统允许的安全来源标签，必须人工检查。`,
        ),
      };
    }

    return normalizedSourceLabel && normalizedSourceLabel !== record.totalSourceLabel
      ? { ...record, totalSourceLabel: normalizedSourceLabel }
      : record;
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

const MAX_REASONABLE_POD_COUNT = 9999;

function sanitizePodCountField(
  record: PodRecord,
  fileName: string,
  field: "total" | "unscanned" | "exceptions",
  label: string,
  issues: ExtractionIssue[],
): PodRecord {
  const value = record[field];
  if (value === "") {
    return record;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return record;
  }
  if (value <= MAX_REASONABLE_POD_COUNT) {
    return record;
  }

  issues.push({
    imageName: fileName,
    route: record.route,
    level: "error",
    code: `${field}_out_of_range`,
    message: `${label} 识别为异常大数值 ${value}，已清空并标记人工复核。`,
  });
  return {
    ...record,
    [field]: "" as const,
    reviewRequired: true,
    reviewReason: appendReviewReason(
      record.reviewReason,
      `${label} 识别结果异常偏大（${value}），疑似误读到时间戳、文件名或无关长数字，已清空待复核。`,
    ),
  };
}

function applyRecordSanityChecks(fileName: string, records: PodRecord[]) {
  const issues: ExtractionIssue[] = [];

  const nextRecords = records.map((record) => {
    let nextRecord = record;

    nextRecord = sanitizePodCountField(nextRecord, fileName, "total", "运单数量", issues);
    nextRecord = sanitizePodCountField(nextRecord, fileName, "unscanned", "未收数量", issues);
    nextRecord = sanitizePodCountField(nextRecord, fileName, "exceptions", "错扫数量", issues);

    if (nextRecord.total !== "" && nextRecord.unscanned !== "" && nextRecord.unscanned > nextRecord.total) {
      issues.push({
        imageName: fileName,
        route: nextRecord.route,
        level: "error",
        code: "unscanned_exceeds_total",
        message: `未收数量 ${nextRecord.unscanned} 大于运单数量 ${nextRecord.total}，已清空未收数量并标记复核。`,
      });
      nextRecord = {
        ...nextRecord,
        unscanned: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          nextRecord.reviewReason,
          `未收数量大于运单数量（${nextRecord.unscanned} > ${nextRecord.total}），疑似误读，已清空待复核。`,
        ),
      };
    }

    if (nextRecord.total !== "" && nextRecord.exceptions !== "" && nextRecord.exceptions > nextRecord.total) {
      issues.push({
        imageName: fileName,
        route: nextRecord.route,
        level: "error",
        code: "exceptions_exceeds_total",
        message: `错扫数量 ${nextRecord.exceptions} 大于运单数量 ${nextRecord.total}，已清空错扫数量并标记复核。`,
      });
      nextRecord = {
        ...nextRecord,
        exceptions: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          nextRecord.reviewReason,
          `错扫数量大于运单数量（${nextRecord.exceptions} > ${nextRecord.total}），疑似误读，已清空待复核。`,
        ),
      };
    }

    return nextRecord;
  });

  return {
    records: nextRecords,
    issues,
  };
}

function deriveWaybillStatus(records: PodRecord[]) {
  return records.map((record) => {
    if (record.unscanned === "") {
      return record;
    }
    return {
      ...record,
      waybillStatus: record.unscanned > 0 ? "待更新" : "全领取",
    };
  });
}

function deriveCounterBasedUnscanned(
  expectedCount: number | null,
  actualCount: number | null,
  pickedUpCount: number | null,
  actualCountVisible: boolean,
  pickedUpVisible: boolean,
  singleRecordView: boolean,
): { value: number | null; source: "actualCount" | "pickedUpCount" | null } {
  if (expectedCount === null) {
    return { value: null, source: null };
  }

  if (actualCountVisible && actualCount !== null) {
    const derived = expectedCount - actualCount;
    if (Number.isInteger(derived) && derived >= 0 && derived <= expectedCount) {
      return { value: derived, source: "actualCount" };
    }
  }

  if (singleRecordView && pickedUpVisible && pickedUpCount !== null) {
    const derived = expectedCount - pickedUpCount;
    if (Number.isInteger(derived) && derived >= 0 && derived <= expectedCount) {
      return { value: derived, source: "pickedUpCount" };
    }
  }

  return { value: null, source: null };
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
  const actualCountVisible = toBoolean(verification.actualCountVisible);
  const pickedUpVisible = toBoolean(verification.pickedUpVisible);
  const singleRecordView = records.length === 1;
  const derivedUnscanned = deriveCounterBasedUnscanned(
    expectedCount,
    actualCount,
    pickedUpCount,
    actualCountVisible,
    pickedUpVisible,
    singleRecordView,
  );

  const nextRecords = records.map((record) => {
    let nextRecord = record;

    const sourceLabelNorm = normalizeSafeTotalSourceLabel(nextRecord.totalSourceLabel);
    const totalLabelTrusted =
      validLabels.size > 0 && sourceLabelNorm !== "" && validLabels.has(sourceLabelNorm);
    const hasReliableExpectedCount = expectedCountVisible && expectedCount !== null;

    if (hasReliableExpectedCount) {
      const previousTotal = nextRecord.total;
      const totalNeedsCorrection = previousTotal === "" || previousTotal !== expectedCount;
      const labelNeedsCorrection =
        sourceLabelNorm === "" ||
        isUnsafeTotalSourceLabel(nextRecord.totalSourceLabel) ||
        (validLabels.size > 0 && !validLabels.has(sourceLabelNorm));

      if (totalNeedsCorrection || labelNeedsCorrection) {
        nextRecord = clearResolvedTotalReviewFlags({
          ...nextRecord,
          total: expectedCount,
          totalSourceLabel: "应领件数",
        });

        if (previousTotal === "") {
          issues.push({
            imageName: fileName,
            route: record.route,
            level: "warning",
            code: "total_filled_from_expected",
            message: `固定计数器识别到应领件数 ${expectedCount}，已自动回填运单数量。`,
          });
        } else if (previousTotal !== expectedCount) {
          issues.push({
            imageName: fileName,
            route: record.route,
            level: "warning",
            code: "total_corrected_from_expected",
            message: `运单数量原为 ${previousTotal}，与应领件数 ${expectedCount} 不一致，已按应领件数自动纠正。`,
          });
        }
      }

      if (derivedUnscanned.value !== null) {
        const previousUnscanned = nextRecord.unscanned;
        if (previousUnscanned === "" || previousUnscanned !== derivedUnscanned.value) {
          nextRecord = clearResolvedUnscannedReviewFlags({
            ...nextRecord,
            unscanned: derivedUnscanned.value,
          });

          if (previousUnscanned === "") {
            issues.push({
              imageName: fileName,
              route: record.route,
              level: "warning",
              code: "unscanned_filled_from_counters",
              message: `固定计数器核验推导出未收数量 ${derivedUnscanned.value}（依据 ${derivedUnscanned.source === "actualCount" ? "应领件数 - 实领件数" : "应领件数 - 已领"}），已自动回填。`,
            });
          } else if (previousUnscanned !== derivedUnscanned.value) {
            issues.push({
              imageName: fileName,
              route: record.route,
              level: "warning",
              code: "unscanned_corrected_from_counters",
              message: `未收数量原为 ${previousUnscanned}，与固定计数器推导结果 ${derivedUnscanned.value} 不一致，已自动纠正。`,
            });
          }
        }
      }

      return nextRecord;
    }

    // 固定裁剪区读不到应领件数时，若运单数量已由主模型/训练池裁剪给出且来源标签在训练池合法列表中，则保留，避免误清空
    if (
      nextRecord.total !== "" &&
      !hasReliableExpectedCount &&
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

    for (const file of files) {
      const recognitionResult = await callVisionModel(file, model, visionCtx);
      const checkedRecords = recognitionResult.records.map((rawRecord, index) => mapRecord(file.name, rawRecord, index));

      const totalPromptTokens = recognitionResult.usage?.prompt_tokens || 0;
      const totalCompletionTokens = recognitionResult.usage?.completion_tokens || 0;
      const totalTokens = recognitionResult.usage?.total_tokens || 0;

      if (user?.id) {
        const admin = getSupabaseAdmin();
        if (admin) {
          admin.from("usage_logs").insert({
            user_id: user.id,
            action_type: "extract_table",
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
        continue;
      }

      checkedRecords.forEach((record) => {
        records.push(record);
        issues.push(...validateRecord(record));
      });
    }

    return NextResponse.json({
      records,
      issues,
      modelUsed: model,
      mode,
      trainingExamplesLoaded: examples.length,
    });
    const validLabels = new Set(["应领件数", "应收件数", "运单数量"]);
    for (const file of files) {
      const consistencyResult = await runConsistencyCheck(file, model, visionCtx);
      let workingRecords = consistencyResult.records;

      if (consistencyResult.imageType === "POD") {
        const refined = await runLiveAggregationRefine(file, visionCtx, workingRecords, model);
        workingRecords = refined.records;
        if (refined.collapsed) {
          consistencyResult.issues = consistencyResult.issues.filter((issue) => !issue.route);
        }
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

      const sanityChecked = applyRecordSanityChecks(file.name, sourceCheckedRecords);
      let checkedRecords = sanityChecked.records;
      let counterIssues: ExtractionIssue[] = sanityChecked.issues;

      let totalPromptTokens = consistencyResult.usage?.prompt_tokens || 0;
      let totalCompletionTokens = consistencyResult.usage?.completion_tokens || 0;
      let totalTokens = consistencyResult.usage?.total_tokens || 0;

      // Only run counter verification for POD images
      if (consistencyResult.imageType === "POD") {
        const counterVerification = await callCounterVerifier(file, model);
        const counterChecked = applyCounterVerification(
          file.name,
          checkedRecords,
          counterVerification.result,
          validLabels,
        );
        checkedRecords = counterChecked.records;
        counterIssues = [...counterIssues, ...counterChecked.issues];
        
        if (counterVerification.usage) {
          totalPromptTokens += counterVerification.usage?.prompt_tokens || 0;
          totalCompletionTokens += counterVerification.usage?.completion_tokens || 0;
          totalTokens += counterVerification.usage?.total_tokens || 0;
        }
      }

      checkedRecords = deriveWaybillStatus(checkedRecords);

      // Log usage to Supabase if user is logged in
      if (user?.id) {
        const admin = getSupabaseAdmin();
        if (admin) {
          // Fire and forget, don't await to block the response
          admin!.from('usage_logs').insert({
            user_id: user!.id,
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
