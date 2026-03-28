"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentAsset, AgentThreadTurn } from "@/lib/agent-context-types";
import { type PodRecord } from "@/lib/pod";

function formatTurnForChatApi(turn: AgentThreadTurn): string {
  let s = turn.content;
  if (turn.assets?.length) {
    for (const a of turn.assets) {
      if (a.kind === "image") {
        s += `\n[附图：${a.name}，存储名 ${a.imageName}]`;
      } else {
        s += `\n[文档：${a.name} 摘录]\n${a.excerpt.slice(0, 4000)}`;
      }
    }
  }
  return s;
}

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
};

type AnnotationField = "date" | "route" | "driver" | "total" | "unscanned" | "exceptions" | "waybillStatus" | "stationTeam";

/** 与 @/lib/training FieldAggregation 一致 */
type FieldAggregation = "sum" | "join_comma" | "join_newline" | "first";

type AnnotationBox = {
  id: string;
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
    fieldAggregations?: Partial<Record<AnnotationField, FieldAggregation>>;
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

function defaultAggregationForField(field: AnnotationField): FieldAggregation {
  return field === "total" || field === "unscanned" || field === "exceptions" ? "sum" : "join_comma";
}

function effectiveFieldAggregation(
  field: AnnotationField,
  aggs: Partial<Record<AnnotationField, FieldAggregation>>,
): FieldAggregation {
  return aggs[field] ?? defaultAggregationForField(field);
}

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
  const [fieldAggregations, setFieldAggregations] = useState<Partial<Record<AnnotationField, FieldAggregation>>>({});
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
    agentThread?: AgentThreadTurn[];
    workingRules?: string;
  }>({ instructions: "", documents: [], agentThread: [], workingRules: "" });
  const [agentInput, setAgentInput] = useState("");
  const [pendingAgentFiles, setPendingAgentFiles] = useState<Array<{ id: string; file: File }>>([]);
  const [agentDragActive, setAgentDragActive] = useState(false);
  const [agentChatLoading, setAgentChatLoading] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);

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
      setNoticeMessage("填表工作规则已保存，将在下次识别时生效。");
    } catch (e) {
      setErrorMessage("保存工作规则失败。");
    } finally {
      setIsSavingRules(false);
    }
  }

  function addPendingAgentFiles(files: File[]) {
    const allowed = files.filter((f) => {
      const n = f.name.toLowerCase();
      return f.type.startsWith("image/") || /\.(txt|csv|md|pdf|doc|docx)$/i.test(n);
    });
    if (allowed.length < files.length) {
      setErrorMessage("部分文件已忽略：仅支持图片与 PDF / Word / TXT / CSV / Markdown。");
    }
    if (allowed.length === 0) return;
    setPendingAgentFiles((p) => [...p, ...allowed.map((file) => ({ id: crypto.randomUUID(), file }))]);
  }

  async function processFileToAgentAsset(file: File): Promise<AgentAsset | null> {
    const maxBytes = 12 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`「${file.name}」超过 12MB。`);
    }
    if (file.type.startsWith("image/")) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/training/context-asset", { method: "POST", body: fd });
      const payload = (await res.json()) as { error?: string; imageName?: string; originalName?: string };
      if (!res.ok) {
        throw new Error(payload.error || "图片上传失败");
      }
      if (!payload.imageName) {
        throw new Error("图片上传未返回文件名");
      }
      return {
        kind: "image",
        name: file.name || payload.originalName || "image",
        imageName: payload.imageName,
      };
    }
    if (/\.(txt|csv|md)$/i.test(file.name)) {
      const excerpt = (await file.text()).slice(0, 12000);
      if (!excerpt.trim()) return null;
      return { kind: "document", name: file.name, excerpt };
    }
    if (/\.(pdf|doc|docx)$/i.test(file.name)) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/training/parse-document", { method: "POST", body: fd });
      const payload = (await res.json()) as { text?: string; error?: string; warning?: string };
      if (!res.ok) {
        throw new Error(payload.error || "文档解析失败");
      }
      const excerpt = (payload.text || "").trim().slice(0, 12000);
      if (!excerpt) {
        throw new Error(payload.warning || "文档中未提取到文字");
      }
      return { kind: "document", name: file.name, excerpt };
    }
    return null;
  }

  async function sendAgentMessage() {
    const text = agentInput.trim();
    if ((!text && pendingAgentFiles.length === 0) || agentChatLoading) return;
    setAgentChatLoading(true);
    setErrorMessage("");
    try {
      const assets: AgentAsset[] = [];
      for (const { file } of pendingAgentFiles) {
        const a = await processFileToAgentAsset(file);
        if (a) assets.push(a);
      }
      setPendingAgentFiles([]);

      const userTurn: AgentThreadTurn = {
        id: crypto.randomUUID(),
        role: "user",
        content: text || "（仅附件）",
        ts: new Date().toISOString(),
        ...(assets.length > 0 ? { assets } : {}),
      };

      const thread = [...(globalRules.agentThread || []), userTurn];
      const forApi = thread.map((t) => ({ role: t.role, content: formatTurnForChatApi(t) }));

      const res = await fetch("/api/training/guidance-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: forApi,
          currentWorkingRules: globalRules.workingRules ?? "",
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        assistantReply?: string;
        revisedWorkingRules?: string;
        suggestedRules?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "发送失败");
      }

      let nextWorking = (data.revisedWorkingRules ?? "").trim();
      if (!nextWorking && typeof data.suggestedRules === "string" && data.suggestedRules.trim()) {
        nextWorking = `${globalRules.workingRules || ""}\n\n【本轮补充】\n${data.suggestedRules.trim()}`.trim();
      }
      if (!nextWorking) {
        nextWorking = (globalRules.workingRules || "").trim();
      }

      const assistantTurn: AgentThreadTurn = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.assistantReply || "",
        ts: new Date().toISOString(),
      };

      const updated = {
        ...globalRules,
        workingRules: nextWorking,
        agentThread: [...(globalRules.agentThread || []), userTurn, assistantTurn],
      };
      setGlobalRules(updated);
      setAgentInput("");

      setIsSavingRules(true);
      try {
        const saveRes = await fetch("/api/training/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
        if (!saveRes.ok) throw new Error("自动保存失败");
        setNoticeMessage("工作规则已按本轮对话升级并写入填表流程；效果不好可继续在这里说明，Agent 会再优化。");
      } catch {
        setErrorMessage("规则已更新到界面，但自动保存失败，请点击「保存工作规则」。");
      } finally {
        setIsSavingRules(false);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "发送失败");
    } finally {
      setAgentChatLoading(false);
    }
  }

  function clearAgentThread() {
    setGlobalRules((p) => ({ ...p, agentThread: [] }));
    setPendingAgentFiles([]);
    setNoticeMessage("已清空对话记录（工作规则未清空）。若也要重置规则，请手动删除上方规则正文后保存。");
  }

  function handleAgentComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) {
      event.preventDefault();
      addPendingAgentFiles(files);
    }
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
    const rawBoxes = existingExample?.boxes || [];
    setAnnotationBoxes(
      rawBoxes.map((b) => ({
        ...b,
        id: typeof (b as AnnotationBox).id === "string" && (b as AnnotationBox).id ? (b as AnnotationBox).id : crypto.randomUUID(),
      })),
    );
    setFieldAggregations(existingExample?.fieldAggregations || {});
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
    setFieldAggregations({});
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
      id: crypto.randomUUID(),
      field: annotationField,
      value: getAnnotationFieldValue(annotationField),
      x,
      y,
      width,
      height,
    };

    setAnnotationBoxes((current) => [...current, nextBox]);
  }

  function removeAnnotationBoxById(boxId: string) {
    setAnnotationBoxes((current) => current.filter((box) => box.id !== boxId));
  }

  function clearAnnotationFieldBoxes(field: AnnotationField) {
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
          fieldAggregations,
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
                <h2 className="text-lg font-semibold">填表 Agent</h2>
                <p className="mt-1 text-sm text-slate-500">
                  像 Cursor 一样对话：说明你的业务、错判案例或丢入截图/文档。Agent 会<strong>生成并升级「填表工作规则」</strong>并
                  <strong>自动写入识别流程</strong>——不是存聊天记录。效果不好就再来聊，规则会持续迭代。
                </p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">当前填表工作规则（已内化到填表识别）</label>
                  <textarea
                    className="min-h-[120px] w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-xs leading-relaxed outline-none focus:border-blue-500"
                    placeholder="对话后 Agent 会在这里写入完整规则；你也可以直接手改。"
                    value={globalRules.workingRules ?? ""}
                    onChange={(e) => setGlobalRules({ ...globalRules, workingRules: e.target.value })}
                    disabled={agentChatLoading}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">识别时优先使用本段正文；附件仍会作为参考图进入视觉模型。</p>
                </div>

                <div className="flex min-h-[200px] max-h-72 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                    <span className="text-xs font-medium text-slate-600">对话</span>
                    <button type="button" className="text-xs text-slate-500 hover:text-rose-600" onClick={clearAgentThread}>
                      清空
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
                    {(globalRules.agentThread?.length ?? 0) === 0 ? (
                      <p className="text-xs text-slate-400">还没有消息。直接说明你的业务规则、常见错判，或丢入现场截图 / 说明文档。</p>
                    ) : (
                      (globalRules.agentThread || []).map((turn) => (
                        <div
                          key={turn.id}
                          className={`rounded-lg px-3 py-2 ${
                            turn.role === "user" ? "ml-2 bg-blue-50 text-slate-800" : "mr-2 bg-white text-slate-700 shadow-sm"
                          }`}
                        >
                          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            {turn.role === "user" ? "你" : "Agent"}
                          </div>
                          {turn.assets?.map((a) => (
                            <div
                              key={`${turn.id}-${a.kind}-${a.name}`}
                              className="mb-1 rounded border border-slate-200 bg-white/80 px-2 py-1 text-xs text-slate-600"
                            >
                              {a.kind === "image" ? `图片：${a.name}` : `文档：${a.name}（已提取文字）`}
                            </div>
                          ))}
                          <p className="whitespace-pre-wrap break-words">{turn.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div
                  className={`rounded-xl border-2 border-dashed p-3 transition-colors ${
                    agentDragActive ? "border-blue-400 bg-blue-50/50" : "border-slate-200 bg-white"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAgentDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAgentDragActive(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAgentDragActive(false);
                    addPendingAgentFiles(Array.from(e.dataTransfer.files || []));
                  }}
                >
                  {pendingAgentFiles.length > 0 ? (
                    <ul className="mb-2 flex flex-wrap gap-2">
                      {pendingAgentFiles.map(({ id, file }) => (
                        <li
                          key={id}
                          className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
                        >
                          <span className="max-w-[140px] truncate">{file.name}</span>
                          <button
                            type="button"
                            className="text-rose-500 hover:text-rose-700"
                            onClick={() => setPendingAgentFiles((p) => p.filter((x) => x.id !== id))}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-2 text-center text-xs text-slate-400">拖文件到此处，或使用下方按钮选择</p>
                  )}
                  <textarea
                    className="mb-2 min-h-[88px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    placeholder="例如：我们 POD 屏上「应领件数」在第二屏中间，反光严重时优先看左上角小字…"
                    value={agentInput}
                    onChange={(e) => setAgentInput(e.target.value)}
                    onPaste={handleAgentComposerPaste}
                    disabled={agentChatLoading}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                      添加文件
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        accept="image/*,.txt,.csv,.md,.pdf,.doc,.docx"
                        onChange={(e) => {
                          const list = e.target.files;
                          if (list?.length) addPendingAgentFiles(Array.from(list));
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
                      onClick={() => void sendAgentMessage()}
                      disabled={
                        agentChatLoading || (!agentInput.trim() && pendingAgentFiles.length === 0)
                      }
                    >
                      {agentChatLoading ? "发送中…" : "发送"}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                  onClick={() => void saveGlobalRules()}
                  disabled={isSavingRules || agentChatLoading}
                >
                  {isSavingRules ? "保存中…" : "保存工作规则"}
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
                  <li>选中字段后在图上画框；同一字段可画多个框（如两条「未领取」各画一框）</li>
                  <li>多框时在列表里选择合并方式：数字相加、逗号/换行并列，或仅取第一处</li>
                  <li>右侧填写该字段最终应写入表格的值（如 1+0=1），最后点「存入训练池」</li>
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
                  {annotationBoxes.map((box) => {
                    const sameField = annotationBoxes.filter((b) => b.field === box.field);
                    const idx = sameField.findIndex((b) => b.id === box.id) + 1;
                    const baseLabel = annotationFields.find((f) => f.key === box.field)?.label || box.field;
                    const tag = sameField.length > 1 ? `${baseLabel}#${idx}` : baseLabel;
                    return (
                      <div
                        key={box.id}
                        className="pointer-events-none absolute border-2 border-rose-500 bg-rose-500/10"
                        style={{
                          left: `${box.x * 100}%`,
                          top: `${box.y * 100}%`,
                          width: `${box.width * 100}%`,
                          height: `${box.height * 100}%`,
                        }}
                      >
                        <span className="absolute left-0 top-0 max-w-[min(100%,120px)] -translate-y-full truncate rounded bg-rose-500 px-1.5 py-0.5 text-[10px] text-white">
                          {tag}
                        </span>
                      </div>
                    );
                  })}
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
                  <div className="space-y-3">
                    {annotationFields.map((field) => {
                      const boxesFor = annotationBoxes.filter((box) => box.field === field.key);
                      const count = boxesFor.length;
                      const hasBox = count > 0;
                      return (
                        <div key={field.key} className="rounded-lg border border-slate-100 bg-white/60 px-2 py-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                              <input
                                type="radio"
                                name="annotationField"
                                checked={annotationField === field.key}
                                onChange={() => setAnnotationField(field.key)}
                                className="text-blue-600"
                              />
                              <span className={hasBox ? "font-medium text-slate-900" : "text-slate-500"}>{field.label}</span>
                              {count > 0 ? (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{count} 框</span>
                              ) : null}
                            </label>
                            {count >= 2 ? (
                              <select
                                className="max-w-[140px] rounded border border-slate-300 bg-white px-1 py-1 text-[11px] outline-none focus:border-blue-500"
                                value={effectiveFieldAggregation(field.key, fieldAggregations)}
                                onChange={(e) =>
                                  setFieldAggregations((prev) => ({
                                    ...prev,
                                    [field.key]: e.target.value as FieldAggregation,
                                  }))
                                }
                              >
                                <option value="sum">多框：数字相加</option>
                                <option value="join_comma">多框：逗号并列</option>
                                <option value="join_newline">多框：换行并列</option>
                                <option value="first">多框：仅第一处</option>
                              </select>
                            ) : null}
                            {hasBox ? (
                              <button
                                type="button"
                                className="text-xs text-rose-500 hover:text-rose-700"
                                onClick={() => clearAnnotationFieldBoxes(field.key)}
                              >
                                清除全部
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">未框选</span>
                            )}
                          </div>
                          {count > 1 ? (
                            <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
                              {boxesFor.map((b, i) => (
                                <li key={b.id} className="flex items-center justify-between gap-2">
                                  <span>
                                    框 {i + 1}
                                    {b.value ? `（参考值 ${b.value}）` : ""}
                                  </span>
                                  <button
                                    type="button"
                                    className="shrink-0 text-rose-500 hover:text-rose-700"
                                    onClick={() => removeAnnotationBoxById(b.id)}
                                  >
                                    删除
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    同一字段可连续画多个框；未收数量等数字字段默认「相加」。单框时无需选择合并方式。
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
