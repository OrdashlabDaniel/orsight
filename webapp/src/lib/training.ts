import fs from "node:fs";
import path from "node:path";

import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase";

export type TrainingField =
  | "date"
  | "route"
  | "driver"
  | "total"
  | "unscanned"
  | "exceptions"
  | "waybillStatus"
  | "stationTeam";

export type TrainingBox = {
  field: TrainingField;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

function formatBoxHintsForExample(example: TrainingExample): string {
  if (!example.boxes?.length) {
    return "";
  }
  const lines = example.boxes.map((b) => {
    const label = TRAINING_FIELD_LABELS[b.field] || b.field;
    const x2 = b.x + b.width;
    const y2 = b.y + b.height;
    const valHint = b.value ? `图中可见值约「${b.value}」` : "值见下方示例输出";
    return `  - ${label}：${valHint}；归一化矩形 x∈[${(b.x * 100).toFixed(1)}%, ${(x2 * 100).toFixed(1)}%]，y∈[${(b.y * 100).toFixed(1)}%, ${(y2 * 100).toFixed(1)}%]（原点左上，宽与高均为相对整图比例）`;
  });
  return `参考图「${example.imageName}」上各字段的大致区域：\n${lines.join("\n")}`;
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
      : Math.max(0, Number.parseInt(maxImagesRaw || "1", 10) || 1);
  const maxBoxHintExamples = options?.maxBoxHintExamples ?? 5;
  const effectiveMaxImages = options?.maxImages ?? maxImages;

  const withBoxes = examples.filter((e) => e.boxes && e.boxes.length > 0);
  const sorted = [...withBoxes].sort((a, b) => (b.boxes?.length || 0) - (a.boxes?.length || 0));

  const hintParts: string[] = [];
  for (const ex of sorted.slice(0, maxBoxHintExamples)) {
    const block = formatBoxHintsForExample(ex);
    if (block) hintParts.push(block);
  }

  let hintText = "";
  if (hintParts.length > 0) {
    hintText = `\n\n【训练池：人工框选给出的相对位置（用于推断同类截图中字段在画面中的大致区域，禁止机械套用坐标到布局差异过大的图片）】\n${hintParts.join("\n\n")}\n`;
  }

  const referenceImages: Array<{ imageName: string; caption: string; dataUrl: string }> = [];
  if (effectiveMaxImages > 0) {
    for (const ex of sorted) {
      if (referenceImages.length >= effectiveMaxImages) break;
      const dataUrl = await getTrainingImageDataUrl(ex.imageName);
      if (!dataUrl) continue;
      const caption = `【训练参考截图：${ex.imageName}】与上文「相对位置」描述对应；请归纳同类设备的布局规律，但最终识别结果必须只来自最后一张「当前待识别图片」。`;
      referenceImages.push({ imageName: ex.imageName, caption, dataUrl });
    }
  }

  return { hintText, referenceImages };
}

export function buildTrainingPromptSection(examples: TrainingExample[], globalRules?: GlobalRules | null, limit = 8): string {
  let section = "";

  if (globalRules) {
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

  if (examples.length > 0) {
    const chosen = examples.slice(0, limit);
    const lines = chosen.map((example, index) => {
      const prefix = `示例 ${index + 1}`;
      const meta = [
        example.imageName ? `图片名=${example.imageName}` : "",
        example.notes ? `备注=${example.notes}` : "",
      ]
        .filter(Boolean)
        .join("；");

      return [
        `${prefix}${meta ? `（${meta}）` : ""}`,
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

    section += `\n\n下面是历史正确样本，请优先遵循这些字段映射方式，不要编造未展示信息：\n${lines.join("\n")}`;
  }

  return section;
}
