"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import {
  type ExtractionIssue,
  type ExtractionResponse,
  type PodRecord,
  excelHeaders,
  organizeRecords,
} from "@/lib/pod";

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
};

type AnnotationField = "date" | "route" | "driver" | "total" | "unscanned" | "exceptions" | "waybillStatus" | "stationTeam";

type AnnotationBox = {
  field: AnnotationField;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
      total: number;
      unscanned: number;
      exceptions: number;
      stationTeam?: string;
    };
    boxes?: AnnotationBox[];
  } | null;
};

type TrainingStatusResponse = {
  totalImages: number;
  labeledImages: number;
  unlabeledImages: number;
  items: TrainingStatusItem[];
};

type DrawingState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type RecordPopupMode = "view" | "annotate";

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

const editableColumns: Array<{
  key: keyof Pick<PodRecord, "date" | "route" | "driver" | "total" | "unscanned" | "exceptions" | "waybillStatus">;
  label: string;
  type?: "text" | "number";
}> = [
  { key: "date", label: "日期" },
  { key: "route", label: "抽查路线" },
  { key: "driver", label: "抽查司机" },
  { key: "total", label: "运单数量", type: "number" },
  { key: "unscanned", label: "未收数量", type: "number" },
  { key: "exceptions", label: "错扫数量", type: "number" },
  { key: "waybillStatus", label: "响应更新状态" },
];

const annotationFields: Array<{ key: AnnotationField; label: string }> = [
  { key: "date", label: "日期" },
  { key: "route", label: "抽查路线" },
  { key: "driver", label: "抽查司机" },
  { key: "total", label: "运单数量" },
  { key: "unscanned", label: "未收数量" },
  { key: "exceptions", label: "错扫数量" },
  { key: "waybillStatus", label: "响应更新状态" },
  { key: "stationTeam", label: "站点车队" },
];

function buildExportRows(records: PodRecord[]) {
  return records.map((record) => [
    record.date,
    record.route,
    record.driver,
    record.total,
    record.unscanned,
    record.exceptions,
    record.waybillStatus || "",
    record.stationTeam || "",
  ]);
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
  const primaryModelName = "gpt-5-mini";
  const reviewModelName = "gpt-5";

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [records, setRecords] = useState<PodRecord[]>([]);
  const [issues, setIssues] = useState<ExtractionIssue[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [retryingKeys, setRetryingKeys] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [trainingExamplesLoaded, setTrainingExamplesLoaded] = useState(0);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [annotatingRecord, setAnnotatingRecord] = useState<PodRecord | null>(null);
  const [annotationImageSrc, setAnnotationImageSrc] = useState("");
  const [annotationImageName, setAnnotationImageName] = useState("");
  const [annotationBoxes, setAnnotationBoxes] = useState<AnnotationBox[]>([]);
  const [annotationNotes, setAnnotationNotes] = useState("");
  const [annotationField, setAnnotationField] = useState<AnnotationField>("driver");
  const [annotationStationTeam, setAnnotationStationTeam] = useState("");
  const [drawingState, setDrawingState] = useState<DrawingState | null>(null);
  const [isSavingTraining, setIsSavingTraining] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [recordPopupMode, setRecordPopupMode] = useState<RecordPopupMode>("view");
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);
  const [viewingRecord, setViewingRecord] = useState<PodRecord | null>(null);
  const [viewerImageSrc, setViewerImageSrc] = useState("");
  const [viewerImageName, setViewerImageName] = useState("");
  const [viewerPopupPosition, setViewerPopupPosition] = useState<PopupPosition | null>(null);
  const [viewerScale, setViewerScale] = useState(1);
  const [viewerPan, setViewerPan] = useState<ViewerPan>({ x: 0, y: 0 });
  const [viewerDragState, setViewerDragState] = useState<ViewerDragState | null>(null);
  const [viewerLoadError, setViewerLoadError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [isRouteDropdownOpen, setIsRouteDropdownOpen] = useState(false);
  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const filterDropdownRef = useRef<HTMLDivElement | null>(null);
  const popupAnchorRef = useRef<HTMLElement | null>(null);
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
    void loadTrainingStatus();
  }, []);

  useEffect(() => {
    if (!annotatingRecord || !popupAnchorRef.current) {
      return;
    }

    const updatePopupPosition = () => {
      if (!popupAnchorRef.current) {
        return;
      }

      const rect = popupAnchorRef.current.getBoundingClientRect();
      const desiredWidth = recordPopupMode === "annotate" ? 980 : 540;
      const desiredHeight = recordPopupMode === "annotate" ? 760 : 580;
      const rightSideAvailable = Math.max(260, window.innerWidth - rect.right - 24);
      const popupWidth = Math.max(260, Math.min(desiredWidth, rightSideAvailable));
      const left = Math.min(rect.right + 12, window.innerWidth - popupWidth - 16);
      const top = Math.max(16, Math.min(rect.top, window.innerHeight - desiredHeight - 16));
      setPopupPosition({ top, left, width: popupWidth });
    };

    updatePopupPosition();
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
    };
  }, [annotatingRecord, recordPopupMode]);

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
  const drawingPreview = useMemo(() => {
    if (!drawingState) {
      return null;
    }

    return {
      x: Math.min(drawingState.startX, drawingState.currentX),
      y: Math.min(drawingState.startY, drawingState.currentY),
      width: Math.abs(drawingState.currentX - drawingState.startX),
      height: Math.abs(drawingState.currentY - drawingState.startY),
    };
  }, [drawingState]);
  const activePopupRecordId = viewingRecord?.id || annotatingRecord?.id || null;

  const totalWarnings = issues.filter((issue) => issue.level === "warning").length;

  function getSourceImageNames(record: PodRecord) {
    return record.imageName
      .split(" | ")
      .map((value) => value.trim())
      .filter(Boolean);
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

  function closeRecordPopup() {
    setAnnotatingRecord(null);
    setAnnotationImageName("");
    setAnnotationImageSrc("");
    setAnnotationBoxes([]);
    setAnnotationNotes("");
    setAnnotationStationTeam("");
    setPopupPosition(null);
    popupAnchorRef.current = null;
  }

  function closeViewerPopup() {
    setViewingRecord(null);
    setViewerImageSrc("");
    setViewerImageName("");
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

  function calculatePopupPosition(anchor: HTMLElement, mode: "viewer" | "annotate"): PopupPosition {
    const rect = anchor.getBoundingClientRect();
    const desiredWidth = mode === "annotate" ? 980 : 420;
    const desiredHeight = mode === "annotate" ? 760 : 620;
    const minWidth = mode === "annotate" ? 260 : 260;
    let width = desiredWidth;
    let left = rect.right + 12;

    if (mode === "viewer") {
      const leftSideAvailable = Math.max(minWidth, rect.left - 24);
      width = Math.max(minWidth, Math.min(desiredWidth, leftSideAvailable));
      left = Math.max(16, rect.left - width - 12);
    } else {
      const rightSideAvailable = Math.max(minWidth, window.innerWidth - rect.right - 24);
      width = Math.max(minWidth, Math.min(desiredWidth, rightSideAvailable));
      left = Math.min(rect.right + 12, window.innerWidth - width - 16);
    }

    const top = Math.max(16, Math.min(rect.top, window.innerHeight - desiredHeight - 16));
    return { top, left, width };
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
        organized.duplicateCount > 0 ? `，已自动去重 ${organized.duplicateCount} 条完全重复记录` : "";
      setNoticeMessage(
        `AI 已完成识别，共生成 ${organized.records.length} 条记录${dedupeMessage}。批量识别已启用并发加速，默认使用 ${payload.modelUsed || primaryModelName}。`,
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
        organized.duplicateCount > 0 ? `，当前已自动去重 ${organized.duplicateCount} 条完全重复记录` : "";
      setNoticeMessage(
        `已使用 ${payload.modelUsed || reviewModelName} 重新识别 ${sourceImageNames.length} 张图片${dedupeMessage}。`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "再次识别失败。");
    } finally {
      setRetryingKeys((current) => current.filter((key) => key !== record.id));
    }
  }

  async function copyTable() {
    const rows = [excelHeaders, ...buildExportRows(filteredRecordsResult.records)];
    const text = rows.map((row) => row.join("\t")).join("\n");
    await navigator.clipboard.writeText(text);
    setNoticeMessage("表格内容已复制，可直接粘贴到其他表格。");
  }

  function downloadExcel() {
    const worksheet = XLSX.utils.aoa_to_sheet([excelHeaders, ...buildExportRows(filteredRecordsResult.records)]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "OrSight数据");
    const filename = `${formatDateForFilename(filteredRecordsResult.records[0]?.date)}.xlsx`;
    XLSX.writeFile(workbook, filename);
    setNoticeMessage(`Excel 已下载：${filename}`);
  }

  function updateRecord(id: string, field: keyof PodRecord, value: string) {
    setRecords((current) =>
      current.map((record) => {
        if (record.id !== id) {
          return record;
        }

        if (field === "total" || field === "unscanned" || field === "exceptions") {
          return {
            ...record,
            [field]: value === "" ? "" : Number(value),
          };
        }

        return {
          ...record,
          [field]: value,
        };
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

  async function openAnnotationPanel(record: PodRecord, anchorElement?: HTMLElement) {
    const imageName = getSourceImageNames(record)[0];
    if (!imageName) {
      setErrorMessage("找不到该条记录对应的图片名。");
      return;
    }

    const anchor = resolveRowAnchor(anchorElement);
    popupAnchorRef.current = anchor;
    if (anchor) {
      setPopupPosition(calculatePopupPosition(anchor, "annotate"));
    }

    const matchedUpload = uploads.find((upload) => upload.file.name === imageName);

    try {
      if (viewingRecord) {
        closeViewerPopup();
      }
      const imageSrc = await resolveAnnotationImage(imageName, matchedUpload?.previewUrl);
      setRecordPopupMode("annotate");
      setAnnotatingRecord(record);
      setAnnotationImageName(imageName);
      setAnnotationImageSrc(imageSrc);
      setAnnotationBoxes([]);
      setAnnotationField("driver");
      setAnnotationNotes("人工标注用于训练池。");
      setAnnotationStationTeam(record.stationTeam || "");
      if (matchedUpload) {
        setSelectedUploadId(matchedUpload.id);
      }
      setNoticeMessage(`已打开标注工作台：${imageName}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开标注失败。");
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
        setViewerPopupPosition(calculatePopupPosition(anchor, "viewer"));
      }

      if (annotatingRecord) {
        closeRecordPopup();
      }

      setViewingRecord(null);
      setViewerImageName(upload.file.name);
      setViewerImageSrc(upload.previewUrl);
      setViewerLoadError("");
      setViewerScale(1);
      setViewerPan({ x: 0, y: 0 });
      setNoticeMessage(`已打开图片：${upload.file.name}`);
    }
  }

  function openRecordImage(record: PodRecord, anchorElement?: HTMLElement) {
    const imageName = getSourceImageNames(record)[0];
    if (!imageName) {
      setErrorMessage("找不到该条记录对应的图片名。");
      return;
    }

    const anchor = resolveRowAnchor(anchorElement);
    viewerAnchorRef.current = anchor;
    if (anchor) {
      setViewerPopupPosition(calculatePopupPosition(anchor, "viewer"));
    }

    if (annotatingRecord) {
      closeRecordPopup();
    }

    setViewingRecord(record);
    setViewerImageName(imageName);
    setViewerImageSrc("");
    setViewerLoadError("");
    setViewerScale(1);
    setViewerPan({ x: 0, y: 0 });
    setNoticeMessage(`正在打开图片：${imageName}`);

    const matchedUpload = uploads.find((upload) => upload.file.name === imageName);
    if (matchedUpload) {
      setSelectedUploadId(matchedUpload.id);
    }

    void resolveAnnotationImage(imageName, matchedUpload?.previewUrl)
      .then((imageSrc) => {
        setViewerImageSrc(imageSrc);
        setNoticeMessage(`已打开图片：${imageName}`);
      })
      .catch((error) => {
        setViewerLoadError(error instanceof Error ? error.message : "打开图片失败。");
        setErrorMessage(error instanceof Error ? error.message : "打开图片失败。");
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

  function getAnnotationFieldValue(record: PodRecord | null, field: AnnotationField) {
    if (!record) {
      return "";
    }

    if (field === "stationTeam") {
      return annotationStationTeam;
    }

    const value = record[field as keyof PodRecord];
    return value === null || value === undefined || value === "" ? "" : String(value);
  }

  function getRelativePoint(event: React.MouseEvent<HTMLDivElement>) {
    const rect = annotationCanvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  function beginDrawing(event: React.MouseEvent<HTMLDivElement>) {
    const point = getRelativePoint(event);
    if (!point) {
      return;
    }

    setDrawingState({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function updateDrawing(event: React.MouseEvent<HTMLDivElement>) {
    if (!drawingState) {
      return;
    }

    const point = getRelativePoint(event);
    if (!point) {
      return;
    }

    setDrawingState({
      ...drawingState,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function finishDrawing() {
    if (!drawingState || !annotatingRecord) {
      setDrawingState(null);
      return;
    }

    const x = Math.min(drawingState.startX, drawingState.currentX);
    const y = Math.min(drawingState.startY, drawingState.currentY);
    const width = Math.abs(drawingState.currentX - drawingState.startX);
    const height = Math.abs(drawingState.currentY - drawingState.startY);
    setDrawingState(null);

    if (width < 0.01 || height < 0.01) {
      return;
    }

    const nextBox: AnnotationBox = {
      field: annotationField,
      value: getAnnotationFieldValue(annotatingRecord, annotationField),
      x,
      y,
      width,
      height,
    };

    setAnnotationBoxes((current) => [...current.filter((box) => box.field !== annotationField), nextBox]);
  }

  function removeAnnotationBox(field: AnnotationField) {
    setAnnotationBoxes((current) => current.filter((box) => box.field !== field));
  }

  async function imageSourceToDataUrl(source: string) {
    if (source.startsWith("data:")) {
      return source;
    }

    const response = await fetch(source);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败。"));
      reader.readAsDataURL(blob);
    });
  }

  async function saveAnnotationToTrainingPool() {
    if (!annotatingRecord || !annotationImageName || !annotationImageSrc) {
      setErrorMessage("当前没有可保存的标注。");
      return;
    }

    if (!annotationBoxes.length) {
      setErrorMessage("请至少标注一个字段框后再保存。");
      return;
    }

    setIsSavingTraining(true);
    setErrorMessage("");

    try {
      const imageDataUrl = await imageSourceToDataUrl(annotationImageSrc);
      const response = await fetch("/api/training/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageName: annotationImageName,
          imageDataUrl,
          notes: annotationNotes,
          output: {
            date: annotatingRecord.date,
            route: annotatingRecord.route,
            driver: annotatingRecord.driver,
            total: annotatingRecord.total,
            unscanned: annotatingRecord.unscanned,
            exceptions: annotatingRecord.exceptions,
            stationTeam: annotationStationTeam,
          },
          boxes: annotationBoxes,
        }),
      });

      const payload = (await response.json()) as { error?: string; totalExamples?: number };
      if (!response.ok) {
        throw new Error(payload.error || "保存训练样本失败。");
      }

      await loadTrainingStatus();
      setNoticeMessage(`标注已存入训练池，当前训练样本总数 ${payload.totalExamples || 0}。`);
      closeRecordPopup();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存训练样本失败。");
    } finally {
      setIsSavingTraining(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 text-slate-900">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
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
                  <div className="text-rose-700">去重数</div>
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
                    {editableColumns.map((column) => (
                      <th key={column.key} className="border-b border-slate-700 px-3 py-3 text-left font-medium">
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
                          <td colSpan={editableColumns.length + 1} className="border-b border-slate-300 px-3 py-2 text-left font-semibold text-slate-800">
                            路线分组：{route} · {routeRecords.length} 条
                          </td>
                        </tr>
                        {routeRecords.map((record) => (
                          <tr
                            key={record.id}
                            id={`record-row-${record.id}`}
                            className={`odd:bg-white even:bg-slate-50 ${
                              needsManualAnnotation(record) ? "bg-rose-50/70" : ""
                            } ${
                              activePopupRecordId === record.id
                                ? "relative ring-2 ring-blue-400 ring-inset bg-blue-50/80"
                                : ""
                            }`}
                          >
                            <td className="border-b border-slate-200 px-3 py-2 align-top text-slate-600">
                              <div className="max-w-56 whitespace-pre-wrap break-words">{record.imageName}</div>
                              {record.reviewRequired ? (
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
                            {editableColumns.map((column) => (
                              <td key={column.key} className="border-b border-slate-200 px-2 py-2 align-top">
                                <input
                                  type={column.type || "text"}
                                  value={record[column.key]}
                                  onChange={(event) => updateRecord(record.id, column.key, event.target.value)}
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
                      <td colSpan={editableColumns.length + 1} className="px-4 py-16 text-center text-slate-500">
                        {routeFilter ? "没有找到匹配该路线的记录。" : "上传图片并点击“开始 AI 填表”后，结果会出现在这里。"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {viewerImageName && viewerPopupPosition ? (
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
                <p className="mt-1 text-sm text-slate-500">查看当前条目对应图片，可放大并拖动图片位置，辅助人工修改表格。</p>
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

            <div
              className="relative h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
              onMouseDown={beginViewerDrag}
              onMouseMove={updateViewerDrag}
              onMouseUp={endViewerDrag}
              onMouseLeave={endViewerDrag}
            >
              {viewerImageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={viewerImageSrc}
                  alt={viewerImageName}
                  className="h-full w-full object-contain select-none"
                  draggable={false}
                  style={{
                    transform: `translate(${viewerPan.x}px, ${viewerPan.y}px) scale(${viewerScale})`,
                    transformOrigin: "center center",
                    cursor: viewerScale > 1 ? (viewerDragState ? "grabbing" : "grab") : "default",
                  }}
                />
              ) : viewerLoadError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-rose-600">
                  {viewerLoadError}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">图片加载中...</div>
              )}
            </div>
          </div>
        ) : null}

        {annotatingRecord && popupPosition ? (
          <div
            className="fixed z-50 max-h-[85vh] overflow-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl"
            style={{
              top: popupPosition.top,
              left: popupPosition.left,
              width: popupPosition.width,
            }}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{recordPopupMode === "annotate" ? "人工标注工作台" : "图片查看"}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {recordPopupMode === "annotate"
                    ? "选择字段后，在图片上拖动画框，完成后点击“存入训练池”。"
                    : "查看当前条目对应图片，必要时切换到标注模式。"}
                </p>
              </div>
              <button
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                onClick={closeRecordPopup}
              >
                关闭窗口
              </button>
            </div>

            <div className={`grid gap-4 ${recordPopupMode === "annotate" ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3 text-sm font-medium text-slate-700">标注图片：{annotationImageName}</div>
                <div
                  ref={annotationCanvasRef}
                  className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black/5"
                  onMouseDown={beginDrawing}
                  onMouseMove={updateDrawing}
                  onMouseUp={finishDrawing}
                  onMouseLeave={finishDrawing}
                >
                  {annotationImageSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={annotationImageSrc} alt={annotationImageName} className="h-full w-full object-contain" />
                  ) : null}
                  {annotationBoxes.map((box) => (
                    <div
                      key={box.field}
                      className="pointer-events-none absolute border-2 border-rose-500 bg-rose-500/10"
                      style={{
                        left: `${box.x * 100}%`,
                        top: `${box.y * 100}%`,
                        width: `${box.width * 100}%`,
                        height: `${box.height * 100}%`,
                      }}
                    >
                      <span className="absolute left-0 top-0 -translate-y-full rounded bg-rose-500 px-1.5 py-0.5 text-[10px] text-white">
                        {annotationFields.find((item) => item.key === box.field)?.label}
                      </span>
                    </div>
                  ))}
                  {drawingPreview ? (
                    <div
                      className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/10"
                      style={{
                        left: `${drawingPreview.x * 100}%`,
                        top: `${drawingPreview.y * 100}%`,
                        width: `${drawingPreview.width * 100}%`,
                        height: `${drawingPreview.height * 100}%`,
                      }}
                    />
                  ) : null}
                </div>
              </div>

              {recordPopupMode === "annotate" ? (
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">当前要画的字段</label>
                  <select
                    value={annotationField}
                    onChange={(event) => setAnnotationField(event.target.value as AnnotationField)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                  >
                    {annotationFields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-3">
                  {editableColumns.map((column) => (
                    <label key={column.key} className="block">
                      <span className="mb-1 block text-sm text-slate-700">{column.label}</span>
                      <input
                        type={column.type || "text"}
                        value={annotatingRecord[column.key]}
                        onChange={(event) => updateRecord(annotatingRecord.id, column.key, event.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                      />
                    </label>
                  ))}
                  <label className="block">
                    <span className="mb-1 block text-sm text-slate-700">站点车队</span>
                    <input
                      type="text"
                      value={annotationStationTeam}
                      onChange={(event) => setAnnotationStationTeam(event.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm text-slate-700">训练备注</span>
                    <textarea
                      value={annotationNotes}
                      onChange={(event) => setAnnotationNotes(event.target.value)}
                      className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    />
                  </label>
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-slate-700">已画框字段</div>
                  <div className="space-y-2">
                    {annotationFields.map((field) => {
                      const box = annotationBoxes.find((item) => item.field === field.key);
                      return (
                        <div key={field.key} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm">
                          <span>
                            {field.label}：{box ? "已标注" : "未标注"}
                          </span>
                          {box ? (
                            <button className="text-rose-600 hover:text-rose-500" onClick={() => removeAnnotationBox(field.key)}>
                              删除
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  onClick={() => void saveAnnotationToTrainingPool()}
                  disabled={isSavingTraining}
                >
                  {isSavingTraining ? "保存训练样本中..." : "存入训练池"}
                </button>
                </div>
              ) : (
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-600">
                    当前条目：`{annotatingRecord.route}` / `{annotatingRecord.driver}`
                  </div>
                  <button
                    className="w-full rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100"
                    onClick={(event) => void openAnnotationPanel(annotatingRecord, event.currentTarget)}
                  >
                    切换到标注模式
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
