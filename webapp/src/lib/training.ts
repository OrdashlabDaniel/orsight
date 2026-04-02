import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import type { AgentAsset, AgentThreadTurn } from "./agent-context-types";
import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase";

export type { AgentAsset, AgentThreadTurn } from "./agent-context-types";

export type TrainingField =
  | "date"
  | "route"
  | "driver"
  | "total"
  | "unscanned"
  | "exceptions"
  | "waybillStatus"
  | "stationTeam";

/** 同一字段多框时，如何合并写入表格 */
export type FieldAggregation = "sum" | "join_comma" | "join_newline" | "first";

export type TrainingBox = {
  /** 唯一 id，支持同字段多框 */
  id?: string;
  field: TrainingField;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * 框坐标含义。未设置视为历史数据：相对标注容器（含 object-contain 留白），与位图不完全一致。
   * 新标注应使用 `image`：相对原始图片宽高的 0~1，与发给模型的说明一致。
   */
  coordSpace?: "image" | "container";
};

export type TrainingExample = {
  imageName: string;
  notes?: string;
  output: {
    date: string;
    route: string;
    driver: string;
    total: number;
    totalSourceLabel?: string;
    unscanned: number;
    exceptions: number;
    waybillStatus?: string;
    stationTeam?: string;
  };
  boxes?: TrainingBox[];
  /** 按字段指定多框合并方式；未指定的字段按默认策略推断 */
  fieldAggregations?: Partial<Record<TrainingField, FieldAggregation>>;
};

export type GuidanceTurn = {
  role: "user" | "assistant";
  content: string;
  ts: string;
};

export type GlobalRules = {
  instructions: string;
  documents: Array<{
    name: string;
    content: string;
  }>;
  /** 训练页「与 AI 对话」历史，随全局规则一并持久化 */
  guidanceHistory?: GuidanceTurn[];
  /** 填表 Agent：单一对话流（文字 + 附图 + 文档摘录），用于继续优化规则 */
  agentThread?: AgentThreadTurn[];
  /**
   * 由 Agent 迭代生成的「填表工作规则」全文，直接注入 Vision 提示词（内化到工作流，非聊天记录）
   */
  workingRules?: string;
};

const GLOBAL_RULES_KEY = "__global_rules__";

export async function loadGlobalRules(): Promise<GlobalRules> {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    // Fallback to local if needed, but for now just return empty
    return { instructions: "", documents: [] };
  }

  try {
    const { data, error } = await admin
      .from("training_examples")
      .select("data")
      .eq("image_name", GLOBAL_RULES_KEY)
      .single();

    if (error || !data) {
      return { instructions: "", documents: [] };
    }

    const row = data.data as GlobalRules;
    return {
      instructions: row.instructions ?? "",
      documents: Array.isArray(row.documents) ? row.documents : [],
      guidanceHistory: Array.isArray(row.guidanceHistory) ? row.guidanceHistory : undefined,
      agentThread: Array.isArray(row.agentThread) ? row.agentThread : undefined,
      workingRules: typeof row.workingRules === "string" ? row.workingRules : undefined,
    };
  } catch (error) {
    console.error("Exception loading global rules:", error);
    return { instructions: "", documents: [] };
  }
}

export async function saveGlobalRules(rules: GlobalRules) {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    return;
  }

  const { error } = await admin
    .from("training_examples")
    .upsert(
      {
        image_name: GLOBAL_RULES_KEY,
        data: rules,
      },
      { onConflict: "image_name" },
    );

  if (error) {
    throw new Error(`Failed to save global rules: ${error.message}`);
  }
}

export async function loadTrainingExamples(): Promise<TrainingExample[]> {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    return loadLocalTrainingExamples().filter(ex => ex.imageName !== GLOBAL_RULES_KEY);
  }

  try {
    const { data, error } = await admin
      .from("training_examples")
      .select("data")
      .neq("image_name", GLOBAL_RULES_KEY);

    if (error) {
      console.error("Error loading examples from Supabase:", error);
      return loadLocalTrainingExamples().filter(ex => ex.imageName !== GLOBAL_RULES_KEY);
    }

    return data.map((row) => row.data as TrainingExample);
  } catch (error) {
    console.error("Exception loading examples:", error);
    return loadLocalTrainingExamples().filter(ex => ex.imageName !== GLOBAL_RULES_KEY);
  }
}

export async function saveTrainingExamples(examples: TrainingExample[]) {
  saveLocalTrainingExamples(examples);
}

export async function upsertTrainingExample(example: TrainingExample) {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    const current = loadLocalTrainingExamples();
    const next = current.filter((item) => item.imageName !== example.imageName);
    next.push(example);
    saveLocalTrainingExamples(next);
    return next;
  }

  const { error } = await admin
    .from("training_examples")
    .upsert(
      {
        image_name: example.imageName,
        data: example,
      },
      { onConflict: "image_name" },
    );

  if (error) {
    throw new Error(`Failed to save to Supabase: ${error.message}`);
  }

  return await loadTrainingExamples();
}

export async function listTrainingImages() {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    return listLocalTrainingImages();
  }

  const { data, error } = await admin.storage
    .from("training-images")
    .list();

  if (error) {
    console.error("Error listing images:", error);
    return [];
  }

  return data
    .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file.name))
    .map((file) => ({
      imageName: file.name,
      absolutePath: file.name,
    }));
}

export async function getTrainingImageDataUrl(imageName: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    return getLocalTrainingImageDataUrl(imageName);
  }

  const { data, error } = await admin.storage
    .from("training-images")
    .download(imageName);

  if (error || !data) {
    console.error("Error downloading image:", error);
    return null;
  }

  const buffer = await data.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  const extension = imageName.split(".").pop()?.toLowerCase();
  const mimeType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";

  return `data:${mimeType};base64,${base64}`;
}

export async function saveTrainingImageDataUrl(imageName: string, dataUrl: string) {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    saveLocalTrainingImageDataUrl(imageName, dataUrl);
    return;
  }

  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }

  const mimeType = matched[1];
  const base64 = matched[2];
  const buffer = Buffer.from(base64, "base64");

  const { error } = await admin.storage
    .from("training-images")
    .upload(imageName, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload image to Supabase: ${error.message}`);
  }
}

export async function getTrainingPoolStatus() {
  const examples = await loadTrainingExamples();
  const exampleMap = new Map(examples.map((example) => [example.imageName, example]));
  const images = await listTrainingImages();

  return {
    totalImages: images.length,
    labeledImages: images.filter((image) => exampleMap.has(image.imageName)).length,
    unlabeledImages: images.filter((image) => !exampleMap.has(image.imageName)).length,
    items: images.map((image) => ({
      imageName: image.imageName,
      labeled: exampleMap.has(image.imageName),
      example: exampleMap.get(image.imageName) || null,
    })),
  };
}

function examplesCandidatePaths() {
  return [
    path.join(process.cwd(), "training", "examples.json"),
    path.resolve(process.cwd(), "..", "training", "examples.json"),
  ];
}

function trainingImageCandidatePaths() {
  return [
    path.join(process.cwd(), "image", "training-ai"),
    path.resolve(process.cwd(), "..", "image", "training-ai"),
  ];
}

function resolveExamplesPath(): string {
  const existing = examplesCandidatePaths().find((filePath) => fs.existsSync(filePath));
  return existing || examplesCandidatePaths()[1];
}

function resolveTrainingImageDir(): string | null {
  return trainingImageCandidatePaths().find((dirPath) => fs.existsSync(dirPath)) || null;
}

function loadLocalTrainingExamples(): TrainingExample[] {
  for (const filePath of examplesCandidatePaths()) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        examples?: TrainingExample[];
      };
      return Array.isArray(payload.examples) ? payload.examples : [];
    } catch {
      return [];
    }
  }

  return [];
}

function saveLocalTrainingExamples(examples: TrainingExample[]) {
  const filePath = resolveExamplesPath();
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ examples }, null, 2), "utf8");
}

function listLocalTrainingImages() {
  const dirPath = resolveTrainingImageDir();
  if (!dirPath) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((fileName) => /\.(png|jpg|jpeg|webp)$/i.test(fileName))
    .sort()
    .map((fileName) => ({
      imageName: fileName,
      absolutePath: path.join(dirPath, fileName),
    }));
}

function getLocalTrainingImageDataUrl(imageName: string): string | null {
  const dirPath = resolveTrainingImageDir();
  if (!dirPath) {
    return null;
  }

  const filePath = path.join(dirPath, imageName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const extension = path.extname(filePath).toLowerCase();
  const mimeType =
    extension === ".png"
      ? "image/png"
      : extension === ".webp"
        ? "image/webp"
        : "image/jpeg";
  const buffer = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function saveLocalTrainingImageDataUrl(imageName: string, dataUrl: string) {
  const dirPath = resolveTrainingImageDir() || path.resolve(process.cwd(), "..", "image", "training-ai");
  fs.mkdirSync(dirPath, { recursive: true });

  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }

  const buffer = Buffer.from(matched[2], "base64");
  fs.writeFileSync(path.join(dirPath, imageName), buffer);
}

const TRAINING_FIELD_LABELS: Record<string, string> = {
  date: "日期",
  route: "抽查路线",
  driver: "抽查司机",
  total: "运单数量",
  unscanned: "未收数量",
  exceptions: "错扫数量",
  waybillStatus: "响应更新状态",
  stationTeam: "站点车队",
};

const TRAINING_FIELD_COLORS: Record<TrainingField, string> = {
  date: "#2563eb",
  route: "#7c3aed",
  driver: "#0891b2",
  total: "#16a34a",
  unscanned: "#ea580c",
  exceptions: "#dc2626",
  waybillStatus: "#475569",
  stationTeam: "#0f766e",
};

const NUMERIC_TRAINING_FIELDS: TrainingField[] = ["total", "unscanned", "exceptions"];

function inferFieldAggregation(field: TrainingField, boxCount: number): FieldAggregation {
  if (boxCount <= 1) return "first";
  return NUMERIC_TRAINING_FIELDS.includes(field) ? "sum" : "join_comma";
}

function describeAggregation(mode: FieldAggregation): string {
  switch (mode) {
    case "sum":
      return "多个区域时，将读到的**数字相加**后再填入该字段";
    case "join_comma":
      return "多个区域时，将读到的文本**用英文逗号连接**后填入该字段";
    case "join_newline":
      return "多个区域时，将读到的文本**换行并列**写入（或按表格允许多行展示）";
    case "first":
      return "仅采用**第一个**框对应读数，其余同字段框可忽略";
    default:
      return "";
  }
}

// Legacy text-rule generator kept only for rollback; extraction now uses annotated reference images instead.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatBoxHintsForExample(example: TrainingExample): string {
  if (!example.boxes?.length) {
    return "";
  }
  const byField = new Map<TrainingField, TrainingBox[]>();
  for (const b of example.boxes) {
    const list = byField.get(b.field) || [];
    list.push(b);
    byField.set(b.field, list);
  }

  const lines: string[] = [];
  for (const [field, list] of byField) {
    const label = TRAINING_FIELD_LABELS[field] || field;
    const mode =
      example.fieldAggregations?.[field] ?? inferFieldAggregation(field, list.length);
    list.forEach((b, i) => {
      const x2 = b.x + b.width;
      const y2 = b.y + b.height;
      const valHint = b.value ? `图中可见值约「${b.value}」` : "值见下方示例输出";
      const idx = list.length > 1 ? ` 区域${i + 1}` : "";
      const coordNote =
        b.coordSpace === "image"
          ? "位图归一化"
          : b.coordSpace === "container"
            ? "旧版容器坐标（仅供参考）"
            : "坐标（旧数据可能为容器比例）";
      lines.push(
        `  - ${label}${idx}：${valHint}；${coordNote} 矩形 x∈[${(b.x * 100).toFixed(1)}%, ${(x2 * 100).toFixed(1)}%]，y∈[${(b.y * 100).toFixed(1)}%, ${(y2 * 100).toFixed(1)}%]（原点左上）。这些坐标只用于缩小搜索范围，真正取值必须依据该区域内可见的字段标签与其相邻值的语义关系，禁止仅凭坐标位置硬套数字。`,
      );
    });
    if (list.length > 1) {
      lines.push(`  （${label} — 多框合并：${describeAggregation(mode)}）`);
    }
  }
  return `参考图「${example.imageName}」上各字段的大致区域：\n${lines.join("\n")}`;
}

/** 优先把含框选多、信息完整的样本排在前面，便于作为识别指导注入提示词。 */
export function sortTrainingExamplesForGuidance(examples: TrainingExample[]): TrainingExample[] {
  return [...examples].sort((a, b) => {
    const ba = a.boxes?.length ?? 0;
    const bb = b.boxes?.length ?? 0;
    if (bb !== ba) return bb - ba;
    const na = a.notes?.trim() ? 1 : 0;
    const nb = b.notes?.trim() ? 1 : 0;
    if (nb !== na) return nb - na;
    return (a.imageName || "").localeCompare(b.imageName || "", "en");
  });
}

function resolveTrainingPromptExampleLimit(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.max(1, Math.min(48, Math.floor(explicit)));
  }
  const raw = process.env.TRAINING_PROMPT_EXAMPLES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n)) return Math.max(1, Math.min(48, n));
  return 12;
}

// Legacy text-rule generator kept only for rollback; extraction now uses annotated reference images instead.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function resolveTrainingBoxHintLimit(options?: { maxBoxHintExamples?: number }): number {
  if (options?.maxBoxHintExamples != null) {
    return Math.max(1, Math.min(24, options.maxBoxHintExamples));
  }
  const raw = process.env.TRAINING_BOX_HINT_EXAMPLES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n)) return Math.max(1, Math.min(24, n));
  return 8;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    return null;
  }
  return {
    mimeType: matched[1],
    buffer: Buffer.from(matched[2], "base64"),
  };
}

async function buildAnnotatedTrainingImageDataUrl(
  example: TrainingExample,
  originalDataUrl: string,
): Promise<string> {
  const parsed = parseDataUrl(originalDataUrl);
  if (!parsed) {
    return originalDataUrl;
  }

  const boxes = (example.boxes || []).filter((box) => box.coordSpace === "image");
  if (boxes.length === 0) {
    return originalDataUrl;
  }

  const image = sharp(parsed.buffer);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return originalDataUrl;
  }

  const width = metadata.width;
  const height = metadata.height;
  const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.022));
  const strokeWidth = Math.max(3, Math.round(Math.min(width, height) * 0.004));
  const labelHeight = fontSize + 12;
  const overlayParts: string[] = [];

  for (const box of boxes) {
    const color = TRAINING_FIELD_COLORS[box.field] || "#2563eb";
    const x = Math.max(0, Math.round(box.x * width));
    const y = Math.max(0, Math.round(box.y * height));
    const w = Math.max(1, Math.round(box.width * width));
    const h = Math.max(1, Math.round(box.height * height));
    const label = escapeSvgText(TRAINING_FIELD_LABELS[box.field] || box.field);
    const labelWidth = Math.max(88, label.length * (fontSize * 0.95));
    const labelY = Math.max(0, y - labelHeight);

    overlayParts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8" fill="none" stroke="${color}" stroke-width="${strokeWidth}" />`,
    );
    overlayParts.push(
      `<rect x="${x}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" rx="8" ry="8" fill="${color}" fill-opacity="0.92" />`,
    );
    overlayParts.push(
      `<text x="${x + 10}" y="${labelY + labelHeight - 8}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="700" fill="#ffffff">${label}</text>`,
    );
  }

  const overlaySvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${overlayParts.join("")}</svg>`,
    "utf8",
  );
  const annotated = await image
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return `data:image/png;base64,${annotated.toString("base64")}`;
}

/**
 * 将训练样本中的框选 + 可选参考图拼进 Vision 请求，便于模型对齐布局规律。
 * 参考图数量默认 1，可用环境变量 TRAINING_VISUAL_REF_IMAGES=0 关闭附图（仍保留文字区域说明）。
 */
export async function buildVisualReferencePack(
  examples: TrainingExample[],
  options?: { maxImages?: number; maxBoxHintExamples?: number },
): Promise<{
  hintText: string;
  referenceImages: Array<{ imageName: string; caption: string; dataUrl: string }>;
}> {
  const maxImagesRaw = process.env.TRAINING_VISUAL_REF_IMAGES;
  const maxImages =
    maxImagesRaw === "0" || maxImagesRaw === "false"
      ? 0
      : Math.max(0, Number.parseInt(maxImagesRaw || "4", 10) || 4);
  const effectiveMaxImages = options?.maxImages ?? maxImages;
  const annotatedExamples = examples.filter((e) => e.boxes && e.boxes.length > 0);
  const sorted = sortTrainingExamplesForGuidance(
    annotatedExamples.length > 0 ? annotatedExamples : examples,
  );

  const referenceImages: Array<{ imageName: string; caption: string; dataUrl: string }> = [];
  if (effectiveMaxImages > 0) {
    for (const ex of sorted) {
      if (referenceImages.length >= effectiveMaxImages) break;
      const originalDataUrl = await getTrainingImageDataUrl(ex.imageName);
      if (!originalDataUrl) continue;
      const dataUrl = await buildAnnotatedTrainingImageDataUrl(ex, originalDataUrl);
      const summary = [
        `date=${ex.output.date}`,
        `route=${ex.output.route}`,
        `driver=${ex.output.driver}`,
        `total=${ex.output.total}`,
        ex.output.totalSourceLabel ? `totalSourceLabel=${ex.output.totalSourceLabel}` : "",
        `unscanned=${ex.output.unscanned}`,
        `exceptions=${ex.output.exceptions}`,
        ex.output.waybillStatus ? `waybillStatus=${ex.output.waybillStatus}` : "",
        ex.output.stationTeam ? `stationTeam=${ex.output.stationTeam}` : "",
      ]
        .filter(Boolean)
        .join("；");
      const caption = `【人工标注参考图：${ex.imageName}】这是一张已人工确认的样本图，方框只用于帮助你先看懂同类界面的字段位置与含义。该样本的正确结果是：${summary}。禁止把这张样本图的数字直接抄到最终结果；最终输出只能来自最后一张「当前待识别图片」的可见像素。`;
      referenceImages.push({ imageName: ex.imageName, caption, dataUrl });
    }
  }

  const hintText =
    referenceImages.length > 0
      ? "\n\n【人工标注参考图】先看下面这些已标注样本图，理解同类界面的字段含义与布局；不要把样本值抄入当前结果。\n"
      : "";

  return { hintText, referenceImages };
}

const MAX_DOC_EXCERPT_IN_PROMPT = 6000;

/** 仅当存储里还没有 agentThread 字段时，把旧版 instructions / documents / guidanceHistory 合成时间线（避免每次 GET 重复迁入） */
export function mergeLegacyIntoAgentThreadIfEmpty(rules: GlobalRules): GlobalRules {
  if (rules.agentThread !== undefined) {
    return rules;
  }

  const thread: AgentThreadTurn[] = [];
  const baseTs = "1970-01-01T00:00:00.000Z";

  if (rules.instructions?.trim()) {
    thread.push({
      id: `legacy-instructions`,
      role: "user",
      content: `【自旧版「自定义规则」迁入】\n${rules.instructions.trim()}`,
      ts: baseTs,
    });
  }

  for (const doc of rules.documents || []) {
    if (!doc?.name || !doc.content?.trim()) continue;
    thread.push({
      id: `legacy-doc-${doc.name}`,
      role: "user",
      content: `【自旧版文档迁入】${doc.name}`,
      ts: baseTs,
      assets: [
        {
          kind: "document",
          name: doc.name,
          excerpt: doc.content.slice(0, 12000),
        },
      ],
    });
  }

  for (const g of rules.guidanceHistory || []) {
    if (!g.content?.trim()) continue;
    thread.push({
      id: `legacy-chat-${g.ts}`,
      role: g.role,
      content: g.content.trim(),
      ts: g.ts,
    });
  }

  return { ...rules, agentThread: thread };
}

/** 首次加载：若尚无 workingRules，用旧版自定义规则文本作为初始工作规则 */
export function seedWorkingRulesFromLegacy(rules: GlobalRules): GlobalRules {
  if (rules.workingRules !== undefined) {
    return rules;
  }
  const w = rules.instructions?.trim() ? rules.instructions.trim() : "";
  return { ...rules, workingRules: w };
}

export function buildAgentThreadPromptSection(thread: AgentThreadTurn[] | undefined | null): string {
  if (!thread || thread.length === 0) {
    return "";
  }

  const blocks: string[] = [];
  for (const turn of thread) {
    const who = turn.role === "user" ? "用户" : "助手";
    let block = `${who}：${turn.content}`;
    if (turn.role === "assistant" && turn.suggestedRules?.trim()) {
      block += `\n（整理出的可执行补充规则）\n${turn.suggestedRules.trim()}`;
    }
    if (turn.assets?.length) {
      for (const a of turn.assets) {
        if (a.kind === "image") {
          block += `\n  [附图 ${a.name}，存储名 ${a.imageName}，填表视觉阶段会附带该图作布局参考]`;
        } else {
          const ex = a.excerpt.length > MAX_DOC_EXCERPT_IN_PROMPT
            ? `${a.excerpt.slice(0, MAX_DOC_EXCERPT_IN_PROMPT)}…`
            : a.excerpt;
          block += `\n  [文档 ${a.name} 摘录]\n${ex}`;
        }
      }
    }
    blocks.push(block);
  }

  return `\n\n【填表 Agent 对话与参考材料（用户通过自然语言、图片与文档教你的业务约定）】\n${blocks.join("\n\n---\n\n")}\n`;
}

export function normalizeAgentThread(raw: unknown): AgentThreadTurn[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AgentThreadTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    if (t.role !== "user" && t.role !== "assistant") continue;
    if (typeof t.content !== "string" || typeof t.ts !== "string") continue;
    const id = typeof t.id === "string" && t.id ? t.id : `t-${t.ts}-${out.length}`;
    const assets = normalizeAgentAssets(t.assets);
    const suggestedRules =
      typeof t.suggestedRules === "string" ? t.suggestedRules.slice(0, 8000) : undefined;
    out.push({
      id,
      role: t.role,
      content: t.content.slice(0, 24000),
      ts: t.ts,
      ...(assets.length ? { assets } : {}),
      ...(suggestedRules ? { suggestedRules } : {}),
    });
  }
  return out;
}

function normalizeAgentAssets(raw: unknown): AgentAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAsset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (a.kind === "image" && typeof a.name === "string" && typeof a.imageName === "string") {
      out.push({ kind: "image", name: a.name.slice(0, 256), imageName: a.imageName.slice(0, 512) });
    } else if (a.kind === "document" && typeof a.name === "string" && typeof a.excerpt === "string") {
      out.push({
        kind: "document",
        name: a.name.slice(0, 256),
        excerpt: a.excerpt.slice(0, 12000),
      });
    }
  }
  return out;
}

/** 从对话线程收集用户上传的参考图，供 Vision 请求附带（不计入训练池标注样本） */
export async function buildAgentThreadReferenceImages(
  thread: AgentThreadTurn[] | undefined | null,
  limit?: number,
): Promise<Array<{ imageName: string; caption: string; dataUrl: string }>> {
  const max =
    limit ??
    Math.max(0, Math.min(3, Number.parseInt(process.env.AGENT_CONTEXT_REF_IMAGES || "2", 10) || 2));
  if (!thread || max === 0) return [];

  const seen = new Set<string>();
  const order: string[] = [];
  for (const turn of thread) {
    if (turn.role !== "user" || !turn.assets?.length) continue;
    for (const a of turn.assets) {
      if (a.kind !== "image") continue;
      if (seen.has(a.imageName)) continue;
      seen.add(a.imageName);
      order.push(a.imageName);
      if (order.length >= max) break;
    }
    if (order.length >= max) break;
  }

  const refs: Array<{ imageName: string; caption: string; dataUrl: string }> = [];
  for (const imageName of order) {
    const dataUrl = await getTrainingImageDataUrl(imageName);
    if (!dataUrl) continue;
    refs.push({
      imageName,
      caption: `【用户在填表 Agent 对话中提供的参考图：${imageName}】仅作布局/样式参考，禁止把图中文字抄入最终结果；结果必须来自下方「当前待识别图片」。`,
      dataUrl,
    });
  }
  return refs;
}

export function buildTrainingPromptSection(
  examples: TrainingExample[],
  globalRules?: GlobalRules | null,
  limitOrOptions?: number | { limit?: number },
): string {
  let section = "";
  const limitOpt =
    typeof limitOrOptions === "number"
      ? limitOrOptions
      : limitOrOptions?.limit;
  const exampleLimit = resolveTrainingPromptExampleLimit(limitOpt);

  if (globalRules) {
    const wr = globalRules.workingRules?.trim();
    if (wr) {
      section += `\n\n【填表工作规则（已由 Agent 内化，填表时优先遵守；与像素冲突时以当前截图为准）】\n${wr}\n`;
    } else {
      const thread = globalRules.agentThread;
      if (thread && thread.length > 0) {
        section += buildAgentThreadPromptSection(thread);
      } else {
        if (globalRules.instructions) {
          section += `\n\n【全局提取规则与用户指示】\n${globalRules.instructions}\n`;
        }
        if (globalRules.documents && globalRules.documents.length > 0) {
          section += `\n\n【参考文档与知识库】\n`;
          globalRules.documents.forEach((doc, idx) => {
            section += `--- 文档 ${idx + 1}: ${doc.name} ---\n${doc.content}\n`;
          });
        }
        if (globalRules.guidanceHistory && globalRules.guidanceHistory.length > 0) {
          const recent = globalRules.guidanceHistory.slice(-8);
          const lines = recent.map((t) => {
            const who = t.role === "user" ? "用户" : "助手";
            const text = t.content.length > 500 ? `${t.content.slice(0, 500)}…` : t.content;
            return `${who}：${text}`;
          });
          section += `\n\n【与操作员的近期对话（帮助理解业务偏好；执行时须与上文规则及示例一致，冲突以规则与可见像素为准）】\n${lines.join("\n")}\n`;
        }
      }
    }
  }

  if (examples.length > 0) {
    const ordered = sortTrainingExamplesForGuidance(examples);
    const chosen = ordered.slice(0, exampleLimit);
    const lines = chosen.map((example, index) => {
      const prefix = `指导样本 ${index + 1}`;
      const boxTag =
        example.boxes && example.boxes.length > 0
          ? `含${example.boxes.length}处人工框选（区域说明见上文/附图）`
          : "无框选（仅以下输出作形态参考）";
      const meta = [
        example.imageName ? `图片名=${example.imageName}` : "",
        example.notes ? `备注=${example.notes}` : "",
        boxTag,
      ]
        .filter(Boolean)
        .join("；");

      return [
        `${prefix}（${meta}）`,
        `date=${example.output.date}`,
        `route=${example.output.route}`,
        `driver=${example.output.driver}`,
        `total=${example.output.total}`,
        example.output.totalSourceLabel ? `totalSourceLabel=${example.output.totalSourceLabel}` : "",
        `unscanned=${example.output.unscanned}`,
        `exceptions=${example.output.exceptions}`,
        example.output.waybillStatus ? `waybillStatus=${example.output.waybillStatus}` : "",
        example.output.stationTeam ? `stationTeam=${example.output.stationTeam}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    });

    section += `\n\n【训练池 · 标准输出指导】\n下列条目均来自人工确认的训练池。你必须将其视为**字段含义与输出形态**的权威参考：书写格式、路线编码样式、totalSourceLabel 习惯、stationTeam 与 route 的分工等应与之一致；除非当前截图像素明确矛盾，否则不要改用与样本不一致的字段理解。禁止编造当前图中不可见的数值或标签。\n\n${lines.join("\n")}`;
    section += `\n\n【字段约束提醒】抽查路线 (route) 在样本中多为「IAH + 两位数字 + 横线 + 编号…」（如 IAH01-030-C）。形如「IAH-BAA」仅三字母且中间无两位数字的，通常是站点车队/司机侧代码，**不得**作为 route；站点车队应写入 stationTeam。\n`;
  }

  return section;
}
