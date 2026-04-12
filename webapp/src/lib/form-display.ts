import type { FormDefinition } from "@/lib/forms";

/** Demo / seed form titles (exact match). User-renamed forms won’t match these strings. */
const CANONICAL_FORM_NAME_ZH_TO_EN: Record<string, string> = {
  抽擦路线表: "Route inspection (sample)",
  财务支持记录: "Finance support log (sample)",
  财务支出记录: "Financial expense records (sample)",
  未命名填表: "Untitled form",
} as Record<string, string>;

// Quoted keys: Chinese strings with punctuation must be string keys for the parser.
const DESCRIPTION_ZH_TO_EN: Record<string, string> = {
  "已完成配置。": "Configuration complete.",
  "已完成配置，可直接进入填表模式。": "Configuration complete. You can open fill mode now.",
  "待配置：请先设置表格模板并补充训练样本。":
    "Draft: configure the table template and add training samples.",
  "已完成：沿用当前线上填表与训练能力。":
    "Sample: production-style route inspection and training.",
};

const CLONE_SUFFIX_ZH = " 副本";
const CLONE_SUFFIX_EN = " (copy)";

function localizedBaseName(name: string, locale: string): string {
  if (locale !== "en") return name;
  return CANONICAL_FORM_NAME_ZH_TO_EN[name] ?? name;
}

/**
 * Stored names/descriptions stay in Chinese in the database; in English UI we substitute
 * known system strings. User-chosen titles/descriptions that don’t match these keys are shown as stored.
 */
export function getLocalizedFormName(form: Pick<FormDefinition, "id" | "name">, locale: string): string {
  const raw = form.name;
  if (locale !== "en") return raw;

  if (raw.endsWith(CLONE_SUFFIX_ZH)) {
    const baseZh = raw.slice(0, -CLONE_SUFFIX_ZH.length);
    return `${localizedBaseName(baseZh, "en")}${CLONE_SUFFIX_EN}`;
  }

  return localizedBaseName(raw, "en");
}

export function getLocalizedFormDescription(
  form: Pick<FormDefinition, "id" | "name" | "description">,
  locale: string,
): string {
  if (locale !== "en") return form.description;
  return DESCRIPTION_ZH_TO_EN[form.description] ?? form.description;
}
