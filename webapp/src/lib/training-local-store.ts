import fs from "node:fs";
import path from "node:path";

import { DEFAULT_FORM_ID, normalizeFormId } from "./forms";
import type { GlobalRules, TrainingExample, TrainingImageBinary } from "./training";

const GLOBAL_RULES_KEY = "__global_rules__";
const AGENT_CONTEXT_IMAGE_ROOT = "agent-context";

function isAgentContextImageName(imageName: string | undefined | null) {
  return typeof imageName === "string" && /^ctx-/i.test(imageName.trim());
}

function emptyGlobalRules(): GlobalRules {
  return { instructions: "", documents: [] };
}

function globalRulesPath(formId = DEFAULT_FORM_ID) {
  if (normalizeFormId(formId) !== DEFAULT_FORM_ID) {
    return path.join(process.cwd(), "training", "forms", formId, "global-rules.json");
  }
  return path.join(process.cwd(), "training", "global-rules.json");
}

function examplesPath(formId = DEFAULT_FORM_ID) {
  if (normalizeFormId(formId) !== DEFAULT_FORM_ID) {
    return path.join(process.cwd(), "training", "forms", formId, "examples.json");
  }
  return path.join(process.cwd(), "training", "examples.json");
}

function trainingImageDir(formId = DEFAULT_FORM_ID) {
  if (normalizeFormId(formId) !== DEFAULT_FORM_ID) {
    return path.join(process.cwd(), "image", "training-ai", "forms", formId);
  }
  return path.join(process.cwd(), "image", "training-ai");
}

function agentContextImageDir(formId = DEFAULT_FORM_ID) {
  return path.join(process.cwd(), "image", AGENT_CONTEXT_IMAGE_ROOT, normalizeFormId(formId));
}

function inferMimeTypeFromName(fileName: string | undefined | null) {
  const match = (fileName || "").toLowerCase().match(/\.[^.]+$/);
  switch (match?.[0]) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    default:
      return "image/jpeg";
  }
}

function detectMimeTypeFromBuffer(buffer: Buffer, fileName?: string | null, fallbackMimeType?: string | null) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return fallbackMimeType || inferMimeTypeFromName(fileName);
}

export function loadLocalGlobalRules(formId = DEFAULT_FORM_ID): GlobalRules {
  const filePath = globalRulesPath(formId);
  if (!fs.existsSync(filePath)) {
    return emptyGlobalRules();
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as GlobalRules;
    return {
      instructions: typeof payload.instructions === "string" ? payload.instructions : "",
      documents: Array.isArray(payload.documents) ? payload.documents : [],
      guidanceHistory: Array.isArray(payload.guidanceHistory) ? payload.guidanceHistory : undefined,
      agentThread: Array.isArray(payload.agentThread) ? payload.agentThread : undefined,
      workingRules: typeof payload.workingRules === "string" ? payload.workingRules : undefined,
      tableFields: Array.isArray(payload.tableFields) ? payload.tableFields : undefined,
    };
  } catch {
    return emptyGlobalRules();
  }
}

export function saveLocalGlobalRules(rules: GlobalRules, formId = DEFAULT_FORM_ID) {
  const filePath = globalRulesPath(formId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rules, null, 2), "utf8");
}

export function loadLocalTrainingExamples(formId = DEFAULT_FORM_ID): TrainingExample[] {
  const filePath = examplesPath(formId);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      examples?: TrainingExample[];
    };
    return Array.isArray(payload.examples)
      ? payload.examples.filter(
          (example) => example.imageName !== GLOBAL_RULES_KEY && !isAgentContextImageName(example.imageName),
        )
      : [];
  } catch {
    return [];
  }
}

export function saveLocalTrainingExamples(examples: TrainingExample[], formId = DEFAULT_FORM_ID) {
  const filePath = examplesPath(formId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ examples }, null, 2), "utf8");
}

export function listLocalTrainingImages(formId = DEFAULT_FORM_ID) {
  const dirPath = trainingImageDir(formId);
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((fileName) => /\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName))
    .filter((fileName) => !isAgentContextImageName(fileName))
    .sort()
    .map((fileName) => ({
      imageName: fileName,
      absolutePath: path.join(dirPath, fileName),
    }));
}

export function saveLocalTrainingImageDataUrl(imageName: string, dataUrl: string, formId = DEFAULT_FORM_ID) {
  const dirPath = trainingImageDir(formId);
  fs.mkdirSync(dirPath, { recursive: true });

  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }

  fs.writeFileSync(path.join(dirPath, imageName), Buffer.from(matched[2], "base64"));
}

export function saveLocalAgentContextImageDataUrl(imageName: string, dataUrl: string, formId = DEFAULT_FORM_ID) {
  const dirPath = agentContextImageDir(formId);
  fs.mkdirSync(dirPath, { recursive: true });

  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }

  fs.writeFileSync(path.join(dirPath, imageName), Buffer.from(matched[2], "base64"));
}

export function getLocalTrainingImageBinary(imageName: string, formId = DEFAULT_FORM_ID): TrainingImageBinary | null {
  const filePath = path.join(trainingImageDir(formId), imageName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    mimeType: detectMimeTypeFromBuffer(buffer, filePath),
  };
}

export function getLocalAgentContextImageBinary(
  imageName: string,
  formId = DEFAULT_FORM_ID,
): TrainingImageBinary | null {
  const filePath = path.join(agentContextImageDir(formId), imageName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    mimeType: detectMimeTypeFromBuffer(buffer, filePath),
  };
}

export function deleteLocalTrainingPoolImage(imageName: string, formId = DEFAULT_FORM_ID) {
  const filePath = path.join(trainingImageDir(formId), imageName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  const currentExamples = loadLocalTrainingExamples(formId);
  const nextExamples = currentExamples.filter((example) => example.imageName !== imageName);
  if (nextExamples.length !== currentExamples.length) {
    saveLocalTrainingExamples(nextExamples, formId);
  }
}
