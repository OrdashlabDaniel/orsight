"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
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
import {
  DEFAULT_FORM_ID,
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

type DropZoneKey = "source-image" | "template-excel" | "template-image";

function withFormId(formId: string, path: string) {
  return formId === DEFAULT_FORM_ID
    ? path
    : `${path}${path.includes("?") ? "&" : "?"}formId=${encodeURIComponent(formId)}`;
}

function buildTrainingImageRawUrl(formId: string, imageName: string) {
  return withFormId(formId, `/api/training/image?imageName=${encodeURIComponent(imageName)}&raw=1`);
}

function formatTemplateSource(source?: FormDefinition["templateSource"]) {
  switch (source) {
    case "manual":
      return "手动搭建";
    case "excel":
      return "Excel 模板导入";
    case "image":
      return "模板图片识别";
    case "copied":
      return "复制自已有填表";
    default:
      return "空白模板";
  }
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

function cloneFieldDrafts(fields: TableFieldDefinition[]) {
  return fields.map((field) => ({ ...field }));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
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

type UploadDropAreaProps = {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  active?: boolean;
  title: string;
  hint: string;
  helper?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (fileList: FileList | null) => void | Promise<void>;
  onHoverChange?: (active: boolean) => void;
};

function UploadDropArea({
  accept,
  multiple = false,
  disabled = false,
  active = false,
  title,
  hint,
  helper,
  inputRef,
  onFiles,
  onHoverChange,
}: UploadDropAreaProps) {
  function handleDrag(event: DragEvent<HTMLLabelElement>, nextActive: boolean) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) {
      return;
    }
    onHoverChange?.(nextActive);
  }

  async function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    onHoverChange?.(false);
    if (disabled) {
      return;
    }
    await onFiles(event.dataTransfer.files);
  }

  return (
    <label
      className={`flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-10 text-center transition ${
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : active
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/40"
      }`}
      onDragEnter={(event) => handleDrag(event, true)}
      onDragOver={(event) => handleDrag(event, true)}
      onDragLeave={(event) => handleDrag(event, false)}
      onDrop={(event) => void handleDrop(event)}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(event) => void onFiles(event.target.files)}
      />
      <div className="text-base font-medium">{title}</div>
      <div className="mt-2 text-sm text-slate-500">{hint}</div>
      {helper ? <div className="mt-3 text-xs text-slate-400">{helper}</div> : null}
    </label>
  );
}

export function FormSetupClient({ initialForm }: { initialForm: FormDefinition }) {
  const router = useRouter();
  const formId = initialForm.id;
  const apiPathBuilder = useCallback((path: string) => withFormId(formId, path), [formId]);

  const [form, setForm] = useState<FormDefinition>(initialForm);
  const [tableFields, setTableFields] = useState<TableFieldDefinition[]>([]);
  const [fieldDrafts, setFieldDrafts] = useState<TableFieldDefinition[]>([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<TableFieldType>("text");
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [trainingThumbnailMap, setTrainingThumbnailMap] = useState<Record<string, string>>({});
  const [annotatingItem, setAnnotatingItem] = useState<UploadItem | TrainingStatusItem | null>(null);
  const [annotationImageName, setAnnotationImageName] = useState("");
  const [annotationImageSrc, setAnnotationImageSrc] = useState("");
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraftState | null>(null);
  const [noticeMessage, setNoticeMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingFields, setIsSavingFields] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [activeDropTarget, setActiveDropTarget] = useState<DropZoneKey | null>(null);

  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const templateImageInputRef = useRef<HTMLInputElement | null>(null);
  const sourceImageInputRef = useRef<HTMLInputElement | null>(null);
  const removeUploadAfterSaveRef = useRef<string | null>(null);
  const uploadsRef = useRef<UploadItem[]>([]);
  uploadsRef.current = uploads;

  const activeTableFields = useMemo(() => getActiveTableFields(tableFields), [tableFields]);
  const deletedFieldDrafts = useMemo(
    () => fieldDrafts.filter((field) => !field.active),
    [fieldDrafts],
  );

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    };
  }, []);

  const loadForm = useCallback(async () => {
    const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, { cache: "no-store" });
    const payload = (await response.json()) as FormResponse;
    if (!response.ok || !payload.form) {
      throw new Error(payload.error || "填表信息读取失败。");
    }
    setForm(payload.form);
  }, [formId]);

  const loadTableFieldConfig = useCallback(async () => {
    const response = await fetch(apiPathBuilder("/api/table-fields"), { cache: "no-store" });
    const payload = (await response.json()) as TableFieldsResponse;
    if (!response.ok) {
      throw new Error(payload.error || "表格项目配置读取失败。");
    }
    const nextFields = normalizeTableFields(payload.tableFields || [], {
      preserveEmpty: true,
      appendMissingBuiltIns: false,
    });
    setTableFields(nextFields);
    setFieldDrafts(cloneFieldDrafts(nextFields));
  }, [apiPathBuilder]);

  const loadTrainingStatus = useCallback(async () => {
    const response = await fetch(apiPathBuilder("/api/training/status"), { cache: "no-store" });
    const payload = (await response.json()) as TrainingStatusResponse & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "训练池状态读取失败。");
    }
    setTrainingStatus(payload);
  }, [apiPathBuilder]);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      setErrorMessage("");
      try {
        await Promise.all([loadForm(), loadTableFieldConfig(), loadTrainingStatus()]);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "新建填表配置读取失败。");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [loadForm, loadTableFieldConfig, loadTrainingStatus]);

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

  useEffect(() => {
    const imageNames = trainingStatus?.items.map((item) => item.imageName) || [];
    if (!imageNames.length) {
      return;
    }

    let cancelled = false;
    const pendingNames = imageNames.filter((imageName) => !trainingThumbnailMap[imageName]);

    setTrainingThumbnailMap((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([imageName]) => imageNames.includes(imageName)),
      );
      for (const imageName of pendingNames) {
        if (!next[imageName]) {
          next[imageName] = buildTrainingImageRawUrl(formId, imageName);
        }
      }
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      const unchanged =
        currentKeys.length === nextKeys.length &&
        currentKeys.every((key) => next[key] === current[key]);
      if (unchanged) {
        return current;
      }
      return next;
    });

    if (!pendingNames.length) {
      return;
    }

    void (async () => {
      for (const imageName of pendingNames) {
        if (cancelled) {
          return;
        }

        try {
          const response = await fetch(apiPathBuilder(`/api/training/image?imageName=${encodeURIComponent(imageName)}`));
          const payload = (await response.json()) as { dataUrl?: string; error?: string };
          if (!response.ok || !payload.dataUrl || cancelled) {
            continue;
          }
          setTrainingThumbnailMap((current) => {
            const existing = current[imageName];
            if (existing === payload.dataUrl) {
              return current;
            }
            if (existing && !existing.includes("&raw=1")) {
              return current;
            }
            return { ...current, [imageName]: payload.dataUrl! };
          });
        } catch {
          // Keep raw fallback URL when thumbnail fetch fails.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiPathBuilder, formId, trainingStatus, trainingThumbnailMap]);

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
      throw new Error(payload.error || "填表信息更新失败。");
    }
    setForm(payload.form);
    return payload.form;
  }

  function validateFieldDrafts(fields: TableFieldDefinition[]) {
    const activeFields = fields.filter((field) => field.active);
    if (!activeFields.length) {
      throw new Error("至少需要保留一个表格项目。");
    }

    const seenLabels = new Map<string, string>();
    for (const field of activeFields) {
      const label = field.label.trim();
      if (!label) {
        throw new Error("表格项目名称不能为空。");
      }
      const key = label.toLocaleLowerCase("zh-CN");
      if (seenLabels.has(key)) {
        throw new Error(`表格项目「${label}」与「${seenLabels.get(key)}」重名，请调整后再保存。`);
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
      throw new Error(payload.error || "保存表格模板失败。");
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
        description: "已手动配置表格项目，可继续上传数据来源图片进行标注训练。",
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
      setErrorMessage("请先填写新表格项目名称。");
      return;
    }
    if (
      fieldDrafts.some(
        (field) => field.active && field.label.trim().toLocaleLowerCase("zh-CN") === label.toLocaleLowerCase("zh-CN"),
      )
    ) {
      setErrorMessage("已有同名的表格项目，请换一个名称。");
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
      setNoticeMessage("表格模板已保存，现在可以上传数据来源图片开始标注。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存表格模板失败。");
    } finally {
      setIsSavingFields(false);
    }
  }

  async function handleExcelTemplateSelection(fileList: FileList | null) {
    const file = fileList?.[0];
    setActiveDropTarget(null);
    if (!file) {
      return;
    }
    setIsImportingExcel(true);
    setErrorMessage("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error("Excel 中没有可用工作表。");
      }
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
      }) as unknown[][];
      const columns = guessTemplateColumnsFromRows(rows);
      if (!columns.length) {
        throw new Error("没有识别到可用的表头，请换一个更标准的 Excel 模板。");
      }
      const nextFields = buildTableFieldsFromTemplateColumns(columns);
      await saveFieldConfig(nextFields, {
        templateSource: "excel",
        description: `已从 Excel 模板导入 ${columns.length} 个表格项目，可继续补充训练样本。`,
      });
      setNoticeMessage(`已从 Excel 模板导入 ${columns.length} 个表格项目。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Excel 模板导入失败。");
    } finally {
      setIsImportingExcel(false);
      if (excelInputRef.current) {
        excelInputRef.current.value = "";
      }
    }
  }

  async function handleTemplateImageSelection(fileList: FileList | null) {
    const file = fileList?.[0];
    setActiveDropTarget(null);
    if (!file) {
      return;
    }
    setIsImportingImage(true);
    setErrorMessage("");
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const response = await fetch("/api/forms/template-from-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl }),
      });
      const payload = (await response.json()) as TemplateFromImageResponse;
      if (!response.ok || !payload.tableFields?.length) {
        throw new Error(payload.error || "模板图片识别失败。");
      }
      await saveFieldConfig(payload.tableFields, {
        templateSource: "image",
        description: payload.description || "已从模板截图识别表格项目，可继续补充训练样本。",
      });
      setNoticeMessage("模板截图已识别为标准表格项目，你可以继续微调后开始标注训练。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "模板图片识别失败。");
    } finally {
      setIsImportingImage(false);
      if (templateImageInputRef.current) {
        templateImageInputRef.current.value = "";
      }
    }
  }

  async function openAnnotationPanel(item: UploadItem | TrainingStatusItem) {
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
      previewUrl = trainingThumbnailMap[item.imageName] || buildTrainingImageRawUrl(formId, item.imageName);
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
      notes: existingExample?.notes || "人工标注用于训练池。",
    });
    setAnnotationImageName(imageName);
    setAnnotationImageSrc(previewUrl);
  }

  function closeAnnotationPanel() {
    setAnnotatingItem(null);
    setAnnotationDraft(null);
    removeUploadAfterSaveRef.current = null;
  }

  async function handleSourceFiles(fileList: FileList | File[] | null) {
    setActiveDropTarget(null);
    if (!fileList?.length) {
      return;
    }
    if (!activeTableFields.length) {
      setErrorMessage("请先配置至少一个表格项目，再上传数据来源图片。");
      return;
    }

    try {
      const nextUploads = await Promise.all(
        Array.from(fileList).map(async (file, index) => {
          const buffer = await file.arrayBuffer();
          const clonedFile = new File([buffer], file.name, {
            type: file.type,
            lastModified: file.lastModified,
          });
          return {
            id: `${clonedFile.name}-${clonedFile.lastModified}-${index}-${Date.now()}`,
            file: clonedFile,
            previewUrl: URL.createObjectURL(clonedFile),
          };
        }),
      );

      setUploads((current) => [...current, ...nextUploads]);
      setSelectedUploadId(nextUploads[0]?.id || null);
      setNoticeMessage(`已加入 ${nextUploads.length} 张数据来源图片，并自动进入标注。`);
      setErrorMessage("");
      if (nextUploads[0]) {
        await openAnnotationPanel(nextUploads[0]);
      }
    } catch {
      setErrorMessage("读取数据来源图片失败，请重试。");
    } finally {
      if (sourceImageInputRef.current) {
        sourceImageInputRef.current.value = "";
      }
    }
  }

  async function handleCompleteSetup() {
    setIsCompleting(true);
    setErrorMessage("");
    try {
      if (!activeTableFields.length) {
        throw new Error("请先完成表格模板配置。");
      }
      if (!trainingStatus || trainingStatus.labeledImages < 1) {
        throw new Error("请至少标注并存入 1 张训练样本后，再完成新建。");
      }

      const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ready" }),
      });
      const payload = (await response.json()) as FormResponse;
      if (!response.ok || !payload.form) {
        throw new Error(payload.error || "完成新建失败。");
      }
      setForm(payload.form);
      router.push(buildFormFillHref(formId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "完成新建失败。");
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-100 px-4 py-4 text-slate-900">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-4">
        <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link href="/forms" className="font-medium text-blue-600 hover:underline">
              ← 返回填表池
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">当前填表: {form.name}</span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs text-blue-700">
                模板来源: {formatTemplateSource(form.templateSource)}
              </span>
              <Link
                href={buildFormTrainingHref(formId)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                进入完整训练模式
              </Link>
            </div>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{form.name} · 新建填表</h1>
          <p className="mt-2 text-sm text-slate-600">
            每个填表都会拥有自己的表格模板、训练池和专属工作规则。先搭建模板，再上传数据来源图片标注训练，最后完成新建进入填表模式。
          </p>
          {noticeMessage ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {noticeMessage}
            </div>
          ) : null}
          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}
        </header>

        <section className="grid gap-4 xl:grid-cols-[420px_minmax(0,1.2fr)]">
          <div className="order-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:order-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">1. 配置表格模板</h2>
                <p className="mt-1 text-sm text-slate-500">
                  可以导入 Excel、上传模板截图给 AI 识别，或者手动逐项搭建表格项目。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => excelInputRef.current?.click()}
                  disabled={isImportingExcel}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {isImportingExcel ? "导入中..." : "上传 Excel 模板"}
                </button>
                <button
                  type="button"
                  onClick={() => templateImageInputRef.current?.click()}
                  disabled={isImportingImage}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {isImportingImage ? "识别中..." : "上传图片识别模板"}
                </button>
              </div>
            </div>

            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => void handleExcelTemplateSelection(event.target.files)}
            />
            <input
              ref={templateImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void handleTemplateImageSelection(event.target.files)}
            />

            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-700">空白表格区域预览</div>
              <div className="mt-1 text-xs text-slate-500">已启用 {activeTableFields.length} 个表格项目。</div>
              {activeTableFields.length ? (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <div
                    className="grid min-w-[760px] bg-slate-900 text-sm font-medium text-white"
                    style={{ gridTemplateColumns: `repeat(${activeTableFields.length}, minmax(120px, 1fr))` }}
                  >
                    {activeTableFields.map((field) => (
                      <div key={field.id} className="border-r border-slate-800 px-3 py-3 last:border-r-0">
                        {field.label}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid min-w-[760px] text-sm text-slate-400"
                    style={{ gridTemplateColumns: `repeat(${activeTableFields.length}, minmax(120px, 1fr))` }}
                  >
                    {activeTableFields.map((field) => (
                      <div key={field.id} className="border-r border-slate-100 px-3 py-4 last:border-r-0">
                        {field.type === "number" ? "0" : "示例值"}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-400">
                  这里还是空白模板。先导入模板，或者在下面手动增加表格项目。
                </div>
              )}
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 p-4">
              <div className="mb-3 text-sm font-medium text-slate-700">手动编辑表格项目</div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newFieldName}
                  onChange={(event) => setNewFieldName(event.target.value.slice(0, 40))}
                  placeholder="输入新的表格项目名称"
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <select
                  value={newFieldType}
                  onChange={(event) => setNewFieldType(event.target.value as TableFieldType)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="text">文本项目</option>
                  <option value="number">数字项目</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddField}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  新增项目
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {fieldDrafts.filter((field) => field.active).map((field, index, activeFields) => (
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
                        {field.type === "number" ? "数字" : "文本"}
                      </span>
                      <button
                        type="button"
                        onClick={() => moveFieldDraft(field.id, -1)}
                        disabled={index === 0}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-40"
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFieldDraft(field.id, 1)}
                        disabled={index === activeFields.length - 1}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-40"
                      >
                        下移
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteField(field)}
                        className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                {deletedFieldDrafts.length ? (
                  <div className="rounded-2xl border border-slate-200 p-3">
                    <div className="mb-2 text-sm font-medium text-slate-700">已删除项目</div>
                    <div className="space-y-2">
                      {deletedFieldDrafts.map((field) => (
                        <div
                          key={field.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                        >
                          <div>
                            <div className="text-sm font-medium text-slate-700">{field.label}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {field.type === "number" ? "数字项目" : "文本项目"}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRestoreField(field)}
                            className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                          >
                            恢复
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
                {isSavingFields ? "保存中..." : "保存模板配置"}
              </button>
            </div>
          </div>

          <div className="order-1 space-y-4 xl:order-1">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">2. 数据来源图片与训练</h2>
              <p className="mt-2 text-sm text-slate-500">
                模板配置好后，把真实数据来源图片上传到这里。上传后会自动打开标注工作台。
              </p>
              <label
                className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-10 text-center transition ${
                  activeTableFields.length
                    ? "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/40"
                    : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                }`}
              >
                <input
                  ref={sourceImageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={!activeTableFields.length}
                  className="hidden"
                  onChange={(event) => void handleSourceFiles(event.target.files)}
                />
                <div className="text-base font-medium">
                  {activeTableFields.length ? "点击上传数据来源图片" : "请先配置表格模板"}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  {activeTableFields.length ? "支持批量上传，上传后自动跳转标注。" : "模板为空时无法开始标注。"}
                </div>
              </label>

              <div className="mt-4 space-y-3">
                {uploads.length ? (
                  uploads.map((upload) => (
                    <button
                      key={upload.id}
                      type="button"
                      onClick={() => {
                        setSelectedUploadId(upload.id);
                        void openAnnotationPanel(upload);
                      }}
                      className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                        selectedUploadId === upload.id
                          ? "border-blue-400 bg-blue-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <div className="relative h-14 w-14 overflow-hidden rounded-xl bg-slate-200">
                        <Image src={upload.previewUrl} alt={upload.file.name} fill className="object-cover" unoptimized />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-700">{upload.file.name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {(upload.file.size / 1024).toFixed(1)} KB · 点击继续标注
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                    上传后这里会显示待标注的数据来源图片。
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">3. 当前训练池</h2>
              <div className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4 text-center">
                <div>
                  <div className="text-xs text-slate-500">训练图片</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">{trainingStatus?.totalImages ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">已标注</div>
                  <div className="mt-1 text-2xl font-semibold text-emerald-700">{trainingStatus?.labeledImages ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">未标注</div>
                  <div className="mt-1 text-2xl font-semibold text-amber-600">{trainingStatus?.unlabeledImages ?? 0}</div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(trainingStatus?.items || []).slice(0, 6).map((item) => (
                  <button
                    key={item.imageName}
                    type="button"
                    onClick={() => void openAnnotationPanel(item)}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="relative aspect-[4/3] bg-slate-200">
                      <Image
                        src={trainingThumbnailMap[item.imageName] || buildTrainingImageRawUrl(formId, item.imageName)}
                        alt={item.imageName}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="p-3">
                      <div className="truncate text-sm font-medium text-slate-700">{item.imageName}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.labeled ? "已标注，可点击修改" : "未标注"}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCompleteSetup()}
              disabled={isCompleting || isLoading}
              className="w-full rounded-3xl bg-emerald-600 px-4 py-4 text-base font-semibold text-white hover:bg-emerald-500 disabled:bg-emerald-300"
            >
              {isCompleting ? "完成中..." : form.ready ? "保存并进入填表模式" : "完成新建并进入填表模式"}
            </button>
          </div>
        </section>

        {annotatingItem && annotationDraft ? (
          <TrainingAnnotationWorkbench
            open
            imageName={annotationImageName}
            imageSrc={annotationImageSrc}
            apiPathBuilder={apiPathBuilder}
            fieldDefinitions={activeTableFields}
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
              setNoticeMessage(`标注已存入当前填表训练池，当前训练样本总数 ${totalExamples || 0}。`);
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
                if (selectedUploadId === uploadId) {
                  setSelectedUploadId(null);
                }
              }
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
