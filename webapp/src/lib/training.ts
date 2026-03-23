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
    stationTeam?: string;
  };
  boxes?: TrainingBox[];
};

export type GlobalRules = {
  instructions: string;
  documents: Array<{
    name: string;
    content: string;
  }>;
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

    return data.data as GlobalRules;
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
        example.output.stationTeam ? `stationTeam=${example.output.stationTeam}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    });

    section += `\n\n下面是历史正确样本，请优先遵循这些字段映射方式，不要编造未展示信息：\n${lines.join("\n")}`;
  }

  return section;
}
