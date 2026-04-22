"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TrainingAnnotationWorkbench,
  type AnnotationField,
  type AnnotationMode,
  type AnnotationWorkbenchSeed,
  type FieldAggregation,
  type TableAnnotationFieldValues,
  type WorkbenchAnnotationBox,
} from "@/components/TrainingAnnotationWorkbench";
import { EditableFormTitle } from "@/components/EditableFormTitle";
import { RecognitionAgentDock } from "@/components/RecognitionAgentDock";
import { LoginLoadingFallback } from "@/app/login/LoginLoadingFallback";
import { useLocale } from "@/i18n/LocaleProvider";
import type { FormFilePoolItem } from "@/lib/form-file-pools";
import { getLocalizedTableFieldLabel } from "@/lib/table-field-display";
import {
  clearPersistedWorkbenchUploads,
  loadPersistedWorkbenchUploads,
  savePersistedWorkbenchUploads,
} from "@/lib/workbench-upload-store";
import {
  broadcastTableFieldsChanged,
  createCustomField,
  getActiveTableFields,
  TABLE_FIELDS_SYNC_EVENT,
  TABLE_FIELDS_SYNC_STORAGE_KEY,
  type TableFieldDefinition,
  type TableFieldType,
} from "@/lib/table-fields";
import { DEFAULT_FORM_ID, buildFormFillHref, normalizeFormId } from "@/lib/forms";
import {
  ensureImageDataUrlFromSource,
  isWorkspaceDocumentFile,
  prepareVisualUpload,
  SUPPORTED_WORKSPACE_UPLOAD_ACCEPT,
  TEMPLATE_IMPORT_ACCEPT,
} from "@/lib/client-visual-upload";

function isPdfLikeFile(file: File) {
  const type = (file.type || "").toLowerCase();
  return type.includes("pdf") || /\.pdf$/i.test(file.name);
}

function isTemplatePoolFile(file: File) {
  return isWorkspaceDocumentFile(file) || (file.type || "").startsWith("image/") || isPdfLikeFile(file);
}


type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
};

function normalizeUploadFileName(fileName: string) {
  return fileName.trim().toLocaleLowerCase();
}

function dedupeUploadsByName(items: UploadItem[], existingNames?: ReadonlySet<string>) {
  const seen = new Set(existingNames ? Array.from(existingNames) : []);
  const accepted: UploadItem[] = [];
  const skipped: UploadItem[] = [];

  for (const item of items) {
    const key = normalizeUploadFileName(item.file.name);
    if (!key || seen.has(key)) {
      skipped.push(item);
      continue;
    }
    seen.add(key);
    accepted.push(item);
  }

  return { accepted, skipped };
}

function isRasterImageUpload(upload: UploadItem) {
  return (upload.file.type || "").startsWith("image/");
}

function rasterImageLabelFromTrainingStatus(
  upload: UploadItem,
  items: TrainingStatusItem[] | undefined,
): "labeled" | "unlabeled" | null {
  if (!isRasterImageUpload(upload)) {
    return null;
  }
  const item = items?.find((i) => i.imageName === upload.file.name);
  return item?.labeled ? "labeled" : "unlabeled";
}

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

type FormFilePoolResponse = {
  files?: FormFilePoolItem[];
  file?: FormFilePoolItem;
  error?: string;
};

type TrainingPoolWorkspaceMode = "input" | "output";

type OutputWorkspaceColumnDragState = {
  edge: "left" | "right";
  startX: number;
  startLeftWidth: number;
  startRightWidth: number;
  shellWidth: number;
};

function formatPoolFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
}

function formatPoolUploadedAt(uploadedAt: number) {
  try {
    return new Date(uploadedAt).toLocaleString();
  } catch {
    return "";
  }
}

function poolFileBadgeLabel(file: FormFilePoolItem) {
  const ext = file.fileName.includes(".") ? file.fileName.split(".").pop()?.toUpperCase() : "";
  if (ext) {
    return ext.slice(0, 8);
  }
  switch (file.kind) {
    case "image":
      return "IMG";
    case "pdf":
      return "PDF";
    case "spreadsheet":
      return "SHEET";
    case "document":
      return "DOC";
    case "text":
      return "TEXT";
    default:
      return "FILE";
  }
}

function TrainingModeContent() {
  const { locale, t } = useLocale();
  const searchParams = useSearchParams();
  const currentFormId = useMemo(
    () => normalizeFormId(searchParams.get("formId") || DEFAULT_FORM_ID),
    [searchParams],
  );
  const withFormId = useMemo(
    () => (path: string) =>
      currentFormId === DEFAULT_FORM_ID
        ? path
        : `${path}${path.includes("?") ? "&" : "?"}formId=${encodeURIComponent(currentFormId)}`,
    [currentFormId],
  );
  const [setupField, setSetupField] = useState("");
  const [tableFields, setTableFields] = useState<TableFieldDefinition[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [trainingThumbnailMap, setTrainingThumbnailMap] = useState<Record<string, string>>({});
  const [trainingThumbnailErrorMap, setTrainingThumbnailErrorMap] = useState<Record<string, boolean>>({});
  const [deletingImageName, setDeletingImageName] = useState<string | null>(null);
  const [templatePoolFiles, setTemplatePoolFiles] = useState<FormFilePoolItem[]>([]);
  const [isUploadingPool, setIsUploadingPool] = useState<"templates" | null>(null);
  const [deletingPoolFileId, setDeletingPoolFileId] = useState<string | null>(null);
  const [activePoolMode, setActivePoolMode] = useState<TrainingPoolWorkspaceMode>("input");
  const [fieldDrafts, setFieldDrafts] = useState<TableFieldDefinition[]>([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<TableFieldType>("text");
  const [isSavingFieldConfig, setIsSavingFieldConfig] = useState(false);
  const [outputLeftPanelWidthPx, setOutputLeftPanelWidthPx] = useState(320);
  const [outputRightPanelWidthPx, setOutputRightPanelWidthPx] = useState(380);
  const [isOutputDesktopLayout, setIsOutputDesktopLayout] = useState(false);

  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isDraggingTemplatePoolFiles, setIsDraggingTemplatePoolFiles] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const [annotatingItem, setAnnotatingItem] = useState<UploadItem | TrainingStatusItem | null>(null);
  const [annotationImageName, setAnnotationImageName] = useState("");
  const [annotationImageSrc, setAnnotationImageSrc] = useState("");
  const [annotationDraft, setAnnotationDraft] = useState<{
    seed: AnnotationWorkbenchSeed;
    annotationMode: AnnotationMode;
    tableFieldValues?: TableAnnotationFieldValues;
    boxes: WorkbenchAnnotationBox[];
    fieldAggregations: Partial<Record<AnnotationField, FieldAggregation>>;
    notes: string;
  } | null>(null);

  const removeUploadAfterSaveRef = useRef<string | null>(null);
  const outputWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const outputWorkspaceDragRef = useRef<OutputWorkspaceColumnDragState | null>(null);
  const outputLeftPanelWidthRef = useRef(320);
  const outputRightPanelWidthRef = useRef(380);
  const OUTPUT_LEFT_PANEL_WIDTH_KEY = "orsight-training-output-left-width";
  const OUTPUT_RIGHT_PANEL_WIDTH_KEY = "orsight-training-output-right-width";

  const [isSavingTraining, setIsSavingTraining] = useState(false);

  const activeTableFields = getActiveTableFields(tableFields);
  const setupFieldDefinition = activeTableFields.find((field) => field.id === setupField) || null;
  const isFieldOnboarding = Boolean(setupFieldDefinition);
  const isInputPoolMode = activePoolMode === "input";
  const OUTPUT_LEFT_PANEL_MIN_WIDTH = 280;
  const OUTPUT_CENTER_PANEL_MIN_WIDTH = 320;
  const OUTPUT_RIGHT_PANEL_MIN_WIDTH = 320;
  const OUTPUT_SPLITTER_TOTAL_WIDTH = 24;

  function clampOutputWorkspaceWidths(shellWidth: number, leftWidth: number, rightWidth: number) {
    const safeShellWidth = Math.max(shellWidth, OUTPUT_LEFT_PANEL_MIN_WIDTH + OUTPUT_CENTER_PANEL_MIN_WIDTH + OUTPUT_RIGHT_PANEL_MIN_WIDTH + OUTPUT_SPLITTER_TOTAL_WIDTH);
    const maxLeftWidth = Math.max(
      OUTPUT_LEFT_PANEL_MIN_WIDTH,
      safeShellWidth - OUTPUT_RIGHT_PANEL_MIN_WIDTH - OUTPUT_CENTER_PANEL_MIN_WIDTH - OUTPUT_SPLITTER_TOTAL_WIDTH,
    );
    let nextLeftWidth = Math.min(Math.max(leftWidth, OUTPUT_LEFT_PANEL_MIN_WIDTH), maxLeftWidth);

    const maxRightWidth = Math.max(
      OUTPUT_RIGHT_PANEL_MIN_WIDTH,
      safeShellWidth - nextLeftWidth - OUTPUT_CENTER_PANEL_MIN_WIDTH - OUTPUT_SPLITTER_TOTAL_WIDTH,
    );
    const nextRightWidth = Math.min(Math.max(rightWidth, OUTPUT_RIGHT_PANEL_MIN_WIDTH), maxRightWidth);

    const recomputedLeftMax = Math.max(
      OUTPUT_LEFT_PANEL_MIN_WIDTH,
      safeShellWidth - nextRightWidth - OUTPUT_CENTER_PANEL_MIN_WIDTH - OUTPUT_SPLITTER_TOTAL_WIDTH,
    );
    nextLeftWidth = Math.min(nextLeftWidth, recomputedLeftMax);

    return { leftWidth: nextLeftWidth, rightWidth: nextRightWidth };
  }

  function applyOutputWorkspaceWidths(leftWidth: number, rightWidth: number) {
    outputLeftPanelWidthRef.current = leftWidth;
    outputRightPanelWidthRef.current = rightWidth;
    setOutputLeftPanelWidthPx(leftWidth);
    setOutputRightPanelWidthPx(rightWidth);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSetupField(params.get("setupField") || "");
  }, [searchParams]);

  useEffect(() => {
    void loadTableFieldConfig();
  }, [currentFormId]);

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
  }, []);

  useEffect(() => {
    if (setupField && !activeTableFields.some((field) => field.id === setupField)) {
      setSetupField("");
    }
  }, [activeTableFields, setupField]);

  useEffect(() => {
    if (!isFieldOnboarding) {
      return;
    }
    setActivePoolMode("input");
    uploadPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isFieldOnboarding]);

  useEffect(() => {
    const imageNames = trainingStatus?.items.map((item) => item.imageName) || [];
    if (!imageNames.length) {
      setTrainingThumbnailMap({});
      setTrainingThumbnailErrorMap({});
      return;
    }

    setTrainingThumbnailMap(() => {
      const next: Record<string, string> = {};
      for (const imageName of imageNames) {
        next[imageName] = buildTrainingImageThumbnailUrl(imageName);
      }
      return next;
    });
    setTrainingThumbnailErrorMap((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([imageName, failed]) => imageNames.includes(imageName) && failed),
      ),
    );
  }, [trainingStatus, withFormId]);

  async function loadTableFieldConfig() {
    try {
      const res = await fetch(withFormId("/api/table-fields"));
      const data = (await res.json()) as { error?: string; tableFields?: TableFieldDefinition[] };
      if (!res.ok) {
        setTableFields([]);
        setFieldDrafts([]);
        return;
      }
      const nextFields = Array.isArray(data.tableFields) ? data.tableFields : [];
      setTableFields(nextFields);
      setFieldDrafts(nextFields.map((field) => ({ ...field })));
    } catch {
      setTableFields([]);
      setFieldDrafts([]);
    }
  }


  const uploadPanelRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const uploadRestoreRequestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    };
  }, []);

  useEffect(() => {
    setSelectedUploadId((current) =>
      current && uploads.some((upload) => upload.id === current) ? current : uploads[0]?.id ?? null,
    );
  }, [uploads]);

  useEffect(() => {
    let cancelled = false;
    const requestId = uploadRestoreRequestIdRef.current + 1;
    uploadRestoreRequestIdRef.current = requestId;

    void loadPersistedWorkbenchUploads(currentFormId)
      .then((restoredUploads) => {
        if (cancelled || uploadRestoreRequestIdRef.current !== requestId) {
          restoredUploads.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
          return;
        }

        const { accepted, skipped } = dedupeUploadsByName(restoredUploads);
        skipped.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
        if (skipped.length > 0) {
          void savePersistedWorkbenchUploads(
            currentFormId,
            accepted.map((upload) => ({ id: upload.id, file: upload.file })),
          );
        }

        uploadsRef.current = accepted;
        setUploads(accepted);
        setSelectedUploadId((current) =>
          current && accepted.some((upload) => upload.id === current) ? current : accepted[0]?.id ?? null,
        );
      })
      .catch(() => {
        if (!cancelled && uploadRestoreRequestIdRef.current === requestId) {
          uploadsRef.current.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
          uploadsRef.current = [];
          setUploads([]);
          setSelectedUploadId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentFormId]);

  useEffect(() => {
    outputLeftPanelWidthRef.current = outputLeftPanelWidthPx;
  }, [outputLeftPanelWidthPx]);

  useEffect(() => {
    outputRightPanelWidthRef.current = outputRightPanelWidthPx;
  }, [outputRightPanelWidthPx]);

  useEffect(() => {
    try {
      const rawLeft = localStorage.getItem(OUTPUT_LEFT_PANEL_WIDTH_KEY);
      const rawRight = localStorage.getItem(OUTPUT_RIGHT_PANEL_WIDTH_KEY);
      const nextLeft = rawLeft ? Number.parseInt(rawLeft, 10) : NaN;
      const nextRight = rawRight ? Number.parseInt(rawRight, 10) : NaN;
      if (Number.isFinite(nextLeft)) {
        setOutputLeftPanelWidthPx(Math.max(OUTPUT_LEFT_PANEL_MIN_WIDTH, nextLeft));
      }
      if (Number.isFinite(nextRight)) {
        setOutputRightPanelWidthPx(Math.max(OUTPUT_RIGHT_PANEL_MIN_WIDTH, nextRight));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsOutputDesktopLayout(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isOutputDesktopLayout || typeof ResizeObserver === "undefined") {
      return;
    }

    const applyClamp = () => {
      const shellWidth = outputWorkspaceRef.current?.getBoundingClientRect().width ?? 0;
      if (!shellWidth) {
        return;
      }
      const next = clampOutputWorkspaceWidths(
        shellWidth,
        outputLeftPanelWidthRef.current,
        outputRightPanelWidthRef.current,
      );
      if (next.leftWidth !== outputLeftPanelWidthRef.current || next.rightWidth !== outputRightPanelWidthRef.current) {
        applyOutputWorkspaceWidths(next.leftWidth, next.rightWidth);
      }
    };

    applyClamp();
    const observer = new ResizeObserver(() => applyClamp());
    if (outputWorkspaceRef.current) {
      observer.observe(outputWorkspaceRef.current);
    }
    return () => observer.disconnect();
  }, [isOutputDesktopLayout]);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = outputWorkspaceDragRef.current;
      if (drag) {
        const deltaX = event.clientX - drag.startX;
        const next =
          drag.edge === "left"
            ? clampOutputWorkspaceWidths(drag.shellWidth, drag.startLeftWidth + deltaX, drag.startRightWidth)
            : clampOutputWorkspaceWidths(drag.shellWidth, drag.startLeftWidth, drag.startRightWidth - deltaX);
        applyOutputWorkspaceWidths(next.leftWidth, next.rightWidth);
      }
    }

    function onUp() {
      if (outputWorkspaceDragRef.current) {
        outputWorkspaceDragRef.current = null;
        try {
          localStorage.setItem(OUTPUT_LEFT_PANEL_WIDTH_KEY, String(outputLeftPanelWidthRef.current));
          localStorage.setItem(OUTPUT_RIGHT_PANEL_WIDTH_KEY, String(outputRightPanelWidthRef.current));
        } catch {
          /* ignore */
        }
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    void loadTrainingStatus();
    void loadTemplatePoolFiles();
  }, [currentFormId]);

  const handleFilesRef = useRef<((fileList: FileList | File[] | null) => Promise<void>) | null>(null);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      const items = event.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            const ext = file.type.split('/')[1] || 'png';
            const newFile = new File([file], `pasted-image-${Date.now()}-${i}.${ext}`, { type: file.type, lastModified: file.lastModified });
            files.push(newFile);
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault();
        if (handleFilesRef.current) {
          void handleFilesRef.current(files);
        }
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, []);

  async function loadTrainingStatus() {
    try {
      const response = await fetch(withFormId("/api/training/status"));
      const payload = (await response.json()) as TrainingStatusResponse & { error?: string };
      if (!response.ok) {

      }
      setTrainingStatus(payload);
    } catch (error) {

    }
  }

  async function refreshTrainingStatusUntilImage(imageName: string, timeoutMs = 2500) {
    const deadline = Date.now() + Math.max(250, timeoutMs);
    let lastPayload: TrainingStatusResponse | null = null;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(withFormId("/api/training/status"), { cache: "no-store" });
        const payload = (await response.json()) as TrainingStatusResponse & { error?: string };
        if (response.ok) {
          lastPayload = payload;
          setTrainingStatus(payload);
          if (payload.items?.some((item) => item.imageName === imageName)) {
            return true;
          }
        }
      } catch {
        // ignore transient fetch errors
      }

      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }

    if (lastPayload) {
      setTrainingStatus(lastPayload);
    }
    return false;
  }

  async function loadTemplatePoolFiles() {
    try {
      const response = await fetch(withFormId(`/api/form-file-pools?pool=templates`));
      const payload = (await response.json()) as FormFilePoolResponse;
      if (!response.ok) {
        throw new Error(payload.error || t("filePool.errLoad"));
      }
      const nextFiles = Array.isArray(payload.files) ? payload.files : [];
      setTemplatePoolFiles(nextFiles);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("filePool.errLoad"));
    }
  }

  async function uploadTemplatePoolFiles(files: File[], source: string) {
    if (!files.length) {
      return;
    }
    setIsUploadingPool("templates");
    setErrorMessage("");
    try {
      const uploaded: FormFilePoolItem[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("pool", "templates");
        formData.append("formId", currentFormId);
        formData.append("source", source);
        formData.append("file", file);
        const response = await fetch("/api/form-file-pools", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as FormFilePoolResponse;
        if (!response.ok || !payload.file) {
          throw new Error(payload.error || t("filePool.errUpload"));
        }
        uploaded.push(payload.file);
      }
      setTemplatePoolFiles((current) => [...uploaded, ...current.filter((item) => !uploaded.some((next) => next.id === item.id))]);
      setNoticeMessage(
        t("filePool.uploadedToPool", {
          n: uploaded.length,
          pool: t("filePool.templateTitle"),
        }),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("filePool.errUpload"));
    } finally {
      setIsUploadingPool(null);
    }
  }

  function buildTemplatePoolFileHref(fileId: string) {
    return withFormId(`/api/form-file-pools?pool=templates&fileId=${encodeURIComponent(fileId)}&raw=1`);
  }

  async function handleDeleteTemplatePoolFile(file: FormFilePoolItem) {
    const confirmed = window.confirm(t("filePool.confirmDelete", { name: file.fileName }));
    if (!confirmed) {
      return;
    }
    setDeletingPoolFileId(file.id);
    setErrorMessage("");
    try {
      const response = await fetch(
        withFormId(`/api/form-file-pools?pool=templates&fileId=${encodeURIComponent(file.id)}`),
        { method: "DELETE" },
      );
      const payload = (await response.json()) as FormFilePoolResponse;
      if (!response.ok) {
        throw new Error(payload.error || t("filePool.errDelete"));
      }
      setTemplatePoolFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("filePool.errDelete"));
    } finally {
      setDeletingPoolFileId(null);
    }
  }

  async function handleTemplatePoolUpload(fileList: FileList | null) {
    const files = Array.from(fileList || []).filter(isTemplatePoolFile);
    if (!files.length) {
      return;
    }
    await uploadTemplatePoolFiles(files, "training-page-template-pool");
  }

  async function saveFieldConfig(nextFields: TableFieldDefinition[]) {
    const response = await fetch(withFormId("/api/table-fields"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableFields: nextFields }),
    });
    const payload = (await response.json()) as { error?: string; tableFields?: TableFieldDefinition[] };
    if (!response.ok) {
      throw new Error(payload.error || t("home.errSaveFields"));
    }
    const saved = payload.tableFields?.length ? payload.tableFields : nextFields;
    setTableFields(saved);
    setFieldDrafts(saved.map((field) => ({ ...field })));
    broadcastTableFieldsChanged(saved);
    return saved;
  }

  function updateFieldDraft(id: string, updater: (field: TableFieldDefinition) => TableFieldDefinition) {
    setFieldDrafts((current) => current.map((field) => (field.id === id ? updater(field) : field)));
  }

  function validateFieldDrafts(fields: TableFieldDefinition[]) {
    const activeFields = fields.filter((field) => field.active);
    if (!activeFields.length) {
      throw new Error(t("home.errNeedOne"));
    }

    const normalizedLabels = new Map<string, string>();
    for (const field of activeFields) {
      const label = field.label.trim();
      if (!label) {
        throw new Error(t("home.errFieldEmpty"));
      }
      const key = label.toLocaleLowerCase(locale === "en" ? "en-US" : "zh-CN");
      if (normalizedLabels.has(key)) {
        throw new Error(t("home.errDupField", { a: label, b: String(normalizedLabels.get(key)) }));
      }
      normalizedLabels.set(key, label);
    }

    return fields.map((field) => ({
      ...field,
      label: field.label.trim(),
    }));
  }

  function handleDeleteFieldDraft(field: TableFieldDefinition) {
    if (!window.confirm(t("home.confirmDeleteField", { label: getLocalizedTableFieldLabel(field, locale) }))) {
      return;
    }
    updateFieldDraft(field.id, (current) => ({ ...current, active: false }));
  }

  function handleRestoreFieldDraft(field: TableFieldDefinition) {
    updateFieldDraft(field.id, (current) => ({ ...current, active: true }));
  }

  function handlePurgeDeletedFieldDraft(field: TableFieldDefinition) {
    if (field.active) {
      return;
    }
    const label = getLocalizedTableFieldLabel(field, locale);
    if (!window.confirm(t("home.confirmPurgeField", { label }))) {
      return;
    }
    setFieldDrafts((current) => current.filter((item) => item.id !== field.id));
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

      const nextActiveFields = [...activeFields];
      const [movedField] = nextActiveFields.splice(currentIndex, 1);
      nextActiveFields.splice(targetIndex, 0, movedField);
      return [...nextActiveFields, ...deletedFields];
    });
  }

  async function submitFieldDrafts() {
    setIsSavingFieldConfig(true);
    setErrorMessage("");
    try {
      const nextFields = validateFieldDrafts(fieldDrafts);
      await saveFieldConfig(nextFields);
      setNoticeMessage(t("home.noticeFieldsUpdated"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errSaveFields"));
    } finally {
      setIsSavingFieldConfig(false);
    }
  }

  function handleAddFieldDraft() {
    const label = newFieldName.trim();
    if (!label) {
      setErrorMessage(t("home.errNewName"));
      return;
    }
    const normalizedLabel = label.toLocaleLowerCase(locale === "en" ? "en-US" : "zh-CN");
    if (
      fieldDrafts.some(
        (field) => field.active && field.label.trim().toLocaleLowerCase(locale === "en" ? "en-US" : "zh-CN") === normalizedLabel,
      )
    ) {
      setErrorMessage(t("home.errDupName"));
      return;
    }
    const nextField = { ...createCustomField(label), type: newFieldType };
    setFieldDrafts((current) => [...current, nextField]);
    setNewFieldName("");
    setNewFieldType("text");
    setErrorMessage("");
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList?.length) {
      return;
    }

    const list = Array.from(fileList);
    const skippedDocs = list.filter((f) => isWorkspaceDocumentFile(f));
    const visualOnly = list.filter((f) => !isWorkspaceDocumentFile(f));
    if (skippedDocs.length) {
      setNoticeMessage(t("training.skipDocs", { n: skippedDocs.length }));
    }
    if (!visualOnly.length) {
      setErrorMessage("");
      return;
    }

    try {
      const nextUploads = await Promise.all(
        visualOnly.map(async (file, index) => {
          const prepared = await prepareVisualUpload(file);
          return {
            id: `${prepared.file.name}-${prepared.file.lastModified}-${index}-${Date.now()}`,
            file: prepared.file,
            previewUrl: prepared.previewUrl,
          };
        })
      );

      const existingNames = new Set(uploadsRef.current.map((upload) => normalizeUploadFileName(upload.file.name)));
      const { accepted, skipped } = dedupeUploadsByName(nextUploads, existingNames);
      skipped.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));

      if (accepted.length === 0) {
        setNoticeMessage(t("home.noticeSkippedDuplicateUploads", { n: skipped.length }));
        setErrorMessage("");
        return;
      }

      setUploads((current) => {
        const merged = [...current, ...accepted];
        void savePersistedWorkbenchUploads(
          currentFormId,
          merged.map((upload) => ({ id: upload.id, file: upload.file })),
        );
        setSelectedUploadId((currentId) => {
          if (!currentId && merged[0]) {
            return merged[0].id;
          }
          return currentId;
        });
        return merged;
      });

      setErrorMessage("");
      setNoticeMessage(
        skipped.length > 0
          ? t("home.noticeAddedDedupByName", { n: accepted.length, skipped: skipped.length })
          : t("home.noticeAdded", { n: accepted.length }),
      );
      if (isFieldOnboarding && accepted[0]) {
        setSelectedUploadId(accepted[0].id);
        void openAnnotationPanel(accepted[0]);
      }
    } catch {

    }
  }
  handleFilesRef.current = handleFiles;

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!isDraggingFiles) {
      setIsDraggingFiles(true);
    }
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
    void handleFiles(event.dataTransfer.files);
  }

  function openUploadFilePicker() {
    uploadInputRef.current?.click();
  }

  function handleTemplatePoolDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!isDraggingTemplatePoolFiles) {
      setIsDraggingTemplatePoolFiles(true);
    }
  }

  function handleTemplatePoolDragLeave(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingTemplatePoolFiles(false);
  }

  function handleTemplatePoolDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingTemplatePoolFiles(false);
    void handleTemplatePoolUpload(event.dataTransfer.files);
  }

  function beginOutputWorkspaceLeftResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !isOutputDesktopLayout) {
      return;
    }
    event.preventDefault();
    const shellWidth = outputWorkspaceRef.current?.getBoundingClientRect().width ?? 0;
    if (!shellWidth) {
      return;
    }
    outputWorkspaceDragRef.current = {
      edge: "left",
      startX: event.clientX,
      startLeftWidth: outputLeftPanelWidthRef.current,
      startRightWidth: outputRightPanelWidthRef.current,
      shellWidth,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function beginOutputWorkspaceRightResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !isOutputDesktopLayout) {
      return;
    }
    event.preventDefault();
    const shellWidth = outputWorkspaceRef.current?.getBoundingClientRect().width ?? 0;
    if (!shellWidth) {
      return;
    }
    outputWorkspaceDragRef.current = {
      edge: "right",
      startX: event.clientX,
      startLeftWidth: outputLeftPanelWidthRef.current,
      startRightWidth: outputRightPanelWidthRef.current,
      shellWidth,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function clearAll() {
    uploadRestoreRequestIdRef.current += 1;
    uploads.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    setUploads([]);
    setSelectedUploadId(null);
    void clearPersistedWorkbenchUploads(currentFormId);
    setErrorMessage("");
    setNoticeMessage(t("training.cleared"));
  }

  async function resolveAnnotationImage(imageName: string, previewUrl?: string) {
    if (previewUrl) {
      try {
        return await ensureImageDataUrlFromSource(previewUrl);
      } catch {
        // Fall back to the JSON data-url endpoint if the raw preview request fails.
      }
    }

    const response = await fetch(withFormId(`/api/training/image?imageName=${encodeURIComponent(imageName)}`));
    const payload = (await response.json()) as { dataUrl?: string; error?: string };
    if (!response.ok || !payload.dataUrl) {
      throw new Error(payload.error || t("training.errTrainImage"));
    }
    return await ensureImageDataUrlFromSource(payload.dataUrl);
  }

  function buildTrainingImageRawUrl(imageName: string) {
    return withFormId(`/api/training/image?imageName=${encodeURIComponent(imageName)}&raw=1`);
  }

  function buildTrainingImageThumbnailUrl(imageName: string, cacheBust?: number) {
    return withFormId(
      `/api/training/image?imageName=${encodeURIComponent(imageName)}&raw=1&thumbnail=1${cacheBust ? `&v=${cacheBust}` : ""}`,
    );
  }

  function retryTrainingThumbnail(imageName: string) {
    setTrainingThumbnailErrorMap((current) => {
      if (!current[imageName]) {
        return current;
      }
      const next = { ...current };
      delete next[imageName];
      return next;
    });
    setTrainingThumbnailMap((current) => ({
      ...current,
      [imageName]: buildTrainingImageThumbnailUrl(imageName, Date.now()),
    }));
  }

  function handleImageClick(upload: UploadItem) {
    setSelectedUploadId(upload.id);
    void openAnnotationPanel(upload);
  }

  function handleTrainingItemClick(item: TrainingStatusItem) {
    void openAnnotationPanel(item);
  }

  async function handleDeleteTrainingItem(item: TrainingStatusItem, event: { stopPropagation(): void }) {
    event.stopPropagation();
    if (deletingImageName) {
      return;
    }

    const confirmed = window.confirm(t("training.confirmDelete", { name: item.imageName }));
    if (!confirmed) {
      return;
    }

    setDeletingImageName(item.imageName);
    setErrorMessage("");
    try {
      const response = await fetch(
        withFormId(`/api/training/image?imageName=${encodeURIComponent(item.imageName)}`),
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {

      }

      if (annotatingItem && !("file" in annotatingItem) && annotatingItem.imageName === item.imageName) {
        closeRecordPopup();
      }

      setTrainingThumbnailMap((current) => {
        const next = { ...current };
        delete next[item.imageName];
        return next;
      });
      setTrainingThumbnailErrorMap((current) => {
        const next = { ...current };
        delete next[item.imageName];
        return next;
      });

      await loadTrainingStatus();

    } catch (error) {

    } finally {
      setDeletingImageName(null);
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
      previewUrl = buildTrainingImageRawUrl(item.imageName);
      existingExample = item.example;
      removeUploadAfterSaveRef.current = null;
    }

    const rawBoxes = existingExample?.boxes || [];
    setAnnotationDraft({
      seed: {
        date: existingExample?.output.date || "",
        route: existingExample?.output.route || "",
        driver: existingExample?.output.driver || "",
        taskCode: existingExample?.output.taskCode || "",
        total: existingExample?.output.total ?? "",
        unscanned: existingExample?.output.unscanned ?? "",
        exceptions: existingExample?.output.exceptions ?? "",
        waybillStatus: existingExample?.output.waybillStatus || "",
        stationTeam: existingExample?.output.stationTeam || "",
        totalSourceLabel: existingExample?.output.totalSourceLabel || "",
        customFieldValues: { ...(existingExample?.output.customFieldValues || {}) },
      },
      annotationMode:
        existingExample?.annotationMode === "table" || existingExample?.tableOutput?.fieldValues ? "table" : "record",
      tableFieldValues: existingExample?.tableOutput?.fieldValues || undefined,
      boxes: rawBoxes.map((b) => ({
        ...b,
        id: typeof b.id === "string" && b.id ? b.id : crypto.randomUUID(),
      })),
      fieldAggregations: existingExample?.fieldAggregations || {},
      notes: existingExample?.notes || t("annotation.defaultNotes"),
    });

    setAnnotationImageName(imageName);
    setAnnotationImageSrc("");

    setNoticeMessage(t("training.opening", { name: imageName }));

    try {
      const imageSrc = await resolveAnnotationImage(imageName, previewUrl);
      setAnnotationImageSrc(imageSrc);
      setNoticeMessage(t("training.opened", { name: imageName }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("training.errOpen"));
      setAnnotatingItem(null);
      setAnnotationDraft(null);
      removeUploadAfterSaveRef.current = null;
    }
  }

  const closeRecordPopup = useCallback(() => {
    setAnnotatingItem(null);
    setAnnotationDraft(null);
    removeUploadAfterSaveRef.current = null;
  }, []);

  async function imageSourceToDataUrl(source: string) {
    if (source.startsWith("data:")) {
      return source;
    }

    const response = await fetch(source);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));

      reader.readAsDataURL(blob);
    });
  }

  async function saveUploadsToTrainingPoolWithoutBoxes() {
    if (!uploads.length) {
      setErrorMessage(t("training.errNeedImage"));
      return;
    }

    setIsSavingTraining(true);
    setErrorMessage("");
    try {
      for (const upload of uploads) {
        try {
          const imageDataUrl = await imageSourceToDataUrl(upload.previewUrl);
          await fetch(withFormId("/api/training/save"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageName: upload.file.name,
              imageDataUrl,
              output: {
                date: "",
                route: "",
                driver: "",
                taskCode: "",
                total: 0,
                totalSourceLabel: "",
                unscanned: 0,
                exceptions: 0,
                waybillStatus: "",
                stationTeam: "",
                customFieldValues: {},
              },
              boxes: [],
            }),
          });
        } catch (err) {
          console.error(`Failed to save ${upload.file.name}:`, err);
        }
      }
      const last = uploads[uploads.length - 1];
      if (last) {
        await refreshTrainingStatusUntilImage(last.file.name);
      } else {
        await loadTrainingStatus();
      }
      clearAll();
    } finally {
      setIsSavingTraining(false);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-[var(--background)] px-3 py-6 text-[var(--foreground)]">
      <div className="mx-auto flex min-h-0 w-[80%] max-w-full flex-1 flex-col gap-6">
        <header className="shrink-0 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <Link
                href="/forms"
                className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--accent-muted)]"
              >
                {t("nav.backToPool")}
              </Link>
              <div className="h-5 w-px bg-[var(--border)]" />
              <div className="flex items-center rounded-lg bg-slate-200/60 p-1">
                <Link
                  href={buildFormFillHref(currentFormId)}
                  className="rounded-md px-4 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
                >
                  {t("home.title")}
                </Link>
                <div className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-slate-900 shadow-sm">
                  {t("home.training")}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <EditableFormTitle
              formId={currentFormId}
              onNotice={setNoticeMessage}
              onError={setErrorMessage}
              titleClassName="text-[20px] font-medium leading-7 tracking-[0.06em] text-slate-600"
            />
            <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">{t("training.intro")}</p>
          </div>
        </header>

        {setupFieldDefinition ? (
          <div className="shrink-0 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 shadow-sm">
            <div className="font-medium">{t("training.setupBanner", { label: setupFieldDefinition.label })}</div>
            <div className="mt-1">{t("training.setupHint", { label: setupFieldDefinition.label })}</div>
          </div>
        ) : null}

        <div className="shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-slate-800">{t("training.poolModeLabel")}</div>
              <p className="mt-1 text-xs text-slate-500">
                {isInputPoolMode ? t("training.inputModeSummary") : t("training.outputModeSummary")}
              </p>
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                aria-pressed={isInputPoolMode}
                onClick={() => setActivePoolMode("input")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  isInputPoolMode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t("training.poolModeInput")}
              </button>
              <button
                type="button"
                aria-pressed={!isInputPoolMode}
                onClick={() => setActivePoolMode("output")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  !isInputPoolMode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t("training.poolModeOutput")}
              </button>
            </div>
          </div>
        </div>

        {errorMessage ? (
          <div className="shrink-0 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        {noticeMessage ? (
          <div className="shrink-0 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {noticeMessage}
          </div>
        ) : null}

        <section
          ref={!isInputPoolMode ? outputWorkspaceRef : undefined}
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            isInputPoolMode ? "gap-4 xl:flex-row xl:items-stretch" : isOutputDesktopLayout ? "gap-0 flex-row items-stretch" : "gap-4"
          }`}
        >
          <div
            className={`flex min-h-0 w-full min-w-0 flex-col gap-4 overflow-hidden ${
              isInputPoolMode
                ? "flex-1 xl:max-w-[420px] xl:flex-none xl:basis-[min(100%,420px)]"
                : isOutputDesktopLayout
                  ? "shrink-0"
                  : "flex-1"
            }`}
            style={!isInputPoolMode && isOutputDesktopLayout ? { width: outputLeftPanelWidthPx } : undefined}
          >
            {isInputPoolMode ? (
              <>
                {trainingStatus ? (
                  <div className="flex shrink-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="px-5 py-4">
                      <h2 className="text-sm font-medium text-slate-500">{t("training.inputStatusTitle")}</h2>
                      <div className="mt-3 flex flex-col gap-2.5 text-sm font-medium text-slate-700">
                        <div className="flex items-center justify-between">
                          <span>{t("training.inputStatusImages")}</span>
                          <span className="text-slate-900">{trainingStatus.totalImages}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-emerald-500" />
                            <span>{t("training.inputStatusLabeled")}</span>
                          </div>
                          <span className="text-emerald-700">{trainingStatus.labeledImages}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-amber-500" />
                            <span>{t("training.inputStatusUnlabeled")}</span>
                          </div>
                          <span className="text-amber-700">{trainingStatus.unlabeledImages}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div
                  ref={uploadPanelRef}
                  className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"
                >
                  <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
                    <h2 className="text-sm font-medium text-[var(--foreground)]">{t("training.inputWorkspaceTitle")}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{t("training.inputWorkspaceSub")}</p>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md bg-[var(--foreground)] px-3 py-2 text-sm text-[var(--background)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void saveUploadsToTrainingPoolWithoutBoxes()}
                        disabled={isSavingTraining || !uploads.length}
                      >
                        {isSavingTraining ? t("training.saveNoBox") : t("training.saveNoBoxBtn")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)]"
                        onClick={async () => {
                          try {
                            const items = await navigator.clipboard.read();
                            const files: File[] = [];
                            for (const item of items) {
                              const imageTypes = item.types.filter((type) => type.startsWith("image/"));
                              for (const type of imageTypes) {
                                const blob = await item.getType(type);
                                const ext = type.split("/")[1] || "png";
                                files.push(
                                  new File([blob], `pasted-image-${Date.now()}-${files.length}.${ext}`, {
                                    type,
                                    lastModified: Date.now(),
                                  }),
                                );
                              }
                            }
                            if (files.length > 0) {
                              void handleFiles(files);
                            } else {
                              setErrorMessage(t("home.noClipboardImage"));
                            }
                          } catch {
                            setErrorMessage(t("home.errClipboard"));
                          }
                        }}
                      >
                        {t("home.pasteScreenshot")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)]"
                        onClick={clearAll}
                      >
                        {t("home.clear")}
                      </button>
                    </div>

                    <input
                      ref={uploadInputRef}
                      className="hidden"
                      type="file"
                      accept={SUPPORTED_WORKSPACE_UPLOAD_ACCEPT}
                      multiple
                      onChange={(event) => {
                        void handleFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />

                    <div
                      className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border transition ${
                        isDraggingFiles
                          ? "border-[var(--accent)] bg-[var(--accent-muted)]"
                          : "border-[var(--border)] bg-[var(--background)]"
                      }`}
                      onDragOver={handleDragOver}
                      onDragEnter={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
                        <div className="min-w-0 text-xs font-medium text-[var(--foreground)]">{t("home.uploadListTitle")}</div>
                        <button
                          type="button"
                          className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface)]"
                          onClick={openUploadFilePicker}
                        >
                          {t("home.addFiles")}
                        </button>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto">
                        {uploads.length ? (
                          <ul className="divide-y divide-[var(--border)]">
                            {uploads.map((upload) => {
                              const labelKind = rasterImageLabelFromTrainingStatus(upload, trainingStatus?.items);
                              return (
                                <li key={upload.id}>
                                  <button
                                    type="button"
                                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                                      selectedUploadId === upload.id ? "bg-[var(--accent-muted)]" : "hover:bg-[var(--surface)]"
                                    }`}
                                    onClick={() => void handleImageClick(upload)}
                                  >
                                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--background)]">
                                      <Image src={upload.previewUrl} alt={upload.file.name} className="object-cover" fill unoptimized />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate font-medium text-[var(--foreground)]">{upload.file.name}</div>
                                      <div className="mt-1 flex flex-wrap items-center gap-2">
                                        {labelKind === "labeled" ? (
                                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                                            {t("training.labeled")}
                                          </span>
                                        ) : labelKind === "unlabeled" ? (
                                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                                            {t("training.unlabeled")}
                                          </span>
                                        ) : null}
                                        <span className="text-xs text-[var(--muted-foreground)]">
                                          {(upload.file.size / 1024).toFixed(1)} KB
                                        </span>
                                      </div>
                                    </div>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <button
                            type="button"
                            className="flex min-h-[220px] w-full flex-col items-center justify-center px-4 py-10 text-center text-sm text-[var(--muted-foreground)]"
                            onClick={openUploadFilePicker}
                          >
                            <span>{t("home.uploadQueueEmpty")}</span>
                            <span className="mt-2 text-xs">
                              {isDraggingFiles ? t("home.dropRelease") : t("home.uploadListHint")}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex shrink-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="px-5 py-4">
                    <h2 className="text-sm font-medium text-slate-500">{t("training.outputStatusTitle")}</h2>
                    <div className="mt-3 flex items-center justify-between text-sm font-medium text-slate-700">
                      <span>{t("training.outputStatusTemplates")}</span>
                      <span className="text-slate-900">{templatePoolFiles.length}</span>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="shrink-0 border-b border-slate-200 px-5 py-4">
                    <h2 className="text-lg font-semibold">{t("training.outputUploadTitle")}</h2>
                    <p className="mt-1 text-sm text-slate-500">{t("training.outputUploadHint")}</p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-5">
                    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--muted-foreground)]">
                      {t("training.outputModeNote")}
                    </div>
                    <label
                      className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-10 text-center transition ${
                        isDraggingTemplatePoolFiles
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100"
                      }`}
                      onDragOver={handleTemplatePoolDragOver}
                      onDragEnter={handleTemplatePoolDragOver}
                      onDragLeave={handleTemplatePoolDragLeave}
                      onDrop={handleTemplatePoolDrop}
                    >
                      <span className="text-sm font-medium text-slate-800">{t("filePool.uploadTemplate")}</span>
                      <span className="mt-1 text-xs text-slate-500">{t("filePool.uploadTemplateHint")}</span>
                      <span className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                        {isUploadingPool === "templates" ? t("filePool.uploading") : t("filePool.uploadTemplate")}
                      </span>
                      <input
                        className="hidden"
                        type="file"
                        accept={TEMPLATE_IMPORT_ACCEPT}
                        multiple
                        onChange={(event) => {
                          void handleTemplatePoolUpload(event.target.files);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          {!isInputPoolMode && isOutputDesktopLayout ? (
            <div
              role="separator"
              aria-orientation="vertical"
              onPointerDown={beginOutputWorkspaceLeftResize}
              className="flex w-3 shrink-0 cursor-col-resize select-none items-center justify-center"
            >
              <div className="h-full w-px bg-slate-200" />
            </div>
          ) : null}

          {isInputPoolMode ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold">{t("training.gridTitle")}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t("training.gridHint")}</p>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-5">
                {trainingStatus?.items && trainingStatus.items.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {trainingStatus.items.map((item) => (
                      <button
                        key={item.imageName}
                        onClick={() => handleTrainingItemClick(item)}
                        className="group relative flex aspect-square flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left transition-all hover:border-blue-400 hover:shadow-md"
                      >
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => void handleDeleteTrainingItem(item, event)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void handleDeleteTrainingItem(item, event);
                            }
                          }}
                          aria-disabled={deletingImageName === item.imageName}
                          className={`absolute right-2 top-2 z-10 rounded-full border border-rose-200 bg-white/95 px-2 py-1 text-[11px] font-medium text-rose-600 shadow-sm transition hover:bg-rose-50 ${
                            deletingImageName === item.imageName ? "pointer-events-none opacity-60" : ""
                          }`}
                        >
                          {t("training.delete")}
                        </span>
                        <div className="relative flex-1 bg-slate-100">
                          {!trainingThumbnailErrorMap[item.imageName] ? (
                            <Image
                              src={trainingThumbnailMap[item.imageName] || buildTrainingImageThumbnailUrl(item.imageName)}
                              alt={item.imageName}
                              fill
                              unoptimized
                              className="object-cover"
                              onLoad={() => {
                                setTrainingThumbnailErrorMap((current) => {
                                  if (!current[item.imageName]) {
                                    return current;
                                  }
                                  const next = { ...current };
                                  delete next[item.imageName];
                                  return next;
                                });
                              }}
                              onError={() => {
                                setTrainingThumbnailErrorMap((current) =>
                                  current[item.imageName] ? current : { ...current, [item.imageName]: true },
                                );
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                retryTrainingThumbnail(item.imageName);
                              }}
                              className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-slate-400 break-all hover:bg-slate-200/70 hover:text-slate-500"
                            >
                              {t("training.thumbErr")}
                            </button>
                          )}
                        </div>
                        <div className="border-t border-slate-200 bg-white px-3 py-2">
                          <div className="truncate text-xs font-medium text-slate-700" title={item.imageName}>
                            {item.imageName}
                          </div>
                          <div className="mt-1 flex items-center gap-1">
                            {item.labeled ? (
                              <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                {t("training.labeled")}
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                {t("training.unlabeled")}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-500">
                    {t("training.emptyPool")}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={`flex min-h-0 min-w-0 flex-1 ${isOutputDesktopLayout ? "flex-row gap-0" : "flex-col gap-4"}`}>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold">{t("training.outputGridTitle")}</h2>
                    <p className="mt-1 text-sm text-slate-500">{t("training.outputGridHint")}</p>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-5">
                  {templatePoolFiles.length ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <ul className="divide-y divide-slate-200">
                        {templatePoolFiles.map((file) => (
                          <li key={file.id} className="flex flex-wrap items-start gap-3 px-4 py-4">
                            <div className="mt-0.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-slate-500">
                              {poolFileBadgeLabel(file)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-slate-800" title={file.fileName}>
                                {file.fileName}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                <span>{formatPoolFileSize(file.size)}</span>
                                <span>{formatPoolUploadedAt(file.uploadedAt)}</span>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <a
                                href={buildTemplatePoolFileHref(file.id)}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                {t("filePool.open")}
                              </a>
                              <button
                                type="button"
                                onClick={() => void handleDeleteTemplatePoolFile(file)}
                                disabled={deletingPoolFileId === file.id}
                                className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deletingPoolFileId === file.id ? t("filePool.deleting") : t("filePool.delete")}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                      {t("training.emptyOutputPool")}
                    </div>
                  )}
                </div>
              </div>

              {isOutputDesktopLayout ? (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={beginOutputWorkspaceRightResize}
                  className="flex w-3 shrink-0 cursor-col-resize select-none items-center justify-center"
                >
                  <div className="h-full w-px bg-slate-200" />
                </div>
              ) : null}

              <div
                className={`flex min-h-0 w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ${
                  isOutputDesktopLayout ? "shrink-0" : ""
                }`}
                style={isOutputDesktopLayout ? { width: outputRightPanelWidthPx } : undefined}
              >
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold">{t("home.fmTitle")}</h2>
                    <p className="mt-1 text-sm text-slate-500">{t("home.fmIntro")}</p>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-5">
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                      <input
                        type="text"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        placeholder={t("formSetup.newFieldPlaceholder")}
                        value={newFieldName}
                        onChange={(event) => setNewFieldName(event.target.value)}
                      />
                      <select
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        value={newFieldType}
                        onChange={(event) => setNewFieldType(event.target.value as TableFieldType)}
                      >
                        <option value="text">{t("formSetup.fieldTypeTextFull")}</option>
                        <option value="number">{t("formSetup.fieldTypeNumberFull")}</option>
                      </select>
                      <button
                        type="button"
                        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:bg-blue-300"
                        onClick={handleAddFieldDraft}
                        disabled={isSavingFieldConfig}
                      >
                        {t("formSetup.addField")}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 text-sm font-medium text-slate-700">{t("home.currentFields")}</div>
                      <div className="space-y-3">
                        {fieldDrafts.filter((field) => field.active).map((field, index, activeFields) => (
                          <div key={field.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                value={field.label}
                                onChange={(event) =>
                                  updateFieldDraft(field.id, (current) => ({
                                    ...current,
                                    label: event.target.value.slice(0, 40),
                                  }))
                                }
                              />
                              <span className="rounded-full bg-slate-200 px-2 py-1 text-[11px] text-slate-600">
                                {field.type === "number" ? t("formSetup.fieldTypeNumberFull") : t("formSetup.fieldTypeTextFull")}
                              </span>
                              {field.builtIn ? (
                                <span className="rounded-full bg-blue-100 px-2 py-1 text-[11px] text-blue-700">{t("home.builtin")}</span>
                              ) : (
                                <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] text-violet-700">{t("home.custom")}</span>
                              )}
                              <button
                                type="button"
                                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => moveFieldDraft(field.id, -1)}
                                disabled={index === 0}
                              >
                                {t("home.moveUp")}
                              </button>
                              <button
                                type="button"
                                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => moveFieldDraft(field.id, 1)}
                                disabled={index === activeFields.length - 1}
                              >
                                {t("home.moveDown")}
                              </button>
                              <button
                                type="button"
                                className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                                onClick={() => handleDeleteFieldDraft(field)}
                              >
                                {t("home.delete")}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 text-sm font-medium text-slate-700">{t("home.deletedSection")}</div>
                      <div className="space-y-3">
                        {fieldDrafts.filter((field) => !field.active).length ? (
                          fieldDrafts
                            .filter((field) => !field.active)
                            .map((field) => (
                              <div
                                key={field.id}
                                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div>
                                  <div className="text-sm font-medium text-slate-700">
                                    {getLocalizedTableFieldLabel(field, locale)}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {field.type === "number" ? t("formSetup.fieldTypeNumberFull") : t("formSetup.fieldTypeTextFull")}
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                                  <button
                                    type="button"
                                    className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                                    onClick={() => handleRestoreFieldDraft(field)}
                                  >
                                    {t("formSetup.restore")}
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                                    onClick={() => handlePurgeDeletedFieldDraft(field)}
                                  >
                                    {t("home.purgePermanent")}
                                  </button>
                                </div>
                              </div>
                            ))
                        ) : (
                          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                            {t("home.noDeleted")}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                      <p>{t("home.fmFooter1")}</p>
                      <p className="mt-2">{t("home.fmFooter2")}</p>
                      <p className="mt-2">{t("home.fmFooter3")}</p>
                    </div>

                    <button
                      type="button"
                      className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
                      onClick={() => void submitFieldDrafts()}
                      disabled={isSavingFieldConfig}
                    >
                      {isSavingFieldConfig ? t("home.saving") : t("home.saveFieldCfg")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {annotatingItem && annotationDraft ? (
          <TrainingAnnotationWorkbench
            open
            imageName={annotationImageName}
            imageSrc={annotationImageSrc}
            apiPathBuilder={withFormId}
            draftStorageKey={`orsight-training-annot-draft:v1:${currentFormId}:${annotationImageName}`}
            fieldDefinitions={activeTableFields}
            initialSeed={annotationDraft.seed}
            initialAnnotationMode={annotationDraft.annotationMode}
            initialTableFieldValues={annotationDraft.tableFieldValues}
            initialBoxes={annotationDraft.boxes}
            initialFieldAggregations={annotationDraft.fieldAggregations}
            initialNotes={annotationDraft.notes}
            initialField={setupFieldDefinition?.id || undefined}
            onClose={closeRecordPopup}
            onNotice={setNoticeMessage}
            onError={setErrorMessage}
            onSaved={async ({ totalExamples }) => {
              const ensured = annotationImageName ? await refreshTrainingStatusUntilImage(annotationImageName) : false;
              if (!ensured) {
                await loadTrainingStatus();
              }

              const uploadId = removeUploadAfterSaveRef.current;
              removeUploadAfterSaveRef.current = null;
              if (uploadId) {
                setUploads((current) => {
                  const next = current.filter((u) => u.id !== uploadId);
                  void savePersistedWorkbenchUploads(
                    currentFormId,
                    next.map((upload) => ({ id: upload.id, file: upload.file })),
                  );
                  return next;
                });
              }
            }}
          />
        ) : null}

        <RecognitionAgentDock formId={currentFormId} modeLabel={t("training.modeLabel")} />
      </div>
    </main>
  );
}

export default function TrainingMode() {
  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <TrainingModeContent />
    </Suspense>
  );
}
