"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import {
  TrainingAnnotationWorkbench,
  type AnnotationField,
  type AnnotationWorkbenchSeed,
  type FieldAggregation,
  type WorkbenchAnnotationBox,
} from "@/components/TrainingAnnotationWorkbench";
import {
  type ExtractionIssue,
  type ExtractionResponse,
  type PodRecord,
  organizeRecords,
} from "@/lib/pod";
import {
  DEFAULT_TABLE_FIELDS,
  broadcastTableFieldsChanged,
  createCustomField,
  getActiveTableFields,
  getRecordFieldValue,
  hasRecordFieldValue,
  setRecordFieldValue,
  type TableFieldDefinition,
} from "@/lib/table-fields";

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
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
      exceptions: number;
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

export const editableColumns: Array<{
  key: keyof Pick<PodRecord, "date" | "route" | "driver" | "taskCode" | "total" | "unscanned" | "exceptions" | "waybillStatus">;
  label: string;
  type?: "text" | "number";
}> = [
  { key: "date", label: "日期" },
  { key: "route", label: "抽查路线" },
  { key: "driver", label: "抽查司机" },
  { key: "taskCode", label: "任务编码" },
  { key: "total", label: "运单数量", type: "number" },
  { key: "unscanned", label: "未收数量", type: "number" },
  { key: "exceptions", label: "错扫数量", type: "number" },
  { key: "waybillStatus", label: "响应更新状态" },
];

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

function formatDateForFilename(rawDate: string | undefined) {
  if (!rawDate) {
    return "OrSight数据";
  }

  const normalized = rawDate.trim();
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}_OrSight数据`;
  }

  const dashMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dashMatch) {
    const [, year, month, day] = dashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}_OrSight数据`;
  }

  return `${normalized.replace(/[\\/:*?"<>|]/g, "-")}_OrSight数据`;
}

export default function Home() {
  const router = useRouter();
  const primaryModelName = "gpt-5-mini";
  const reviewModelName = "gpt-5";

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [records, setRecords] = useState<PodRecord[]>([]);
  const [issues, setIssues] = useState<ExtractionIssue[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isRetryingReviewAll, setIsRetryingReviewAll] = useState(false);
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
  const [tableFields, setTableFields] = useState<TableFieldDefinition[]>(DEFAULT_TABLE_FIELDS);
  const [isFieldManagerOpen, setIsFieldManagerOpen] = useState(false);
  const [fieldDrafts, setFieldDrafts] = useState<TableFieldDefinition[]>(DEFAULT_TABLE_FIELDS);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "number">("text");
  const [isSavingFieldConfig, setIsSavingFieldConfig] = useState(false);
  const [routeFilter, setRouteFilter] = useState("");
  const [isRouteDropdownOpen, setIsRouteDropdownOpen] = useState(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const filterDropdownRef = useRef<HTMLDivElement | null>(null);
  const viewerAnchorRef = useRef<HTMLElement | null>(null);
  const uploadPanelRef = useRef<HTMLDivElement | null>(null);

  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    };
  }, []);

  useEffect(() => {
    void loadTableFieldConfig();
  }, []);

  useEffect(() => {
    void loadTrainingStatus();
  }, []);

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
    function handleClickOutside(event: MouseEvent) {
      if (
        filterDropdownRef.current &&
        !filterDropdownRef.current.contains(event.target as Node) &&
        filterInputRef.current &&
        !filterInputRef.current.contains(event.target as Node)
      ) {
        setIsRouteDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

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
  const activeTableFields = useMemo(() => getActiveTableFields(tableFields), [tableFields]);
  const tableHeaders = useMemo(() => activeTableFields.map((field) => field.label), [activeTableFields]);
  const organizedRecordsResult = useMemo(() => organizeRecords(records), [records]);
  
  const allAvailableRoutes = useMemo(() => {
    const routes = new Set<string>();
    for (const record of organizedRecordsResult.records) {
      if (record.route) {
        routes.add(record.route);
      }
    }
    return Array.from(routes).sort();
  }, [organizedRecordsResult.records]);

  const filteredRoutes = useMemo(() => {
    if (!routeFilter.trim()) {
      return allAvailableRoutes;
    }
    const lowerFilter = routeFilter.toLowerCase().trim();
    return allAvailableRoutes.filter(route => route.toLowerCase().includes(lowerFilter));
  }, [allAvailableRoutes, routeFilter]);

  const filteredRecordsResult = useMemo(() => {
    if (!routeFilter.trim()) {
      return organizedRecordsResult;
    }
    const lowerFilter = routeFilter.toLowerCase().trim();
    const filtered = organizedRecordsResult.records.filter((record) => 
      record.route && record.route.toLowerCase().includes(lowerFilter)
    );
    return {
      records: filtered,
      duplicateCount: organizedRecordsResult.duplicateCount
    };
  }, [organizedRecordsResult, routeFilter]);

  const groupedRecords = useMemo(() => {
    const groups = new Map<string, PodRecord[]>();
    for (const record of filteredRecordsResult.records) {
      const routeKey = record.route || "未分组路线";
      const existing = groups.get(routeKey) || [];
      existing.push(record);
      groups.set(routeKey, existing);
    }
    return Array.from(groups.entries());
  }, [filteredRecordsResult.records]);
  const activePopupRecordId = viewingRecord?.id || annotatingRecord?.id || null;
  const reviewRecords = useMemo(
    () =>
      organizedRecordsResult.records.filter((record) => {
        if (record.reviewRequired) {
          return true;
        }
        const sourceImageNames = record.imageName
          .split(" | ")
          .map((value) => value.trim())
          .filter(Boolean);
        return issues.some(
          (issue) =>
            issue.level === "error" &&
            sourceImageNames.includes(issue.imageName) &&
            (!issue.route || !record.route || issue.route === record.route),
        );
      }),
    [organizedRecordsResult.records, issues],
  );

  const totalWarnings = issues.filter((issue) => issue.level === "warning").length;

  function getSourceImageNames(record: PodRecord) {
    return record.imageName
      .split(" | ")
      .map((value) => value.trim())
      .filter(Boolean);
  }

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

  function getRecordIssues(record: PodRecord) {
    const sourceImageNames = getSourceImageNames(record);
    return issues.filter(
      (issue) =>
        sourceImageNames.includes(issue.imageName) &&
        (!issue.route || !record.route || issue.route === record.route),
    );
  }

  function hasConsistencyMismatch(record: PodRecord) {
    return getRecordIssues(record).some((issue) => issue.code === "consistency_mismatch");
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
    return record.reviewRequired || getRecordIssues(record).length > 0;
  }

  /** 与「待复核」徽章对齐：服务端校验错误也应提示人工复核 */
  function recordNeedsReviewBadge(record: PodRecord) {
    return (
      record.reviewRequired ||
      getRecordIssues(record).some((issue) => issue.level === "error")
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
      const response = await fetch("/api/table-fields");
      const payload = (await response.json()) as { error?: string; tableFields?: TableFieldDefinition[] };
      if (!response.ok) {
        throw new Error(payload.error || "表格项目配置读取失败。");
      }
      const nextFields = payload.tableFields?.length ? payload.tableFields : DEFAULT_TABLE_FIELDS;
      setTableFields(nextFields);
      setFieldDrafts(nextFields);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "表格项目配置读取失败。");
    }
  }

  async function loadTrainingStatus() {
    try {
      const response = await fetch("/api/training/status");
      const payload = (await response.json()) as TrainingStatusResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "训练池状态读取失败。");
      }
      setTrainingStatus(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "训练池状态读取失败。");
    }
  }

  async function requestExtraction(
    files: File[],
    mode: "primary" | "review" = "primary",
  ): Promise<ExtractionResponse> {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("mode", mode);

    const response = await fetch("/api/extract", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json()) as ExtractionResponse & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "AI 识别失败。");
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
    let currentIndex = 0;

    setProgress({ completed: 0, total: files.length });

    async function worker() {
      while (currentIndex < files.length) {
        const index = currentIndex;
        currentIndex += 1;
        const file = files[index];

        try {
          const payload = await requestExtraction([file], mode);
          allRecords.push(...(payload.records || []));
          allIssues.push(...(payload.issues || []));
          loadedTrainingExamples = payload.trainingExamplesLoaded || loadedTrainingExamples;
        } catch (error) {
          allIssues.push({
            imageName: file.name,
            level: "error",
            message: error instanceof Error ? error.message : "识别失败。",
          });
        } finally {
          setProgress((current) =>
            current
              ? {
                  ...current,
                  completed: Math.min(current.completed + 1, current.total),
                }
              : current,
          );
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));

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

    try {
      const nextUploads = await Promise.all(
        Array.from(fileList).map(async (file, index) => {
          // 立即将文件读取到内存中，避免微信等应用清理临时文件导致 File 对象失效（拖拽图片破损问题）
          const buffer = await file.arrayBuffer();
          const clonedFile = new File([buffer], file.name, { type: file.type, lastModified: file.lastModified });
          return {
            id: `${clonedFile.name}-${clonedFile.lastModified}-${index}-${Date.now()}`,
            file: clonedFile,
            previewUrl: URL.createObjectURL(clonedFile),
          };
        })
      );

      setUploads((current) => {
        const merged = [...current, ...nextUploads];
        setSelectedUploadId((currentId) => {
          if (!currentId && merged[0]) {
            return merged[0].id;
          }
          return currentId;
        });
        return merged;
      });
      setNoticeMessage(`已加入 ${nextUploads.length} 张图片。`);
      setErrorMessage("");
    } catch {
      setErrorMessage("读取图片内容失败，可能是文件已被其他程序移动或删除，请重试。");
    }
  }
  handleFilesRef.current = handleFiles;

  function handleDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!isDraggingFiles) {
      setIsDraggingFiles(true);
    }
  }

  function handleDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
    void handleFiles(event.dataTransfer.files);
  }

  function clearAll() {
    uploads.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    setUploads([]);
    setSelectedUploadId(null);
    setRecords([]);
    setIssues([]);
    setErrorMessage("");
    setNoticeMessage("已清空上传图片和表格数据。");
  }

  function openFieldManager() {
    setFieldDrafts(tableFields.map((field) => ({ ...field })));
    setNewFieldName("");
    setNewFieldType("text");
    setIsFieldManagerOpen(true);
  }

  async function saveFieldConfig(nextFields: TableFieldDefinition[]) {
    const response = await fetch("/api/table-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableFields: nextFields }),
    });
    const payload = (await response.json()) as { error?: string; tableFields?: TableFieldDefinition[] };
    if (!response.ok) {
      throw new Error(payload.error || "保存表格项目失败。");
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
      throw new Error("至少需要保留一个表格项目。");
    }

    const normalizedLabels = new Map<string, string>();
    for (const field of activeFields) {
      const label = field.label.trim();
      if (!label) {
        throw new Error("表格项目名称不能为空。");
      }
      const key = label.toLocaleLowerCase("zh-CN");
      if (normalizedLabels.has(key)) {
        throw new Error(`表格项目「${label}」与「${normalizedLabels.get(key)}」重名，请调整后再保存。`);
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
      ? `当前表格里已经有「${field.label}」的数据。删除后该项目会从表格中隐藏，请确认是否继续？`
      : `确认删除表格项目「${field.label}」吗？`;
    if (!window.confirm(message)) {
      return;
    }
    updateFieldDraft(field.id, (current) => ({ ...current, active: false }));
  }

  function handleRestoreFieldDraft(field: TableFieldDefinition) {
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
      setNoticeMessage("表格项目配置已更新。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存表格项目失败。");
    } finally {
      setIsSavingFieldConfig(false);
    }
  }

  async function createFieldAndStartTraining() {
    const label = newFieldName.trim();
    if (!label) {
      setErrorMessage("请先填写新表格项目名称。");
      return;
    }
    if (fieldDrafts.some((field) => field.active && field.label.trim().toLocaleLowerCase("zh-CN") === label.toLocaleLowerCase("zh-CN"))) {
      setErrorMessage("已有同名的表格项目，请换一个名称。");
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
      router.push(`/training?setupField=${encodeURIComponent(nextField.id)}&source=fill`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "新增表格项目失败。");
    } finally {
      setIsSavingFieldConfig(false);
    }
  }

  async function extractData() {
    if (!uploads.length) {
      setErrorMessage("请先上传图片。");
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
      setTrainingExamplesLoaded(payload.trainingExamplesLoaded || 0);
      const organized = organizeRecords(payload.records || []);
      const dedupeMessage =
        organized.duplicateCount > 0
          ? `，已合并 ${organized.duplicateCount} 条跨图重复（不同截图中日期、路线、司机与收取数据完全一致）`
          : "";
      setNoticeMessage(
        `AI 已完成识别，共生成 ${organized.records.length} 条记录${dedupeMessage}。批量识别已并发加速；每张图内训练池裁剪为并行、训练数据每请求只加载一次。默认模型 ${payload.modelUsed || primaryModelName}。`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "识别失败。");
    } finally {
      setIsExtracting(false);
      setProgress(null);
    }
  }

  async function retryRecord(record: PodRecord) {
    const sourceImageNames = getSourceImageNames(record);
    const matchedUploads = uploads.filter((upload) => sourceImageNames.includes(upload.file.name));

    if (!matchedUploads.length) {
      setErrorMessage("找不到这条记录对应的原始图片，无法再次识别。");
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
      setTrainingExamplesLoaded(payload.trainingExamplesLoaded || 0);

      const organized = organizeRecords(nextRecords);
      const dedupeMessage =
        organized.duplicateCount > 0
          ? `，已合并 ${organized.duplicateCount} 条跨图重复（不同截图中日期、路线、司机与收取数据完全一致）`
          : "";
      setNoticeMessage(
        `已使用 ${payload.modelUsed || reviewModelName} 重新识别 ${sourceImageNames.length} 张图片${dedupeMessage}。`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "再次识别失败。");
    } finally {
      setRetryingKeys((current) => current.filter((key) => key !== record.id));
    }
  }

  async function retryAllReviewRecords() {
    if (!reviewRecords.length) {
      setErrorMessage("当前没有需要再次识别的待复核条目。");
      return;
    }

    const sourceImageNames = Array.from(
      new Set(reviewRecords.flatMap((record) => getSourceImageNames(record))),
    );
    const matchedUploads = uploads.filter((upload) => sourceImageNames.includes(upload.file.name));

    if (!matchedUploads.length) {
      setErrorMessage("找不到待复核条目对应的原始图片，无法批量再次识别。");
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
      setTrainingExamplesLoaded(payload.trainingExamplesLoaded || 0);

      const organized = organizeRecords(nextRecords);
      const dedupeMessage =
        organized.duplicateCount > 0
          ? `，已合并 ${organized.duplicateCount} 条跨图重复（不同截图中日期、路线、司机与收取数据完全一致）`
          : "";
      setNoticeMessage(
        `已使用 ${payload.modelUsed || reviewModelName} 批量再次识别 ${matchedUploads.length} 张待复核图片${dedupeMessage}。`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "批量再次识别失败。");
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
    setNoticeMessage("表格内容已复制，可直接粘贴到其他表格。");
  }

  function downloadExcel() {
    const worksheet = XLSX.utils.aoa_to_sheet([
      tableHeaders,
      ...buildExportRows(filteredRecordsResult.records, activeTableFields),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "OrSight数据");
    const filename = `${formatDateForFilename(filteredRecordsResult.records[0]?.date)}.xlsx`;
    XLSX.writeFile(workbook, filename);
    setNoticeMessage(`Excel 已下载：${filename}`);
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
      return previewUrl;
    }

    const response = await fetch(`/api/training/image?imageName=${encodeURIComponent(imageName)}`);
    const payload = (await response.json()) as { dataUrl?: string; error?: string };
    if (!response.ok || !payload.dataUrl) {
      throw new Error(payload.error || "无法读取训练图片。");
    }
    return payload.dataUrl;
  }

  async function openAnnotationPanel(record: PodRecord, _anchorElement?: HTMLElement) {
    void _anchorElement;
    const imageName = getSourceImageNames(record)[0];
    if (!imageName) {
      setErrorMessage("找不到该条记录对应的图片名。");
      return;
    }

    const matchedUpload = uploads.find((upload) => upload.file.name === imageName);

    setAnnotationDraft({
      seed: podRecordToAnnotationSeed(record),
      boxes: [],
      fieldAggregations: {},
      notes: "人工标注用于训练池。",
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
      setNoticeMessage(`已打开标注工作台：${imageName}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开标注失败。");
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
      setNoticeMessage(`已打开图片：${upload.file.name}`);
    }
  }

  function openRecordImage(record: PodRecord, anchorElement?: HTMLElement) {
    const imageNames = getSourceImageNames(record);
    if (!imageNames.length) {
      setErrorMessage("找不到该条记录对应的图片名。");
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
        ? `正在打开 ${imageNames.length} 张源图…`
        : `正在打开图片：${imageNames[0]}`,
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
            ? `已打开 ${gallery.length} 张源图`
            : gallery.length === 1
              ? `已打开图片：${gallery[0]!.name}`
              : "图片加载失败",
        );
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : "打开图片失败。";
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
    if (!window.confirm("确认删除这条记录吗？")) {
      return;
    }

    const sourceImageNames = getSourceImageNames(record);
    setRecords((current) =>
      current.filter(
        (currentRecord) =>
          !(
            currentRecord.date === record.date &&
            currentRecord.route === record.route &&
            currentRecord.driver === record.driver &&
            (currentRecord.taskCode || "") === (record.taskCode || "") &&
            currentRecord.total === record.total &&
            currentRecord.unscanned === record.unscanned &&
            currentRecord.exceptions === record.exceptions &&
            sourceImageNames.some((name) => currentRecord.imageName.includes(name))
          ),
      ),
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

    if (annotatingRecord?.id === record.id) {
      closeRecordPopup();
    }

    setNoticeMessage(`已删除条目：${record.route || "未命名路线"} / ${record.driver || "未命名司机"}`);
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

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 text-slate-900">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link href="/forms" className="font-medium text-blue-600 hover:underline">
              ← 返回填表池
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                onClick={openFieldManager}
              >
                表格项目管理
              </button>
              <Link href="/training" className="font-medium text-slate-700 hover:text-slate-900 hover:underline">
                切换到训练模式
              </Link>
            </div>
          </div>
          <h1 className="text-2xl font-semibold">OrSight - 填表模式</h1>
          <p className="mt-2 text-sm text-slate-600">
            左侧批量上传 POD 签退截图，右侧查看 AI 填表结果。对四次不一致的条目可以打开标注工作台，手动画框后存入训练池。
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">批量识别模型：{primaryModelName}</span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">再次识别模型：{reviewModelName}</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">已加载训练样本：{trainingExamplesLoaded}</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">训练池图片：{trainingStatus?.totalImages || 0}</span>
          </div>
        </header>

        {isFieldManagerOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold">表格项目管理</h2>
                  <p className="mt-1 text-sm text-slate-500">你可以新增、重命名、删除或恢复表格项目。这里的改动会同步到训练页和标注项目；删除命中当前表格数据时会先提示。</p>
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                  onClick={() => setIsFieldManagerOpen(false)}
                >
                  关闭
                </button>
              </div>

              <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-medium text-slate-700">新增项目并进入标注</div>
                    <div className="space-y-3">
                      <input
                        type="text"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        placeholder="输入新的表格项目名称"
                        value={newFieldName}
                        onChange={(event) => setNewFieldName(event.target.value)}
                      />
                      <div className="flex items-center gap-3">
                        <select
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                          value={newFieldType}
                          onChange={(event) => setNewFieldType(event.target.value as "text" | "number")}
                        >
                          <option value="text">文本项目</option>
                          <option value="number">数字项目</option>
                        </select>
                        <button
                          type="button"
                          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:bg-blue-300"
                          onClick={() => void createFieldAndStartTraining()}
                          disabled={isSavingFieldConfig}
                        >
                          {isSavingFieldConfig ? "处理中..." : "新增并去标注"}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500">新增后会直接跳转到训练模式，并默认选中新项目开始标注。</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="mb-3 text-sm font-medium text-slate-700">当前项目</div>
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
                              {field.type === "number" ? "数字" : "文本"}
                            </span>
                            {field.builtIn ? (
                              <span className="rounded-full bg-blue-100 px-2 py-1 text-[11px] text-blue-700">内置</span>
                            ) : (
                              <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] text-violet-700">自定义</span>
                            )}
                            <button
                              type="button"
                              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => moveFieldDraft(field.id, -1)}
                              disabled={index === 0}
                            >
                              上移
                            </button>
                            <button
                              type="button"
                              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => moveFieldDraft(field.id, 1)}
                              disabled={index === activeFields.length - 1}
                            >
                              下移
                            </button>
                            <button
                              type="button"
                              className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                              onClick={() => handleDeleteFieldDraft(field)}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="mb-3 text-sm font-medium text-slate-700">已删除项目</div>
                    <div className="space-y-3">
                      {fieldDrafts.filter((field) => !field.active).length ? (
                        fieldDrafts
                          .filter((field) => !field.active)
                          .map((field) => (
                            <div key={field.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                              <div>
                                <div className="text-sm font-medium text-slate-700">{field.label}</div>
                                <div className="mt-1 text-xs text-slate-500">{field.type === "number" ? "数字项目" : "文本项目"}</div>
                              </div>
                              <button
                                type="button"
                                className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                                onClick={() => handleRestoreFieldDraft(field)}
                              >
                                恢复
                              </button>
                            </div>
                          ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                          暂无已删除项目
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <p>删除项目时，如果当前表格里已经有该列的数据，系统会先提醒你。</p>
                    <p className="mt-2">删除后的项目会先隐藏，不会立刻清空已有识别值；你也可以在这里恢复。</p>
                    <p className="mt-2">当前项目的上下顺序，就是填表表头和标注字段的显示顺序。</p>
                  </div>

                  <button
                    type="button"
                    className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
                    onClick={() => void submitFieldDrafts()}
                    disabled={isSavingFieldConfig}
                  >
                    {isSavingFieldConfig ? "保存中..." : "保存项目配置"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <section className="grid min-h-[calc(100vh-170px)] grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div ref={uploadPanelRef} className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold">图片上传区</h2>
              <p className="mt-1 text-sm text-slate-500">支持批量上传 JPG / PNG，支持直接 Ctrl+V 粘贴截图。</p>
            </div>

            <div className="space-y-4 p-5">
              <label
                className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center transition ${
                  isDraggingFiles
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100"
                }`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <span className="text-sm font-medium">点击、拖拽或粘贴上传图片</span>
                <span className="mt-1 text-xs text-slate-500">
                  {isDraggingFiles ? "松开鼠标即可上传图片" : "可一次选择多张，或直接 Ctrl+V 粘贴"}
                </span>
                <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => void handleFiles(event.target.files)} />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  onClick={extractData}
                  disabled={isExtracting || !uploads.length}
                >
                  {isExtracting ? "AI 识别中..." : "开始 AI 填表"}
                </button>
                <button
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
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
                        setErrorMessage("剪贴板中没有图片。");
                      }
                    } catch {
                      setErrorMessage("无法读取剪贴板，请确保已授予浏览器权限，或直接使用 Ctrl+V 快捷键粘贴。");
                    }
                  }}
                >
                  从剪贴板粘贴
                </button>
                <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50" onClick={clearAll}>
                  清空
                </button>
              </div>

              {progress ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">识别进度</span>
                    <span className="text-slate-500">
                      {progress.completed} / {progress.total}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    当前批量并发识别中，已完成 {progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}%
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl bg-slate-50 px-3 py-3">
                  <div className="text-slate-500">录入条数</div>
                  <div className="mt-1 text-xl font-semibold">{organizedRecordsResult.records.length}</div>
                </div>
                <div className="rounded-2xl bg-amber-50 px-3 py-3">
                  <div className="text-amber-700">警告</div>
                  <div className="mt-1 text-xl font-semibold text-amber-700">{totalWarnings}</div>
                </div>
                <div className="rounded-2xl bg-rose-50 px-3 py-3">
                  <div className="text-rose-700" title="仅统计跨多张截图的完全重复行；同一张图内相同字段的多行不会合并">
                    跨图合并数
                  </div>
                  <div className="mt-1 text-xl font-semibold text-rose-700">{organizedRecordsResult.duplicateCount}</div>
                </div>
              </div>

              {trainingStatus ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
                  <div className="mb-2 font-medium text-slate-700">训练池状态</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-slate-500">训练图片</div>
                      <div className="text-lg font-semibold">{trainingStatus.totalImages}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">已标注</div>
                      <div className="text-lg font-semibold text-emerald-700">{trainingStatus.labeledImages}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">未标注</div>
                      <div className="text-lg font-semibold text-amber-700">{trainingStatus.unlabeledImages}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div>
              ) : null}

              {noticeMessage ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{noticeMessage}</div>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-1">
                <div className="max-h-[600px] overflow-auto rounded-2xl border border-slate-200">
                  {uploads.length ? (
                    <ul className="divide-y divide-slate-200">
                      {uploads.map((upload) => (
                        <li key={upload.id}>
                          <button
                            className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                              selectedUpload?.id === upload.id ? "bg-blue-50 ring-1 ring-inset ring-blue-400" : "bg-white hover:bg-slate-50"
                            }`}
                            onClick={(e) => handleImageClick(upload, e)}
                          >
                            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                              <Image src={upload.previewUrl} alt={upload.file.name} className="object-cover" fill unoptimized />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-slate-700">{upload.file.name}</div>
                              <div className="mt-0.5 text-xs text-slate-500">
                                {(upload.file.size / 1024).toFixed(1)} KB
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">上传后这里会显示图片列表</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">在线表格</h2>
                <p className="mt-1 text-sm text-slate-500">识别后可直接修改、复制到其他表格，或下载成 Excel。</p>
                <p className="mt-1 text-xs text-slate-500">表格项目可在这里增删改名，保存后会同步到训练页和标注项目。</p>
                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">识别条目</span>
                  <span>
                    ：共 <strong>{organizedRecordsResult.records.length.toLocaleString()}</strong> 条
                  </span>
                  {organizedRecordsResult.duplicateCount > 0 ? (
                    <span className="text-slate-500">
                      （原始识别 {records.length.toLocaleString()} 行，跨图合并{" "}
                      {organizedRecordsResult.duplicateCount.toLocaleString()} 条）
                    </span>
                  ) : null}
                  {routeFilter.trim() &&
                  filteredRecordsResult.records.length !== organizedRecordsResult.records.length ? (
                    <span className="text-blue-800">
                      · 当前显示 {filteredRecordsResult.records.length.toLocaleString()} 条（路线筛选）
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="relative flex items-center">
                  <input
                    ref={filterInputRef}
                    type="text"
                    placeholder="输入或选择路线..."
                    value={routeFilter}
                    onChange={(e) => {
                      setRouteFilter(e.target.value);
                      setIsRouteDropdownOpen(true);
                    }}
                    onFocus={() => setIsRouteDropdownOpen(true)}
                    className="w-56 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 pr-8 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
                  />
                  {routeFilter ? (
                    <button
                      onClick={() => {
                        setRouteFilter("");
                        setIsRouteDropdownOpen(false);
                      }}
                      className="absolute right-2 text-slate-400 hover:text-slate-600"
                      title="清除搜索"
                    >
                      ✕
                    </button>
                  ) : (
                    <svg className="absolute right-2.5 h-4 w-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                  
                  {isRouteDropdownOpen && allAvailableRoutes.length > 0 && (
                    <div 
                      ref={filterDropdownRef}
                      className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                    >
                      {filteredRoutes.length > 0 ? (
                        filteredRoutes.map((route) => (
                          <button
                            key={route}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 focus:bg-slate-50 outline-none"
                            onClick={() => {
                              setRouteFilter(route);
                              setIsRouteDropdownOpen(false);
                            }}
                          >
                            {route}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-slate-500">
                          没有匹配的路线
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                    onClick={openFieldManager}
                  >
                    编辑表格项目
                  </button>
                  <button
                    className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void retryAllReviewRecords()}
                    disabled={!reviewRecords.length || isExtracting || isRetryingReviewAll}
                  >
                    {isRetryingReviewAll
                      ? `待复核批量重识别中...`
                      : `一键重识别待复核（${reviewRecords.length}）`}
                  </button>
                  <button
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={copyTable}
                    disabled={!filteredRecordsResult.records.length}
                  >
                    复制表格内容
                  </button>
                  <button
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    onClick={downloadExcel}
                    disabled={!filteredRecordsResult.records.length}
                  >
                    下载 Excel
                  </button>
                </div>
              </div>
            </div>

            {issues.length ? (
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div className="mb-2 text-sm font-semibold">复核提醒</div>
                <div className="max-h-36 space-y-2 overflow-auto text-sm">
                  {issues.map((issue, index) => (
                    <div
                      key={`${issue.imageName}-${issue.route || "none"}-${index}`}
                      className={`rounded-xl px-3 py-2 ${issue.level === "error" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}
                    >
                      <span className="font-medium">{issue.imageName}</span>
                      {issue.route ? ` / ${issue.route}` : ""}
                      {`：${issue.message}`}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-slate-900 text-white">
                  <tr>
                    <th className="border-b border-slate-700 px-3 py-3 text-left font-medium">来源图片</th>
                    {activeTableFields.map((column) => (
                      <th key={column.id} className="border-b border-slate-700 px-3 py-3 text-left font-medium">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRecordsResult.records.length ? (
                    groupedRecords.map(([route, routeRecords]) => (
                      <Fragment key={route}>
                        <tr className="bg-slate-200">
                          <td colSpan={activeTableFields.length + 1} className="border-b border-slate-300 px-3 py-2 text-left font-semibold text-slate-800">
                            路线分组：{route} · {routeRecords.length} 条
                          </td>
                        </tr>
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
                                    跨图合并
                                  </span>
                                  <span className="text-xs text-violet-700">
                                    {mergedSourceImageCount(record)} 张源图合并为一条
                                  </span>
                                </div>
                              ) : null}
                              {recordNeedsReviewBadge(record) ? (
                                <div className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">待复核</div>
                              ) : null}
                              {hasConsistencyMismatch(record) ? (
                                <div className="mt-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">四次校验不一致</div>
                              ) : null}
                              {hasTotalSourceMismatch(record) ? (
                                <div className="mt-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">运单量来源异常</div>
                              ) : null}
                              {getRecordIssues(record).length ? (
                                <div className="mt-2">
                                  <button
                                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    onClick={() => retryRecord(record)}
                                    disabled={retryingKeys.includes(record.id)}
                                  >
                                    {retryingKeys.includes(record.id) ? "再次识别中..." : "再次识别"}
                                  </button>
                                </div>
                              ) : null}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                  onClick={(event) => openRecordImage(record, event.currentTarget)}
                                >
                                  查看图片
                                </button>
                                {needsManualAnnotation(record) ? (
                                  <>
                                    <button
                                      className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                                      onClick={(event) => void openAnnotationPanel(record, event.currentTarget)}
                                    >
                                      打开标注
                                    </button>
                                    <button
                                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                                      onClick={() => deleteRecord(record)}
                                    >
                                      删除条目
                                    </button>
                                  </>
                                ) : null}
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
                        {routeFilter ? "没有找到匹配该路线的记录。" : "上传图片并点击“开始 AI 填表”后，结果会出现在这里。"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {viewerPopupPosition && (viewerGallery.length > 0 || viewerLoadError || viewerGalleryLoading) ? (
          <div
            className="fixed z-50 max-h-[85vh] overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl"
            style={{
              top: viewerPopupPosition.top,
              left: viewerPopupPosition.left,
              width: viewerPopupPosition.width,
            }}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">图片查看</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {viewerGallery.length > 1
                    ? `本条目由 ${viewerGallery.length} 张源图合并，可滚动查看每张图；可放大并拖动辅助人工核对。`
                    : "查看当前条目对应图片，可放大并拖动图片位置，辅助人工修改表格。"}
                </p>
              </div>
              <button
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                onClick={closeViewerPopup}
              >
                关闭窗口
              </button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              {viewingRecord ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  {viewingRecord.route} / {viewingRecord.driver}
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  未生成记录
                </span>
              )}
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => zoomViewer(0.25)}
              >
                放大
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => zoomViewer(-0.25)}
              >
                缩小
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={resetViewer}
              >
                重置
              </button>
              {viewingRecord && (
                <button
                  className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  onClick={(event) => void openAnnotationPanel(viewingRecord, event.currentTarget)}
                >
                  转到标注
                </button>
              )}
            </div>

            {viewerLoadError && viewerGallery.length > 0 ? (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                部分源图未加载：{viewerLoadError}
              </div>
            ) : null}

            <div
              className="relative h-[520px] overflow-auto rounded-2xl border border-slate-200 bg-slate-50"
              onMouseDown={beginViewerDrag}
              onMouseMove={updateViewerDrag}
              onMouseUp={endViewerDrag}
              onMouseLeave={endViewerDrag}
            >
              {viewerGalleryLoading && viewerGallery.length === 0 && !viewerLoadError ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">图片加载中…</div>
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
                <div className="flex h-full items-center justify-center text-sm text-slate-500">图片加载中…</div>
              )}
            </div>
          </div>
        ) : null}

        {annotatingRecord && annotationDraft ? (
          <TrainingAnnotationWorkbench
            open
            imageName={annotationImageName}
            imageSrc={annotationImageSrc}
            fieldDefinitions={activeTableFields}
            initialSeed={annotationDraft.seed}
            initialBoxes={annotationDraft.boxes}
            initialFieldAggregations={annotationDraft.fieldAggregations}
            initialNotes={annotationDraft.notes}
            onClose={closeRecordPopup}
            onNotice={setNoticeMessage}
            onError={setErrorMessage}
            onSaved={async ({ totalExamples, finalSeed }) => {
              const recordId = annotatingRecord.id;
              await loadTrainingStatus();
              setNoticeMessage(`标注已存入训练池，当前训练样本总数 ${totalExamples || 0}。`);
              applyAnnotationSeedToRecord(recordId, finalSeed);
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
