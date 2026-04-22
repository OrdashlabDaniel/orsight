import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AgentAsset, AgentThreadTurn } from "./agent-context-types";
import {
  DEFAULT_FORM_ID,
  FORMS_MANIFEST_KEY,
  FORM_IMAGE_ROOT,
  getFormExampleStorageKey,
  getFormExampleStorageKeyPrefix,
  getFormImageStoragePath,
  isReservedTrainingStorageKey,
  normalizeFormId,
} from "./forms";
import { loadRemoteFormConfig, saveRemoteFormConfig } from "./form-config-db";
import { stripRecognitionFieldGuidanceBlock } from "./recognition-field-guidance";
import {
  scopeTrainingBucketPath,
  scopeTrainingExamplesImageName,
  tenantActive,
  tenantDbKeyPrefix,
  tenantStorageFolderPrefix,
  unscopeTrainingExamplesImageName,
} from "./storage-tenant";
import {
  isMissingSupabaseTableError,
  isSupabaseTableMarkedUnavailable,
  markSupabaseTableUnavailable,
} from "./supabase-compat";
import { getSupabaseAdmin } from "./supabase";
import { getTenantDbClient, hasTenantDbAccess, requireTenantDbAccess } from "./tenant-db";
import type { TableFieldDefinition } from "./table-fields";

export type { AgentAsset, AgentThreadTurn } from "./agent-context-types";

export type TrainingField = string;
export type TrainingScalarValue = string | number | "";
export type TrainingAnnotationMode = "record" | "table";
export type TrainingTableFieldValues = Record<string, TrainingScalarValue[]>;
export type TrainingTableOutput = {
  fieldValues?: TrainingTableFieldValues;
};

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
  annotationMode?: TrainingAnnotationMode;
  output: {
    date: string;
    route: string;
    driver: string;
    taskCode?: string;
    total: number;
    totalSourceLabel?: string;
    unscanned: number;
    exceptions: number | "";
    waybillStatus?: string;
    stationTeam?: string;
    customFieldValues?: Record<string, string | number | "">;
  };
  boxes?: TrainingBox[];
  /** 按字段指定多框合并方式；未指定的字段按默认策略推断 */
  fieldAggregations?: Partial<Record<TrainingField, FieldAggregation>>;
  tableOutput?: TrainingTableOutput;
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
  tableFields?: TableFieldDefinition[];
  /** 训练页「与 AI 对话」历史，随全局规则一并持久化 */
  guidanceHistory?: GuidanceTurn[];
  /** 识别规则 Agent：单一对话流（文字 + 附图 + 文档摘录），用于继续优化识别规则 */
  agentThread?: AgentThreadTurn[];
  /**
   * 由 Agent 迭代生成的「识别规则」全文，直接注入 Vision 提示词（内化到识别流程，非聊天记录）
   */
  workingRules?: string;
};

export type RecognitionOptionalFieldRule = {
  fieldId: string;
  imageTypes?: Array<"POD" | "WEB_TABLE" | "OTHER">;
  /** 默认 true：仅当模型未主动标记 reviewRequired 时才允许把“缺失”视为正常 */
  requireModelConfidence?: boolean;
  note?: string;
};

export type RecognitionValidationConfig = {
  optionalFields: RecognitionOptionalFieldRule[];
};

export type RecognitionFieldOutputFormat =
  | "as_visible"
  | "YYYY.MM.DD"
  | "YYYY-MM-DD"
  | "MM/DD/YYYY";

export type RecognitionFieldRuleCode = {
  fieldId: string;
  outputFormat?: RecognitionFieldOutputFormat;
  exampleValue?: string;
  instruction?: string;
};

export type RecognitionRuleCode = {
  fieldDirectives: RecognitionFieldRuleCode[];
};

export type TrainingImageBinary = {
  buffer: Buffer;
  mimeType: string;
};

type TrainingImageRequestCache = {
  binaryByKey: Map<string, Promise<TrainingImageBinary | null>>;
  dataUrlByKey: Map<string, Promise<string | null>>;
};

const GLOBAL_RULES_KEY = "__global_rules__";
const AGENT_CONTEXT_IMAGE_ROOT = "agent-context";
const FORM_TRAINING_EXAMPLES_TABLE = "app_form_training_examples";
export const RECOGNITION_VALIDATION_CONFIG_BEGIN = "【字段缺省策略(JSON_BEGIN)】";

async function runStorageOpWithAdminFallback<T extends { error: { message?: string | null } | null }>(
  primary: SupabaseClient,
  operation: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  const first = await operation(primary);
  const admin = getSupabaseAdmin();
  if (!first.error || !admin || admin === primary) {
    return first;
  }
  return await operation(admin);
}
export const RECOGNITION_VALIDATION_CONFIG_END = "【字段缺省策略(JSON_END)】";
const RECOGNITION_VALIDATION_IMAGE_TYPES = new Set(["POD", "WEB_TABLE", "OTHER"]);
export const RECOGNITION_RULE_CODE_BEGIN = "【识别规则代码(JSON_BEGIN)】";
export const RECOGNITION_RULE_CODE_END = "【识别规则代码(JSON_END)】";
const RECOGNITION_FIELD_OUTPUT_FORMATS = new Set<RecognitionFieldOutputFormat>([
  "as_visible",
  "YYYY.MM.DD",
  "YYYY-MM-DD",
  "MM/DD/YYYY",
]);

const trainingImageRequestCacheStorage = new AsyncLocalStorage<TrainingImageRequestCache>();

function isAnyTenantScopedTrainingKey(imageName: string) {
  return /^tnt_[A-Za-z0-9_-]+::/.test(imageName);
}

async function shouldAllowDefaultFormLegacyFallback() {
  if (!tenantActive()) {
    return true;
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    return true;
  }

  const { data, error } = await admin
    .from("training_examples")
    .select("data")
    .eq("image_name", scopeTrainingExamplesImageName(FORMS_MANIFEST_KEY))
    .maybeSingle();

  if (error || !data) {
    return true;
  }

  const forms = Array.isArray((data as { data?: { forms?: unknown } }).data?.forms)
    ? ((data as { data?: { forms?: unknown[] } }).data?.forms ?? [])
    : [];
  const defaultForm = forms.find((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const record = item as { id?: unknown };
    return normalizeFormId(typeof record.id === "string" ? record.id : "") === DEFAULT_FORM_ID;
  }) as { name?: unknown } | undefined;

  return (typeof defaultForm?.name === "string" ? defaultForm.name.trim() : "") !== "财务支出表";
}

function getTrainingImageRequestCache() {
  return trainingImageRequestCacheStorage.getStore();
}

function trainingImageCacheKey(formId: string, imageName: string) {
  return `${normalizeFormId(formId)}::${imageName}`;
}

function agentContextImageCacheKey(formId: string, imageName: string) {
  return `ctx::${normalizeFormId(formId)}::${imageName}`;
}

export function isAgentContextImageName(imageName: string | undefined | null) {
  return typeof imageName === "string" && /^ctx-/i.test(imageName.trim());
}

function getAgentContextImageStoragePath(formId: string, imageName: string) {
  return `${AGENT_CONTEXT_IMAGE_ROOT}/${normalizeFormId(formId)}/${imageName}`;
}

function memoizeTrainingImageLoad<T>(
  map: Map<string, Promise<T>>,
  key: string,
  loader: () => Promise<T>,
) {
  const cached = map.get(key);
  if (cached) {
    return cached;
  }

  const promise = loader().catch((error) => {
    map.delete(key);
    throw error;
  });
  map.set(key, promise);
  return promise;
}

export async function withTrainingImageRequestCache<T>(loader: () => Promise<T>) {
  const existing = getTrainingImageRequestCache();
  if (existing) {
    return loader();
  }

  return trainingImageRequestCacheStorage.run(
    {
      binaryByKey: new Map(),
      dataUrlByKey: new Map(),
    },
    loader,
  );
}

function normalizeRecognitionValidationConfig(raw: unknown): RecognitionValidationConfig {
  if (!raw || typeof raw !== "object") {
    return { optionalFields: [] };
  }

  const source = raw as Record<string, unknown>;
  const optionalFields: RecognitionOptionalFieldRule[] = Array.isArray(source.optionalFields)
    ? source.optionalFields.reduce<RecognitionOptionalFieldRule[]>((acc, item) => {
        if (!item || typeof item !== "object") return acc;
        const rule = item as Record<string, unknown>;
        const fieldId = typeof rule.fieldId === "string" ? rule.fieldId.trim() : "";
        if (!fieldId) return acc;

        const imageTypes = Array.isArray(rule.imageTypes)
          ? rule.imageTypes
              .map((value) => (typeof value === "string" ? value.trim().toUpperCase() : ""))
              .filter((value): value is "POD" | "WEB_TABLE" | "OTHER" => RECOGNITION_VALIDATION_IMAGE_TYPES.has(value))
          : undefined;
        const note = typeof rule.note === "string" ? rule.note.trim().slice(0, 500) : undefined;

        acc.push({
          fieldId,
          ...(imageTypes && imageTypes.length > 0 ? { imageTypes } : {}),
          requireModelConfidence: rule.requireModelConfidence !== false,
          ...(note ? { note } : {}),
        });
        return acc;
      }, [])
    : [];

  return { optionalFields };
}

export function stripRecognitionValidationConfigBlock(workingRules: string | undefined | null): string {
  const text = typeof workingRules === "string" ? workingRules : "";
  const start = text.indexOf(RECOGNITION_VALIDATION_CONFIG_BEGIN);
  if (start < 0) {
    return text.trim();
  }

  const end = text.indexOf(RECOGNITION_VALIDATION_CONFIG_END, start);
  const afterEnd = end < 0 ? text.length : end + RECOGNITION_VALIDATION_CONFIG_END.length;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(afterEnd).trimStart();

  if (before && after) return `${before}\n\n${after}`;
  return before || after;
}

export function extractRecognitionValidationConfigFromWorkingRules(
  workingRules: string | undefined | null,
): RecognitionValidationConfig {
  const text = typeof workingRules === "string" ? workingRules : "";
  const start = text.indexOf(RECOGNITION_VALIDATION_CONFIG_BEGIN);
  if (start < 0) {
    return { optionalFields: [] };
  }

  const jsonStart = start + RECOGNITION_VALIDATION_CONFIG_BEGIN.length;
  const end = text.indexOf(RECOGNITION_VALIDATION_CONFIG_END, jsonStart);
  if (end < 0) {
    return { optionalFields: [] };
  }

  const rawJson = text.slice(jsonStart, end).trim();
  if (!rawJson) {
    return { optionalFields: [] };
  }

  try {
    return normalizeRecognitionValidationConfig(JSON.parse(rawJson));
  } catch {
    return { optionalFields: [] };
  }
}

export function serializeRecognitionValidationConfig(
  config: RecognitionValidationConfig | undefined | null,
): string {
  return JSON.stringify(normalizeRecognitionValidationConfig(config), null, 2);
}

export function upsertRecognitionValidationConfigBlock(
  workingRules: string | undefined | null,
  config: RecognitionValidationConfig | undefined | null,
): string {
  const base = stripRecognitionValidationConfigBlock(workingRules);
  const json = serializeRecognitionValidationConfig(config);
  const block = `${RECOGNITION_VALIDATION_CONFIG_BEGIN}\n${json}\n${RECOGNITION_VALIDATION_CONFIG_END}`;
  return base ? `${base}\n\n${block}` : block;
}

export function normalizeRecognitionRuleCode(raw: unknown): RecognitionRuleCode {
  if (!raw || typeof raw !== "object") {
    return { fieldDirectives: [] };
  }

  const source = raw as Record<string, unknown>;
  const fieldDirectives: RecognitionFieldRuleCode[] = Array.isArray(source.fieldDirectives)
    ? source.fieldDirectives.reduce<RecognitionFieldRuleCode[]>((acc, item) => {
        if (!item || typeof item !== "object") return acc;
        const directive = item as Record<string, unknown>;
        const fieldId = typeof directive.fieldId === "string" ? directive.fieldId.trim() : "";
        if (!fieldId) return acc;

        const outputFormat =
          typeof directive.outputFormat === "string" &&
          RECOGNITION_FIELD_OUTPUT_FORMATS.has(directive.outputFormat as RecognitionFieldOutputFormat)
            ? (directive.outputFormat as RecognitionFieldOutputFormat)
            : undefined;
        const exampleValue =
          typeof directive.exampleValue === "string" ? directive.exampleValue.trim().slice(0, 80) : undefined;
        const instruction =
          typeof directive.instruction === "string" ? directive.instruction.trim().slice(0, 500) : undefined;

        if (!outputFormat && !exampleValue && !instruction) {
          return acc;
        }

        acc.push({
          fieldId,
          ...(outputFormat ? { outputFormat } : {}),
          ...(exampleValue ? { exampleValue } : {}),
          ...(instruction ? { instruction } : {}),
        });
        return acc;
      }, [])
    : [];

  return { fieldDirectives };
}

export function stripRecognitionRuleCodeBlock(workingRules: string | undefined | null): string {
  const text = typeof workingRules === "string" ? workingRules : "";
  const start = text.indexOf(RECOGNITION_RULE_CODE_BEGIN);
  if (start < 0) {
    return text.trim();
  }

  const end = text.indexOf(RECOGNITION_RULE_CODE_END, start);
  const afterEnd = end < 0 ? text.length : end + RECOGNITION_RULE_CODE_END.length;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(afterEnd).trimStart();

  if (before && after) return `${before}\n\n${after}`;
  return before || after;
}

export function extractRecognitionRuleCodeFromWorkingRules(
  workingRules: string | undefined | null,
): RecognitionRuleCode {
  const text = typeof workingRules === "string" ? workingRules : "";
  const start = text.indexOf(RECOGNITION_RULE_CODE_BEGIN);
  if (start < 0) {
    return { fieldDirectives: [] };
  }

  const jsonStart = start + RECOGNITION_RULE_CODE_BEGIN.length;
  const end = text.indexOf(RECOGNITION_RULE_CODE_END, jsonStart);
  if (end < 0) {
    return { fieldDirectives: [] };
  }

  const rawJson = text.slice(jsonStart, end).trim();
  if (!rawJson) {
    return { fieldDirectives: [] };
  }

  try {
    return normalizeRecognitionRuleCode(JSON.parse(rawJson));
  } catch {
    return { fieldDirectives: [] };
  }
}

export function serializeRecognitionRuleCode(code: RecognitionRuleCode | undefined | null): string {
  return JSON.stringify(normalizeRecognitionRuleCode(code), null, 2);
}

export function upsertRecognitionRuleCodeBlock(
  workingRules: string | undefined | null,
  code: RecognitionRuleCode | undefined | null,
): string {
  const base = stripRecognitionRuleCodeBlock(workingRules);
  const json = serializeRecognitionRuleCode(code);
  const block = `${RECOGNITION_RULE_CODE_BEGIN}\n${json}\n${RECOGNITION_RULE_CODE_END}`;
  return base ? `${base}\n\n${block}` : block;
}

export function buildRecognitionRuleCodePromptSection(
  code: RecognitionRuleCode | undefined | null,
): string {
  const normalized = normalizeRecognitionRuleCode(code);
  if (normalized.fieldDirectives.length === 0) {
    return "";
  }

  const lines = [
    "",
    "【当前表单可执行规则代码】",
    "以下结构化规则只对当前填表生效，并会被系统直接读取；模型必须遵守：",
  ];

  for (const directive of normalized.fieldDirectives) {
    const parts = [`字段 ${directive.fieldId}`];
    if (directive.outputFormat) {
      parts.push(`输出格式 ${directive.outputFormat}`);
    }
    if (directive.exampleValue) {
      parts.push(`示例 ${directive.exampleValue}`);
    }
    if (directive.instruction) {
      parts.push(directive.instruction);
    }
    lines.push(`- ${parts.join("；")}`);
  }

  lines.push("- 不要忽略这些规则，也不要把它们套用到其他未指定字段。");
  return lines.join("\n");
}

function emptyGlobalRules(): GlobalRules {
  return { instructions: "", documents: [] };
}

function globalRulesCandidatePaths(formId = DEFAULT_FORM_ID) {
  if (normalizeFormId(formId) !== DEFAULT_FORM_ID) {
    return [
      path.join(process.cwd(), "training", "forms", formId, "global-rules.json"),
      path.resolve(process.cwd(), "..", "training", "forms", formId, "global-rules.json"),
    ];
  }
  return [
    path.join(process.cwd(), "training", "global-rules.json"),
    path.resolve(process.cwd(), "..", "training", "global-rules.json"),
  ];
}

function resolveGlobalRulesPath(formId = DEFAULT_FORM_ID) {
  return (
    globalRulesCandidatePaths(formId).find((filePath) => fs.existsSync(filePath)) ||
    globalRulesCandidatePaths(formId)[1]
  );
}

function loadLocalGlobalRules(formId = DEFAULT_FORM_ID): GlobalRules {
  const filePath = resolveGlobalRulesPath(formId);
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
      tableFields: Array.isArray(payload.tableFields) ? (payload.tableFields as TableFieldDefinition[]) : undefined,
    };
  } catch {
    return emptyGlobalRules();
  }
}

function saveLocalGlobalRules(rules: GlobalRules, formId = DEFAULT_FORM_ID) {
  const filePath = resolveGlobalRulesPath(formId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rules, null, 2), "utf8");
}

export async function loadGlobalRules(formId = DEFAULT_FORM_ID): Promise<GlobalRules> {
  const normalizedFormId = normalizeFormId(formId);
  if (!hasTenantDbAccess()) {
    return loadLocalGlobalRules(normalizedFormId);
  }

  try {
    const config = await loadRemoteFormConfig(normalizedFormId);
    if (!config) {
      return emptyGlobalRules();
    }
    return {
      instructions: config.instructions ?? "",
      documents: Array.isArray(config.documents) ? (config.documents as GlobalRules["documents"]) : [],
      guidanceHistory: Array.isArray(config.guidanceHistory)
        ? (config.guidanceHistory as GuidanceTurn[])
        : undefined,
      agentThread: Array.isArray(config.agentThread) ? (config.agentThread as AgentThreadTurn[]) : undefined,
      workingRules: typeof config.workingRules === "string" ? config.workingRules : undefined,
      tableFields: Array.isArray(config.tableFields) ? (config.tableFields as TableFieldDefinition[]) : undefined,
    };
  } catch (error) {
    console.error("Exception loading global rules:", error);
    return loadLocalGlobalRules(normalizedFormId);
  }
}

export async function saveGlobalRules(rules: GlobalRules, formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  if (!hasTenantDbAccess()) {
    saveLocalGlobalRules(rules, normalizedFormId);
    return;
  }

  await saveRemoteFormConfig(
    {
      instructions: rules.instructions,
      documents: Array.isArray(rules.documents) ? rules.documents : [],
      guidanceHistory: Array.isArray(rules.guidanceHistory) ? rules.guidanceHistory : [],
      agentThread: Array.isArray(rules.agentThread) ? rules.agentThread : [],
      workingRules: typeof rules.workingRules === "string" ? rules.workingRules : "",
      tableFields: Array.isArray(rules.tableFields) ? rules.tableFields : [],
    },
    normalizedFormId,
  );
}

type TrainingExampleRow = {
  owner_id: string;
  form_id: string;
  image_name: string;
  data: TrainingExample;
};

function normalizeRemoteTrainingExamples(rows: TrainingExampleRow[]) {
  return rows
    .map((row) => row.data as TrainingExample)
    .filter((example) => example?.imageName && !isAgentContextImageName(example.imageName));
}

async function loadLegacyTrainingExamplesFromKv(formId = DEFAULT_FORM_ID): Promise<TrainingExample[]> {
  const normalizedFormId = normalizeFormId(formId);
  const admin = getSupabaseAdmin();
  if (!tenantActive() || !admin) {
    return [];
  }

  const exampleKeyPrefix = getFormExampleStorageKeyPrefix(normalizedFormId);
  const query = admin.from("training_examples").select("image_name,data");
  const scopedExamplePrefix = scopeTrainingExamplesImageName(exampleKeyPrefix);
  const tenantPrefix = tenantActive() ? tenantDbKeyPrefix() : "";
  const { data, error } =
    normalizedFormId === DEFAULT_FORM_ID
      ? tenantActive()
        ? await query.like("image_name", `${tenantPrefix}%`)
        : await query
      : await query.like("image_name", `${scopedExamplePrefix}%`);

  if (error || !data) {
    return [];
  }

  const scopedExamples = data
    .filter((row) => {
      if (typeof row.image_name !== "string") {
        return false;
      }
      if (normalizedFormId !== DEFAULT_FORM_ID) {
        return row.image_name.startsWith(scopedExamplePrefix);
      }
      const logical = unscopeTrainingExamplesImageName(row.image_name);
      return !isReservedTrainingStorageKey(logical);
    })
    .map((row) => row.data as TrainingExample)
    .filter((example) => example?.imageName && !isAgentContextImageName(example.imageName));

  if (scopedExamples.length > 0) {
    return scopedExamples;
  }

  if (normalizedFormId === DEFAULT_FORM_ID && !(await shouldAllowDefaultFormLegacyFallback())) {
    return scopedExamples;
  }

  const legacyQuery = admin.from("training_examples").select("image_name,data");
  const { data: legacyData, error: legacyError } =
    normalizedFormId === DEFAULT_FORM_ID
      ? await legacyQuery
      : await legacyQuery.like("image_name", `${exampleKeyPrefix}%`);

  if (legacyError || !legacyData) {
    return scopedExamples;
  }

  return legacyData
    .filter((row) => {
      if (typeof row.image_name !== "string" || isAnyTenantScopedTrainingKey(row.image_name)) {
        return false;
      }
      if (normalizedFormId !== DEFAULT_FORM_ID) {
        return row.image_name.startsWith(exampleKeyPrefix);
      }
      return !isReservedTrainingStorageKey(row.image_name);
    })
    .map((row) => row.data as TrainingExample)
    .filter((example) => example?.imageName && !isAgentContextImageName(example.imageName));
}

async function upsertLegacyTrainingExample(example: TrainingExample, formId = DEFAULT_FORM_ID) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    const current = loadLocalTrainingExamples(formId);
    const next = current.filter((item) => item.imageName !== example.imageName);
    next.push(example);
    saveLocalTrainingExamples(next, formId);
    return;
  }
  const normalizedFormId = normalizeFormId(formId);
  const storageKey = scopeTrainingExamplesImageName(getFormExampleStorageKey(normalizedFormId, example.imageName));
  const { error } = await admin.from("training_examples").upsert(
    {
      image_name: storageKey,
      data: example,
    },
    { onConflict: "image_name" },
  );
  if (error) {
    throw new Error(`Failed to save legacy training example: ${error.message}`);
  }
}

async function deleteLegacyTrainingExample(imageName: string, formId = DEFAULT_FORM_ID) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return;
  }
  const normalizedFormId = normalizeFormId(formId);
  const storageKey = scopeTrainingExamplesImageName(getFormExampleStorageKey(normalizedFormId, imageName));
  const { error } = await admin.from("training_examples").delete().eq("image_name", storageKey);
  if (error) {
    throw new Error(`Failed to delete legacy training example: ${error.message}`);
  }
}

async function upsertRemoteTrainingExamples(examples: TrainingExample[], formId = DEFAULT_FORM_ID) {
  if (isSupabaseTableMarkedUnavailable(FORM_TRAINING_EXAMPLES_TABLE)) {
    return false;
  }
  const normalizedFormId = normalizeFormId(formId);
  const { ownerId, client } = requireTenantDbAccess();
  if (examples.length === 0) {
    return true;
  }
  const rows = examples.map((example) => ({
    owner_id: ownerId,
    form_id: normalizedFormId,
    image_name: example.imageName,
    data: example,
  }));
  const { error } = await client
    .from(FORM_TRAINING_EXAMPLES_TABLE)
    .upsert(rows, { onConflict: "owner_id,form_id,image_name" });
  if (error) {
    if (isMissingSupabaseTableError(error, FORM_TRAINING_EXAMPLES_TABLE)) {
      markSupabaseTableUnavailable(FORM_TRAINING_EXAMPLES_TABLE);
      return false;
    }
    throw new Error(`Failed to save training examples: ${error.message}`);
  }
  return true;
}

export async function loadTrainingExamples(formId = DEFAULT_FORM_ID): Promise<TrainingExample[]> {
  const normalizedFormId = normalizeFormId(formId);
  if (!hasTenantDbAccess()) {
    return loadLocalTrainingExamples(normalizedFormId);
  }

  try {
    if (isSupabaseTableMarkedUnavailable(FORM_TRAINING_EXAMPLES_TABLE)) {
      return await loadLegacyTrainingExamplesFromKv(normalizedFormId);
    }
    const { ownerId, client } = requireTenantDbAccess();
    const { data, error } = await client
      .from(FORM_TRAINING_EXAMPLES_TABLE)
      .select("owner_id,form_id,image_name,data")
      .eq("owner_id", ownerId)
      .eq("form_id", normalizedFormId)
      .order("image_name", { ascending: true });

    if (error && isMissingSupabaseTableError(error, FORM_TRAINING_EXAMPLES_TABLE)) {
      markSupabaseTableUnavailable(FORM_TRAINING_EXAMPLES_TABLE);
      return await loadLegacyTrainingExamplesFromKv(normalizedFormId);
    }

    if (!error && data && data.length > 0) {
      return normalizeRemoteTrainingExamples(data as TrainingExampleRow[]);
    }

    const legacyExamples = await loadLegacyTrainingExamplesFromKv(normalizedFormId);
    if (legacyExamples.length > 0) {
      await upsertRemoteTrainingExamples(legacyExamples, normalizedFormId);
      return legacyExamples;
    }
    return [];
  } catch (error) {
    console.error("Exception loading examples:", error);
    return loadLocalTrainingExamples(normalizedFormId);
  }
}

export async function saveTrainingExamples(examples: TrainingExample[], formId = DEFAULT_FORM_ID) {
  if (!hasTenantDbAccess()) {
    saveLocalTrainingExamples(examples, formId);
    return;
  }
  const saved = await upsertRemoteTrainingExamples(examples, formId);
  if (!saved) {
    for (const example of examples) {
      await upsertLegacyTrainingExample(example, formId);
    }
  }
}

export async function upsertTrainingExample(example: TrainingExample, formId = DEFAULT_FORM_ID) {
  if (isAgentContextImageName(example.imageName)) {
    throw new Error("识别管家上下文图片不能保存到训练池。");
  }
  const normalizedFormId = normalizeFormId(formId);
  if (!hasTenantDbAccess()) {
    const current = loadLocalTrainingExamples(normalizedFormId);
    const next = current.filter((item) => item.imageName !== example.imageName);
    next.push(example);
    saveLocalTrainingExamples(next, normalizedFormId);
    return next;
  }

  if (isSupabaseTableMarkedUnavailable(FORM_TRAINING_EXAMPLES_TABLE)) {
    await upsertLegacyTrainingExample(example, normalizedFormId);
    return await loadLegacyTrainingExamplesFromKv(normalizedFormId);
  }

  const { ownerId, client } = requireTenantDbAccess();
  const { error } = await client.from(FORM_TRAINING_EXAMPLES_TABLE).upsert(
    {
      owner_id: ownerId,
      form_id: normalizedFormId,
      image_name: example.imageName,
      data: example,
    },
    { onConflict: "owner_id,form_id,image_name" },
  );

  if (error) {
    if (isMissingSupabaseTableError(error, FORM_TRAINING_EXAMPLES_TABLE)) {
      markSupabaseTableUnavailable(FORM_TRAINING_EXAMPLES_TABLE);
      await upsertLegacyTrainingExample(example, normalizedFormId);
      return await loadLegacyTrainingExamplesFromKv(normalizedFormId);
    }
    throw new Error(`Failed to save to Supabase: ${error.message}`);
  }

  return await loadTrainingExamples(normalizedFormId);
}

export async function listTrainingImages(formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  const storageClient = getTenantDbClient();
  const legacyAdmin = getSupabaseAdmin();
  if (!hasTenantDbAccess() || !storageClient) {
    return listLocalTrainingImages(normalizedFormId);
  }

  const tenantFolder = tenantStorageFolderPrefix();
  const listPath =
    normalizedFormId === DEFAULT_FORM_ID
      ? tenantFolder
        ? tenantFolder.replace(/\/$/, "")
        : undefined
      : tenantFolder
        ? `${tenantFolder}${FORM_IMAGE_ROOT}/${normalizedFormId}`
        : `${FORM_IMAGE_ROOT}/${normalizedFormId}`;
  const { data, error } = await runStorageOpWithAdminFallback(storageClient, (client) =>
    client.storage.from("training-images").list(listPath),
  );

  if (error) {
    console.error("Error listing images:", error);
    return [];
  }

  const scopedImages = data
    .filter((file) => /\.(png|jpg|jpeg|webp|pdf)$/i.test(file.name))
    .filter((file) => !isAgentContextImageName(file.name))
    .map((file) => ({
      imageName: file.name,
      absolutePath:
        normalizedFormId === DEFAULT_FORM_ID ? file.name : getFormImageStoragePath(normalizedFormId, file.name),
    }));

  if (scopedImages.length > 0 || !tenantActive()) {
    return scopedImages;
  }

  if (normalizedFormId === DEFAULT_FORM_ID && !(await shouldAllowDefaultFormLegacyFallback())) {
    return scopedImages;
  }

  const legacyListPath = normalizedFormId === DEFAULT_FORM_ID ? undefined : getFormImageStoragePath(normalizedFormId, "");
  const legacyStorageClient = legacyAdmin || storageClient;
  const { data: legacyData, error: legacyError } = await legacyStorageClient.storage.from("training-images").list(
    legacyListPath ? legacyListPath.replace(/\/$/, "") : undefined,
  );

  if (legacyError || !legacyData) {
    return scopedImages;
  }

  return legacyData
    .filter((file) => /\.(png|jpg|jpeg|webp|pdf)$/i.test(file.name))
    .filter((file) => !isAgentContextImageName(file.name))
    .map((file) => ({
      imageName: file.name,
      absolutePath:
        normalizedFormId === DEFAULT_FORM_ID ? file.name : getFormImageStoragePath(normalizedFormId, file.name),
    }));
}

export async function getTrainingImageDataUrl(imageName: string, formId = DEFAULT_FORM_ID): Promise<string | null> {
  const requestCache = getTrainingImageRequestCache();
  const cacheKey = trainingImageCacheKey(formId, imageName);

  if (requestCache) {
    return memoizeTrainingImageLoad(requestCache.dataUrlByKey, cacheKey, async () => {
      const binary = await getTrainingImageBinary(imageName, formId);
      if (!binary) {
        return null;
      }
      return `data:${binary.mimeType};base64,${binary.buffer.toString("base64")}`;
    });
  }

  const binary = await getTrainingImageBinary(imageName, formId);
  if (!binary) {
    return null;
  }
  return `data:${binary.mimeType};base64,${binary.buffer.toString("base64")}`;
}

export async function saveTrainingImageDataUrl(imageName: string, dataUrl: string, formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  const storagePath = scopeTrainingBucketPath(getFormImageStoragePath(normalizedFormId, imageName));
  const storageClient = getTenantDbClient();
  if (!hasTenantDbAccess() || !storageClient) {
    saveLocalTrainingImageDataUrl(imageName, dataUrl, normalizedFormId);
    return;
  }

  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }

  const mimeType = matched[1];
  const base64 = matched[2];
  const buffer = Buffer.from(base64, "base64");

  const { error } = await runStorageOpWithAdminFallback(storageClient, (client) =>
    client.storage.from("training-images").upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
    }),
  );

  if (error) {
    throw new Error(`Failed to upload image to Supabase: ${error.message}`);
  }
}

function saveLocalAgentContextImageDataUrl(imageName: string, dataUrl: string, formId = DEFAULT_FORM_ID) {
  const dirPath =
    resolveAgentContextImageDir(formId) || agentContextImageCandidatePaths(formId)[1];
  fs.mkdirSync(dirPath, { recursive: true });

  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }

  const buffer = Buffer.from(matched[2], "base64");
  fs.writeFileSync(path.join(dirPath, imageName), buffer);
}

function getLocalAgentContextImageBinaryInternal(
  imageName: string,
  formId = DEFAULT_FORM_ID,
): TrainingImageBinary | null {
  const dirPath = resolveAgentContextImageDir(formId);
  if (!dirPath) {
    return null;
  }

  const filePath = path.join(dirPath, imageName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    mimeType: detectMimeTypeFromBuffer(buffer, filePath),
  };
}

export async function saveAgentContextImageDataUrl(
  imageName: string,
  dataUrl: string,
  formId = DEFAULT_FORM_ID,
) {
  const normalizedFormId = normalizeFormId(formId);
  const storagePath = scopeTrainingBucketPath(getAgentContextImageStoragePath(normalizedFormId, imageName));
  const storageClient = getTenantDbClient();
  if (!hasTenantDbAccess() || !storageClient) {
    saveLocalAgentContextImageDataUrl(imageName, dataUrl, normalizedFormId);
    return;
  }

  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }

  const mimeType = matched[1];
  const base64 = matched[2];
  const buffer = Buffer.from(base64, "base64");

  const { error } = await runStorageOpWithAdminFallback(storageClient, (client) =>
    client.storage.from("training-images").upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
    }),
  );

  if (error) {
    throw new Error(`Failed to upload context image to Supabase: ${error.message}`);
  }
}

export async function getAgentContextImageBinary(
  imageName: string,
  formId = DEFAULT_FORM_ID,
): Promise<TrainingImageBinary | null> {
  const normalizedFormId = normalizeFormId(formId);
  const requestCache = getTrainingImageRequestCache();
  const cacheKey = agentContextImageCacheKey(normalizedFormId, imageName);

  const loadBinary = async (): Promise<TrainingImageBinary | null> => {
    const storageClient = getTenantDbClient();
    const legacyAdmin = getSupabaseAdmin();
    if (!hasTenantDbAccess() || !storageClient) {
      const localBinary = getLocalAgentContextImageBinaryInternal(imageName, normalizedFormId);
      if (localBinary) {
        return localBinary;
      }
      return isAgentContextImageName(imageName)
        ? getLocalTrainingImageBinary(imageName, normalizedFormId)
        : null;
    }

    const storagePath = scopeTrainingBucketPath(getAgentContextImageStoragePath(normalizedFormId, imageName));
    const { data, error } = await runStorageOpWithAdminFallback(storageClient, (client) =>
      client.storage.from("training-images").download(storagePath),
    );
    if (!error && data) {
      const buffer = Buffer.from(await data.arrayBuffer());
      return {
        buffer,
        mimeType: detectMimeTypeFromBuffer(buffer, imageName, data.type),
      };
    }

    if (!isAgentContextImageName(imageName)) {
      if (tenantActive()) {
        const legacyImagePath = getFormImageStoragePath(normalizedFormId, imageName);
        const legacyStorageClient = legacyAdmin || storageClient;
        const { data: legacyImageData, error: legacyImageError } = await legacyStorageClient.storage
          .from("training-images")
          .download(legacyImagePath);
        if (!legacyImageError && legacyImageData) {
          const legacyBuffer = Buffer.from(await legacyImageData.arrayBuffer());
          return {
            buffer: legacyBuffer,
            mimeType: detectMimeTypeFromBuffer(legacyBuffer, imageName, legacyImageData.type),
          };
        }
      }
      return null;
    }

    if (tenantActive()) {
      const legacyAgentContextPath = getAgentContextImageStoragePath(normalizedFormId, imageName);
      const legacyStorageClient = legacyAdmin || storageClient;
      const { data: legacyContextData, error: legacyContextError } = await legacyStorageClient.storage
        .from("training-images")
        .download(legacyAgentContextPath);
      if (!legacyContextError && legacyContextData) {
        const legacyBuffer = Buffer.from(await legacyContextData.arrayBuffer());
        return {
          buffer: legacyBuffer,
          mimeType: detectMimeTypeFromBuffer(legacyBuffer, imageName, legacyContextData.type),
        };
      }
    }

    const legacyStoragePath = scopeTrainingBucketPath(getFormImageStoragePath(normalizedFormId, imageName));
    const fallbackStorageClient = legacyAdmin || storageClient;
    const { data: legacyData, error: legacyError } = await fallbackStorageClient.storage
      .from("training-images")
      .download(legacyStoragePath);
    if (legacyError || !legacyData) {
      return null;
    }

    const legacyBuffer = Buffer.from(await legacyData.arrayBuffer());
    return {
      buffer: legacyBuffer,
      mimeType: detectMimeTypeFromBuffer(legacyBuffer, imageName, legacyData.type),
    };
  };

  if (requestCache) {
    return memoizeTrainingImageLoad(requestCache.binaryByKey, cacheKey, loadBinary);
  }

  return loadBinary();
}

export async function getAgentContextImageDataUrl(
  imageName: string,
  formId = DEFAULT_FORM_ID,
): Promise<string | null> {
  const requestCache = getTrainingImageRequestCache();
  const cacheKey = agentContextImageCacheKey(formId, imageName);

  if (requestCache) {
    return memoizeTrainingImageLoad(requestCache.dataUrlByKey, cacheKey, async () => {
      const binary = await getAgentContextImageBinary(imageName, formId);
      if (!binary) {
        return null;
      }
      return `data:${binary.mimeType};base64,${binary.buffer.toString("base64")}`;
    });
  }

  const binary = await getAgentContextImageBinary(imageName, formId);
  if (!binary) {
    return null;
  }
  return `data:${binary.mimeType};base64,${binary.buffer.toString("base64")}`;
}

export async function getManagedImageBinary(
  imageName: string,
  formId = DEFAULT_FORM_ID,
): Promise<TrainingImageBinary | null> {
  return isAgentContextImageName(imageName)
    ? getAgentContextImageBinary(imageName, formId)
    : getTrainingImageBinary(imageName, formId);
}

export async function getManagedImageDataUrl(
  imageName: string,
  formId = DEFAULT_FORM_ID,
): Promise<string | null> {
  return isAgentContextImageName(imageName)
    ? getAgentContextImageDataUrl(imageName, formId)
    : getTrainingImageDataUrl(imageName, formId);
}

function removeImageAssetsFromAgentThread(thread: AgentThreadTurn[] | undefined, imageName: string) {
  if (!Array.isArray(thread) || thread.length === 0) {
    return { changed: false, thread: thread || [] };
  }

  let changed = false;
  const nextThread = thread.map((turn) => {
    if (!Array.isArray(turn.assets) || turn.assets.length === 0) {
      return turn;
    }

    const nextAssets = turn.assets.filter(
      (asset) => !(asset.kind === "image" && asset.imageName === imageName),
    );
    if (nextAssets.length === turn.assets.length) {
      return turn;
    }

    changed = true;
    if (nextAssets.length === 0) {
      const nextTurn = { ...turn };
      delete nextTurn.assets;
      return nextTurn;
    }

    return {
      ...turn,
      assets: nextAssets,
    };
  });

  return { changed, thread: nextThread };
}

async function pruneTrainingImageFromGlobalRules(imageName: string, formId = DEFAULT_FORM_ID) {
  const rules = await loadGlobalRules(formId);
  const { changed, thread } = removeImageAssetsFromAgentThread(rules.agentThread, imageName);
  if (!changed) {
    return;
  }
  await saveGlobalRules(
    {
      ...rules,
      agentThread: thread,
    },
    formId,
  );
}

export async function deleteTrainingPoolImage(imageName: string, formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  const storagePath = scopeTrainingBucketPath(getFormImageStoragePath(normalizedFormId, imageName));
  const storageClient = getTenantDbClient();
  const legacyAdmin = getSupabaseAdmin();

  if (!hasTenantDbAccess() || !storageClient) {
    for (const dirPath of trainingImageCandidatePaths(normalizedFormId)) {
      const filePath = path.join(dirPath, imageName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    const currentExamples = loadLocalTrainingExamples(normalizedFormId);
    const nextExamples = currentExamples.filter((example) => example.imageName !== imageName);
    if (nextExamples.length !== currentExamples.length) {
      saveLocalTrainingExamples(nextExamples, normalizedFormId);
    }

    await pruneTrainingImageFromGlobalRules(imageName, normalizedFormId);
    return;
  }

  if (isSupabaseTableMarkedUnavailable(FORM_TRAINING_EXAMPLES_TABLE)) {
    const removeImageResult = await runStorageOpWithAdminFallback(storageClient, (client) =>
      client.storage.from("training-images").remove([storagePath]),
    );
    if (removeImageResult.error && !/not[\s-]?found/i.test(removeImageResult.error.message || "")) {
      throw new Error(`Failed to delete training image: ${removeImageResult.error.message}`);
    }
    await deleteLegacyTrainingExample(imageName, normalizedFormId);
    await pruneTrainingImageFromGlobalRules(imageName, normalizedFormId);
    return;
  }

  const { ownerId, client } = requireTenantDbAccess();
  const legacyStoragePath = getFormImageStoragePath(normalizedFormId, imageName);
  const [removeImageResult, removeExampleResult] = await Promise.all([
    runStorageOpWithAdminFallback(storageClient, (activeClient) =>
      activeClient.storage.from("training-images").remove([storagePath]),
    ),
    client
      .from(FORM_TRAINING_EXAMPLES_TABLE)
      .delete()
      .eq("owner_id", ownerId)
      .eq("form_id", normalizedFormId)
      .eq("image_name", imageName),
  ]);

  if (
    removeImageResult.error &&
    /not[\s-]?found/i.test(removeImageResult.error.message || "") &&
    tenantActive() &&
    legacyAdmin
  ) {
    await legacyAdmin.storage.from("training-images").remove([legacyStoragePath]);
  }

  if (removeImageResult.error && !/not[\s-]?found/i.test(removeImageResult.error.message || "")) {
    throw new Error(`Failed to delete training image: ${removeImageResult.error.message}`);
  }

  if (removeExampleResult.error) {
    if (isMissingSupabaseTableError(removeExampleResult.error, FORM_TRAINING_EXAMPLES_TABLE)) {
      markSupabaseTableUnavailable(FORM_TRAINING_EXAMPLES_TABLE);
      await deleteLegacyTrainingExample(imageName, normalizedFormId);
      await pruneTrainingImageFromGlobalRules(imageName, normalizedFormId);
      return;
    }
    throw new Error(`Failed to delete training annotation: ${removeExampleResult.error.message}`);
  }

  await pruneTrainingImageFromGlobalRules(imageName, normalizedFormId);
}

export async function getTrainingPoolStatus(formId = DEFAULT_FORM_ID) {
  const examples = await loadTrainingExamples(formId);
  const exampleMap = new Map(examples.map((example) => [example.imageName, example]));
  const images = await listTrainingImages(formId);

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

export async function getTrainingImageBinary(
  imageName: string,
  formId = DEFAULT_FORM_ID,
): Promise<TrainingImageBinary | null> {
  const normalizedFormId = normalizeFormId(formId);
  const storagePath = scopeTrainingBucketPath(getFormImageStoragePath(normalizedFormId, imageName));
  const requestCache = getTrainingImageRequestCache();
  const cacheKey = trainingImageCacheKey(normalizedFormId, imageName);

  const loadBinary = async (): Promise<TrainingImageBinary | null> => {
    const storageClient = getTenantDbClient();
    const legacyAdmin = getSupabaseAdmin();
    if (!hasTenantDbAccess() || !storageClient) {
      return getLocalTrainingImageBinary(imageName, normalizedFormId);
    }

    const { data, error } = await runStorageOpWithAdminFallback(storageClient, (client) =>
      client.storage.from("training-images").download(storagePath),
    );

    if (error || !data) {
      if (tenantActive()) {
        const legacyStoragePath = getFormImageStoragePath(normalizedFormId, imageName);
        const legacyStorageClient = legacyAdmin || storageClient;
        const { data: legacyData, error: legacyError } = await legacyStorageClient.storage
          .from("training-images")
          .download(legacyStoragePath);
        if (!legacyError && legacyData) {
          const buffer = Buffer.from(await legacyData.arrayBuffer());
          return {
            buffer,
            mimeType: detectMimeTypeFromBuffer(buffer, imageName, legacyData.type),
          };
        }
      }
      console.error("Error downloading image:", error);
      return null;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    return {
      buffer,
      mimeType: detectMimeTypeFromBuffer(buffer, imageName, data.type),
    };
  };

  if (requestCache) {
    return memoizeTrainingImageLoad(requestCache.binaryByKey, cacheKey, loadBinary);
  }

  return loadBinary();
}

function examplesCandidatePaths(formId = DEFAULT_FORM_ID) {
  if (normalizeFormId(formId) !== DEFAULT_FORM_ID) {
    return [
      path.join(process.cwd(), "training", "forms", formId, "examples.json"),
      path.resolve(process.cwd(), "..", "training", "forms", formId, "examples.json"),
    ];
  }
  return [
    path.join(process.cwd(), "training", "examples.json"),
    path.resolve(process.cwd(), "..", "training", "examples.json"),
  ];
}

function trainingImageCandidatePaths(formId = DEFAULT_FORM_ID) {
  if (normalizeFormId(formId) !== DEFAULT_FORM_ID) {
    return [
      path.join(process.cwd(), "image", "training-ai", "forms", formId),
      path.resolve(process.cwd(), "..", "image", "training-ai", "forms", formId),
    ];
  }
  return [
    path.join(process.cwd(), "image", "training-ai"),
    path.resolve(process.cwd(), "..", "image", "training-ai"),
  ];
}

function agentContextImageCandidatePaths(formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  return [
    path.join(process.cwd(), "image", AGENT_CONTEXT_IMAGE_ROOT, normalizedFormId),
    path.resolve(process.cwd(), "..", "image", AGENT_CONTEXT_IMAGE_ROOT, normalizedFormId),
  ];
}

function resolveExamplesPath(formId = DEFAULT_FORM_ID): string {
  const existing = examplesCandidatePaths(formId).find((filePath) => fs.existsSync(filePath));
  return existing || examplesCandidatePaths(formId)[1];
}

function resolveTrainingImageDir(formId = DEFAULT_FORM_ID): string | null {
  return trainingImageCandidatePaths(formId).find((dirPath) => fs.existsSync(dirPath)) || null;
}

function resolveAgentContextImageDir(formId = DEFAULT_FORM_ID): string | null {
  return agentContextImageCandidatePaths(formId).find((dirPath) => fs.existsSync(dirPath)) || null;
}

function loadLocalTrainingExamples(formId = DEFAULT_FORM_ID): TrainingExample[] {
  for (const filePath of examplesCandidatePaths(formId)) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        examples?: TrainingExample[];
      };
      return Array.isArray(payload.examples)
        ? payload.examples.filter(
            (example) =>
              example.imageName !== GLOBAL_RULES_KEY && !isAgentContextImageName(example.imageName),
          )
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function saveLocalTrainingExamples(examples: TrainingExample[], formId = DEFAULT_FORM_ID) {
  const filePath = resolveExamplesPath(formId);
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ examples }, null, 2), "utf8");
}

function listLocalTrainingImages(formId = DEFAULT_FORM_ID) {
  const dirPath = resolveTrainingImageDir(formId);
  if (!dirPath) {
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

function saveLocalTrainingImageDataUrl(imageName: string, dataUrl: string, formId = DEFAULT_FORM_ID) {
  const dirPath =
    resolveTrainingImageDir(formId) || trainingImageCandidatePaths(formId)[1];
  fs.mkdirSync(dirPath, { recursive: true });

  const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }

  const buffer = Buffer.from(matched[2], "base64");
  fs.writeFileSync(path.join(dirPath, imageName), buffer);
}

function getLocalTrainingImageBinary(imageName: string, formId = DEFAULT_FORM_ID): TrainingImageBinary | null {
  const dirPath = resolveTrainingImageDir(formId);
  if (!dirPath) {
    return null;
  }

  const filePath = path.join(dirPath, imageName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    mimeType: detectMimeTypeFromBuffer(buffer, filePath),
  };
}

function inferMimeTypeFromName(fileName: string | undefined | null) {
  const extension = path.extname(fileName || "").toLowerCase();
  switch (extension) {
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

const TRAINING_FIELD_LABELS: Record<string, string> = {
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

const TRAINING_FIELD_COLORS: Record<string, string> = {
  date: "#2563eb",
  route: "#7c3aed",
  driver: "#0891b2",
  taskCode: "#9333ea",
  total: "#16a34a",
  unscanned: "#ea580c",
  exceptions: "#dc2626",
  waybillStatus: "#475569",
  stationTeam: "#0f766e",
};

const NUMERIC_TRAINING_FIELDS = new Set<TrainingField>(["total", "unscanned", "exceptions"]);

function inferFieldAggregation(field: TrainingField, boxCount: number): FieldAggregation {
  if (boxCount <= 1) return "first";
  return NUMERIC_TRAINING_FIELDS.has(field) ? "sum" : "join_comma";
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

function normalizeTableSeriesValue(value: unknown): TrainingScalarValue {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function trimTrailingEmptySeries(values: TrainingScalarValue[]): TrainingScalarValue[] {
  const next = [...values];
  while (next.length > 0 && next[next.length - 1] === "") {
    next.pop();
  }
  return next;
}

function getTrainingTableFieldValues(
  example: TrainingExample,
  activeFieldIds?: ReadonlySet<string>,
): TrainingTableFieldValues {
  const raw = example.tableOutput?.fieldValues;
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const out: TrainingTableFieldValues = {};
  for (const [fieldId, series] of Object.entries(raw)) {
    if (activeFieldIds && !activeFieldIds.has(fieldId)) {
      continue;
    }
    if (!Array.isArray(series)) {
      continue;
    }
    const normalized = trimTrailingEmptySeries(series.map((value) => normalizeTableSeriesValue(value)));
    if (normalized.length > 0) {
      out[fieldId] = normalized;
    }
  }
  return out;
}

function hasTrainingFieldEvidence(example: TrainingExample, fieldId: string): boolean {
  if (example.boxes?.some((box) => box.field === fieldId)) {
    return true;
  }
  const series = example.tableOutput?.fieldValues?.[fieldId];
  return Array.isArray(series) && series.some((value) => value !== "" && value !== undefined && value !== null);
}

function getPromptSafeBuiltInValue(
  example: TrainingExample,
  fieldId: "exceptions",
): number | "" {
  const value = example.output[fieldId];
  if (fieldId === "exceptions" && value === 0 && !hasTrainingFieldEvidence(example, fieldId)) {
    return "";
  }
  return value;
}

function buildTableModeExampleSummary(
  example: TrainingExample,
  fieldLabels?: Record<string, string>,
  activeFieldIds?: ReadonlySet<string>,
): string {
  const fieldValues = getTrainingTableFieldValues(example, activeFieldIds);
  const fieldOrder = Object.keys(fieldValues);
  if (fieldOrder.length === 0) {
    return "";
  }

  const rowCount = fieldOrder.reduce((max, fieldId) => Math.max(max, fieldValues[fieldId]?.length ?? 0), 0);
  if (rowCount <= 0) {
    return "";
  }

  const previewRows = Math.min(rowCount, 12);
  const rowSummaries: string[] = [];
  for (let index = 0; index < previewRows; index += 1) {
    const cells = fieldOrder
      .map((fieldId) => {
        const value = fieldValues[fieldId]?.[index];
        if (value === "" || value === undefined || value === null) {
          return "";
        }
        return `${fieldLabels?.[fieldId] || TRAINING_FIELD_LABELS[fieldId] || fieldId}=${String(value)}`;
      })
      .filter(Boolean);
    if (cells.length > 0) {
      rowSummaries.push(`第${index + 1}行：${cells.join("；")}`);
    }
  }

  if (rowSummaries.length === 0) {
    return "";
  }

  const suffix = rowCount > previewRows ? `；其余 ${rowCount - previewRows} 行同样按自上而下顺序。` : "";
  return `这是一个完整表格样本，共 ${rowCount} 行。按自上而下顺序，列框中的正确值示例如下：${rowSummaries.join(" | ")}${suffix}`;
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
  fieldLabels?: Record<string, string>,
  activeFieldIds?: ReadonlySet<string>,
): Promise<string> {
  const parsed = parseDataUrl(originalDataUrl);
  if (!parsed) {
    return originalDataUrl;
  }

  const boxes = (example.boxes || []).filter(
    (box) => box.coordSpace === "image" && (!activeFieldIds || activeFieldIds.has(box.field)),
  );
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
    const label = escapeSvgText(fieldLabels?.[box.field] || TRAINING_FIELD_LABELS[box.field] || box.field);
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
 * 参考图数量默认由环境变量控制，可用 TRAINING_VISUAL_REF_IMAGES=0 关闭附图（仍保留文字区域说明）。
 */
export async function buildVisualReferencePack(
  examples: TrainingExample[],
  options?: {
    maxImages?: number;
    maxBoxHintExamples?: number;
    fieldLabels?: Record<string, string>;
    activeFieldIds?: string[];
    formId?: string;
  },
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
  const annotatedExamples = examples.filter((example) => example.boxes && example.boxes.length > 0);
  const sorted = sortTrainingExamplesForGuidance(annotatedExamples.length > 0 ? annotatedExamples : examples);
  const activeFieldIds = options?.activeFieldIds?.length ? new Set(options.activeFieldIds) : undefined;

  const referenceImages: Array<{ imageName: string; caption: string; dataUrl: string }> = [];
  if (effectiveMaxImages > 0) {
    for (const example of sorted) {
      if (referenceImages.length >= effectiveMaxImages) {
        break;
      }

      const originalDataUrl = await getTrainingImageDataUrl(example.imageName, options?.formId);
      if (!originalDataUrl) {
        continue;
      }

      const dataUrl = await buildAnnotatedTrainingImageDataUrl(
        example,
        originalDataUrl,
        options?.fieldLabels,
        activeFieldIds,
      );

      const recordSummary = [
        !activeFieldIds || activeFieldIds.has("date") ? `date=${example.output.date}` : "",
        !activeFieldIds || activeFieldIds.has("route") ? `route=${example.output.route}` : "",
        !activeFieldIds || activeFieldIds.has("driver") ? `driver=${example.output.driver}` : "",
        (!activeFieldIds || activeFieldIds.has("taskCode")) && example.output.taskCode ? `taskCode=${example.output.taskCode}` : "",
        !activeFieldIds || activeFieldIds.has("total") ? `total=${example.output.total}` : "",
        (!activeFieldIds || activeFieldIds.has("total")) && example.output.totalSourceLabel
          ? `totalSourceLabel=${example.output.totalSourceLabel}`
          : "",
        !activeFieldIds || activeFieldIds.has("unscanned") ? `unscanned=${example.output.unscanned}` : "",
        (!activeFieldIds || activeFieldIds.has("exceptions")) && getPromptSafeBuiltInValue(example, "exceptions") !== ""
          ? `exceptions=${getPromptSafeBuiltInValue(example, "exceptions")}`
          : "",
        (!activeFieldIds || activeFieldIds.has("waybillStatus")) && example.output.waybillStatus
          ? `waybillStatus=${example.output.waybillStatus}`
          : "",
        (!activeFieldIds || activeFieldIds.has("stationTeam")) && example.output.stationTeam
          ? `stationTeam=${example.output.stationTeam}`
          : "",
        ...(example.output.customFieldValues
          ? Object.entries(example.output.customFieldValues)
              .filter(
                ([key, value]) =>
                  (!activeFieldIds || activeFieldIds.has(key)) && value !== "" && value !== undefined && value !== null,
              )
              .map(([key, value]) => `${options?.fieldLabels?.[key] || key}=${value}`)
          : []),
      ]
        .filter(Boolean)
        .join(" | ");

      const summary =
        example.annotationMode === "table"
          ? buildTableModeExampleSummary(example, options?.fieldLabels, activeFieldIds) || recordSummary
          : recordSummary;

      const caption = `训练参考图：${example.imageName}。这是一张人工确认并且已经画框标注过的样本图。请重点参考它的版式、字段位置、标注框覆盖范围，以及对应的正确结果：${summary}。若当前待识别图片与它布局相似，请优先沿用相同的阅读方式。`;
      referenceImages.push({ imageName: example.imageName, caption, dataUrl });
    }
  }

  const hintText =
    referenceImages.length > 0
      ? "\n\n上面附带了训练池里的人工标注参考图。模型应先看这些带框样本，理解字段对应的版式与正确答案，再去识别当前图片。\n"
      : "";

  return { hintText, referenceImages };
}

const MAX_DOC_EXCERPT_IN_PROMPT = 6000;

/** 注入「可编辑识别规则」Agent 与填表 Vision 时的固定边界说明 */
const RECOGNITION_RULE_SCOPE_NOTE =
  "【识别规则的固定边界】以下适用于「可编辑的识别规则」：只约束截图 OCR、字段映射与歧义处理；不得包含软件架构、接口、数据库、权限、部署、表格模板结构或需改代码才能生效的产品描述。与当前图片像素冲突时以像素为准，禁止编造不可见信息。";

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
          block += `\n  [附图 ${a.name}，存储名 ${a.imageName}，识别视觉阶段会附带该图作布局参考]`;
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

  return blocks.join("\n\n");
}

export function buildEditableRecognitionRulesSection(globalRules?: GlobalRules | null): string {
  let section = `\n\n${RECOGNITION_RULE_SCOPE_NOTE}\n`;
  if (!globalRules) {
    return section;
  }

  const normalizedRules = seedWorkingRulesFromLegacy(mergeLegacyIntoAgentThreadIfEmpty(globalRules));
  const workingRules = stripRecognitionFieldGuidanceBlock(normalizedRules.workingRules).trim();
  if (workingRules) {
    section += `\n\n【当前工作识别规则】\n${workingRules}\n`;
    return section;
  }

  if (normalizedRules.agentThread && normalizedRules.agentThread.length > 0) {
    section += buildAgentThreadPromptSection(normalizedRules.agentThread);
  }

  return section;
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
  formId = DEFAULT_FORM_ID,
): Promise<Array<{ imageName: string; caption: string; dataUrl: string }>> {
  const max =
    limit ??
    Math.max(0, Math.min(3, Number.parseInt(process.env.AGENT_CONTEXT_REF_IMAGES || "2", 10) || 2));
  if (!thread || max === 0) return [];

  const seen = new Set<string>();
  const order: string[] = [];
  for (let turnIndex = thread.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread[turnIndex];
    if (!turn) continue;
    if (turn.role !== "user" || !turn.assets?.length) continue;
    for (let assetIndex = turn.assets.length - 1; assetIndex >= 0; assetIndex -= 1) {
      const a = turn.assets[assetIndex];
      if (!a) continue;
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
    const dataUrl = await getManagedImageDataUrl(imageName, formId);
    if (!dataUrl) continue;
    refs.push({
      imageName,
      caption: `规则对话附图：${imageName}（布局参考，不计入训练池标注样本）`,
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
    const wr = stripRecognitionFieldGuidanceBlock(globalRules.workingRules).trim();
    if (wr) {
      section += `\n\n【当前工作识别规则】\n${wr}\n`;
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
        getPromptSafeBuiltInValue(example, "exceptions") !== ""
          ? `exceptions=${getPromptSafeBuiltInValue(example, "exceptions")}`
          : "",
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
