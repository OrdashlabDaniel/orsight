"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { type PodRecord } from "@/lib/pod";

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
      totalSourceLabel?: string;
      unscanned: number;
      exceptions: number;
      waybillStatus?: string;
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
  const [manualRecord, setManualRecord] = useState<Partial<PodRecord> & { stationTeam?: string; totalSourceLabel?: string }>({});

  const [drawingState, setDrawingState] = useState<DrawingState | null>(null);
  const [isSavingTraining, setIsSavingTraining] = useState(false);

  const [globalRules, setGlobalRules] = useState<{
    instructions: string;
    documents: Array<{ name: string; content: string }>;
    guidanceHistory?: Array<{ role: "user" | "assistant"; content: string; ts: string }>;
  }>({ instructions: "", documents: [] });
  const [guidanceInput, setGuidanceInput] = useState("");
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [lastSuggestedRules, setLastSuggestedRules] = useState("");
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);

  useEffect(() => {
    void loadGlobalRules();
  }, []);

  async function loadGlobalRules() {
    try {
      const res = await fetch("/api/training/rules");
      if (res.ok) {
        const data = await res.json();
        setGlobalRules(data);
      }
    } catch (e) {
      console.error("Failed to load global rules", e);
    }
  }

  async function saveGlobalRules() {
    setIsSavingRules(true);
    try {
      const res = await fetch("/api/training/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(globalRules),
      });
      if (!res.ok) throw new Error("保存失败");
      setNoticeMessage("全局规则与文档已保存，将在下次 AI 填表时生效。");
    } catch (e) {
      setErrorMessage("保存全局规则失败。");
    } finally {
      setIsSavingRules(false);
    }
  }

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingDoc(true);
    setErrorMessage("");
    try {
      const name = file.name.toLowerCase();
      let text: string;

      if (/\.(txt|csv|md)$/i.test(file.name)) {
        text = await file.text();
      } else if (/\.(pdf|doc|docx)$/i.test(file.name)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/training/parse-document", { method: "POST", body: fd });
        const payload = (await res.json()) as { text?: string; warning?: string; error?: string };
        if (!res.ok) {
          throw new Error(payload.error || "服务端解析失败。");
        }
        text = (payload.text || "").trim();
        if (!text) {
          throw new Error(payload.warning || "未能从该文件中提取到文本。");
        }
      } else {
        throw new Error("不支持的扩展名，请使用 PDF、Word、TXT、CSV 或 Markdown。");
      }

      if (!text.trim()) {
        throw new Error("文档内容为空。");
      }

      setGlobalRules((prev) => ({
        ...prev,
        documents: [...prev.documents, { name: file.name, content: text }],
      }));
      setNoticeMessage(`成功解析文档：${file.name}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "文档解析失败，请检查格式与大小（最大约 12MB）。");
    } finally {
      setIsUploadingDoc(false);
      e.target.value = "";
    }
  }

  function removeDocument(index: number) {
    setGlobalRules(prev => {
      const nextDocs = [...prev.documents];
      nextDocs.splice(index, 1);
      return { ...prev, documents: nextDocs };
    });
  }

  async function sendGuidanceChat() {
    const text = guidanceInput.trim();
    if (!text || guidanceLoading) return;
    setGuidanceLoading(true);
    setErrorMessage("");
    try {
      const userTurn = { role: "user" as const, content: text, ts: new Date().toISOString() };
      const prevHistory = globalRules.guidanceHistory || [];
      const nextHistory = [...prevHistory, userTurn];
      const forApi = nextHistory.slice(-20).map(({ role, content }) => ({ role, content }));
      const res = await fetch("/api/training/guidance-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: forApi }),
      });
      const data = (await res.json()) as { error?: string; assistantReply?: string; suggestedRules?: string };
      if (!res.ok) {
        throw new Error(data.error || "对话失败");
      }
      const assistantTurn = {
        role: "assistant" as const,
        content: data.assistantReply || "",
        ts: new Date().toISOString(),
      };
      setGlobalRules((prevR) => ({
        ...prevR,
        guidanceHistory: [...(prevR.guidanceHistory || []), userTurn, assistantTurn],
      }));
      setGuidanceInput("");
      if (data.suggestedRules?.trim()) {
        setLastSuggestedRules(data.suggestedRules.trim());
      }
      setNoticeMessage("已收到 AI 回复。若有「建议规则」，可合并到上方自定义规则后点击保存。");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "对话失败");
    } finally {
      setGuidanceLoading(false);
    }
  }

  function mergeSuggestedRulesIntoInstructions() {
    if (!lastSuggestedRules.trim()) return;
    setGlobalRules((prev) => ({
      ...prev,
      instructions: `${(prev.instructions || "").trim()}\n\n【对话整理 — 提取补充】\n${lastSuggestedRules.trim()}`.trim(),
    }));
    setLastSuggestedRules("");
    setNoticeMessage("已写入「自定义提取规则」文本框，请点击「保存全局规则」后在填表识别中生效。");
  }

  function clearGuidanceHistory() {
    setGlobalRules((p) => ({ ...p, guidanceHistory: [] }));
    setLastSuggestedRules("");
    setNoticeMessage("已清空本地对话记录；保存全局规则后将同步到云端。");
  }

  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
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

  function handleImageClick(upload: UploadItem) {
    setSelectedUploadId(upload.id);
    void openAnnotationPanel(upload);
  }

  function handleTrainingItemClick(item: TrainingStatusItem) {
    void openAnnotationPanel(item);
  }

  async function openAnnotationPanel(item: UploadItem | TrainingStatusItem) {
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
      totalSourceLabel: existingExample?.output.totalSourceLabel || "",
      unscanned: existingExample?.output.unscanned || undefined,
      exceptions: existingExample?.output.exceptions || undefined,
      waybillStatus: existingExample?.output.waybillStatus || "",
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

  const closeRecordPopup = useCallback(() => {
    setAnnotatingItem(null);
    setDrawingState(null);
  }, []);

  useEffect(() => {
    if (!annotatingItem) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeRecordPopup();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotatingItem, closeRecordPopup]);

  function getAnnotationFieldValue(field: AnnotationField) {
    const value = manualRecord[field as keyof typeof manualRecord];
    return value === null || value === undefined || value === "" ? "" : String(value);
  }

  function getRelativePointFromClient(clientX: number, clientY: number) {
    const rect = annotationCanvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  function beginDrawing(event: React.MouseEvent<HTMLDivElement>) {
    const point = getRelativePointFromClient(event.clientX, event.clientY);
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

    const point = getRelativePointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    setDrawingState({
      ...drawingState,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function beginDrawingTouch(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return;
    const t = event.touches[0];
    const point = getRelativePointFromClient(t.clientX, t.clientY);
    if (!point) return;
    event.preventDefault();
    setDrawingState({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function updateDrawingTouch(event: React.TouchEvent<HTMLDivElement>) {
    if (!drawingState || event.touches.length !== 1) return;
    const t = event.touches[0];
    const point = getRelativePointFromClient(t.clientX, t.clientY);
    if (!point) return;
    event.preventDefault();
    setDrawingState({
      ...drawingState,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function finishDrawingTouch(event: React.TouchEvent<HTMLDivElement>) {
    event.preventDefault();
    const t = event.changedTouches[0];
    let endX: number | undefined;
    let endY: number | undefined;
    if (t) {
      const point = getRelativePointFromClient(t.clientX, t.clientY);
      if (point) {
        endX = point.x;
        endY = point.y;
      }
    }
    finishDrawing(endX, endY);
  }

  function finishDrawing(endX?: number, endY?: number) {
    if (!drawingState || !annotatingItem) {
      setDrawingState(null);
      return;
    }

    const cx = endX ?? drawingState.currentX;
    const cy = endY ?? drawingState.currentY;
    const x = Math.min(drawingState.startX, cx);
    const y = Math.min(drawingState.startY, cy);
    const width = Math.abs(cx - drawingState.startX);
    const height = Math.abs(cy - drawingState.startY);
    setDrawingState(null);

    if (width < 0.005 || height < 0.005) {
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
            totalSourceLabel: manualRecord.totalSourceLabel || "",
            unscanned: Number(manualRecord.unscanned) || 0,
            exceptions: Number(manualRecord.exceptions) || 0,
            waybillStatus: manualRecord.waybillStatus || "",
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link href="/forms" className="font-medium text-blue-600 hover:underline">
              ← 返回填表池
            </Link>
            <Link href="/" className="font-medium text-slate-700 hover:text-slate-900 hover:underline">
              切换到填表模式
            </Link>
          </div>
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
          <div className="flex flex-col gap-4">
            <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold">全局规则与知识库</h2>
                <p className="mt-1 text-sm text-slate-500">
                  上传 PDF、Word（.doc/.docx）、TXT/CSV 等参考文档，或输入自定义提取规则；AI 填表时会一并参考（扫描版 PDF 可能无法提取文字）。
                </p>
              </div>
              <div className="flex flex-col gap-4 p-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">自定义提取规则</label>
                  <textarea
                    className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    rows={4}
                    placeholder="例如：如果路线包含 'M'，则认为是早班..."
                    value={globalRules.instructions}
                    onChange={(e) => setGlobalRules({ ...globalRules, instructions: e.target.value })}
                  />
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm font-medium text-slate-800">与 AI 对话（教它怎么认得更准）</label>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-rose-600"
                      onClick={clearGuidanceHistory}
                    >
                      清空对话记录
                    </button>
                  </div>
                  <p className="mb-3 text-xs text-slate-500">
                    用自然语言描述误判案例、屏幕样式、字段别名等；模型会回复并整理成可写入规则的条目。上传的参考文档也会作为对话上下文。
                    填表识别时：自定义规则、文档摘录、近期对话、训练池示例与框选位置会一并进入视觉模型提示词。
                  </p>
                  <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                    {(globalRules.guidanceHistory?.length ?? 0) === 0 ? (
                      <span className="text-slate-400">尚无对话，在下方输入后发送。</span>
                    ) : (
                      <ul className="space-y-2">
                        {(globalRules.guidanceHistory || []).map((turn, i) => (
                          <li key={`${turn.ts}-${i}`} className={turn.role === "user" ? "text-slate-800" : "text-slate-600"}>
                            <span className="font-medium text-slate-500">{turn.role === "user" ? "你" : "AI"}：</span>
                            {turn.content}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      placeholder="例如：我们现场照片里「应领件数」在第二屏，要向下滚才看得到…"
                      value={guidanceInput}
                      onChange={(e) => setGuidanceInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void sendGuidanceChat();
                        }
                      }}
                      disabled={guidanceLoading}
                    />
                    <button
                      type="button"
                      className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-slate-400"
                      onClick={() => void sendGuidanceChat()}
                      disabled={guidanceLoading || !guidanceInput.trim()}
                    >
                      {guidanceLoading ? "思考中…" : "发送"}
                    </button>
                  </div>
                  {lastSuggestedRules ? (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="mb-1 text-xs font-medium text-amber-900">本轮建议写入规则的条目</div>
                      <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-amber-950">
                        {lastSuggestedRules}
                      </pre>
                      <button
                        type="button"
                        className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
                        onClick={mergeSuggestedRulesIntoInstructions}
                      >
                        合并到「自定义提取规则」
                      </button>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    参考文档（PDF / Word / TXT / CSV / MD）
                  </label>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    {isUploadingDoc ? "解析中..." : "上传文档"}
                    <input
                      type="file"
                      accept=".txt,.csv,.md,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      onChange={(e) => void handleDocumentUpload(e)}
                      disabled={isUploadingDoc}
                    />
                  </label>
                  {globalRules.documents.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {globalRules.documents.map((doc, idx) => (
                        <li key={idx} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="truncate text-slate-700" title={doc.name}>{doc.name}</span>
                          <button className="text-rose-500 hover:text-rose-700" onClick={() => removeDocument(idx)}>删除</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                  onClick={() => void saveGlobalRules()}
                  disabled={isSavingRules}
                >
                  {isSavingRules ? "保存中..." : "保存全局规则"}
                </button>
              </div>
            </div>

            <div ref={uploadPanelRef} className="flex min-h-0 flex-1 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
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
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    onClick={async () => {
                      if (!uploads.length) {
                        setErrorMessage("请先上传图片。");
                        return;
                      }
                      setIsSavingTraining(true);
                      setErrorMessage("");
                      try {
                        let successCount = 0;
                        for (const upload of uploads) {
                          try {
                            const imageDataUrl = await imageSourceToDataUrl(upload.previewUrl);
                            await fetch("/api/training/save", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                imageName: upload.file.name,
                                imageDataUrl,
                                notes: "直接存入训练池，未标注",
                              output: {
                                date: "",
                                route: "",
                                driver: "",
                                total: 0,
                                totalSourceLabel: "",
                                unscanned: 0,
                                exceptions: 0,
                                waybillStatus: "",
                                stationTeam: "",
                              },
                                boxes: [],
                              }),
                            });
                            successCount++;
                          } catch (err) {
                            console.error(`Failed to save ${upload.file.name}:`, err);
                          }
                        }
                        await loadTrainingStatus();
                        setNoticeMessage(`成功将 ${successCount} 张图片直接存入训练池！`);
                        clearAll();
                      } catch (error) {
                        setErrorMessage(error instanceof Error ? error.message : "批量存入失败。");
                      } finally {
                        setIsSavingTraining(false);
                      }
                    }}
                    disabled={isSavingTraining || !uploads.length}
                  >
                    {isSavingTraining ? "保存中..." : "全部直接存入训练池"}
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
                              onClick={() => handleImageClick(upload)}
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
                      onClick={() => handleTrainingItemClick(item)}
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

        {annotatingItem ? (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="annotation-dialog-title"
          >
            <div className="my-auto w-full max-w-6xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="annotation-dialog-title" className="text-lg font-semibold">
                  图片框选标注
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  适合 POD 屏摄：先选字段，再在图上拖出矩形框；可触摸屏操作。填好右侧数值后保存。
                </p>
                <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
                  <li>在下方列表选中要标注的字段</li>
                  <li>在图片上按住拖动画框（框住该字段在屏幕上的区域）</li>
                  <li>填写该字段的正确值，重复直到主要字段都有框，最后点「存入训练池」</li>
                </ol>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                onClick={closeRecordPopup}
              >
                关闭（Esc）
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_min(100%,380px)]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3 text-sm font-medium text-slate-700">标注图片：{annotationImageName}</div>
                <div
                  ref={annotationCanvasRef}
                  className="relative min-h-[min(55vh,520px)] overflow-hidden rounded-xl bg-black/5 [touch-action:none] cursor-crosshair select-none"
                  onMouseDown={beginDrawing}
                  onMouseMove={updateDrawing}
                  onMouseUp={() => finishDrawing()}
                  onMouseLeave={() => finishDrawing()}
                  onTouchStart={beginDrawingTouch}
                  onTouchMove={updateDrawingTouch}
                  onTouchEnd={finishDrawingTouch}
                  onTouchCancel={() => setDrawingState(null)}
                >
                  {annotationImageSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={annotationImageSrc}
                      alt={annotationImageName}
                      draggable={false}
                      className="pointer-events-none h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-400">加载图片中…</div>
                  )}
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
                  <div className="mb-3 text-sm font-medium text-slate-700">填写正确数值</div>
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
                        {field.key === "total" && (
                          <input
                            type="text"
                            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                            value={manualRecord.totalSourceLabel || ""}
                            onChange={(e) => setManualRecord({ ...manualRecord, totalSourceLabel: e.target.value })}
                            placeholder="输入运单数量的来源标签 (如: 应领件数)"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-700">选择字段并画框</div>
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
                            <button
                              type="button"
                              className="text-xs text-rose-500 hover:text-rose-700"
                              onClick={() => removeAnnotationBox(field.key)}
                            >
                              清除框
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">未框选</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    先选中字段，再在左侧图上拖动画框；画错可点「清除框」重画。小字区域可把浏览器放大（Ctrl + 滚轮）再框选。
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-medium text-slate-700">附加说明</div>
                  <textarea
                    className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    rows={2}
                    value={annotationNotes}
                    onChange={(e) => setAnnotationNotes(e.target.value)}
                    placeholder="选填：记录特殊情况或标注说明..."
                  />
                </div>

                <button
                  type="button"
                  className="mt-auto w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  onClick={() => void saveAnnotationToTrainingPool()}
                  disabled={isSavingTraining}
                >
                  {isSavingTraining ? "保存中..." : "存入训练池"}
                </button>
              </div>
            </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
