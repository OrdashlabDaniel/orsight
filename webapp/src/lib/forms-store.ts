import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_FORM_ID,
  FORMS_MANIFEST_KEY,
  FORM_RECYCLE_RETENTION_MS,
  buildBlankTableFields,
  cloneTableFields,
  createDefaultFormDefinition,
  createFormId,
  normalizeFormId,
  normalizeForms,
  type FormDefinition,
} from "@/lib/forms";
import { loadTableFields, saveTableFields } from "@/lib/table-fields-store";
import {
  getManagedImageDataUrl,
  getTrainingImageDataUrl,
  isAgentContextImageName,
  loadGlobalRules,
  loadTrainingExamples,
  saveAgentContextImageDataUrl,
  saveGlobalRules,
  saveTrainingImageDataUrl,
  upsertTrainingExample,
} from "@/lib/training";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

function formsCandidatePaths() {
  return [
    path.join(process.cwd(), "training", "forms.json"),
    path.resolve(process.cwd(), "..", "training", "forms.json"),
  ];
}

function resolveFormsPath() {
  return formsCandidatePaths().find((filePath) => fs.existsSync(filePath)) || formsCandidatePaths()[1];
}

function loadLocalForms(): FormDefinition[] {
  const filePath = resolveFormsPath();
  if (!fs.existsSync(filePath)) {
    return normalizeForms([createDefaultFormDefinition()]);
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { forms?: unknown };
    return normalizeForms(payload.forms);
  } catch {
    return normalizeForms([createDefaultFormDefinition()]);
  }
}

function saveLocalForms(forms: FormDefinition[]) {
  const normalized = normalizeForms(forms);
  const filePath = resolveFormsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ forms: normalized }, null, 2), "utf8");
  return normalized;
}

async function loadRemoteForms() {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    return loadLocalForms();
  }

  const { data, error } = await admin
    .from("training_examples")
    .select("data")
    .eq("image_name", FORMS_MANIFEST_KEY)
    .single();

  if (error || !data) {
    return normalizeForms([createDefaultFormDefinition()]);
  }

  const row = data.data as { forms?: unknown };
  return normalizeForms(row.forms);
}

async function saveRemoteForms(forms: FormDefinition[]) {
  const admin = getSupabaseAdmin();
  if (!isSupabaseConfigured() || !admin) {
    saveLocalForms(forms);
    return normalizeForms(forms);
  }

  const normalized = normalizeForms(forms);
  const { error } = await admin
    .from("training_examples")
    .upsert(
      {
        image_name: FORMS_MANIFEST_KEY,
        data: {
          forms: normalized,
        },
      },
      { onConflict: "image_name" },
    );

  if (error) {
    throw new Error(`Failed to save forms manifest: ${error.message}`);
  }

  return normalized;
}

export async function loadForms() {
  return isSupabaseConfigured() ? loadRemoteForms() : loadLocalForms();
}

export async function saveForms(forms: FormDefinition[]) {
  return isSupabaseConfigured() ? saveRemoteForms(forms) : saveLocalForms(forms);
}

export async function getFormById(formId: string) {
  const normalizedId = normalizeFormId(formId);
  const forms = await loadForms();
  return forms.find((form) => form.id === normalizedId) || null;
}

export async function initializeBlankFormSpace(formId: string) {
  const blankFields = buildBlankTableFields();
  await saveTableFields(blankFields, formId);
  await saveGlobalRules(
    {
      instructions: "",
      documents: [],
      guidanceHistory: [],
      agentThread: [],
      workingRules: "",
      tableFields: blankFields,
    },
    formId,
  );
}

export async function createForm(name?: string) {
  const forms = await loadForms();
  const now = Date.now();
  const form: FormDefinition = {
    id: createFormId(),
    name: name?.trim().slice(0, 48) || `新建填表 ${forms.filter((item) => !item.deletedAt).length + 1}`,
    description: "待配置：请先设置表格模板并补充训练样本。",
    status: "draft",
    ready: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    templateSource: "blank",
    sourceFormId: null,
  };
  const nextForms = [...forms, form];
  await saveForms(nextForms);
  await initializeBlankFormSpace(form.id);
  return form;
}

export async function updateForm(formId: string, patch: Partial<FormDefinition>) {
  const normalizedId = normalizeFormId(formId);
  const forms = await loadForms();
  const nextForms = forms.map((form) =>
    form.id === normalizedId
      ? {
          ...form,
          ...patch,
          id: normalizedId,
          updatedAt: Date.now(),
        }
      : form,
  );
  await saveForms(nextForms);
  return nextForms.find((form) => form.id === normalizedId) || null;
}

export async function softDeleteForm(formId: string) {
  if (normalizeFormId(formId) === DEFAULT_FORM_ID) {
    throw new Error("默认填表不能删除。");
  }
  return updateForm(formId, { deletedAt: Date.now() });
}

export async function restoreForm(formId: string) {
  return updateForm(formId, { deletedAt: null });
}

export async function permanentlyDeleteForm(formId: string) {
  if (normalizeFormId(formId) === DEFAULT_FORM_ID) {
    throw new Error("默认填表不能删除。");
  }
  const forms = await loadForms();
  const nextForms = forms.filter((form) => form.id !== normalizeFormId(formId));
  await saveForms(nextForms);
}

export async function markFormReady(formId: string) {
  return updateForm(formId, {
    ready: true,
    status: "ready",
    description: "已完成配置，可直接进入填表模式。",
  });
}

export async function cloneFormSpace(sourceFormId: string, targetFormId: string) {
  const [tableFields, rules, examples] = await Promise.all([
    loadTableFields(sourceFormId),
    loadGlobalRules(sourceFormId),
    loadTrainingExamples(sourceFormId),
  ]);

  await saveTableFields(cloneTableFields(tableFields), targetFormId);
  await saveGlobalRules(
    {
      ...rules,
      tableFields: cloneTableFields(rules.tableFields || tableFields),
      guidanceHistory: rules.guidanceHistory ? [...rules.guidanceHistory] : [],
      agentThread: rules.agentThread ? rules.agentThread.map((turn) => ({ ...turn })) : [],
      documents: Array.isArray(rules.documents) ? rules.documents.map((doc) => ({ ...doc })) : [],
    },
    targetFormId,
  );

  const copiedImages = new Set<string>();
  for (const example of examples) {
    const dataUrl = await getTrainingImageDataUrl(example.imageName, sourceFormId);
    if (dataUrl) {
      await saveTrainingImageDataUrl(example.imageName, dataUrl, targetFormId);
      copiedImages.add(example.imageName);
    }
    await upsertTrainingExample(
      {
        ...example,
        boxes: example.boxes?.map((box) => ({ ...box })),
        fieldAggregations: example.fieldAggregations ? { ...example.fieldAggregations } : undefined,
        output: {
          ...example.output,
          customFieldValues: example.output.customFieldValues
            ? { ...example.output.customFieldValues }
            : undefined,
        },
        tableOutput: example.tableOutput?.fieldValues
          ? {
              fieldValues: Object.fromEntries(
                Object.entries(example.tableOutput.fieldValues).map(([fieldId, series]) => [fieldId, [...series]]),
              ),
            }
          : undefined,
      },
      targetFormId,
    );
  }

  const rulesWithAssets = rules.agentThread || [];
  for (const turn of rulesWithAssets) {
    for (const asset of turn.assets || []) {
      if (asset.kind !== "image" || copiedImages.has(asset.imageName)) {
        continue;
      }
      const dataUrl = await getManagedImageDataUrl(asset.imageName, sourceFormId);
      if (!dataUrl) {
        continue;
      }
      if (isAgentContextImageName(asset.imageName)) {
        await saveAgentContextImageDataUrl(asset.imageName, dataUrl, targetFormId);
      } else {
        await saveTrainingImageDataUrl(asset.imageName, dataUrl, targetFormId);
      }
      copiedImages.add(asset.imageName);
    }
  }
}

export async function duplicateForm(sourceFormId: string) {
  const source = await getFormById(sourceFormId);
  if (!source) {
    throw new Error("源填表不存在。");
  }

  const forms = await loadForms();
  const now = Date.now();
  const duplicate: FormDefinition = {
    ...source,
    id: createFormId(),
    name: `${source.name} 副本`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    templateSource: "copied",
    sourceFormId: source.id,
  };

  await saveForms([...forms, duplicate]);
  await cloneFormSpace(source.id, duplicate.id);
  return duplicate;
}

export function getFormStatusLabel(form: FormDefinition) {
  return form.ready ? "已完成" : "新建中";
}

export function getRemainingRecycleDays(deletedAt: number | null | undefined) {
  if (!deletedAt) {
    return null;
  }
  const expireAt = deletedAt + FORM_RECYCLE_RETENTION_MS;
  const remaining = expireAt - Date.now();
  if (remaining <= 0) {
    return 0;
  }
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}
