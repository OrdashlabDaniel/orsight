"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import * as XLSX from "xlsx";

import {
  TrainingAnnotationWorkbench,
  type AnnotationField,
  type AnnotationMode,
  type AnnotationWorkbenchSeed,
  type FieldAggregation,
  type TableAnnotationFieldValues,
  type WorkbenchAnnotationBox,
} from "@/components/TrainingAnnotationWorkbench";
import { getLocalizedFormName } from "@/lib/form-display";
import { getLocalizedTableFieldLabel } from "@/lib/table-field-display";
import {
  buildFormFillHref,
  buildFormTrainingHref,
  buildTableFieldsFromTemplateColumns,
  type FormDefinition,
} from "@/lib/forms";
import {
  TABLE_FIELDS_SYNC_EVENT,
  TABLE_FIELDS_SYNC_STORAGE_KEY,
  broadcastTableFieldsChanged,
  createCustomField,
  getActiveTableFields,
  normalizeTableFields,
  type TableFieldDefinition,
  type TableFieldType,
} from "@/lib/table-fields";
import {
  ensureImageDataUrlFromSource,
  isWorkspaceDocumentFile,
  prepareVisualUpload,
  SUPPORTED_WORKSPACE_UPLOAD_ACCEPT,
  TEMPLATE_IMPORT_ACCEPT,
} from "@/lib/client-visual-upload";
import { useLocale } from "@/i18n/LocaleProvider";

type FormResponse = {
  form?: FormDefinition | null;
  error?: string;
};

type TableFieldsResponse = {
  tableFields?: TableFieldDefinition[];
  error?: string;
};

type TrainingStatusItem = {
  imageName: string;
  labeled: boolean;
  example: {
    imageName: string;
    notes?: string;
    annotationMode?: AnnotationMode;
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
    boxes?: WorkbenchAnnotationBox[];
    fieldAggregations?: Partial<Record<AnnotationField, FieldAggregation>>;
    tableOutput?: {
      fieldValues?: TableAnnotationFieldValues;
    };
  } | null;
};

type TrainingStatusResponse = {
  totalImages: number;
  labeledImages: number;
  unlabeledImages: number;
  items: TrainingStatusItem[];
};

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
};

type AnnotationDraftState = {
  seed: AnnotationWorkbenchSeed;
  annotationMode: AnnotationMode;
  tableFieldValues?: TableAnnotationFieldValues;
  boxes: WorkbenchAnnotationBox[];
  fieldAggregations: Partial<Record<AnnotationField, FieldAggregation>>;
  notes: string;
};

type TemplateFromImageResponse = {
  tableFields?: TableFieldDefinition[];
  description?: string;
  error?: string;
};

function withFormId(formId: string, path: string) {
  return `${path}${path.includes("?") ? "&" : "?"}formId=${encodeURIComponent(formId)}`;
}

function buildTrainingImageRawUrl(formId: string, imageName: string) {
  return withFormId(formId, `/api/training/image?imageName=${encodeURIComponent(imageName)}&raw=1`);
}

function normalizeHeaderCells(row: unknown[]) {
  return row
    .map((cell) => (cell == null ? "" : String(cell).trim()))
    .filter(Boolean)
    .slice(0, 40);
}

function guessTemplateColumnsFromRows(rows: unknown[][]) {
  let bestRow: string[] = [];
  let bestScore = -1;
  for (const row of rows.slice(0, 20)) {
    const normalized = normalizeHeaderCells(row);
    if (normalized.length < 2) {
      continue;
    }
    const uniqueCount = new Set(normalized.map((value) => value.toLocaleLowerCase("zh-CN"))).size;
    const score = normalized.length * 4 + uniqueCount;
    if (score > bestScore) {
      bestScore = score;
      bestRow = normalized;
    }
  }
  return bestRow.map((label) => ({ label }));
}

/** 从 Word/文本解析结果中拆成「伪表格行」以复用表头猜测逻辑 */
function isTemplateImportFileName(name: string): boolean {
  return /\.(xlsx|xls|csv|doc|docx|txt|md)$/i.test(name);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable=true]"));
}

/** 模板区：表格文档 + 用于识别列名的截图 / PDF */
function isTemplateZoneFile(file: File): boolean {
  if (isTemplateImportFileName(file.name)) {
    return true;
  }
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) {
    return true;
  }
  if (t.includes("pdf") || /\.pdf$/i.test(file.name)) {
    return true;
  }
  return false;
}

/** 数据来源区：截图/PDF 可训练；Excel/Word/文本类文档可直接识别，无需标注。 */
function isSetupDataSourceFile(file: File): boolean {
  if (isWorkspaceDocumentFile(file)) {
    return true;
  }
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) {
    return true;
  }
  if (t.includes("pdf") || /\.pdf$/i.test(file.name)) {
    return true;
  }
  return false;
}

function rowsFromPlainTextTable(text: string): unknown[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 60);
  return lines.map((line) => {
    if (line.includes("\t")) {
      return line.split("\t").map((c) => c.trim());
    }
    const pipes = line.split(/\s*\|\s*/).map((c) => c.trim()).filter(Boolean);
    if (pipes.length >= 2) {
      return pipes;
    }
    const gaps = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (gaps.length >= 2) {
      return gaps;
    }
    return [line];
  });
}

function cloneFieldDrafts(fields: TableFieldDefinition[]) {
  return fields.map((field) => ({ ...field }));
}

function blankSeed(): AnnotationWorkbenchSeed {
  return {
    date: "",
    route: "",
    driver: "",
    taskCode: "",
    total: "",
    totalSourceLabel: "",
    unscanned: "",
    exceptions: "",
    waybillStatus: "",
    stationTeam: "",
    customFieldValues: {},
  };
}

export function FormSetupFlow({ initialForm }: { initialForm: FormDefinition }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const formId = initialForm.id;

  function formatTemplateSourceLabel(source?: FormDefinition["templateSource"]) {
    const key = source ?? "blank";
    return t(`formSetup.templateSource.${key}`);
  }

  const readFileAsDataUrl = useCallback(
    (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(t("formSetup.errReadImage")));
        reader.readAsDataURL(file);
      }),
    [t],
  );

  const apiPathBuilder = useCallback((path: string) => withFormId(formId, path), [formId]);

  const [form, setForm] = useState<FormDefinition>(initialForm);
  const [tableFields, setTableFields] = useState<TableFieldDefinition[]>([]);
  const [fieldDrafts, setFieldDrafts] = useState<TableFieldDefinition[]>([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<TableFieldType>("text");
  const [, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [annotatingItem, setAnnotatingItem] = useState<UploadItem | TrainingStatusItem | null>(null);
  const [annotationImageName, setAnnotationImageName] = useState("");
  const [annotationImageSrc, setAnnotationImageSrc] = useState("");
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraftState | null>(null);
  const [annotationFieldsForWorkbench, setAnnotationFieldsForWorkbench] = useState<TableFieldDefinition[]>([]);
  const [noticeMessage, setNoticeMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingFields, setIsSavingFields] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [isImportingDocument, setIsImportingDocument] = useState(false);
  const [templateDropDragging, setTemplateDropDragging] = useState(false);
  const [dataSourceDropDragging, setDataSourceDropDragging] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const templateZoneInputRef = useRef<HTMLInputElement | null>(null);
  const dataSourceZoneInputRef = useRef<HTMLInputElement | null>(null);
  const unifiedImportBusyRef = useRef(false);
  const removeUploadAfterSaveRef = useRef<string | null>(null);
  const uploadsRef = useRef<UploadItem[]>([]);
  uploadsRef.current = uploads;

  const activeTableFields = useMemo(() => getActiveTableFields(tableFields), [tableFields]);
  const isTemplateImportBusy = isImportingExcel || isImportingImage || isImportingDocument;
  unifiedImportBusyRef.current = isTemplateImportBusy;
  const deletedFieldDrafts = useMemo(() => {
    if ((form.templateSource ?? "blank") === "blank" && !fieldDrafts.some((field) => field.active)) {
      return [];
    }
    return fieldDrafts.filter((field) => !field.active);
  }, [fieldDrafts, form.templateSource]);

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    };
  }, []);

  const loadForm = useCallback(async () => {
    const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, { cache: "no-store" });
    const payload = (await response.json()) as FormResponse;
    if (!response.ok || !payload.form) {
      throw new Error(payload.error || t("formSetup.errFormLoad"));
    }
    setForm(payload.form);
  }, [formId, t]);

  const loadTableFieldConfig = useCallback(async (): Promise<TableFieldDefinition[]> => {
    const response = await fetch(apiPathBuilder("/api/table-fields"), { cache: "no-store" });
    const payload = (await response.json()) as TableFieldsResponse;
    if (!response.ok) {
      throw new Error(payload.error || t("formSetup.errTableFields"));
    }
    const nextFields = normalizeTableFields(payload.tableFields || [], {
      preserveEmpty: true,
      appendMissingBuiltIns: false,
    });
    const sanitizedFields =
      (form.templateSource ?? "blank") === "blank" && !nextFields.some((field) => field.active) ? [] : nextFields;
    setTableFields(sanitizedFields);
    setFieldDrafts(cloneFieldDrafts(sanitizedFields));
    return sanitizedFields;
  }, [apiPathBuilder, form.templateSource, t]);

  const loadTrainingStatus = useCallback(async () => {
    const response = await fetch(apiPathBuilder("/api/training/status"), { cache: "no-store" });
    const payload = (await response.json()) as TrainingStatusResponse & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || t("formSetup.errTrainingStatus"));
    }
    setTrainingStatus(payload);
  }, [apiPathBuilder, t]);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      setErrorMessage("");
      try {
        await Promise.all([loadForm(), loadTableFieldConfig(), loadTrainingStatus()]);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("formSetup.errSetupLoad"));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [loadForm, loadTableFieldConfig, loadTrainingStatus, t]);

  useEffect(() => {
    function handleTableFieldsChanged() {
      void loadTableFieldConfig();
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === TABLE_FIELDS_SYNC_STORAGE_KEY) {
        void loadTableFieldConfig();
      }
    }

    window.addEventListener(TABLE_FIELDS_SYNC_EVENT, handleTableFieldsChanged as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(TABLE_FIELDS_SYNC_EVENT, handleTableFieldsChanged as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadTableFieldConfig]);

  const prevActiveColumnCountRef = useRef(0);

  useEffect(() => {
    const n = activeTableFields.length;
    const prev = prevActiveColumnCountRef.current;
    prevActiveColumnCountRef.current = n;

    if (n === 0 || prev !== 0 || uploads.length === 0 || annotatingItem) {
      return;
    }
    const first = uploads[0];
    if (first) {
      void openAnnotationPanel(first);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅列数 0→有值时自动打开；勿将 openAnnotationPanel 列入 deps
  }, [activeTableFields.length, uploads, annotatingItem]);

  async function updateFormMeta(patch: Partial<FormDefinition>) {
    const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        ...patch,
      }),
    });
    const payload = (await response.json()) as FormResponse;
    if (!response.ok || !payload.form) {
      throw new Error(payload.error || t("formSetup.errFormUpdate"));
    }
    setForm(payload.form);
    return payload.form;
  }

  function validateFieldDrafts(fields: TableFieldDefinition[]) {
    const activeFields = fields.filter((field) => field.active);
    if (!activeFields.length) {
      throw new Error(t("formSetup.errNeedOneField"));
    }

    const seenLabels = new Map<string, string>();
    for (const field of activeFields) {
      const label = field.label.trim();
      if (!label) {
        throw new Error(t("formSetup.errFieldNameEmpty"));
      }
      const key = label.toLocaleLowerCase("zh-CN");
      if (seenLabels.has(key)) {
        throw new Error(t("formSetup.errFieldDuplicate", { a: label, b: seenLabels.get(key)! }));
      }
      seenLabels.set(key, label);
    }

    return fields.map((field) => ({
      ...field,
      label: field.label.trim().slice(0, 40),
    }));
  }

  async function saveFieldConfig(
    nextFields: TableFieldDefinition[],
    options?: { templateSource?: FormDefinition["templateSource"]; description?: string },
  ) {
    const normalized = normalizeTableFields(nextFields, {
      preserveEmpty: true,
      appendMissingBuiltIns: false,
    });
    const response = await fetch(apiPathBuilder("/api/table-fields"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableFields: normalized }),
    });
    const payload = (await response.json()) as TableFieldsResponse;
    if (!response.ok) {
      throw new Error(payload.error || t("formSetup.errSaveTemplate"));
    }

    const saved = normalizeTableFields(payload.tableFields || normalized, {
      preserveEmpty: true,
      appendMissingBuiltIns: false,
    });
    setTableFields(saved);
    setFieldDrafts(cloneFieldDrafts(saved));
    broadcastTableFieldsChanged(saved);

    if (options?.templateSource || options?.description) {
      await updateFormMeta({
        ...(options.templateSource ? { templateSource: options.templateSource } : {}),
        ...(options.description ? { description: options.description } : {}),
      });
    } else if (form.templateSource === "blank" || !form.templateSource) {
      await updateFormMeta({
        templateSource: "manual",
        description: t("formSetup.manualSaveDesc"),
      });
    }

    return saved;
  }

  function updateFieldDraft(fieldId: string, updater: (field: TableFieldDefinition) => TableFieldDefinition) {
    setFieldDrafts((current) => current.map((field) => (field.id === fieldId ? updater(field) : field)));
  }

  function handleDeleteField(field: TableFieldDefinition) {
    if (!field.active) {
      return;
    }
    updateFieldDraft(field.id, (current) => ({ ...current, active: false }));
  }

  function handleRestoreField(field: TableFieldDefinition) {
    updateFieldDraft(field.id, (current) => ({ ...current, active: true }));
  }

  function moveFieldDraft(fieldId: string, direction: -1 | 1) {
    setFieldDrafts((current) => {
      const activeFields = current.filter((field) => field.active);
      const deletedFields = current.filter((field) => !field.active);
      const currentIndex = activeFields.findIndex((field) => field.id === fieldId);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= activeFields.length) {
        return current;
      }
      const nextActive = [...activeFields];
      const [movedField] = nextActive.splice(currentIndex, 1);
      nextActive.splice(targetIndex, 0, movedField);
      return [...nextActive, ...deletedFields];
    });
  }

  function handleAddField() {
    const label = newFieldName.trim();
    if (!label) {
      setErrorMessage(t("formSetup.errNewFieldEmpty"));
      return;
    }
    if (
      fieldDrafts.some(
        (field) => field.active && field.label.trim().toLocaleLowerCase("zh-CN") === label.toLocaleLowerCase("zh-CN"),
      )
    ) {
      setErrorMessage(t("formSetup.errDuplicateFieldName"));
      return;
    }
    const nextField = {
      ...createCustomField(label),
      type: newFieldType,
    };
    setFieldDrafts((current) => [...current, nextField]);
    setNewFieldName("");
    setNewFieldType("text");
    setErrorMessage("");
  }

  async function handleSaveManualFields() {
    setIsSavingFields(true);
    setErrorMessage("");
    try {
      const validated = validateFieldDrafts(fieldDrafts);
      await saveFieldConfig(validated);
      setNoticeMessage(t("formSetup.noticeSavedColumns"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formSetup.errSaveTemplate"));
    } finally {
      setIsSavingFields(false);
    }
  }

  async function importExcelTemplateFromFile(file: File): Promise<boolean> {
    setIsImportingExcel(true);
    setErrorMessage("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error(t("formSetup.errExcelNoSheet"));
      }
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
      }) as unknown[][];
      const columns = guessTemplateColumnsFromRows(rows);
      if (!columns.length) {
        throw new Error(t("formSetup.errExcelNoHeader"));
      }
      const nextFields = buildTableFieldsFromTemplateColumns(columns);
      await saveFieldConfig(nextFields, {
        templateSource: "excel",
        description: t("formSetup.excelImportDesc", { n: columns.length }),
      });
      setNoticeMessage(t("formSetup.noticeExcelImport", { n: columns.length }));
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formSetup.errExcelImport"));
      return false;
    } finally {
      setIsImportingExcel(false);
    }
  }

  async function importTemplateImageFromFile(file: File): Promise<boolean> {
    setIsImportingImage(true);
    setErrorMessage("");
    try {
      const prepared = await prepareVisualUpload(file);
      const imageDataUrl = await readFileAsDataUrl(prepared.file);
      URL.revokeObjectURL(prepared.previewUrl);
      const response = await fetch("/api/forms/template-from-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl }),
      });
      const payload = (await response.json()) as TemplateFromImageResponse;
      if (!response.ok || !payload.tableFields?.length) {
        throw new Error(payload.error || t("formSetup.errTemplateImage"));
      }
      await saveFieldConfig(payload.tableFields, {
        templateSource: "image",
        description: payload.description || t("formSetup.imageImportDesc"),
      });
      setNoticeMessage(t("formSetup.noticeImageImport"));
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formSetup.errTemplateImage"));
      return false;
    } finally {
      setIsImportingImage(false);
    }
  }

  async function importTemplateFromDocumentFile(file: File): Promise<boolean> {
    setIsImportingDocument(true);
    setErrorMessage("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/training/parse-document", { method: "POST", body: fd });
      const data = (await res.json()) as { text?: string; error?: string; warning?: string };
      if (!res.ok) {
        throw new Error(data.error || t("formSetup.errParseDoc"));
      }
      const raw = (data.text || "").trim();
      if (!raw) {
        throw new Error(data.warning || t("formSetup.errDocNoText"));
      }
      const rows = rowsFromPlainTextTable(raw);
      const columns = guessTemplateColumnsFromRows(rows);
      if (!columns.length) {
        throw new Error(t("formSetup.errDocNoHeader"));
      }
      const nextFields = buildTableFieldsFromTemplateColumns(columns);
      await saveFieldConfig(nextFields, {
        templateSource: "manual",
        description: t("formSetup.docInferDesc", { name: file.name, n: columns.length }),
      });
      setNoticeMessage(t("formSetup.noticeDocInfer", { n: columns.length }));
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formSetup.errDocImport"));
      return false;
    } finally {
      setIsImportingDocument(false);
    }
  }

  async function processTemplateImportFile(file: File): Promise<boolean> {
    const name = file.name.toLowerCase();
    if (/\.(xlsx|xls|csv)$/i.test(name)) {
      return importExcelTemplateFromFile(file);
    }
    if (/\.(doc|docx|txt|md)$/i.test(name)) {
      return importTemplateFromDocumentFile(file);
    }
    return importTemplateImageFromFile(file);
  }

  async function appendVisualSourcesFromFiles(
    fileList: File[],
    fieldsHint?: TableFieldDefinition[],
  ): Promise<string | null> {
    if (!fileList.length) {
      return null;
    }
    try {
      const nextUploads = await Promise.all(
        fileList.map(async (file, index) => {
          const prepared = await prepareVisualUpload(file);
          return {
            id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
            file: prepared.file,
            previewUrl: prepared.previewUrl,
          };
        }),
      );
      setUploads((current) => [...nextUploads, ...current]);
      setErrorMessage("");
      const effectiveFields = fieldsHint ?? tableFields;
      const canAnnotate = getActiveTableFields(effectiveFields).length > 0;
      if (canAnnotate) {
        if (nextUploads[0]) {
          await openAnnotationPanel(nextUploads[0], effectiveFields);
        }
        return t("formSetup.noticeQueuedOpen", { n: nextUploads.length });
      } else {
        return t("formSetup.noticeQueuedWait", { n: nextUploads.length });
      }
    } catch {
      setErrorMessage(t("formSetup.errReadVisual"));
      return null;
    }
  }

  async function handleDocumentDataSources(
    fileList: File[],
  ): Promise<{ message: string | null; fieldsHint?: TableFieldDefinition[] }> {
    if (!fileList.length) {
      return { message: null };
    }

    const existingFields = getActiveTableFields(tableFields);
    if (existingFields.length) {
      setErrorMessage("");
      return {
        message: t("formSetup.noticeDocDirect", { n: fileList.length }),
        fieldsHint: tableFields,
      };
    }

    const first = fileList[0];
    const imported = /\.(xlsx|xls|csv)$/i.test(first.name)
      ? await importExcelTemplateFromFile(first)
      : await importTemplateFromDocumentFile(first);

    if (!imported) {
      return { message: null };
    }

    try {
      const nextFields = await loadTableFieldConfig();
      return {
        message: t("formSetup.noticeDocDirectWithColumns", { n: fileList.length }),
        fieldsHint: nextFields,
      };
    } catch {
      return {
        message: t("formSetup.noticeDocDirectWithColumns", { n: fileList.length }),
      };
    }
  }

  async function ingestTemplateZoneFiles(fileList: FileList | null): Promise<void> {
    if (!fileList?.length) {
      return;
    }
    if (templateZoneInputRef.current) {
      templateZoneInputRef.current.value = "";
    }
    const files = Array.from(fileList);
    const accepted = files.filter(isTemplateZoneFile);
    const skippedCount = files.length - accepted.length;
    if (!accepted.length) {
      if (files.length) {
        setNoticeMessage(t("formSetup.errWrongTemplateFiles"));
      }
      return;
    }
    if (skippedCount > 0) {
      setNoticeMessage(t("formSetup.skipWrongTemplate", { n: skippedCount }));
    }
    let hadSuccessfulTemplate = false;
    for (const f of accepted) {
      const ok = await processTemplateImportFile(f);
      if (ok) {
        hadSuccessfulTemplate = true;
      }
    }
    if (hadSuccessfulTemplate) {
      try {
        await loadTableFieldConfig();
      } catch {
        /* loadTableFieldConfig 已在上层设过 error */
      }
    }
  }

  async function ingestDataSourceZoneFiles(fileList: FileList | null): Promise<void> {
    if (!fileList?.length) {
      return;
    }
    if (dataSourceZoneInputRef.current) {
      dataSourceZoneInputRef.current.value = "";
    }
    const files = Array.from(fileList);
    const accepted = files.filter(isSetupDataSourceFile);
    const skippedCount = files.length - accepted.length;
    if (!accepted.length) {
      if (files.length) {
        setNoticeMessage(t("formSetup.dataOnlyVisual"));
      }
      return;
    }
    const documentFiles = accepted.filter((file) => isWorkspaceDocumentFile(file));
    const visualFiles = accepted.filter((file) => !isWorkspaceDocumentFile(file));
    const notices: string[] = [];
    let fieldsHint: TableFieldDefinition[] | undefined;

    if (documentFiles.length) {
      const documentResult = await handleDocumentDataSources(documentFiles);
      if (documentResult.message) {
        notices.push(documentResult.message);
      }
      fieldsHint = documentResult.fieldsHint;
    }

    if (visualFiles.length) {
      const visualNotice = await appendVisualSourcesFromFiles(visualFiles, fieldsHint);
      if (visualNotice) {
        notices.push(visualNotice);
      }
    }

    if (skippedCount > 0) {
      notices.unshift(t("formSetup.skipMixedData", { n: skippedCount }));
    }
    if (notices.length) {
      setNoticeMessage(notices.join(" "));
    }
  }

  function handleTemplateZonePaste(event: ClipboardEvent<HTMLDivElement>) {
    void (async () => {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (unifiedImportBusyRef.current) {
        return;
      }
      const cd = event.clipboardData;
      if (!cd) {
        return;
      }

      const clipFiles: File[] = [];
      for (const item of Array.from(cd.items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) {
            clipFiles.push(f);
          }
        }
      }
      if (clipFiles.length) {
        const accepted = clipFiles.filter(isTemplateZoneFile);
        const skipped = clipFiles.length - accepted.length;
        if (skipped > 0) {
          setNoticeMessage(t("formSetup.clipboardSkipTemplate", { n: skipped }));
        }
        if (accepted.length) {
          event.preventDefault();
          const dt = new DataTransfer();
          for (const f of accepted) {
            dt.items.add(f);
          }
          await ingestTemplateZoneFiles(dt.files);
        }
        return;
      }

      const text = cd.getData("text/plain");
      const trimmed = text.trim();
      if (trimmed) {
        const lines = trimmed.split(/\r?\n/).filter(Boolean);
        if (lines.length >= 2 || trimmed.includes("\t")) {
          event.preventDefault();
          const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
          const file = new File([blob], `clipboard-${Date.now()}.txt`, {
            type: "text/plain",
            lastModified: Date.now(),
          });
          const dt = new DataTransfer();
          dt.items.add(file);
          await ingestTemplateZoneFiles(dt.files);
          return;
        }
      }

      if (navigator.clipboard?.read) {
        try {
          const clipItems = await navigator.clipboard.read();
          for (const clipItem of clipItems) {
            for (const type of clipItem.types) {
              if (type.startsWith("image/")) {
                event.preventDefault();
                const blob = await clipItem.getType(type);
                const ext = type.split("/")[1] || "png";
                const file = new File([blob], `paste-${Date.now()}.${ext}`, {
                  type,
                  lastModified: Date.now(),
                });
                const dt = new DataTransfer();
                dt.items.add(file);
                await ingestTemplateZoneFiles(dt.files);
                return;
              }
            }
          }
        } catch {
          /* 权限或未授权 */
        }
      }
    })();
  }

  function handleDataSourceZonePaste(event: ClipboardEvent<HTMLDivElement>) {
    void (async () => {
      if (isTypingTarget(event.target)) {
        return;
      }
      const cd = event.clipboardData;
      if (!cd) {
        return;
      }

      const clipFiles: File[] = [];
      for (const item of Array.from(cd.items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) {
            clipFiles.push(f);
          }
        }
      }
      if (clipFiles.length) {
        const accepted = clipFiles.filter(isSetupDataSourceFile);
        const skipped = clipFiles.length - accepted.length;
        if (skipped > 0) {
          setNoticeMessage(t("formSetup.clipboardSkipData"));
        }
        if (accepted.length) {
          event.preventDefault();
          const dt = new DataTransfer();
          for (const f of accepted) {
            dt.items.add(f);
          }
          await ingestDataSourceZoneFiles(dt.files);
        }
        return;
      }

      if (navigator.clipboard?.read) {
        try {
          const clipItems = await navigator.clipboard.read();
          for (const clipItem of clipItems) {
            for (const type of clipItem.types) {
              if (type.startsWith("image/")) {
                event.preventDefault();
                const blob = await clipItem.getType(type);
                const ext = type.split("/")[1] || "png";
                const file = new File([blob], `paste-${Date.now()}.${ext}`, {
                  type,
                  lastModified: Date.now(),
                });
                const dt = new DataTransfer();
                dt.items.add(file);
                await ingestDataSourceZoneFiles(dt.files);
                return;
              }
            }
          }
        } catch {
          /* 权限或未授权 */
        }
      }
    })();
  }

  async function openAnnotationPanel(
    item: UploadItem | TrainingStatusItem,
    fieldsOverride?: TableFieldDefinition[],
  ) {
    const fields = fieldsOverride ?? tableFields;
    const flds = getActiveTableFields(fields);
    if ("file" in item && !flds.length) {
      setNoticeMessage(t("formSetup.needTemplateFirst"));
      return;
    }
    if (!flds.length) {
      setNoticeMessage(t("formSetup.configureColumnsRight"));
      return;
    }
    setAnnotationFieldsForWorkbench(flds);

    setAnnotatingItem(item);

    let imageName = "";
    let previewUrl = "";
    let existingExample: TrainingStatusItem["example"] = null;

    if ("file" in item) {
      imageName = item.file.name;
      previewUrl = item.previewUrl;
      removeUploadAfterSaveRef.current = item.id;
    } else {
      imageName = item.imageName;
      previewUrl = buildTrainingImageRawUrl(formId, item.imageName);
      existingExample = item.example;
      removeUploadAfterSaveRef.current = null;
    }

    setAnnotationDraft({
      seed: {
        ...blankSeed(),
        date: existingExample?.output.date || "",
        route: existingExample?.output.route || "",
        driver: existingExample?.output.driver || "",
        taskCode: existingExample?.output.taskCode || "",
        total: existingExample?.output.total ?? "",
        totalSourceLabel: existingExample?.output.totalSourceLabel || "",
        unscanned: existingExample?.output.unscanned ?? "",
        exceptions: existingExample?.output.exceptions ?? "",
        waybillStatus: existingExample?.output.waybillStatus || "",
        stationTeam: existingExample?.output.stationTeam || "",
        customFieldValues: { ...(existingExample?.output.customFieldValues || {}) },
      },
      annotationMode:
        existingExample?.annotationMode === "table" || existingExample?.tableOutput?.fieldValues ? "table" : "record",
      tableFieldValues: existingExample?.tableOutput?.fieldValues || undefined,
      boxes: (existingExample?.boxes || []).map((box) => ({
        ...box,
        id: typeof box.id === "string" && box.id ? box.id : crypto.randomUUID(),
      })),
      fieldAggregations: existingExample?.fieldAggregations || {},
      notes: existingExample?.notes || t("formSetup.defaultNotes"),
    });
    setAnnotationImageName(imageName);
    setAnnotationImageSrc(await ensureImageDataUrlFromSource(previewUrl));
  }

  function closeAnnotationPanel() {
    setAnnotatingItem(null);
    setAnnotationDraft(null);
    setAnnotationFieldsForWorkbench([]);
    removeUploadAfterSaveRef.current = null;
  }

  async function handleCompleteSetup() {
    setIsCompleting(true);
    setErrorMessage("");
    try {
      if (!activeTableFields.length) {
        throw new Error(t("formSetup.errNeedTemplate"));
      }

      const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ready" }),
      });
      const payload = (await response.json()) as FormResponse;
      if (!response.ok || !payload.form) {
        throw new Error(payload.error || t("formSetup.errFinish"));
      }
      setForm(payload.form);
      router.push(buildFormFillHref(formId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formSetup.errFinish"));
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--background)] px-3 py-6 text-[var(--foreground)]">
      <div className="mx-auto flex w-[80%] max-w-full flex-col gap-6">
        <header className="border-b border-[var(--border)] pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link href="/forms" className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              {t("nav.backToPool")}
            </Link>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]">
              <span>{getLocalizedFormName(form, locale)}</span>
              <span>·</span>
              <span>{formatTemplateSourceLabel(form.templateSource)}</span>
              <Link
                href={buildFormTrainingHref(formId)}
                className="text-[var(--foreground)] underline-offset-2 hover:underline"
              >
                {t("formSetup.fullTraining")}
              </Link>
            </div>
          </div>
          <h1 className="mt-4 text-xl font-medium tracking-tight">{t("formSetup.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">{t("formSetup.intro")}</p>
          {noticeMessage ? (
            <div className="mt-4 rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900">
              {noticeMessage}
            </div>
          ) : null}
          {errorMessage ? (
            <div className="mt-4 rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm text-red-800">
              {errorMessage}
            </div>
          ) : null}
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <div
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 outline-none"
            tabIndex={0}
            onPointerDownCapture={(event) => {
              if ((event.target as HTMLElement).closest('input[type="file"]')) {
                return;
              }
              (event.currentTarget as HTMLElement).focus({ preventScroll: true });
            }}
            onPaste={handleTemplateZonePaste}
          >
            <div className="text-sm font-medium">{t("formSetup.templateZoneTitle")}</div>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("formSetup.templateZoneDesc")}</p>
            <label
              className={`mt-3 flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition ${
                templateDropDragging
                  ? "border-[var(--foreground)] bg-[var(--accent-muted)]"
                  : "border-[var(--border)] bg-[var(--background)]"
              } ${isTemplateImportBusy ? "pointer-events-none opacity-60" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setTemplateDropDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setTemplateDropDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setTemplateDropDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setTemplateDropDragging(false);
                void ingestTemplateZoneFiles(event.dataTransfer.files);
              }}
            >
              <input
                ref={templateZoneInputRef}
                type="file"
                accept={TEMPLATE_IMPORT_ACCEPT}
                multiple
                className="hidden"
                disabled={isTemplateImportBusy}
                onChange={(event) => void ingestTemplateZoneFiles(event.target.files)}
              />
              <span className="text-sm">{t("formSetup.templateDrop")}</span>
              <span className="mt-2 max-w-[520px] text-xs text-[var(--muted-foreground)]">
                {t("formSetup.templatePasteHint", { helper: t("upload.templateHelper") })}
              </span>
            </label>
            {isTemplateImportBusy ? (
              <p className="mt-2 text-center text-xs text-[var(--muted-foreground)]">{t("formSetup.processing")}</p>
            ) : null}
          </div>

          <div
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 outline-none"
            tabIndex={0}
            onPointerDownCapture={(event) => {
              if ((event.target as HTMLElement).closest('input[type="file"]')) {
                return;
              }
              (event.currentTarget as HTMLElement).focus({ preventScroll: true });
            }}
            onPaste={handleDataSourceZonePaste}
          >
            <div className="text-sm font-medium">{t("formSetup.dataZoneTitle")}</div>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("formSetup.dataZoneDesc")}</p>
            <label
              className={`mt-3 flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition ${
                dataSourceDropDragging
                  ? "border-[var(--foreground)] bg-[var(--accent-muted)]"
                  : "border-[var(--border)] bg-[var(--background)]"
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDataSourceDropDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDataSourceDropDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDataSourceDropDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDataSourceDropDragging(false);
                void ingestDataSourceZoneFiles(event.dataTransfer.files);
              }}
            >
              <input
                ref={dataSourceZoneInputRef}
                type="file"
                accept={SUPPORTED_WORKSPACE_UPLOAD_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => void ingestDataSourceZoneFiles(event.target.files)}
              />
              <span className="text-sm">{t("formSetup.dataDrop")}</span>
              <span className="mt-2 max-w-[520px] text-xs text-[var(--muted-foreground)]">
                {t("formSetup.dataPasteHint", { helper: t("upload.workspaceHelper") })}
              </span>
            </label>
          </div>
        </div>

        <section className="flex flex-col gap-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div>
              <h2 className="text-sm font-medium">{t("formSetup.columnsTitle")}</h2>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("formSetup.columnsIntro")}</p>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <div className="text-xs font-medium text-[var(--foreground)]">{t("formSetup.preview")}</div>
              <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                {t("formSetup.columnsCount", { n: activeTableFields.length })}
              </div>
              {activeTableFields.length ? (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <div
                    className="grid min-w-[760px] bg-slate-900 text-sm font-medium text-white"
                    style={{ gridTemplateColumns: `repeat(${activeTableFields.length}, minmax(120px, 1fr))` }}
                  >
                    {activeTableFields.map((field) => (
                      <div key={field.id} className="border-r border-slate-800 px-3 py-3 last:border-r-0">
                        {getLocalizedTableFieldLabel(field, locale)}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid min-w-[760px] text-sm text-slate-400"
                    style={{ gridTemplateColumns: `repeat(${activeTableFields.length}, minmax(120px, 1fr))` }}
                  >
                    {activeTableFields.map((field) => (
                      <div key={field.id} className="border-r border-slate-100 px-3 py-4 last:border-r-0">
                        {field.type === "number" ? t("formSetup.sampleNumber") : t("formSetup.sampleText")}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-400">
                  {t("formSetup.blankTemplateHint")}
                </div>
              )}
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 p-4">
              <div className="mb-3 text-sm font-medium text-slate-700">{t("formSetup.manualEdit")}</div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newFieldName}
                  onChange={(event) => setNewFieldName(event.target.value.slice(0, 40))}
                  placeholder={t("formSetup.newFieldPlaceholder")}
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <select
                  value={newFieldType}
                  onChange={(event) => setNewFieldType(event.target.value as TableFieldType)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="text">{t("formSetup.fieldTypeText")}</option>
                  <option value="number">{t("formSetup.fieldTypeNumber")}</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddField}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  {t("formSetup.addField")}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {fieldDrafts.filter((field) => field.active).length ? (
                  fieldDrafts.filter((field) => field.active).map((field, index, visibleFields) => (
                    <div key={field.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(event) =>
                            updateFieldDraft(field.id, (current) => ({
                              ...current,
                              label: event.target.value.slice(0, 40),
                            }))
                          }
                          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                        <span className="rounded-full bg-slate-200 px-2 py-1 text-[11px] text-slate-600">
                          {field.type === "number" ? t("formSetup.typeShortNumber") : t("formSetup.typeShortText")}
                        </span>
                        <button
                          type="button"
                          onClick={() => moveFieldDraft(field.id, -1)}
                          disabled={index === 0}
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-40"
                        >
                          {t("formSetup.moveUp")}
                        </button>
                        <button
                          type="button"
                          onClick={() => moveFieldDraft(field.id, 1)}
                          disabled={index === visibleFields.length - 1}
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-40"
                        >
                          {t("formSetup.moveDown")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteField(field)}
                          className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                        >
                          {t("formSetup.remove")}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                    {t("formSetup.noColumns")}
                  </div>
                )}

                {deletedFieldDrafts.length ? (
                  <div className="rounded-2xl border border-slate-200 p-3">
                    <div className="mb-2 text-sm font-medium text-slate-700">{t("formSetup.deletedSection")}</div>
                    <div className="space-y-2">
                      {deletedFieldDrafts.map((field) => (
                        <div
                          key={field.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                        >
                          <div>
                            <div className="text-sm font-medium text-slate-700">
                              {getLocalizedTableFieldLabel(field, locale)}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {field.type === "number" ? t("formSetup.fieldTypeNumberFull") : t("formSetup.fieldTypeTextFull")}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRestoreField(field)}
                            className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                          >
                            {t("formSetup.restore")}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => void handleSaveManualFields()}
                disabled={isSavingFields}
                className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
              >
                {isSavingFields ? t("formSetup.saving") : t("formSetup.saveTemplate")}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleCompleteSetup()}
            disabled={isCompleting || isLoading}
            className="w-full rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {isCompleting ? t("formSetup.completing") : form.ready ? t("formSetup.enterFillMode") : t("formSetup.finishSetup")}
          </button>
        </section>

        {annotatingItem && annotationDraft ? (
          <TrainingAnnotationWorkbench
            open
            imageName={annotationImageName}
            imageSrc={annotationImageSrc}
            apiPathBuilder={apiPathBuilder}
            fieldDefinitions={annotationFieldsForWorkbench}
            initialSeed={annotationDraft.seed}
            initialAnnotationMode={annotationDraft.annotationMode}
            initialTableFieldValues={annotationDraft.tableFieldValues}
            initialBoxes={annotationDraft.boxes}
            initialFieldAggregations={annotationDraft.fieldAggregations}
            initialNotes={annotationDraft.notes}
            onClose={closeAnnotationPanel}
            onNotice={setNoticeMessage}
            onError={setErrorMessage}
            onSaved={async ({ totalExamples }) => {
              await loadTrainingStatus();
              setNoticeMessage(t("formSetup.noticeSavedTrain", { n: totalExamples || 0 }));
              const uploadId = removeUploadAfterSaveRef.current;
              removeUploadAfterSaveRef.current = null;
              if (uploadId) {
                setUploads((current) => {
                  const target = current.find((item) => item.id === uploadId);
                  if (target) {
                    URL.revokeObjectURL(target.previewUrl);
                  }
                  return current.filter((item) => item.id !== uploadId);
                });
              }
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
