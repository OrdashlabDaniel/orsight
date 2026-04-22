export type RecognitionFieldGuidanceItem = {
  fieldId: string;
  note: string;
};

export type RecognitionFieldGuidance = {
  fieldNotes: RecognitionFieldGuidanceItem[];
};

export const RECOGNITION_FIELD_GUIDANCE_BEGIN = "【字段沟通需求(JSON_BEGIN)】";
export const RECOGNITION_FIELD_GUIDANCE_END = "【字段沟通需求(JSON_END)】";

export function normalizeRecognitionFieldGuidance(raw: unknown): RecognitionFieldGuidance {
  if (!raw || typeof raw !== "object") {
    return { fieldNotes: [] };
  }

  const source = raw as Record<string, unknown>;
  const fieldNotes = Array.isArray(source.fieldNotes)
    ? source.fieldNotes.reduce<RecognitionFieldGuidanceItem[]>((acc, item) => {
        if (!item || typeof item !== "object") {
          return acc;
        }

        const note = item as Record<string, unknown>;
        const fieldId = typeof note.fieldId === "string" ? note.fieldId.trim() : "";
        const content = typeof note.note === "string" ? note.note.trim().slice(0, 2000) : "";
        if (!fieldId || !content) {
          return acc;
        }

        const existing = acc.findIndex((entry) => entry.fieldId === fieldId);
        if (existing >= 0) {
          acc[existing] = { fieldId, note: content };
        } else {
          acc.push({ fieldId, note: content });
        }
        return acc;
      }, [])
    : [];

  return { fieldNotes };
}

export function recognitionFieldGuidanceToMap(
  guidance: RecognitionFieldGuidance | undefined | null,
): Record<string, string> {
  return Object.fromEntries(normalizeRecognitionFieldGuidance(guidance).fieldNotes.map((item) => [item.fieldId, item.note]));
}

export function mapToRecognitionFieldGuidance(fieldGuidance: Record<string, string> | undefined | null): RecognitionFieldGuidance {
  if (!fieldGuidance || typeof fieldGuidance !== "object") {
    return { fieldNotes: [] };
  }

  return normalizeRecognitionFieldGuidance({
    fieldNotes: Object.entries(fieldGuidance).map(([fieldId, note]) => ({ fieldId, note })),
  });
}

export function stripRecognitionFieldGuidanceBlock(workingRules: string | undefined | null): string {
  const text = typeof workingRules === "string" ? workingRules : "";
  const start = text.indexOf(RECOGNITION_FIELD_GUIDANCE_BEGIN);
  if (start < 0) {
    return text.trim();
  }

  const end = text.indexOf(RECOGNITION_FIELD_GUIDANCE_END, start);
  const afterEnd = end < 0 ? text.length : end + RECOGNITION_FIELD_GUIDANCE_END.length;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(afterEnd).trimStart();

  if (before && after) return `${before}\n\n${after}`;
  return before || after;
}

export function extractRecognitionFieldGuidanceFromWorkingRules(
  workingRules: string | undefined | null,
): RecognitionFieldGuidance {
  const text = typeof workingRules === "string" ? workingRules : "";
  const start = text.indexOf(RECOGNITION_FIELD_GUIDANCE_BEGIN);
  if (start < 0) {
    return { fieldNotes: [] };
  }

  const jsonStart = start + RECOGNITION_FIELD_GUIDANCE_BEGIN.length;
  const end = text.indexOf(RECOGNITION_FIELD_GUIDANCE_END, jsonStart);
  if (end < 0) {
    return { fieldNotes: [] };
  }

  const rawJson = text.slice(jsonStart, end).trim();
  if (!rawJson) {
    return { fieldNotes: [] };
  }

  try {
    return normalizeRecognitionFieldGuidance(JSON.parse(rawJson));
  } catch {
    return { fieldNotes: [] };
  }
}

export function serializeRecognitionFieldGuidance(guidance: RecognitionFieldGuidance | undefined | null): string {
  return JSON.stringify(normalizeRecognitionFieldGuidance(guidance), null, 2);
}

export function upsertRecognitionFieldGuidanceBlock(
  workingRules: string | undefined | null,
  guidance: RecognitionFieldGuidance | undefined | null,
): string {
  const normalized = normalizeRecognitionFieldGuidance(guidance);
  const base = stripRecognitionFieldGuidanceBlock(workingRules);
  const block =
    normalized.fieldNotes.length > 0
      ? `${RECOGNITION_FIELD_GUIDANCE_BEGIN}\n${serializeRecognitionFieldGuidance(normalized)}\n${RECOGNITION_FIELD_GUIDANCE_END}`
      : "";

  if (!block) {
    return base;
  }
  return base ? `${base}\n\n${block}` : block;
}

export function buildRecognitionFieldGuidancePromptSection(
  guidance: RecognitionFieldGuidance | undefined | null,
): string {
  const normalized = normalizeRecognitionFieldGuidance(guidance);
  if (normalized.fieldNotes.length === 0) {
    return "";
  }

  const lines = [
    "",
    "【字段级用户沟通需求】",
    "以下说明由用户直接填写在具体字段下，可帮助你理解每个字段应如何识别、取值或格式化：",
  ];

  for (const item of normalized.fieldNotes) {
    lines.push(`- 字段 ${item.fieldId}：${item.note}`);
  }

  lines.push("- 这些内容只作用于对应字段；你应把它们转化为识别规则，而不是忽略字段归属。");
  return lines.join("\n");
}
