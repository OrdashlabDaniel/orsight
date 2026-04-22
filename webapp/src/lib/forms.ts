import { DEFAULT_TABLE_FIELDS, type TableFieldDefinition, type TableFieldType } from "@/lib/table-fields";

export const DEFAULT_FORM_ID = "form-1";
/** 历史第二份赠送模板 id；仅为兼容旧用户已有数据而保留。 */
export const STARTER_FORM_2_ID = "form-starter-2";

/** 新用户首次进入时赠送的模板填表 id（用户自建填表使用其它 id）。 */
export const GIFT_TEMPLATE_FORM_IDS = [DEFAULT_FORM_ID] as const;
export const FORMS_MANIFEST_KEY = "__forms_manifest__";
export const FORM_META_PREFIX = "__form_meta__:";
export const FORM_EXAMPLE_PREFIX = "__form_example__:";
export const FORM_IMAGE_ROOT = "forms";
export const FORM_RECYCLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type FormTemplateSource = "blank" | "manual" | "excel" | "image" | "copied";
export type FormStatus = "draft" | "ready";

export type FormDefinition = {
  id: string;
  name: string;
  description: string;
  status: FormStatus;
  ready: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  templateSource?: FormTemplateSource;
  sourceFormId?: string | null;
};

export type TemplateColumnInput = {
  label: string;
  type?: TableFieldType;
};

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function simpleHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function sanitizeCustomFieldSlug(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeFormId(raw: string | null | undefined): string {
  if (!raw) {
    return DEFAULT_FORM_ID;
  }
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized || DEFAULT_FORM_ID;
}

export function createFormId() {
  return `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 财务支出类赠送模板的标准列（与产品默认示例一致；`date` 为唯一内置列，其余为自定义列）。 */
export const STANDARD_FINANCE_STARTER_TABLE_FIELDS: TableFieldDefinition[] = [
  { id: "date", type: "text", label: "Date", active: true, builtIn: true },
  { id: "custom_vendor", type: "text", label: "Vendor", active: true, builtIn: false },
  { id: "custom_description", type: "text", label: "Description", active: true, builtIn: false },
  { id: "custom_category", type: "text", label: "Category", active: true, builtIn: false },
  { id: "custom_amount", type: "text", label: "Amount", active: true, builtIn: false },
  { id: "custom_payment_method", type: "text", label: "Payment Method", active: true, builtIn: false },
  { id: "custom_reimbursement_status", type: "text", label: "Reimbursement", active: true, builtIn: false },
  { id: "custom_notes", type: "text", label: "Notes", active: true, builtIn: false },
  { id: "custom_link", type: "text", label: "Link", active: true, builtIn: false },
];

/** 历史出厂名：仍视为「未改元数据的赠送模板」，以便一次性把列同步到标准财务列。 */
export function isLegacyRouteGiftStub(form: FormDefinition): boolean {
  if (form.id !== DEFAULT_FORM_ID) {
    return false;
  }
  if (form.templateSource !== "copied" || form.sourceFormId != null) {
    return false;
  }
  return (
    form.name === "抽擦路线表" &&
    form.description === "已完成：沿用当前线上填表与训练能力。" &&
    form.status === "ready" &&
    form.ready === true
  );
}

export function createDefaultFormDefinition(): FormDefinition {
  const now = Date.now();
  return {
    id: DEFAULT_FORM_ID,
    name: "财务支出表",
    description: "标准列布局（日期、Vendor、Description 等），可直接填表或按需调整。",
    status: "ready",
    ready: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    templateSource: "copied",
    sourceFormId: null,
  };
}

export function createSecondStarterFormDefinition(): FormDefinition {
  const now = Date.now();
  return {
    id: STARTER_FORM_2_ID,
    name: "财务支出记录",
    description: "已完成配置，可直接进入填表模式。",
    status: "ready",
    ready: true,
    createdAt: now + 1,
    updatedAt: now + 1,
    deletedAt: null,
    templateSource: "copied",
    sourceFormId: null,
  };
}

/** 历史版本第二份预置表（仅用于判断「仍是出厂占位」以便一次性 legacy 合并）。 */
const LEGACY_SECOND_STARTER_NAME = "派送与签收表";
const LEGACY_SECOND_STARTER_DESCRIPTION = "适用模板：可直接使用或按需调整列与训练样本。";

function giftStubMetaEquals(
  a: Pick<FormDefinition, "name" | "description" | "status" | "ready" | "templateSource" | "sourceFormId">,
  b: FormDefinition,
) {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.status === b.status &&
    a.ready === b.ready &&
    a.templateSource === b.templateSource &&
    a.sourceFormId === b.sourceFormId
  );
}

/**
 * 是否为「从未被用户改过元数据」的赠送模板占位（不含时间戳）。
 * Git 部署不会据此改写数据库；仅 {@link mergeLegacyForms} 等一次性合并用来避免用旧清单覆盖用户已改的模板。
 */
export function isUnmodifiedTenantGiftStub(form: FormDefinition): boolean {
  if (form.templateSource !== "copied" || form.sourceFormId != null) {
    return false;
  }
  if (form.id === DEFAULT_FORM_ID) {
    return giftStubMetaEquals(createDefaultFormDefinition(), form) || isLegacyRouteGiftStub(form);
  }
  if (form.id === STARTER_FORM_2_ID) {
    if (giftStubMetaEquals(createSecondStarterFormDefinition(), form)) {
      return true;
    }
    return (
      form.name === LEGACY_SECOND_STARTER_NAME &&
      form.description === LEGACY_SECOND_STARTER_DESCRIPTION &&
      form.status === "ready" &&
      form.ready === true
    );
  }
  return false;
}

export function buildTenantStarterForms(): FormDefinition[] {
  return [createDefaultFormDefinition()];
}

export type NormalizeFormsOptions = {
  /** 为 false 时不在缺失 form-1 时自动插入内置默认填表（多租户首页仅展示清单内填表）。 */
  injectBuiltinDefault?: boolean;
};

export function normalizeForms(raw: unknown, options?: NormalizeFormsOptions): FormDefinition[] {
  const out: FormDefinition[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  const injectBuiltinDefault = options?.injectBuiltinDefault !== false;

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const id = normalizeFormId(typeof record.id === "string" ? record.id : "");
      if (!id || seen.has(id)) {
        continue;
      }

      const ready = Boolean(record.ready);
      const status = record.status === "ready" || ready ? "ready" : "draft";
      out.push({
        id,
        name:
          typeof record.name === "string" && record.name.trim()
            ? record.name.trim().slice(0, 48)
            : id === DEFAULT_FORM_ID
              ? "财务支出表"
              : id === STARTER_FORM_2_ID
                ? "财务支出记录"
                : "未命名填表",
        description:
          typeof record.description === "string"
            ? record.description.trim().slice(0, 160)
            : status === "ready"
              ? "已完成配置。"
              : "待配置：请先设置表格模板并补充训练样本。",
        status,
        ready: status === "ready",
        createdAt: typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : now,
        updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : now,
        deletedAt:
          typeof record.deletedAt === "number" && Number.isFinite(record.deletedAt)
            ? record.deletedAt
            : null,
        templateSource:
          record.templateSource === "blank" ||
          record.templateSource === "manual" ||
          record.templateSource === "excel" ||
          record.templateSource === "image" ||
          record.templateSource === "copied"
            ? record.templateSource
            : undefined,
        sourceFormId:
          typeof record.sourceFormId === "string" && record.sourceFormId.trim()
            ? normalizeFormId(record.sourceFormId)
            : null,
      });
      seen.add(id);
    }
  }

  if (injectBuiltinDefault && !seen.has(DEFAULT_FORM_ID)) {
    out.unshift(createDefaultFormDefinition());
  }

  return out.filter((form) => {
    if (!form.deletedAt) {
      return true;
    }
    return form.deletedAt + FORM_RECYCLE_RETENTION_MS > now;
  });
}

export function splitForms(forms: FormDefinition[]) {
  const active = forms.filter((form) => !form.deletedAt);
  const recycleBin = forms
    .filter((form) => Boolean(form.deletedAt))
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  return { active, recycleBin };
}

export function buildFormFillHref(formId: string) {
  return formId === DEFAULT_FORM_ID ? "/" : `/?formId=${encodeURIComponent(formId)}`;
}

export function buildFormTrainingHref(formId: string) {
  return formId === DEFAULT_FORM_ID ? "/training" : `/training?formId=${encodeURIComponent(formId)}`;
}

export function buildFormSetupHref(formId: string) {
  return `/forms/${encodeURIComponent(formId)}/setup`;
}

export function getFormGlobalRulesStorageKey(formId: string) {
  return formId === DEFAULT_FORM_ID ? "__global_rules__" : `${FORM_META_PREFIX}${formId}:global_rules`;
}

export function getFormExampleStorageKeyPrefix(formId: string) {
  return `${FORM_EXAMPLE_PREFIX}${formId}::`;
}

export function getFormExampleStorageKey(formId: string, imageName: string) {
  return formId === DEFAULT_FORM_ID ? imageName : `${getFormExampleStorageKeyPrefix(formId)}${imageName}`;
}

export function isReservedTrainingStorageKey(key: string) {
  return key.startsWith("__");
}

export function isFormScopedExampleStorageKey(key: string, formId: string) {
  return key.startsWith(getFormExampleStorageKeyPrefix(formId));
}

export function getFormImageStoragePath(formId: string, imageName: string) {
  return formId === DEFAULT_FORM_ID ? imageName : `${FORM_IMAGE_ROOT}/${formId}/${imageName}`;
}

export function buildBlankTableFields(): TableFieldDefinition[] {
  return [];
}

export function cloneTableFields(fields: TableFieldDefinition[]) {
  return fields.map((field) => ({ ...field }));
}

export function guessFieldTypeFromLabel(label: string): TableFieldType {
  return /数量|件数|重量|顺序|序号|金额|单号数|票数/i.test(label) ? "number" : "text";
}

export function findBuiltInFieldByLabel(label: string) {
  const token = normalizeToken(label);
  return DEFAULT_TABLE_FIELDS.find(
    (field) => normalizeToken(field.label) === token || normalizeToken(field.id) === token,
  );
}

function createStableCustomFieldId(label: string, existingIds: Set<string>) {
  const slug = sanitizeCustomFieldSlug(label);
  const base = slug ? `custom_${slug}` : `custom_${simpleHash(label)}`;
  let candidate = base;
  let index = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

export function buildTableFieldsFromTemplateColumns(columns: TemplateColumnInput[]): TableFieldDefinition[] {
  const normalizedColumns = columns
    .map((column) => ({
      label: column.label.trim(),
      type: column.type === "number" || column.type === "text" ? column.type : guessFieldTypeFromLabel(column.label),
    }))
    .filter((column) => column.label);

  const fields: TableFieldDefinition[] = [];
  const usedIds = new Set<string>();

  for (const column of normalizedColumns) {
    const builtIn = findBuiltInFieldByLabel(column.label);
    if (builtIn && !usedIds.has(builtIn.id)) {
      fields.push({
        ...builtIn,
        active: true,
      });
      usedIds.add(builtIn.id);
      continue;
    }

    const id = createStableCustomFieldId(column.label, usedIds);
    fields.push({
      id,
      label: column.label.slice(0, 40),
      type: column.type,
      active: true,
      builtIn: false,
    });
    usedIds.add(id);
  }

  return fields;
}
