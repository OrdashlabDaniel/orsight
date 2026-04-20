"use client";

import Image from "next/image";
import JSZip from "jszip";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import {
  TrainingAnnotationWorkbench,
  type AnnotationField,
  type AnnotationWorkbenchSeed,
  type FieldAggregation,
  type WorkbenchAnnotationBox,
} from "@/components/TrainingAnnotationWorkbench";
import { RecognitionAgentDock } from "@/components/RecognitionAgentDock";
import {
  type ExtractionIssue,
  type ExtractionResponse,
  type PodRecord,
  organizeRecords,
} from "@/lib/pod";
import {
  broadcastTableFieldsChanged,
  createCustomField,
  getActiveTableFields,
  getRecordFieldValue,
  hasRecordFieldValue,
  setRecordFieldValue,
  type TableFieldDefinition,
} from "@/lib/table-fields";
import { getLocalizedTableFieldLabel } from "@/lib/table-field-display";
import { DEFAULT_FORM_ID, buildFormTrainingHref, normalizeFormId } from "@/lib/forms";
import {
  clearWorkbenchSessionDraft,
  loadWorkbenchSessionDraft,
  saveWorkbenchSessionDraft,
} from "@/lib/workbench-session";
import {
  clearPersistedWorkbenchUploads,
  loadPersistedWorkbenchUploads,
  savePersistedWorkbenchUploads,
} from "@/lib/workbench-upload-store";
import { LoginLoadingFallback } from "@/app/login/LoginLoadingFallback";
import { useLocale } from "@/i18n/LocaleProvider";
import {
  ensureImageDataUrlFromSource,
  prepareWorkspaceUpload,
  SUPPORTED_WORKSPACE_UPLOAD_ACCEPT,
} from "@/lib/client-visual-upload";

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
};

function revokeUploadPreviewUrls(items: UploadItem[]) {
  items.forEach((upload) => {
    if (upload.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(upload.previewUrl);
    }
  });
}

type ConfirmedCorrectRecord = {
  recordId: string;
  sourceImageNames: string[];
  route: string;
};

type TrainingStatusItem = {
  imageName: string;
  labeled: boolean;
  example: {
    imageName: string;
    notes?: string;
    output: {
      date: string;
      route: string;
      driver: string;
      taskCode?: string;
      total: number;
      unscanned: number;
      exceptions: number | "";
      stationTeam?: string;
      customFieldValues?: Record<string, string | number | "">;
    };
    boxes?: WorkbenchAnnotationBox[];
  } | null;
};

type TrainingStatusResponse = {
  totalImages: number;
  labeledImages: number;
  unlabeledImages: number;
  items: TrainingStatusItem[];
};

type PopupPosition = {
  top: number;
  left: number;
  width: number;
};

type ViewerPan = {
  x: number;
  y: number;
};

type ViewerDragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type FieldManagerOffset = {
  x: number;
  y: number;
};

type FieldManagerDragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type SaveFilePickerHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type WindowWithSavePicker = Window &
  typeof globalThis & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<SaveFilePickerHandle>;
  };

const EXTRACTION_BATCH_SIZE = 5;
const SOURCE_FILTER_COLUMN_ID = "__source__";
const EMPTY_COLUMN_FILTER_VALUE = "__orsight_empty__";

/** Stable map key when a record has no route (UI label comes from `home.ungrouped`). */
const UNGROUPED_ROUTE_KEY = "__orsight_ungrouped__";

type FilterableColumnDefinition = {
  id: string;
  label: string;
  type: TableFieldDefinition["type"];
};

type ColumnFilterOption = {
  value: string;
  label: string;
  count: number;
};

function podRecordToAnnotationSeed(record: PodRecord): AnnotationWorkbenchSeed {
  return {
    date: record.date ?? "",
    route: record.route ?? "",
    driver: record.driver ?? "",
    taskCode: record.taskCode ?? "",
    total: record.total ?? "",
    unscanned: record.unscanned ?? "",
    exceptions: record.exceptions ?? "",
    waybillStatus: record.waybillStatus ?? "",
    stationTeam: record.stationTeam ?? "",
    totalSourceLabel: record.totalSourceLabel ?? "",
    customFieldValues: { ...(record.customFieldValues || {}) },
  };
}

function buildExportRows(records: PodRecord[], fields: TableFieldDefinition[]) {
  return records.map((record) => fields.map((field) => getRecordFieldValue(record, field)));
}

function normalizeColumnFilterValue(value: string | number | "" | null | undefined) {
  return value == null ? "" : String(value).trim();
}

function getFilterableColumnValue(
  record: PodRecord,
  columnId: string,
  fieldMap: ReadonlyMap<string, TableFieldDefinition>,
) {
  if (columnId === SOURCE_FILTER_COLUMN_ID) {
    return normalizeColumnFilterValue(record.imageName);
  }

  const field = fieldMap.get(columnId);
  if (!field) {
    return "";
  }

  return normalizeColumnFilterValue(getRecordFieldValue(record, field));
}

function matchesColumnFilterValue(
  record: PodRecord,
  columnId: string,
  selectedValue: string,
  fieldMap: ReadonlyMap<string, TableFieldDefinition>,
) {
  const currentValue = getFilterableColumnValue(record, columnId, fieldMap);
  if (selectedValue === EMPTY_COLUMN_FILTER_VALUE) {
    return currentValue === "";
  }
  return currentValue === selectedValue;
}

function formatDateForFilename(rawDate: string | undefined, dataSuffix: string) {
  if (!rawDate) {
    return dataSuffix;
  }

  const normalized = rawDate.trim();
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}_${dataSuffix}`;
  }

  const dashMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dashMatch) {
    const [, year, month, day] = dashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}_${dataSuffix}`;
  }

  return `${normalized.replace(/[\\/:*?"<>|]/g, "-")}_${dataSuffix}`;
}

function formatTimestampForFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}`;
}

function buildArchiveEntryName(fileName: string, index: number) {
  const safeName = (fileName || "upload").replace(/[\\/:*?"<>|]/g, "-");
  return `${String(index + 1).padStart(2, "0")}-${safeName}`;
}

const ISSUE_CODE_FIELD_REQUIREMENTS: Record<string, string[]> = {
  missing_task_code: ["taskCode"],
  invalid_task_code: ["taskCode"],
  total_source_missing: ["total"],
  total_filled_from_expected: ["total"],
  total_corrected_from_expected: ["total"],
  expected_count_unreadable: ["total"],
  total_matches_wrong_counter: ["total"],
  unscanned_filled_from_counters: ["unscanned"],
  unscanned_corrected_from_counters: ["unscanned"],
  unscanned_exceeds_total: ["total", "unscanned"],
  exceptions_exceeds_total: ["total", "exceptions"],
};

const ISSUE_MESSAGE_FIELD_REQUIREMENTS: Array<{ fields: string[]; patterns: string[] }> = [
  { fields: ["route"], patterns: ["缺少抽查路线", "路线格式异常"] },
  { fields: ["route", "stationTeam"], patterns: ["抽查路线与站点车队相同"] },
  { fields: ["stationTeam"], patterns: ["站点车队字段格式异常"] },
  { fields: ["driver"], patterns: ["缺少司机姓名"] },
  { fields: ["taskCode"], patterns: ["任务编码"] },
  { fields: ["total"], patterns: ["缺少运单数量", "运单数量来源", "运单数量不能自动确认", "应领件数区域"] },
  { fields: ["unscanned"], patterns: ["缺少未收数量"] },
  { fields: ["exceptions"], patterns: ["错扫数量"] },
];

function issueMatchesActiveBuiltInFields(issue: ExtractionIssue, activeBuiltInFieldIds: ReadonlySet<string>) {
  const requiredFields =
    (issue.code && ISSUE_CODE_FIELD_REQUIREMENTS[issue.code]) ||
    ISSUE_MESSAGE_FIELD_REQUIREMENTS.find((entry) =>
      entry.patterns.some((pattern) => issue.message.includes(pattern)),
    )?.fields;

  if (!requiredFields || requiredFields.length === 0) {
    return true;
  }

  return requiredFields.every((fieldId) => activeBuiltInFieldIds.has(fieldId));
}

function HomeContent() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const primaryModelName = "gpt-5-mini";
  const reviewModelName = "gpt-5";
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

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);
  const [records, setRecords] = useState<PodRecord[]>([]);
  const [issues, setIssues] = useState<ExtractionIssue[]>([]);
  const [confirmedCorrectRecords, setConfirmedCorrectRecords] = useState<ConfirmedCorrectRecord[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isHighQualityReextracting, setIsHighQualityReextracting] = useState(false);
  const [isRetryingReviewAll, setIsRetryingReviewAll] = useState(false);
  const [isExportingUploads, setIsExportingUploads] = useState(false);
  const [retryingKeys, setRetryingKeys] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [trainingExamplesLoaded, setTrainingExamplesLoaded] = useState(0);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [annotatingRecord, setAnnotatingRecord] = useState<PodRecord | null>(null);
  const [annotationImageSrc, setAnnotationImageSrc] = useState("");
  const [annotationImageName, setAnnotationImageName] = useState("");
  const [annotationDraft, setAnnotationDraft] = useState<{
    seed: AnnotationWorkbenchSeed;
    boxes: WorkbenchAnnotationBox[];
    fieldAggregations: Partial<Record<AnnotationField, FieldAggregation>>;
    notes: string;
  } | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [viewingRecord, setViewingRecord] = useState<PodRecord | null>(null);
  /** 查看图片弹窗：支持跨图合并等多张源图 */
  const [viewerGallery, setViewerGallery] = useState<Array<{ name: string; src: string }>>([]);
  const [viewerGalleryLoading, setViewerGalleryLoading] = useState(false);
  const [viewerPopupPosition, setViewerPopupPosition] = useState<PopupPosition | null>(null);
  const [viewerScale, setViewerScale] = useState(1);
  const [viewerPan, setViewerPan] = useState<ViewerPan>({ x: 0, y: 0 });
  const [viewerDragState, setViewerDragState] = useState<ViewerDragState | null>(null);
  const [viewerLoadError, setViewerLoadError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [tableFields, setTableFields] = useState<TableFieldDefinition[]>([]);
  const [isFieldManagerOpen, setIsFieldManagerOpen] = useState(false);
  const [fieldDrafts, setFieldDrafts] = useState<TableFieldDefinition[]>([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "number">("text");
  const [isSavingFieldConfig, setIsSavingFieldConfig] = useState(false);
  const [fieldManagerOffset, setFieldManagerOffset] = useState<FieldManagerOffset>({ x: 0, y: 0 });
  const [fieldManagerDragState, setFieldManagerDragState] = useState<FieldManagerDragState | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const viewerAnchorRef = useRef<HTMLElement | null>(null);
  const uploadPanelRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const splitResultsRef = useRef<HTMLDivElement | null>(null);
  const columnDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const rowDragRef = useRef<{ startY: number; startHeight: number; shellHeight: number } | null>(null);
  const uploadPanelWidthRef = useRef(380);
  const remindersPanelHeightRef = useRef(160);
  const prevWorkbenchFormIdRef = useRef<string | null>(null);
  const uploadRestoreRequestIdRef = useRef(0);
  const skipNextWorkbenchSessionSaveRef = useRef(true);

  const UPLOAD_PANEL_WIDTH_KEY = "orsight-home-upload-width";
  const RESULTS_REMINDERS_HEIGHT_KEY = "orsight-home-results-reminders-height";
  const [uploadPanelWidthPx, setUploadPanelWidthPx] = useState(380);
  const [remindersPanelHeightPx, setRemindersPanelHeightPx] = useState(160);
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);

  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  useEffect(() => {
    return () => {
      revokeUploadPreviewUrls(uploadsRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectedUploadIds((current) => current.filter((id) => uploads.some((upload) => upload.id === id)));
  }, [uploads]);

  useEffect(() => {
    uploadPanelWidthRef.current = uploadPanelWidthPx;
  }, [uploadPanelWidthPx]);

  useEffect(() => {
    remindersPanelHeightRef.current = remindersPanelHeightPx;
  }, [remindersPanelHeightPx]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(UPLOAD_PANEL_WIDTH_KEY);
      const n = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(n)) {
        setUploadPanelWidthPx(Math.min(640, Math.max(260, n)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RESULTS_REMINDERS_HEIGHT_KEY);
      const n = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(n)) {
        setRemindersPanelHeightPx(Math.min(480, Math.max(96, n)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktopLayout(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const col = columnDragRef.current;
      if (col) {
        const deltaX = event.clientX - col.startX;
        const w = Math.min(640, Math.max(260, col.startWidth + deltaX));
        uploadPanelWidthRef.current = w;
        setUploadPanelWidthPx(w);
      }
      const row = rowDragRef.current;
      if (row) {
        const splitter = 12;
        const minTable = 120;
        const maxRem = Math.max(96, row.shellHeight - splitter - minTable);
        const deltaY = event.clientY - row.startY;
        const h = Math.min(maxRem, Math.max(96, row.startHeight + deltaY));
        remindersPanelHeightRef.current = h;
        setRemindersPanelHeightPx(h);
      }
    }
    function onUp() {
      if (columnDragRef.current) {
        columnDragRef.current = null;
        try {
          localStorage.setItem(UPLOAD_PANEL_WIDTH_KEY, String(uploadPanelWidthRef.current));
        } catch {
          /* ignore */
        }
      }
      if (rowDragRef.current) {
        rowDragRef.current = null;
        try {
          localStorage.setItem(RESULTS_REMINDERS_HEIGHT_KEY, String(remindersPanelHeightRef.current));
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

  function beginWorkspaceColumnResize(event: React.PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    columnDragRef.current = { startX: event.clientX, startWidth: uploadPanelWidthPx };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function beginRemindersTableResize(event: React.PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = splitResultsRef.current?.getBoundingClientRect();
    const fallback = Math.min(Math.max(window.innerHeight * 0.68, 360), 880);
    const shellHeight = rect && rect.height > 48 ? rect.height : fallback;
    rowDragRef.current = { startY: event.clientY, startHeight: remindersPanelHeightPx, shellHeight };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function setColumnFilterValue(columnId: string, nextValue: string) {
    setColumnFilters((current) => {
      if (!nextValue) {
        if (!(columnId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[columnId];
        return next;
      }
      if (current[columnId] === nextValue) {
        return current;
      }
      return { ...current, [columnId]: nextValue };
    });
  }

  function clearAllColumnFilters() {
    setColumnFilters((current) => {
      if (!Object.keys(current).length) {
        return current;
      }
      return {};
    });
  }

  useEffect(() => {
    void loadTableFieldConfig();
  }, [currentFormId]);

  useEffect(() => {
    void loadTrainingStatus();
  }, [currentFormId]);

  useEffect(() => {
    let cancelled = false;
    const requestId = uploadRestoreRequestIdRef.current + 1;
    uploadRestoreRequestIdRef.current = requestId;

    void loadPersistedWorkbenchUploads(currentFormId)
      .then((restoredUploads) => {
        if (cancelled || uploadRestoreRequestIdRef.current !== requestId) {
          revokeUploadPreviewUrls(restoredUploads);
          return;
        }
        uploadsRef.current = restoredUploads;
        setUploads(restoredUploads);
        setSelectedUploadId((current) =>
          current && restoredUploads.some((upload) => upload.id === current)
            ? current
            : restoredUploads[0]?.id ?? null,
        );
      })
      .catch(() => {
        if (!cancelled && uploadRestoreRequestIdRef.current === requestId) {
          uploadsRef.current = [];
          setUploads([]);
          setSelectedUploadId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentFormId]);

  useLayoutEffect(() => {
    const prev = prevWorkbenchFormIdRef.current;
    const switchedForm = prev !== null && prev !== currentFormId;

    if (switchedForm) {
      revokeUploadPreviewUrls(uploadsRef.current);
      uploadsRef.current = [];
      setRecords([]);
      setIssues([]);
      setConfirmedCorrectRecords([]);
      setTrainingExamplesLoaded(0);
      setColumnFilters({});
      setSelectedUploadId(null);
      setUploads([]);
      setNoticeMessage("");
      setErrorMessage("");
      closeRecordPopup();
      closeViewerPopup();
    }

    skipNextWorkbenchSessionSaveRef.current = true;
    const draft = loadWorkbenchSessionDraft(currentFormId);
    if (draft && (switchedForm || prev === null)) {
      setRecords(draft.records);
      setIssues(draft.issues);
      setConfirmedCorrectRecords(draft.confirmedCorrectRecords);
      setColumnFilters(draft.columnFilters);
      setTrainingExamplesLoaded(draft.trainingExamplesLoaded);
      setSelectedUploadId(draft.selectedUploadId || null);
    }

    prevWorkbenchFormIdRef.current = currentFormId;
  }, [currentFormId]);

  useEffect(() => {
    if (skipNextWorkbenchSessionSaveRef.current) {
      skipNextWorkbenchSessionSaveRef.current = false;
      return;
    }
    const formId = currentFormId;
    const handle = window.setTimeout(() => {
      const hasContent =
        records.length > 0 ||
        issues.length > 0 ||
        confirmedCorrectRecords.length > 0 ||
        Object.keys(columnFilters).length > 0;
      if (hasContent) {
        saveWorkbenchSessionDraft(formId, {
          v: 1,
          records,
          issues,
          confirmedCorrectRecords,
          columnFilters,
          trainingExamplesLoaded,
          selectedUploadId,
        });
      } else {
        clearWorkbenchSessionDraft(formId);
      }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [
    records,
    issues,
    confirmedCorrectRecords,
    columnFilters,
    trainingExamplesLoaded,
    selectedUploadId,
    currentFormId,
  ]);

  useEffect(() => {
    const existingIds = new Set(records.map((record) => record.id));
    setConfirmedCorrectRecords((current) => current.filter((item) => existingIds.has(item.recordId)));
  }, [records]);

  useEffect(() => {
    if (!viewingRecord) {
      return;
    }

    const updateViewerPopupPosition = () => {
      const anchor = uploadPanelRef.current ?? viewerAnchorRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const popupWidth = Math.max(320, rect.width - 16);
      const left = Math.max(8, rect.left + 8);
      const top = Math.max(16, rect.top + 8);
      setViewerPopupPosition({ top, left, width: popupWidth });
    };

    updateViewerPopupPosition();
    window.addEventListener("resize", updateViewerPopupPosition);
    window.addEventListener("scroll", updateViewerPopupPosition, true);

    return () => {
      window.removeEventListener("resize", updateViewerPopupPosition);
      window.removeEventListener("scroll", updateViewerPopupPosition, true);
    };
  }, [viewingRecord]);

  useEffect(() => {
    if (!fieldManagerDragState) {
      return;
    }
    const dragState = fieldManagerDragState;

    function handleMouseMove(event: MouseEvent) {
      setFieldManagerOffset({
        x: dragState.originX + (event.clientX - dragState.startX),
        y: dragState.originY + (event.clientY - dragState.startY),
      });
    }

    function handleMouseUp() {
      setFieldManagerDragState(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [fieldManagerDragState]);

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

  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === selectedUploadId) || uploads[0] || null,
    [selectedUploadId, uploads],
  );
  const selectedUploads = useMemo(
    () => uploads.filter((upload) => selectedUploadIds.includes(upload.id)),
    [selectedUploadIds, uploads],
  );
  const allUploadsSelected = uploads.length > 0 && selectedUploadIds.length === uploads.length;
  const activeTableFields = useMemo(() => getActiveTableFields(tableFields), [tableFields]);
  const activeBuiltInFieldIds = useMemo(
    () => new Set(activeTableFields.filter((field) => field.builtIn).map((field) => field.id)),
    [activeTableFields],
  );
  const activeFieldMap = useMemo(
    () => new Map(activeTableFields.map((field) => [field.id, field])),
    [activeTableFields],
  );
  const routeFieldActive = useMemo(
    () => activeBuiltInFieldIds.has("route"),
    [activeBuiltInFieldIds],
  );
  const filterableColumns = useMemo<FilterableColumnDefinition[]>(
    () => [
      { id: SOURCE_FILTER_COLUMN_ID, label: t("home.sourceCol"), type: "text" },
      ...activeTableFields.map((field) => ({
        id: field.id,
        label: getLocalizedTableFieldLabel(field, locale),
        type: field.type,
      })),
    ],
    [activeTableFields, locale, t],
  );
  const tableHeaders = useMemo(
    () => activeTableFields.map((field) => getLocalizedTableFieldLabel(field, locale)),
    [activeTableFields, locale],
  );

  useEffect(() => {
    const allowedIds = new Set([SOURCE_FILTER_COLUMN_ID, ...activeTableFields.map((field) => field.id)]);
    setColumnFilters((current) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [id, value] of Object.entries(current)) {
        if (allowedIds.has(id) && value) {
          next[id] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeTableFields]);

  const organizedRecordsResult = useMemo(() => organizeRecords(records), [records]);
  const activeColumnFilterEntries = useMemo(
    () => Object.entries(columnFilters).filter(([, value]) => value),
    [columnFilters],
  );
  const hasActiveColumnFilters = activeColumnFilterEntries.length > 0;

  const filteredRecordsResult = useMemo(() => {
    if (!activeColumnFilterEntries.length) {
      return organizedRecordsResult;
    }
    const filtered = organizedRecordsResult.records.filter((record) =>
      activeColumnFilterEntries.every(([columnId, selectedValue]) =>
        matchesColumnFilterValue(record, columnId, selectedValue, activeFieldMap),
      ),
    );
    return {
      records: filtered,
      duplicateCount: organizedRecordsResult.duplicateCount,
    };
  }, [organizedRecordsResult, activeColumnFilterEntries, activeFieldMap]);

  const columnFilterOptions = useMemo<Record<string, ColumnFilterOption[]>>(() => {
    const collator = new Intl.Collator(locale === "en" ? "en-US" : "zh-CN", {
      numeric: true,
      sensitivity: "base",
    });
    const next: Record<string, ColumnFilterOption[]> = {};

    for (const column of filterableColumns) {
      const counts = new Map<string, number>();
      for (const record of organizedRecordsResult.records) {
        const matchesOtherFilters = activeColumnFilterEntries.every(
          ([otherColumnId, selectedValue]) =>
            otherColumnId === column.id ||
            matchesColumnFilterValue(record, otherColumnId, selectedValue, activeFieldMap),
        );
        if (!matchesOtherFilters) {
          continue;
        }

        const rawValue = getFilterableColumnValue(record, column.id, activeFieldMap);
        const optionValue = rawValue === "" ? EMPTY_COLUMN_FILTER_VALUE : rawValue;
        counts.set(optionValue, (counts.get(optionValue) ?? 0) + 1);
      }

      const selectedValue = columnFilters[column.id];
      if (selectedValue && !counts.has(selectedValue)) {
        counts.set(selectedValue, 0);
      }

      next[column.id] = Array.from(counts.entries())
        .sort(([a], [b]) => {
          if (a === EMPTY_COLUMN_FILTER_VALUE) {
            return 1;
          }
          if (b === EMPTY_COLUMN_FILTER_VALUE) {
            return -1;
          }
          if (column.type === "number") {
            const aNum = Number(a);
            const bNum = Number(b);
            if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) {
              return aNum - bNum;
            }
          }
          return collator.compare(a, b);
        })
        .map(([value, count]) => ({
          value,
          label: value === EMPTY_COLUMN_FILTER_VALUE ? t("home.filterBlank") : value,
          count,
        }));
    }

    return next;
  }, [
    activeColumnFilterEntries,
    activeFieldMap,
    columnFilters,
    filterableColumns,
    locale,
    organizedRecordsResult.records,
    t,
  ]);

  const groupedRecords = useMemo(() => {
    if (!routeFieldActive) {
      return [["__all__", filteredRecordsResult.records] as [string, PodRecord[]]];
    }
    const groups = new Map<string, PodRecord[]>();
    for (const record of filteredRecordsResult.records) {
      const routeKey = record.route || UNGROUPED_ROUTE_KEY;
      const existing = groups.get(routeKey) || [];
      existing.push(record);
      groups.set(routeKey, existing);
    }
    return Array.from(groups.entries());
  }, [filteredRecordsResult.records, routeFieldActive]);
  const activePopupRecordId = viewingRecord?.id || annotatingRecord?.id || null;
  function getSourceImageNames(record: PodRecord) {
    return record.imageName
      .split(" | ")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  function issueMatchesRecord(issue: ExtractionIssue, record: PodRecord) {
    const sourceImageNames = getSourceImageNames(record);
    if (!sourceImageNames.includes(issue.imageName)) {
      return false;
    }
    if (record.route) {
      return issue.route === record.route;
    }
    return !issue.route;
  }

  function issueMatchesConfirmedRecord(issue: ExtractionIssue, confirmed: ConfirmedCorrectRecord) {
    if (!confirmed.sourceImageNames.includes(issue.imageName)) {
      return false;
    }
    if (confirmed.route) {
      return issue.route === confirmed.route;
    }
    return !issue.route;
  }

  function isRecordConfirmedCorrect(record: PodRecord) {
    return confirmedCorrectRecords.some((item) => item.recordId === record.id);
  }

  const visibleIssues = useMemo(
    () =>
      issues.filter(
        (issue) =>
          issueMatchesActiveBuiltInFields(issue, activeBuiltInFieldIds) &&
          !confirmedCorrectRecords.some((confirmed) => issueMatchesConfirmedRecord(issue, confirmed)),
      ),
    [issues, confirmedCorrectRecords, activeBuiltInFieldIds],
  );

  const reviewRecords = useMemo(
    () =>
      organizedRecordsResult.records.filter((record) => {
        if (isRecordConfirmedCorrect(record)) {
          return false;
        }
        if (record.reviewRequired) {
          return true;
        }
        return visibleIssues.some((issue) => issue.level === "error" && issueMatchesRecord(issue, record));
      }),
    [organizedRecordsResult.records, visibleIssues, confirmedCorrectRecords],
  );

  const totalWarnings = visibleIssues.filter((issue) => issue.level === "warning").length;

  /** 业务键相同的多张图被合并为一条时，用于高亮该行（兼容仅有 imageName 拼接的旧数据） */
  function isCrossImageMergedRow(record: PodRecord) {
    if (record.mergedSourceCount != null && record.mergedSourceCount > 1) return true;
    return getSourceImageNames(record).length > 1;
  }

  function mergedSourceImageCount(record: PodRecord) {
    if (record.mergedSourceCount != null && record.mergedSourceCount > 1) return record.mergedSourceCount;
    const n = getSourceImageNames(record).length;
    return n > 1 ? n : 0;
  }

  function getSourceRecordIds(record: PodRecord) {
    return record.sourceRecordIds?.length ? record.sourceRecordIds : [record.id];
  }

  function getRecordIssues(record: PodRecord) {
    if (isRecordConfirmedCorrect(record)) {
      return [];
    }
    return visibleIssues.filter((issue) => issueMatchesRecord(issue, record));
  }

  function hasConsistencyMismatch(record: PodRecord) {
    return getRecordIssues(record).some((issue) => issue.code === "consistency_mismatch");
  }

  function getConsistencyRatio(record: PodRecord) {
    if (
      typeof record.consistencyMatchedAttempts === "number" &&
      typeof record.consistencyTotalAttempts === "number" &&
      record.consistencyTotalAttempts > 0
    ) {
      return `${record.consistencyMatchedAttempts}/${record.consistencyTotalAttempts}`;
    }
    return null;
  }

  function hasTotalSourceMismatch(record: PodRecord) {
    return getRecordIssues(record).some(
      (issue) =>
        issue.code === "total_source_mismatch" ||
        issue.code === "total_source_missing" ||
        issue.code === "expected_count_unreadable" ||
        issue.code === "total_conflicts_expected" ||
        issue.code === "total_matches_wrong_counter",
    );
  }

  function needsManualAnnotation(record: PodRecord) {
    if (isRecordConfirmedCorrect(record)) {
      return false;
    }
    return record.reviewRequired || getRecordIssues(record).length > 0;
  }

  /** 与「待复核」徽章对齐：服务端校验错误也应提示人工复核；缺任务编码等为警告时也提示该行 */
  function recordNeedsReviewBadge(record: PodRecord) {
    if (isRecordConfirmedCorrect(record)) {
      return false;
    }
    return (
      record.reviewRequired ||
      getRecordIssues(record).some(
        (issue) => issue.level === "error" || issue.code === "missing_task_code",
      )
    );
  }

  function closeRecordPopup() {
    setAnnotatingRecord(null);
    setAnnotationImageName("");
    setAnnotationImageSrc("");
    setAnnotationDraft(null);
  }

  function closeViewerPopup() {
    setViewingRecord(null);
    setViewerGallery([]);
    setViewerGalleryLoading(false);
    setViewerPopupPosition(null);
    setViewerScale(1);
    setViewerPan({ x: 0, y: 0 });
    setViewerDragState(null);
    setViewerLoadError("");
    viewerAnchorRef.current = null;
  }

  function resolveRowAnchor(element?: HTMLElement | null) {
    return (element?.closest("tr") as HTMLElement | null) || element || null;
  }

  function calculatePopupPosition(anchor: HTMLElement): PopupPosition {
    const rect = anchor.getBoundingClientRect();
    const desiredWidth = 420;
    const desiredHeight = 620;
    const minWidth = 260;
    const leftSideAvailable = Math.max(minWidth, rect.left - 24);
    const width = Math.max(minWidth, Math.min(desiredWidth, leftSideAvailable));
    const left = Math.max(16, rect.left - width - 12);
    const top = Math.max(16, Math.min(rect.top, window.innerHeight - desiredHeight - 16));
    return { top, left, width };
  }

  async function loadTableFieldConfig() {
    try {
      const response = await fetch(withFormId("/api/table-fields"));
      const payload = (await response.json()) as { error?: string; tableFields?: TableFieldDefinition[] };
      if (!response.ok) {
        throw new Error(payload.error || t("home.errTableCfg"));
      }
      const nextFields = Array.isArray(payload.tableFields) ? payload.tableFields : [];
      setTableFields(nextFields);
      setFieldDrafts(nextFields);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errTableCfg"));
    }
  }

  async function loadTrainingStatus() {
    try {
      const response = await fetch(withFormId("/api/training/status"));
      const payload = (await response.json()) as TrainingStatusResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || t("home.errTrainStatus"));
      }
      setTrainingStatus(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errTrainStatus"));
    }
  }

  async function requestExtraction(
    files: File[],
    mode: "primary" | "review" = "primary",
  ): Promise<ExtractionResponse> {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("mode", mode);
    formData.append("formId", currentFormId);

    const response = await fetch("/api/extract", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json()) as ExtractionResponse & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || t("home.errExtract"));
    }

    return payload;
  }

  async function runParallelExtraction(
    files: File[],
    concurrency = 3,
    mode: "primary" | "review" = "primary",
  ): Promise<ExtractionResponse> {
    const allRecords: PodRecord[] = [];
    const allIssues: ExtractionIssue[] = [];
    let loadedTrainingExamples = 0;
    const batches = Array.from(
      { length: Math.ceil(files.length / EXTRACTION_BATCH_SIZE) },
      (_, index) => files.slice(index * EXTRACTION_BATCH_SIZE, (index + 1) * EXTRACTION_BATCH_SIZE),
    ).filter((batch) => batch.length > 0);
    let currentBatchIndex = 0;

    setProgress({ completed: 0, total: files.length });

    async function worker() {
      while (currentBatchIndex < batches.length) {
        const batchIndex = currentBatchIndex;
        currentBatchIndex += 1;
        const batch = batches[batchIndex];

        try {
          const payload = await requestExtraction(batch, mode);
          allRecords.push(...(payload.records || []));
          allIssues.push(...(payload.issues || []));
          loadedTrainingExamples = Math.max(loadedTrainingExamples, payload.trainingExamplesLoaded || 0);
        } catch (error) {
          batch.forEach((file) => {
            allIssues.push({
              imageName: file.name,
              level: "error",
              message: error instanceof Error ? error.message : t("home.errExtractFail"),
            });
          });
        } finally {
          setProgress((current) =>
            current
              ? {
                  ...current,
                  completed: Math.min(current.completed + batch.length, current.total),
                }
              : current,
          );
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => worker()));

    return {
      records: allRecords,
      issues: allIssues,
      modelUsed: mode === "review" ? reviewModelName : primaryModelName,
      trainingExamplesLoaded: loadedTrainingExamples,
      mode,
    };
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList?.length) {
      return;
    }
    uploadRestoreRequestIdRef.current += 1;

    try {
      const nextUploads = await Promise.all(
        Array.from(fileList).map(async (file, index) => {
          const prepared = await prepareWorkspaceUpload(file);
          return {
            id: `${prepared.file.name}-${prepared.file.lastModified}-${index}-${Date.now()}`,
            file: prepared.file,
            previewUrl: prepared.previewUrl,
          };
        })
      );

      const merged = [...uploadsRef.current, ...nextUploads];
      uploadsRef.current = merged;
      setUploads(merged);
      setSelectedUploadId((currentId) => {
        if (currentId && merged.some((upload) => upload.id === currentId)) {
          return currentId;
        }
        return merged[0]?.id ?? null;
      });
      void savePersistedWorkbenchUploads(
        currentFormId,
        merged.map((upload) => ({ id: upload.id, file: upload.file })),
      );
      setNoticeMessage(t("home.noticeAdded", { n: nextUploads.length }));
      setErrorMessage("");
    } catch {
      setErrorMessage(t("home.errReadFile"));
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

  function toggleUploadSelected(uploadId: string) {
    setSelectedUploadIds((current) =>
      current.includes(uploadId) ? current.filter((id) => id !== uploadId) : [...current, uploadId],
    );
  }

  function toggleSelectAllUploads() {
    setSelectedUploadIds((current) => (current.length === uploads.length ? [] : uploads.map((upload) => upload.id)));
  }

  function clearAll() {
    uploadRestoreRequestIdRef.current += 1;
    revokeUploadPreviewUrls(uploadsRef.current);
    uploadsRef.current = [];
    clearWorkbenchSessionDraft(currentFormId);
    void clearPersistedWorkbenchUploads(currentFormId);
    setUploads([]);
    setSelectedUploadIds([]);
    setSelectedUploadId(null);
    setRecords([]);
    setIssues([]);
    setConfirmedCorrectRecords([]);
    setTrainingExamplesLoaded(0);
    setErrorMessage("");
    setNoticeMessage(t("home.cleared"));
  }

  async function downloadSelectedUploads() {
    if (!selectedUploads.length) {
      setErrorMessage(t("home.errNoUploadSelected"));
      return;
    }

    setIsExportingUploads(true);
    setErrorMessage("");
    setNoticeMessage("");

    const filename = `orsight-uploads-${formatTimestampForFilename()}.zip`;

    try {
      const zip = new JSZip();
      for (const [index, upload] of selectedUploads.entries()) {
        zip.file(buildArchiveEntryName(upload.file.name, index), await upload.file.arrayBuffer());
      }

      const archiveBlob = await zip.generateAsync({ type: "blob" });

      try {
        const pickerWindow = window as WindowWithSavePicker;
        if (typeof pickerWindow.showSaveFilePicker === "function") {
          const handle = await pickerWindow.showSaveFilePicker({
            suggestedName: filename,
            types: [
              {
                description: t("home.uploadArchive"),
                accept: {
                  "application/zip": [".zip"],
                },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(archiveBlob);
          await writable.close();
          setNoticeMessage(t("home.uploadArchiveSaved", { name: filename }));
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("abort")) {
          setNoticeMessage(t("home.uploadArchiveCancelled"));
          return;
        }
      }

      const downloadUrl = URL.createObjectURL(archiveBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setNoticeMessage(t("home.uploadArchiveDownloaded", { name: filename }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errDownloadUploads"));
    } finally {
      setIsExportingUploads(false);
    }
  }

  function openFieldManager() {
    setFieldDrafts(tableFields.map((field) => ({ ...field })));
    setNewFieldName("");
    setNewFieldType("text");
    setFieldManagerOffset({ x: 0, y: 0 });
    setFieldManagerDragState(null);
    setIsFieldManagerOpen(true);
  }

  function beginFieldManagerDrag(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button, input, select, textarea, label")) {
      return;
    }
    event.preventDefault();
    setFieldManagerDragState({
      startX: event.clientX,
      startY: event.clientY,
      originX: fieldManagerOffset.x,
      originY: fieldManagerOffset.y,
    });
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
    setFieldDrafts(saved);
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
        throw new Error(
          t("home.errDupField", { a: label, b: String(normalizedLabels.get(key)) }),
        );
      }
      normalizedLabels.set(key, label);
    }

    return fields.map((field) => ({
      ...field,
      label: field.label.trim(),
    }));
  }

  function handleDeleteFieldDraft(field: TableFieldDefinition) {
    const hasCurrentValues = records.some((record) => hasRecordFieldValue(record, field));
    const message = hasCurrentValues
      ? t("home.confirmDeleteFieldWithData", { label: getLocalizedTableFieldLabel(field, locale) })
      : t("home.confirmDeleteField", { label: getLocalizedTableFieldLabel(field, locale) });
    if (!window.confirm(message)) {
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
      setIsFieldManagerOpen(false);
      setNoticeMessage(t("home.noticeFieldsUpdated"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errSaveFields"));
    } finally {
      setIsSavingFieldConfig(false);
    }
  }

  async function reextractAllWithHigherModel() {
    if (!uploads.length) {
      setErrorMessage(t("home.errNoUpload"));
      return;
    }

    setIsHighQualityReextracting(true);
    setErrorMessage("");
    setNoticeMessage("");
    setSelectedUploadId(uploads[0]?.id ?? null);

    try {
      const payload = await runParallelExtraction(
        uploads.map((upload) => upload.file),
        3,
        "review",
      );

      setRecords(payload.records || []);
      setIssues(payload.issues || []);
      setConfirmedCorrectRecords([]);
      setTrainingExamplesLoaded(payload.trainingExamplesLoaded || 0);
      const organized = organizeRecords(payload.records || []);
      const dedupeMessage =
        organized.duplicateCount > 0 ? t("home.dedupe", { n: organized.duplicateCount }) : "";
      setNoticeMessage(
        t("home.noticeExtractHighQualityDone", {
          n: organized.records.length,
          dedupe: dedupeMessage,
          model: payload.modelUsed || reviewModelName,
        }),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errExtractFail"));
    } finally {
      setIsHighQualityReextracting(false);
      setProgress(null);
    }
  }

  async function createFieldAndStartTraining() {
    const label = newFieldName.trim();
    if (!label) {
      setErrorMessage(t("home.errNewName"));
      return;
    }
    if (
      fieldDrafts.some(
        (field) =>
          field.active &&
          field.label.trim().toLocaleLowerCase(locale === "en" ? "en-US" : "zh-CN") ===
            label.toLocaleLowerCase(locale === "en" ? "en-US" : "zh-CN"),
      )
    ) {
      setErrorMessage(t("home.errDupName"));
      return;
    }

    const nextField = {
      ...createCustomField(label),
      type: newFieldType,
    };
    const nextFields = [...fieldDrafts, nextField];
    setIsSavingFieldConfig(true);
    setErrorMessage("");
    try {
      const validatedFields = validateFieldDrafts(nextFields);
      await saveFieldConfig(validatedFields);
      setIsFieldManagerOpen(false);
                      const params = new URLSearchParams();
                      if (currentFormId !== DEFAULT_FORM_ID) {
                        params.set("formId", currentFormId);
                      }
                      params.set("setupField", nextField.id);
                      params.set("source", "fill");
                      router.push(`/training?${params.toString()}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errAddField"));
    } finally {
      setIsSavingFieldConfig(false);
    }
  }

  async function extractData() {
    if (!uploads.length) {
      setErrorMessage(t("home.errNoUpload"));
      return;
    }

    setIsExtracting(true);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      const payload = await runParallelExtraction(
        uploads.map((upload) => upload.file),
        3,
        "primary",
      );

      setRecords(payload.records || []);
      setIssues(payload.issues || []);
      setConfirmedCorrectRecords([]);
      setTrainingExamplesLoaded(payload.trainingExamplesLoaded || 0);
      const organized = organizeRecords(payload.records || []);
      const dedupeMessage =
        organized.duplicateCount > 0 ? t("home.dedupe", { n: organized.duplicateCount }) : "";
      setNoticeMessage(
        t("home.noticeExtractDone", {
          n: organized.records.length,
          dedupe: dedupeMessage,
          model: payload.modelUsed || primaryModelName,
        }),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errExtractFail"));
    } finally {
      setIsExtracting(false);
      setProgress(null);
    }
  }

  async function retryRecord(record: PodRecord) {
    const sourceImageNames = getSourceImageNames(record);
    const matchedUploads = uploads.filter((upload) => sourceImageNames.includes(upload.file.name));

    if (!matchedUploads.length) {
      setErrorMessage(t("home.errNoImageForRow"));
      return;
    }

    setRetryingKeys((current) => [...current, record.id]);
    setErrorMessage("");
    setNoticeMessage("");
    setSelectedUploadId(matchedUploads[0].id);

    try {
      const payload = await requestExtraction(
        matchedUploads.map((upload) => upload.file),
        "review",
      );

      const nextRecords = [
        ...records.filter((currentRecord) => !sourceImageNames.includes(currentRecord.imageName)),
        ...(payload.records || []),
      ];
      const nextIssues = [
        ...issues.filter((issue) => !sourceImageNames.includes(issue.imageName)),
        ...(payload.issues || []),
      ];

      setRecords(nextRecords);
      setIssues(nextIssues);
      setConfirmedCorrectRecords((current) =>
        current.filter((item) => !item.sourceImageNames.some((imageName) => sourceImageNames.includes(imageName))),
      );
      setTrainingExamplesLoaded(payload.trainingExamplesLoaded || 0);

      const organized = organizeRecords(nextRecords);
      const dedupeMessage =
        organized.duplicateCount > 0 ? t("home.dedupe", { n: organized.duplicateCount }) : "";
      setNoticeMessage(
        t("home.noticeRetry", {
          model: payload.modelUsed || reviewModelName,
          n: sourceImageNames.length,
          dedupe: dedupeMessage,
        }),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errRetry"));
    } finally {
      setRetryingKeys((current) => current.filter((key) => key !== record.id));
    }
  }

  async function retryAllReviewRecords() {
    if (!reviewRecords.length) {
      setErrorMessage(t("home.errNoReview"));
      return;
    }

    const sourceImageNames = Array.from(
      new Set(reviewRecords.flatMap((record) => getSourceImageNames(record))),
    );
    const matchedUploads = uploads.filter((upload) => sourceImageNames.includes(upload.file.name));

    if (!matchedUploads.length) {
      setErrorMessage(t("home.errNoReviewImages"));
      return;
    }

    const retryRecordIds = reviewRecords.map((record) => record.id);
    setIsRetryingReviewAll(true);
    setRetryingKeys((current) => Array.from(new Set([...current, ...retryRecordIds])));
    setErrorMessage("");
    setNoticeMessage("");
    setSelectedUploadId(matchedUploads[0]?.id ?? null);

    try {
      const payload = await runParallelExtraction(
        matchedUploads.map((upload) => upload.file),
        3,
        "review",
      );

      const nextRecords = [
        ...records.filter((record) => !sourceImageNames.includes(record.imageName)),
        ...(payload.records || []),
      ];
      const nextIssues = [
        ...issues.filter((issue) => !sourceImageNames.includes(issue.imageName)),
        ...(payload.issues || []),
      ];

      setRecords(nextRecords);
      setIssues(nextIssues);
      setConfirmedCorrectRecords((current) =>
        current.filter((item) => !item.sourceImageNames.some((imageName) => sourceImageNames.includes(imageName))),
      );
      setTrainingExamplesLoaded(payload.trainingExamplesLoaded || 0);

      const organized = organizeRecords(nextRecords);
      const dedupeMessage =
        organized.duplicateCount > 0 ? t("home.dedupe", { n: organized.duplicateCount }) : "";
      setNoticeMessage(
        t("home.noticeBatchRetry", {
          model: payload.modelUsed || reviewModelName,
          n: matchedUploads.length,
          dedupe: dedupeMessage,
        }),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errBatchRetry"));
    } finally {
      setIsRetryingReviewAll(false);
      setRetryingKeys((current) => current.filter((key) => !retryRecordIds.includes(key)));
      setProgress(null);
    }
  }

  async function copyTable() {
    const rows = [tableHeaders, ...buildExportRows(filteredRecordsResult.records, activeTableFields)];
    const text = rows.map((row) => row.join("\t")).join("\n");
    await navigator.clipboard.writeText(text);
    setNoticeMessage(t("home.copied"));
  }

  async function downloadExcel() {
    const worksheet = XLSX.utils.aoa_to_sheet([
      tableHeaders,
      ...buildExportRows(filteredRecordsResult.records, activeTableFields),
    ]);
    const workbook = XLSX.utils.book_new();
    const dataSuffix = t("home.dataSuffix");
    XLSX.utils.book_append_sheet(workbook, worksheet, dataSuffix);
    const filename = `${formatDateForFilename(filteredRecordsResult.records[0]?.date, dataSuffix)}.xlsx`;
    const workbookBytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const fileBlob = new Blob([workbookBytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    try {
      const pickerWindow = window as WindowWithSavePicker;
      if (typeof pickerWindow.showSaveFilePicker === "function") {
        const handle = await pickerWindow.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: t("home.excelBook"),
              accept: {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
              },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(fileBlob);
        await writable.close();
        setNoticeMessage(t("home.excelSaved", { name: filename }));
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("abort")) {
        setNoticeMessage(t("home.excelCancelled"));
        return;
      }
    }

    const downloadUrl = URL.createObjectURL(fileBlob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    setNoticeMessage(t("home.excelDownloaded", { name: filename }));
  }

  function updateRecord(id: string, field: TableFieldDefinition, value: string) {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== id) {
          return record;
        }
        return setRecordFieldValue(record, field, value);
      }),
    );
  }

  async function resolveAnnotationImage(imageName: string, previewUrl?: string) {
    if (previewUrl) {
      return await ensureImageDataUrlFromSource(previewUrl);
    }

      const response = await fetch(withFormId(`/api/training/image?imageName=${encodeURIComponent(imageName)}`));
    const payload = (await response.json()) as { dataUrl?: string; error?: string };
    if (!response.ok || !payload.dataUrl) {
      throw new Error(payload.error || t("home.errTrainImage"));
    }
    return await ensureImageDataUrlFromSource(payload.dataUrl);
  }

  async function openAnnotationPanel(record: PodRecord, _anchorElement?: HTMLElement) {
    void _anchorElement;
    const imageName = getSourceImageNames(record)[0];
    if (!imageName) {
      setErrorMessage(t("home.errNoImageName"));
      return;
    }

    const matchedUpload = uploads.find((upload) => upload.file.name === imageName);

    setAnnotationDraft({
      seed: podRecordToAnnotationSeed(record),
      boxes: [],
      fieldAggregations: {},
      notes: t("home.defaultAnnotNotes"),
    });

    try {
      if (viewingRecord) {
        closeViewerPopup();
      }
      const imageSrc = await resolveAnnotationImage(imageName, matchedUpload?.previewUrl);
      setAnnotatingRecord(record);
      setAnnotationImageName(imageName);
      setAnnotationImageSrc(imageSrc);
      if (matchedUpload) {
        setSelectedUploadId(matchedUpload.id);
      }
      setNoticeMessage(t("home.noticeAnnotOpen", { name: imageName }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("home.errAnnotOpen"));
      setAnnotationDraft(null);
    }
  }

  function handleImageClick(upload: UploadItem, event: React.MouseEvent<HTMLElement>) {
    setSelectedUploadId(upload.id);

    const matchedRecord = records.find((r) => getSourceImageNames(r).includes(upload.file.name));

    if (matchedRecord) {
      openRecordImage(matchedRecord, event.currentTarget);
      setTimeout(() => {
        const row = document.getElementById(`record-row-${matchedRecord.id}`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 50);
    } else {
      const anchor = resolveRowAnchor(event.currentTarget);
      viewerAnchorRef.current = anchor;
      if (anchor) {
        setViewerPopupPosition(calculatePopupPosition(anchor));
      }

      if (annotatingRecord) {
        closeRecordPopup();
      }

      setViewingRecord(null);
      setViewerGallery([{ name: upload.file.name, src: upload.previewUrl }]);
      setViewerGalleryLoading(false);
      setViewerLoadError("");
      setViewerScale(1);
      setViewerPan({ x: 0, y: 0 });
      setNoticeMessage(t("home.noticeImageOpen", { name: upload.file.name }));
    }
  }

  function openRecordImage(record: PodRecord, anchorElement?: HTMLElement) {
    const imageNames = getSourceImageNames(record);
    if (!imageNames.length) {
      setErrorMessage(t("home.errNoImageName"));
      return;
    }

    const anchor = resolveRowAnchor(anchorElement);
    viewerAnchorRef.current = anchor;
    if (anchor) {
      setViewerPopupPosition(calculatePopupPosition(anchor));
    }

    if (annotatingRecord) {
      closeRecordPopup();
    }

    setViewingRecord(record);
    setViewerGallery([]);
    setViewerLoadError("");
    setViewerScale(1);
    setViewerPan({ x: 0, y: 0 });
    setViewerGalleryLoading(true);
    setNoticeMessage(
      imageNames.length > 1
        ? t("home.openingN", { n: imageNames.length })
        : t("home.openingOne", { name: imageNames[0]! }),
    );

    const firstUpload = uploads.find((upload) => upload.file.name === imageNames[0]);
    if (firstUpload) {
      setSelectedUploadId(firstUpload.id);
    }

    void Promise.allSettled(
      imageNames.map(async (name) => {
        const matchedUpload = uploads.find((upload) => upload.file.name === name);
        const src = await resolveAnnotationImage(name, matchedUpload?.previewUrl);
        return { name, src };
      }),
    )
      .then((results) => {
        const gallery: Array<{ name: string; src: string }> = [];
        const failures: string[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          const name = imageNames[i]!;
          if (r.status === "fulfilled") {
            gallery.push(r.value);
          } else {
            const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
            failures.push(`${name}：${reason}`);
          }
        }
        setViewerGallery(gallery);
        if (failures.length) {
          setViewerLoadError(failures.join("；"));
          if (gallery.length === 0) {
            setErrorMessage(failures.join("；"));
          }
        }
        setNoticeMessage(
          gallery.length > 1
            ? t("home.openedN", { n: gallery.length })
            : gallery.length === 1
              ? t("home.noticeImageOpen", { name: gallery[0]!.name })
              : t("home.loadFail"),
        );
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : t("home.errOpenImage");
        setViewerLoadError(msg);
        setErrorMessage(msg);
      })
      .finally(() => {
        setViewerGalleryLoading(false);
      });
  }

  function zoomViewer(delta: number) {
    setViewerScale((current) => Math.min(4, Math.max(1, Number((current + delta).toFixed(2)))));
  }

  function resetViewer() {
    setViewerScale(1);
    setViewerPan({ x: 0, y: 0 });
  }

  function beginViewerDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (viewerScale <= 1) {
      return;
    }

    setViewerDragState({
      startX: event.clientX,
      startY: event.clientY,
      originX: viewerPan.x,
      originY: viewerPan.y,
    });
  }

  function updateViewerDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (!viewerDragState || viewerScale <= 1) {
      return;
    }

    const nextX = viewerDragState.originX + (event.clientX - viewerDragState.startX);
    const nextY = viewerDragState.originY + (event.clientY - viewerDragState.startY);
    setViewerPan({ x: nextX, y: nextY });
  }

  function endViewerDrag() {
    setViewerDragState(null);
  }

  function deleteRecord(record: PodRecord) {
    if (!window.confirm(t("home.confirmDeleteRecord"))) {
      return;
    }

    const sourceImageNames = getSourceImageNames(record);
    const sourceRecordIds = new Set(getSourceRecordIds(record));
    setRecords((current) =>
      current.filter((currentRecord) => !sourceRecordIds.has(currentRecord.id)),
    );
    setIssues((current) =>
      current.filter(
        (issue) =>
          !(
            sourceImageNames.includes(issue.imageName) &&
            (!issue.route || issue.route === record.route)
          ),
      ),
    );
    setConfirmedCorrectRecords((current) => current.filter((item) => !sourceRecordIds.has(item.recordId)));

    if (annotatingRecord?.id === record.id) {
      closeRecordPopup();
    }

    setNoticeMessage(
      t("home.deletedRow", {
        route: record.route || t("home.unnamedRoute"),
        driver: record.driver || t("home.unnamedDriver"),
      }),
    );
  }

  function toggleRecordConfirmedCorrect(record: PodRecord) {
    const alreadyConfirmed = isRecordConfirmedCorrect(record);
    if (alreadyConfirmed) {
      setConfirmedCorrectRecords((current) => current.filter((item) => item.recordId !== record.id));
      setNoticeMessage(
        t("home.unconfirmed", {
          route: record.route || t("home.unnamedRoute"),
          driver: record.driver || t("home.unnamedDriver"),
        }),
      );
      return;
    }

    setConfirmedCorrectRecords((current) => [
      ...current.filter((item) => item.recordId !== record.id),
      {
        recordId: record.id,
        sourceImageNames: getSourceImageNames(record),
        route: record.route,
      },
    ]);
    setNoticeMessage(
      t("home.markedOk", {
        route: record.route || t("home.unnamedRoute"),
        driver: record.driver || t("home.unnamedDriver"),
      }),
    );
  }

  function applyAnnotationSeedToRecord(recordId: string, seed: AnnotationWorkbenchSeed) {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== recordId) {
          return record;
        }
        return {
          ...record,
          date: seed.date ?? record.date,
          route: seed.route ?? record.route,
          driver: seed.driver ?? record.driver,
          taskCode: seed.taskCode ?? record.taskCode,
          total: seed.total === undefined ? record.total : seed.total === "" ? "" : Number(seed.total),
          unscanned:
            seed.unscanned === undefined ? record.unscanned : seed.unscanned === "" ? "" : Number(seed.unscanned),
          exceptions:
            seed.exceptions === undefined ? record.exceptions : seed.exceptions === "" ? "" : Number(seed.exceptions),
          waybillStatus: seed.waybillStatus ?? record.waybillStatus,
          stationTeam: seed.stationTeam ?? record.stationTeam,
          totalSourceLabel: seed.totalSourceLabel ?? record.totalSourceLabel,
          customFieldValues: { ...(seed.customFieldValues || {}) },
        };
      }),
    );
  }

  const renderResultsTable = () => (
    <table className="min-w-full border-separate border-spacing-0 text-sm">
      <thead className="sticky top-0 z-20 bg-[var(--background)] text-[var(--foreground)] shadow-[0_1px_0_var(--border)]">
        <tr>
          {filterableColumns.map((column) => (
            <th key={column.id} className="px-3 py-2 align-top text-left text-xs font-medium text-[var(--muted-foreground)]">
              <div className={`flex flex-col gap-1 ${column.id === SOURCE_FILTER_COLUMN_ID ? "min-w-56" : "min-w-36"}`}>
                <span>{column.label}</span>
                <select
                  value={columnFilters[column.id] ?? ""}
                  onChange={(event) => setColumnFilterValue(column.id, event.target.value)}
                  aria-label={t("home.filterBy", { label: column.label })}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-normal text-slate-700 outline-none focus:border-slate-500"
                >
                  <option value="">{t("home.filterAll")}</option>
                  {columnFilterOptions[column.id]?.map((option) => (
                    <option key={`${column.id}-${option.value}`} value={option.value}>
                      {`${option.label} (${option.count.toLocaleString(nLoc)})`}
                    </option>
                  ))}
                </select>
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filteredRecordsResult.records.length ? (
          groupedRecords.map(([route, routeRecords]) => (
            <Fragment key={route}>
              {routeFieldActive ? (
                <tr className="bg-slate-200">
                  <td colSpan={activeTableFields.length + 1} className="border-b border-slate-300 px-3 py-2 text-left font-semibold text-slate-800">
                    {t("home.groupRoute", {
                      route: route === UNGROUPED_ROUTE_KEY ? t("home.ungrouped") : route,
                      n: routeRecords.length,
                    })}
                  </td>
                </tr>
              ) : null}
              {routeRecords.map((record) => (
                <tr
                  key={record.id}
                  id={`record-row-${record.id}`}
                  className={`${
                    needsManualAnnotation(record)
                      ? "bg-rose-50/70"
                      : isCrossImageMergedRow(record)
                        ? "bg-violet-50/60 odd:bg-violet-50/50 even:bg-violet-50/60"
                        : "odd:bg-white even:bg-slate-50"
                  } ${
                    activePopupRecordId === record.id
                      ? "relative ring-2 ring-blue-400 ring-inset bg-blue-50/80"
                      : ""
                  }`}
                >
                  <td className="border-b border-slate-200 px-3 py-2 align-top text-slate-600">
                    <div className="max-w-56 whitespace-pre-wrap break-words">{record.imageName}</div>
                    {isCrossImageMergedRow(record) ? (
                      <div className="mt-1 inline-flex max-w-full flex-wrap items-center gap-1">
                        <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                          {t("home.mergedCross")}
                        </span>
                        <span className="text-xs text-violet-700">
                          {t("home.mergedSources", { n: mergedSourceImageCount(record) })}
                        </span>
                      </div>
                    ) : null}
                    {recordNeedsReviewBadge(record) ? (
                      <div className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        {t("home.pendingReview")}
                      </div>
                    ) : null}
                    {isRecordConfirmedCorrect(record) ? (
                      <div className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                        {t("home.confirmed")}
                      </div>
                    ) : null}
                    {getConsistencyRatio(record) ? (
                      <div
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs ${
                          hasConsistencyMismatch(record)
                            ? "bg-rose-100 text-rose-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {t("home.consistency", { ratio: getConsistencyRatio(record) ?? "" })}
                      </div>
                    ) : null}
                    {hasTotalSourceMismatch(record) ? (
                      <div className="mt-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                        {t("home.totalSourceBad")}
                      </div>
                    ) : null}
                    {getRecordIssues(record).length ? (
                      <div className="mt-2">
                        <button
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => retryRecord(record)}
                          disabled={retryingKeys.includes(record.id)}
                        >
                          {retryingKeys.includes(record.id) ? t("home.retrying") : t("home.retryExtract")}
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={(event) => openRecordImage(record, event.currentTarget)}
                      >
                        {t("home.viewImage")}
                      </button>
                      <button
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          isRecordConfirmedCorrect(record)
                            ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
                        }`}
                        onClick={() => toggleRecordConfirmedCorrect(record)}
                      >
                        {isRecordConfirmedCorrect(record) ? t("home.unconfirm") : t("home.markCorrect")}
                      </button>
                      {needsManualAnnotation(record) ? (
                        <button
                          className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                          onClick={(event) => void openAnnotationPanel(record, event.currentTarget)}
                        >
                          {t("home.openAnnotation")}
                        </button>
                      ) : null}
                      <button
                        className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        onClick={() => deleteRecord(record)}
                      >
                        {t("home.deleteRow")}
                      </button>
                    </div>
                  </td>
                  {activeTableFields.map((column) => (
                    <td key={column.id} className="border-b border-slate-200 px-2 py-2 align-top">
                      <input
                        type={column.type === "number" ? "number" : "text"}
                        value={String(getRecordFieldValue(record, column) ?? "")}
                        onChange={(event) => updateRecord(record.id, column, event.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-slate-500"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))
        ) : (
          <tr>
            <td colSpan={activeTableFields.length + 1} className="px-4 py-16 text-center text-slate-500">
              {hasActiveColumnFilters ? t("home.emptyFilter") : t("home.emptyNoData")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );

  const nLoc = locale === "en" ? "en-US" : "zh-CN";

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
                <div className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-slate-900 shadow-sm">
                  {t("home.title")}
                </div>
                <Link
                  href={buildFormTrainingHref(currentFormId)}
                  className="rounded-md px-4 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
                >
                  {t("home.training")}
                </Link>
              </div>
              <p className="hidden text-xs text-[var(--muted-foreground)] sm:block">
                {t("home.statsLine", {
                  primary: primaryModelName,
                  review: reviewModelName,
                  samples: trainingExamplesLoaded,
                  images: trainingStatus?.totalImages ?? 0,
                })}
              </p>
            </div>
          </div>
        </header>

        {isFieldManagerOpen ? (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-4 sm:p-6">
            <div className="flex min-h-full items-start justify-center">
            <div className="my-2 flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl" style={{ transform: `translate(${fieldManagerOffset.x}px, ${fieldManagerOffset.y}px)` }}>
              <div className="flex cursor-move select-none items-center justify-between border-b border-slate-200 px-6 py-4" onMouseDown={beginFieldManagerDrag}>
                <div>
                  <h2 className="text-lg font-semibold">{t("home.fmTitle")}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t("home.fmIntro")}</p>
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                  onClick={() => setIsFieldManagerOpen(false)}
                >
                  {t("home.close")}
                </button>
              </div>

              <div className="grid flex-1 gap-6 overflow-y-auto px-6 py-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-medium text-slate-700">{t("home.addAndTrain")}</div>
                    <div className="space-y-3">
                      <input
                        type="text"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        placeholder={t("home.newFieldPh")}
                        value={newFieldName}
                        onChange={(event) => setNewFieldName(event.target.value)}
                      />
                      <div className="flex items-center gap-3">
                        <select
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                          value={newFieldType}
                          onChange={(event) => setNewFieldType(event.target.value as "text" | "number")}
                        >
                          <option value="text">{t("formSetup.fieldTypeTextFull")}</option>
                          <option value="number">{t("formSetup.fieldTypeNumberFull")}</option>
                        </select>
                        <button
                          type="button"
                          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:bg-blue-300"
                          onClick={() => void createFieldAndStartTraining()}
                          disabled={isSavingFieldConfig}
                        >
                          {isSavingFieldConfig ? t("home.processing") : t("home.addGoTrain")}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500">{t("home.addTrainHint")}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
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
                              {field.type === "number" ? t("formSetup.typeShortNumber") : t("formSetup.typeShortText")}
                            </span>
                            {field.builtIn ? (
                              <span className="rounded-full bg-blue-100 px-2 py-1 text-[11px] text-blue-700">
                                {t("home.builtin")}
                              </span>
                            ) : (
                              <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] text-violet-700">
                                {t("home.custom")}
                              </span>
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
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 p-4">
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
                                  {field.type === "number"
                                    ? t("formSetup.fieldTypeNumberFull")
                                    : t("formSetup.fieldTypeTextFull")}
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

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
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
          </div>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-0">
          <div
            ref={uploadPanelRef}
            className="flex w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] lg:shrink-0"
            style={
              isDesktopLayout
                ? { width: uploadPanelWidthPx, maxWidth: "min(100%, 90vw)" }
                : undefined
            }
          >
            <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-medium">{t("home.uploadTitle")}</h2>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("upload.workspaceHelper")}</p>
            </div>

            <div className="flex flex-col gap-4 p-4 pb-3">
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md bg-[var(--foreground)] px-3 py-2 text-sm text-[var(--background)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={extractData}
                  disabled={isExtracting || isHighQualityReextracting || isRetryingReviewAll || !uploads.length}
                >
                  {isExtracting ? t("home.extracting") : t("home.extract")}
                </button>
                <button
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => void reextractAllWithHigherModel()}
                  disabled={isExtracting || isHighQualityReextracting || isRetryingReviewAll || !uploads.length}
                >
                  {isHighQualityReextracting ? t("home.extractingHighQuality") : t("home.extractHighQuality")}
                </button>
                <button
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
                <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)]" onClick={clearAll}>
                  {t("home.clear")}
                </button>
              </div>

              <button
                type="button"
                className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--background)] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={openFieldManager}
                disabled={isSavingFieldConfig}
              >
                {t("home.manageColumns")}
              </button>

              {progress ? (
                <div className="rounded-lg border border-[var(--border)] px-3 py-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                    <span>{t("home.progress")}</span>
                    <span>
                      {progress.completed} / {progress.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--foreground)] transition-all duration-300"
                      style={{ width: `${progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
                <span>{t("home.countRecords", { n: organizedRecordsResult.records.length })}</span>
                <span>{t("home.warnings", { n: totalWarnings })}</span>
                <span title={t("home.mergedCross")}>
                  {t("home.merged", { n: organizedRecordsResult.duplicateCount })}
                </span>
              </div>

              {trainingStatus ? (
                <div className="text-xs text-[var(--muted-foreground)]">
                  {t("home.trainPool", {
                    total: trainingStatus.totalImages,
                    labeled: trainingStatus.labeledImages,
                    unlabeled: trainingStatus.unlabeledImages,
                  })}
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm text-red-800">{errorMessage}</div>
              ) : null}

              {noticeMessage ? (
                <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900">{noticeMessage}</div>
              ) : null}
            </div>

            <div className="border-t border-[var(--border)] px-2 pb-2 pt-1">
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
                className={`overflow-hidden rounded-lg border transition ${
                  isDraggingFiles
                    ? "border-[var(--accent)] bg-[var(--accent-muted)]"
                    : "border-[var(--border)] bg-[var(--background)]"
                }`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--foreground)]">{t("home.uploadListTitle")}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {isDraggingFiles ? t("home.dropRelease") : t("home.uploadListHint")}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface)]"
                      onClick={openUploadFilePicker}
                    >
                      {t("home.addFiles")}
                    </button>
                    {uploads.length ? (
                      <button
                        type="button"
                        className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface)]"
                        onClick={toggleSelectAllUploads}
                      >
                        {allUploadsSelected ? t("home.deselectAllUploads") : t("home.selectAllUploads")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => void downloadSelectedUploads()}
                      disabled={isExportingUploads || !selectedUploads.length}
                    >
                      {isExportingUploads ? t("home.exportingSelectedUploads") : t("home.exportSelectedUploads")}
                    </button>
                  </div>
                </div>
                {uploads.length ? (
                  <div className="border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    {t("home.uploadSelectedCount", {
                      selected: selectedUploads.length,
                      total: uploads.length,
                    })}
                  </div>
                ) : null}
                <div className="max-h-[min(50vh,420px)] overflow-y-auto">
                {uploads.length ? (
                  <ul className="divide-y divide-[var(--border)]">
                    {uploads.map((upload) => (
                      <li key={upload.id}>
                        <div className="flex items-center gap-2 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedUploadIds.includes(upload.id)}
                            onChange={() => toggleUploadSelected(upload.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={upload.file.name}
                            className="h-4 w-4 rounded border-[var(--border)]"
                          />
                          <button
                            type="button"
                            className={`flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                              selectedUpload?.id === upload.id ? "bg-[var(--accent-muted)]" : "hover:bg-[var(--surface)]"
                            }`}
                            onClick={(e) => handleImageClick(upload, e)}
                          >
                            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded border border-[var(--border)] bg-[var(--background)]">
                              <Image src={upload.previewUrl} alt={upload.file.name} className="object-cover" fill unoptimized />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{upload.file.name}</div>
                              <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                                {(upload.file.size / 1024).toFixed(1)} KB
                              </div>
                            </div>
                          </button>
                        </div>
                      </li>
                    ))}
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

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize workspace columns"
            className="relative hidden w-3 shrink-0 cursor-col-resize select-none self-stretch lg:block"
            onPointerDown={beginWorkspaceColumnResize}
          >
            <div className="absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-[var(--border)] hover:bg-blue-500" />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2 className="text-sm font-medium">{t("home.resultsTitle")}</h2>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {t("home.resultsSummary", {
                    n: organizedRecordsResult.records.length.toLocaleString(nLoc),
                  })}
                  {organizedRecordsResult.duplicateCount > 0
                    ? `${t("home.rawRows", { n: records.length.toLocaleString(nLoc) })}${t("home.mergedRows", {
                        n: organizedRecordsResult.duplicateCount.toLocaleString(nLoc),
                      })}`
                    : ""}
                  {hasActiveColumnFilters
                    ? t("home.filtered", {
                        n: filteredRecordsResult.records.length.toLocaleString(nLoc),
                      })
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasActiveColumnFilters ? (
                  <button
                    type="button"
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--background)]"
                    onClick={clearAllColumnFilters}
                  >
                    {t("home.clearFilters")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--background)] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={openFieldManager}
                  disabled={isSavingFieldConfig}
                >
                  {t("home.manageColumns")}
                </button>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--background)] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void retryAllReviewRecords()}
                    disabled={!reviewRecords.length || isExtracting || isHighQualityReextracting || isRetryingReviewAll}
                  >
                    {isRetryingReviewAll
                      ? t("home.reviewing")
                      : t("home.review", { n: reviewRecords.length })}
                  </button>
                  <button
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--background)] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={copyTable}
                    disabled={!filteredRecordsResult.records.length}
                  >
                    {t("home.copy")}
                  </button>
                  <button
                    className="rounded-md bg-[var(--foreground)] px-3 py-1.5 text-sm text-[var(--background)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={downloadExcel}
                    disabled={!filteredRecordsResult.records.length}
                  >
                    {t("home.downloadExcel")}
                  </button>
                </div>
              </div>
            </div>

            {visibleIssues.length ? (
              <div
                ref={splitResultsRef}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <div
                  className="flex min-h-0 shrink-0 flex-col border-b border-[var(--border)] bg-[var(--background)] px-4 pt-3"
                  style={{ height: remindersPanelHeightPx }}
                >
                  <div className="mb-1.5 shrink-0 text-xs font-medium text-[var(--muted-foreground)]">
                    {t("home.reminders")}
                  </div>
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pb-3 text-sm">
                    {visibleIssues.map((issue, index) => (
                      <div
                        key={`${issue.imageName}-${issue.route || "none"}-${index}`}
                        className={`rounded-md px-2 py-1.5 ${issue.level === "error" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}
                      >
                        <span className="font-medium">{issue.imageName}</span>
                        {issue.route ? ` / ${issue.route}` : ""}
                        {`：${issue.message}`}
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t("home.resizeRemindersPanel")}
                  className="relative z-10 h-3 w-full shrink-0 cursor-row-resize touch-none select-none"
                  onPointerDown={beginRemindersTableResize}
                >
                  <div className="pointer-events-none absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--border)] group-hover:bg-blue-500" />
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-slate-50">{renderResultsTable()}</div>
              </div>
            ) : (
              <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-slate-50">{renderResultsTable()}</div>
            )}

          </div>
        </section>

        {viewerPopupPosition && (viewerGallery.length > 0 || viewerLoadError || viewerGalleryLoading) ? (
          <div
            className="fixed z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl"
            style={{
              top: viewerPopupPosition.top,
              left: viewerPopupPosition.left,
              width: viewerPopupPosition.width,
            }}
          >
            <div className="shrink-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{t("home.viewerTitle")}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {viewerGallery.length > 1
                      ? t("home.viewerMulti", { n: viewerGallery.length })
                      : t("home.viewerSingle")}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                  onClick={closeViewerPopup}
                >
                  {t("home.closeWindow")}
                </button>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                {viewingRecord ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                    {viewingRecord.route} / {viewingRecord.driver}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{t("home.noRecordYet")}</span>
                )}
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => zoomViewer(0.25)}
                >
                  {t("annotation.zoomIn")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => zoomViewer(-0.25)}
                >
                  {t("annotation.zoomOut")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  onClick={resetViewer}
                >
                  {t("home.viewerReset")}
                </button>
                {viewingRecord && (
                  <button
                    type="button"
                    className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    onClick={(event) => void openAnnotationPanel(viewingRecord, event.currentTarget)}
                  >
                    {t("home.gotoAnnotation")}
                  </button>
                )}
              </div>

              {viewerLoadError && viewerGallery.length > 0 ? (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {t("home.partialLoad", { detail: viewerLoadError })}
                </div>
              ) : null}
            </div>

            <div
              className="relative min-h-[200px] flex-1 overflow-auto rounded-2xl border border-slate-200 bg-slate-50"
              onMouseDown={beginViewerDrag}
              onMouseMove={updateViewerDrag}
              onMouseUp={endViewerDrag}
              onMouseLeave={endViewerDrag}
            >
              {viewerGalleryLoading && viewerGallery.length === 0 && !viewerLoadError ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">{t("home.loading")}</div>
              ) : viewerGallery.length > 0 ? (
                <div
                  className="inline-block min-w-full space-y-4 p-3"
                  style={{
                    transform: `translate(${viewerPan.x}px, ${viewerPan.y}px) scale(${viewerScale})`,
                    transformOrigin: "top center",
                    cursor: viewerScale > 1 ? (viewerDragState ? "grabbing" : "grab") : "default",
                  }}
                >
                  {viewerGallery.map((item) => (
                    <div
                      key={item.name}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                        {item.name}
                      </div>
                      <div className="flex justify-center bg-slate-100/50 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.src}
                          alt={item.name}
                          className="max-h-[min(480px,70vh)] w-auto max-w-full object-contain select-none"
                          draggable={false}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : viewerLoadError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-rose-600">
                  {viewerLoadError}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">{t("home.loading")}</div>
              )}
            </div>
          </div>
        ) : null}

        {annotatingRecord && annotationDraft ? (
          <TrainingAnnotationWorkbench
            open
            imageName={annotationImageName}
            imageSrc={annotationImageSrc}
            apiPathBuilder={withFormId}
            fieldDefinitions={activeTableFields}
            initialSeed={annotationDraft.seed}
            initialBoxes={annotationDraft.boxes}
            initialFieldAggregations={annotationDraft.fieldAggregations}
            initialNotes={annotationDraft.notes}
            onClose={closeRecordPopup}
            onNotice={setNoticeMessage}
            onError={setErrorMessage}
            onApply={async ({ finalSeed }) => {
              const recordId = annotatingRecord.id;
              applyAnnotationSeedToRecord(recordId, finalSeed);
              setNoticeMessage(t("home.noticeAppliedMain"));
            }}
            onSaved={async ({ totalExamples, finalSeed }) => {
              const recordId = annotatingRecord.id;
              await loadTrainingStatus();
              setNoticeMessage(t("home.noticeTrainSaved", { n: totalExamples || 0 }));
              applyAnnotationSeedToRecord(recordId, finalSeed);
            }}
          />
        ) : null}

        <RecognitionAgentDock formId={currentFormId} modeLabel={t("home.modeFill")} />
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <HomeContent />
    </Suspense>
  );
}
