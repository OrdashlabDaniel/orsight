"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { type PodRecord } from "@/lib/pod";

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
};

type AnnotationField = "date" | "route" | "driver" | "total" | "unscanned" | "exceptions" | "stationTeam";

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

type PopupPosition = {
  top: number;
  left: number;
  width: number;
};

const annotationFields: Array<{ key: AnnotationField; label: string }> = [
  { key: "date", label: "日期" },
  { key: "route", label: "抽查路线" },
  { key: "driver", label: "抽查司机" },
  { key: "total", label: "运单数量" },
  { key: "unscanned", label: "未收数量" },
  { key: "exceptions", label: "错扫数量" },
  { key: "stationTeam", label: "站点车队" },
];

export default function TrainingMode() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const [annotatingItem, setAnnotatingItem] = useState<UploadItem | TrainingStatusItem | null>(null);
  const [annotationImageName, setAnnotationImageName] = useState("");
  const [annotationImageSrc, setAnnotationImageSrc] = useState("");
  const [annotationBoxes, setAnnotationBoxes] = useState<AnnotationBox[]>([]);
  const [annotationField, setAnnotationField] = useState<AnnotationField>("driver");
  const [annotationNotes, setAnnotationNotes] = useState("");
  
  // Manual record fields
  const [manualRecord, setManualRecord] = useState<Partial<PodRecord> & { stationTeam?: string }>({});

  const [drawingState, setDrawingState] = useState<DrawingState | null>(null);
  const [isSavingTraining, setIsSavingTraining] = useState(false);

  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);

  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
  const popupAnchorRef = useRef<HTMLElement | null>(null);
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
    if (!annotatingItem || !popupAnchorRef.current) {
      return;
    }

    const updatePopupPosition = () => {
      if (!popupAnchorRef.current) {
        return;
      }

      const rect = popupAnchorRef.current.getBoundingClientRect();
      const desiredWidth = 980;
      const desiredHeight = 760;
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
  }, [annotatingItem]);

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

  function resolveRowAnchor(element?: HTMLElement) {
    if (!element) {
      return uploadPanelRef.current;
    }
    const tr = element.closest("tr");
    if (tr) {
      return tr;
    }
    const li = element.closest("li");
    if (li) {
      return li;
    }
    return uploadPanelRef.current;
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

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList?.length) {
      return;
    }

    try {
      const nextUploads = await Promise.all(
        Array.from(fileList).map(async (file, index) => {
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
      setNoticeMessage(`已加入 ${nextUploads.length} 张待标注图片。`);
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
    setErrorMessage("");
    setNoticeMessage("已清空待标注图片。");
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

  function handleImageClick(upload: UploadItem, event: React.MouseEvent<HTMLElement>) {
    setSelectedUploadId(upload.id);
    openAnnotationPanel(upload, event.currentTarget);
  }

  function handleTrainingItemClick(item: TrainingStatusItem, event: React.MouseEvent<HTMLElement>) {
    openAnnotationPanel(item, event.currentTarget);
  }

  async function openAnnotationPanel(item: UploadItem | TrainingStatusItem, anchorElement?: HTMLElement) {
    const anchor = resolveRowAnchor(anchorElement);
    popupAnchorRef.current = anchor;
    
    setAnnotatingItem(item);
    
    let imageName = "";
    let previewUrl = "";
    let existingExample: TrainingStatusItem["example"] = null;

    if ("file" in item) {
      // It's an UploadItem
      imageName = item.file.name;
      previewUrl = item.previewUrl;
    } else {
      // It's a TrainingStatusItem
      imageName = item.imageName;
      existingExample = item.example;
    }

    setAnnotationImageName(imageName);
    setAnnotationImageSrc("");
    setAnnotationBoxes(existingExample?.boxes || []);
    setAnnotationField("driver");
    setAnnotationNotes(existingExample?.notes || "人工标注用于训练池。");
    
    setManualRecord({
      date: existingExample?.output.date || "",
      route: existingExample?.output.route || "",
      driver: existingExample?.output.driver || "",
      total: existingExample?.output.total || undefined,
      unscanned: existingExample?.output.unscanned || undefined,
      exceptions: existingExample?.output.exceptions || undefined,
      stationTeam: existingExample?.output.stationTeam || "",
    });

    setNoticeMessage(`正在打开标注工作台：${imageName}`);

    try {
      const imageSrc = await resolveAnnotationImage(imageName, previewUrl);
      setAnnotationImageSrc(imageSrc);
      setNoticeMessage(`已打开标注工作台：${imageName}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开标注失败。");
    }
  }

  function closeRecordPopup() {
    setAnnotatingItem(null);
    setDrawingState(null);
  }

  function getAnnotationFieldValue(field: AnnotationField) {
    const value = manualRecord[field as keyof typeof manualRecord];
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
    if (!drawingState || !annotatingItem) {
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
      value: getAnnotationFieldValue(annotationField),
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
    if (!annotatingItem || !annotationImageName || !annotationImageSrc) {
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
            date: manualRecord.date || "",
            route: manualRecord.route || "",
            driver: manualRecord.driver || "",
            total: Number(manualRecord.total) || 0,
            unscanned: Number(manualRecord.unscanned) || 0,
            exceptions: Number(manualRecord.exceptions) || 0,
            stationTeam: manualRecord.stationTeam || "",
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
      
      // If it was an upload item, we might want to remove it from the uploads list or mark it as done
      if ("file" in annotatingItem) {
        setUploads(current => current.filter(u => u.id !== annotatingItem.id));
      }
      
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
          <h1 className="text-2xl font-semibold">OrSight - 训练模式</h1>
          <p className="mt-2 text-sm text-slate-600">
            在此模式下，您可以上传图片并手动标注字段，这些图片将长期存入云端训练池，作为 AI 识别的引导示例。
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">训练池图片：{trainingStatus?.totalImages || 0}</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">已标注：{trainingStatus?.labeledImages || 0}</span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">未标注：{trainingStatus?.unlabeledImages || 0}</span>
          </div>
        </header>

        <section className="grid min-h-[calc(100vh-170px)] grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div ref={uploadPanelRef} className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold">待标注图片</h2>
              <p className="mt-1 text-sm text-slate-500">上传或粘贴需要加入训练池的图片。</p>
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
                              selectedUploadId === upload.id ? "bg-blue-50 ring-1 ring-inset ring-blue-400" : "bg-white hover:bg-slate-50"
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
                            <div className="text-xs font-medium text-blue-600">点击标注</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">上传后这里会显示待标注图片</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">云端训练池</h2>
                <p className="mt-1 text-sm text-slate-500">这里展示已存入云端的训练图片。点击可查看或修改标注。</p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {trainingStatus?.items && trainingStatus.items.length > 0 ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {trainingStatus.items.map((item) => (
                    <button
                      key={item.imageName}
                      onClick={(e) => handleTrainingItemClick(item, e)}
                      className="group relative flex aspect-square flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left transition-all hover:border-blue-400 hover:shadow-md"
                    >
                      <div className="relative flex-1 bg-slate-100">
                        {/* We don't have a thumbnail URL directly, but we can just show a placeholder or fetch it when clicked */}
                        <div className="flex h-full items-center justify-center p-4 text-center text-xs text-slate-400 break-all">
                          {item.imageName}
                        </div>
                      </div>
                      <div className="border-t border-slate-200 bg-white px-3 py-2">
                        <div className="truncate text-xs font-medium text-slate-700" title={item.imageName}>
                          {item.imageName}
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          {item.labeled ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              已标注
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              未标注
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  训练池中暂无图片。
                </div>
              )}
            </div>
          </div>
        </section>

        {annotatingItem && popupPosition ? (
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
                <h2 className="text-lg font-semibold">人工标注工作台</h2>
                <p className="mt-1 text-sm text-slate-500">
                  请在右侧填写正确的值，并在左侧图片上框选对应区域，完成后点击“存入训练池”。
                </p>
              </div>
              <button
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                onClick={closeRecordPopup}
              >
                关闭窗口
              </button>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
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
                        {annotationFields.find((f) => f.key === box.field)?.label}
                      </span>
                    </div>
                  ))}
                  {drawingState ? (
                    <div
                      className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/20"
                      style={{
                        left: `${Math.min(drawingState.startX, drawingState.currentX) * 100}%`,
                        top: `${Math.min(drawingState.startY, drawingState.currentY) * 100}%`,
                        width: `${Math.abs(drawingState.currentX - drawingState.startX) * 100}%`,
                        height: `${Math.abs(drawingState.currentY - drawingState.startY) * 100}%`,
                      }}
                    />
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-700">1. 填写正确数值</div>
                  <div className="space-y-3">
                    {annotationFields.map((field) => (
                      <div key={field.key}>
                        <label className="mb-1 block text-xs text-slate-500">{field.label}</label>
                        <input
                          type={field.key === "total" || field.key === "unscanned" || field.key === "exceptions" ? "number" : "text"}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                          value={String(manualRecord[field.key as keyof typeof manualRecord] ?? "")}
                          onChange={(e) => setManualRecord({ ...manualRecord, [field.key]: e.target.value })}
                          placeholder={`输入${field.label}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-700">2. 框选图片区域</div>
                  <div className="space-y-2">
                    {annotationFields.map((field) => {
                      const hasBox = annotationBoxes.some((box) => box.field === field.key);
                      return (
                        <div key={field.key} className="flex items-center justify-between text-sm">
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="annotationField"
                              checked={annotationField === field.key}
                              onChange={() => setAnnotationField(field.key)}
                              className="text-blue-600"
                            />
                            <span className={hasBox ? "text-slate-900" : "text-slate-500"}>{field.label}</span>
                          </label>
                          {hasBox ? (
                            <button className="text-xs text-rose-500 hover:text-rose-700" onClick={() => removeAnnotationBox(field.key)}>
                              清除框
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">未框选</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">选中上方字段后，在左侧图片上拖动鼠标画框。</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-700">3. 附加说明</div>
                  <textarea
                    className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    rows={2}
                    value={annotationNotes}
                    onChange={(e) => setAnnotationNotes(e.target.value)}
                    placeholder="选填：记录特殊情况或标注说明..."
                  />
                </div>

                <button
                  className="mt-auto w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  onClick={() => void saveAnnotationToTrainingPool()}
                  disabled={isSavingTraining}
                >
                  {isSavingTraining ? "保存中..." : "存入训练池"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
