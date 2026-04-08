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
import { RecognitionAgentDock } from "@/components/RecognitionAgentDock";
import type { AgentAsset, AgentThreadTurn } from "@/lib/agent-context-types";
import {
  DEFAULT_TABLE_FIELDS,
  getActiveTableFields,
  TABLE_FIELDS_SYNC_EVENT,
  TABLE_FIELDS_SYNC_STORAGE_KEY,
  type TableFieldDefinition,
} from "@/lib/table-fields";
import { DEFAULT_FORM_ID, buildFormFillHref, normalizeFormId } from "@/lib/forms";
import {
  ensureImageDataUrlFromSource,
  prepareVisualUpload,
  SUPPORTED_VISUAL_UPLOAD_ACCEPT,
} from "@/lib/client-visual-upload";

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
      exceptions: number;
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

function TrainingModeContent() {
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
  const [tableFields, setTableFields] = useState<TableFieldDefinition[]>(DEFAULT_TABLE_FIELDS);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [trainingThumbnailMap, setTrainingThumbnailMap] = useState<Record<string, string>>({});
  const [trainingThumbnailErrorMap, setTrainingThumbnailErrorMap] = useState<Record<string, boolean>>({});
  const [deletingImageName, setDeletingImageName] = useState<string | null>(null);

  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
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

  const goToFillMode = useCallback(() => {
    window.location.assign(buildFormFillHref(currentFormId));
  }, [currentFormId]);
  const removeUploadAfterSaveRef = useRef<string | null>(null);

  const [isSavingTraining, setIsSavingTraining] = useState(false);

  const [globalRules, setGlobalRules] = useState<{
    agentThread?: AgentThreadTurn[];
    workingRules?: string;
  }>({ agentThread: [], workingRules: "" });
  const [agentInput, setAgentInput] = useState("");
  const [pendingAgentFiles, setPendingAgentFiles] = useState<Array<{ id: string; file: File }>>([]);
  const [agentDragActive, setAgentDragActive] = useState(false);
  const [agentChatLoading, setAgentChatLoading] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);

  const activeTableFields = getActiveTableFields(tableFields);
  const setupFieldDefinition = activeTableFields.find((field) => field.id === setupField) || null;
  const isFieldOnboarding = Boolean(setupFieldDefinition);

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
    uploadPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isFieldOnboarding]);

  useEffect(() => {
    void loadGlobalRules();
  }, [currentFormId]);

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
        throw new Error(data.error || "表格项目配置读取失败。");
      }
      setTableFields(data.tableFields?.length ? data.tableFields : DEFAULT_TABLE_FIELDS);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "表格项目配置读取失败。");
    }
  }

  async function loadGlobalRules() {
    try {
      const res = await fetch(withFormId("/api/training/rules"));
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
      const res = await fetch(withFormId("/api/training/rules"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingRules: globalRules.workingRules ?? "",
          agentThread: globalRules.agentThread ?? [],
        }),
      });
      if (!res.ok) throw new Error("保存失败");
      setNoticeMessage("识别规则已保存，将在下次识别时生效。");
    } catch {
      setErrorMessage("保存识别规则失败。");
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
      fd.append("formId", currentFormId);
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

      const res = await fetch(withFormId("/api/training/guidance-chat"), {
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
        const saveRes = await fetch(withFormId("/api/training/rules"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workingRules: updated.workingRules ?? "",
            agentThread: updated.agentThread ?? [],
          }),
        });
        if (!saveRes.ok) throw new Error("自动保存失败");
        setNoticeMessage("识别规则已按本轮对话升级并写入识别流程；效果不好可继续在这里说明，Agent 会再优化。");
      } catch {
        setErrorMessage("识别规则已更新到界面，但自动保存失败，请点击「保存识别规则」。");
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
    setNoticeMessage("已清空对话记录（识别规则未清空）。若也要重置规则，请手动删除上方规则正文后保存。");
  }

  function handleAgentComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) {
      event.preventDefault();
      addPendingAgentFiles(files);
    }
  }

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
          const prepared = await prepareVisualUpload(file);
          return {
            id: `${prepared.file.name}-${prepared.file.lastModified}-${index}-${Date.now()}`,
            file: prepared.file,
            previewUrl: prepared.previewUrl,
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
      if (isFieldOnboarding && nextUploads[0]) {
        setSelectedUploadId(nextUploads[0].id);
        void openAnnotationPanel(nextUploads[0]);
      }
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
      try {
        return await ensureImageDataUrlFromSource(previewUrl);
      } catch {
        // Fall back to the JSON data-url endpoint if the raw preview request fails.
      }
    }

    const response = await fetch(withFormId(`/api/training/image?imageName=${encodeURIComponent(imageName)}`));
    const payload = (await response.json()) as { dataUrl?: string; error?: string };
    if (!response.ok || !payload.dataUrl) {
      throw new Error(payload.error || "无法读取训练图片。");
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

    const confirmed = window.confirm(`确定要从训练池中删除图片「${item.imageName}」吗？对应标注也会一起删除。`);
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
        throw new Error(payload.error || "删除训练池图片失败。");
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
      setNoticeMessage(`已从训练池删除图片：${item.imageName}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除训练池图片失败。");
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
      notes: existingExample?.notes || "人工标注用于训练池。",
    });

    setAnnotationImageName(imageName);
    setAnnotationImageSrc("");

    setNoticeMessage(`正在打开标注工作台：${imageName}`);

    try {
      const imageSrc = await resolveAnnotationImage(imageName, previewUrl);
      setAnnotationImageSrc(imageSrc);
      setNoticeMessage(`已打开标注工作台：${imageName}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开标注失败。");
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
      reader.onerror = () => reject(new Error("图片读取失败。"));
      reader.readAsDataURL(blob);
    });
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 text-slate-900">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link href="/forms" className="font-medium text-blue-600 hover:underline">
              ← 返回填表池
            </Link>
            <button
              type="button"
              onClick={goToFillMode}
              className="font-medium text-slate-700 hover:text-slate-900 hover:underline"
            >
              切换到填表模式
            </button>
          </div>
          <h1 className="text-2xl font-semibold">OrSight - 训练模式</h1>
          <p className="mt-2 text-sm text-slate-600">
            在此模式下，您可以上传图片并手动标注字段，这些图片将长期存入云端训练池，作为 AI 识别的引导示例。
          </p>
          {setupFieldDefinition ? (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <div className="font-medium">当前正在扩展新表格项目：{setupFieldDefinition.label}</div>
              <div className="mt-1">
                请先上传一张范例图片。上传后系统会自动打开标注工作台，并默认选中“{setupFieldDefinition.label}”。
                你只需要框出这个表格项目所在的位置，并在右侧填写最终要写入表格的内容。
              </div>
            </div>
          ) : null}
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
                <h2 className="text-lg font-semibold">识别规则 Agent</h2>
                <p className="mt-1 text-sm text-slate-500">
                  像 Cursor 一样对话：告诉模型应该如何识别、哪些字段容易错判、看到什么标签才算哪个字段。Agent 只会
                  <strong>生成并升级「识别规则」</strong>并<strong>自动写入识别流程</strong>；页面结构、接口、存储、权限、
                  字段清单等软件架构不会在这里被改动。
                </p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">当前识别规则（仅影响识别准确性与判定方式）</label>
                  <textarea
                    className="min-h-[120px] w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-xs leading-relaxed outline-none focus:border-blue-500"
                    placeholder="对话后 Agent 会在这里整理可编辑的识别规则；你也可以直接手改。这里不会修改页面、接口、存储或字段结构。"
                    value={globalRules.workingRules ?? ""}
                    onChange={(e) => setGlobalRules({ ...globalRules, workingRules: e.target.value })}
                    disabled={agentChatLoading}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">识别时优先使用本段正文；这里只允许改截图识别规则，附件仍会作为参考图进入视觉模型。</p>
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
                      <p className="text-xs text-slate-400">还没有消息。直接说明识别约定、常见错判，或丢入现场截图 / 说明文档；这里只会调整识别规则，不会改软件架构。</p>
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
                    placeholder="例如：我们 POD 屏上「应领件数」在第二屏中间，反光严重时优先看左上角小字；如果标签不明确就留空并复核…"
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
                  {isSavingRules ? "保存中…" : "保存识别规则"}
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
                  <input
                    className="hidden"
                    type="file"
                    accept={SUPPORTED_VISUAL_UPLOAD_ACCEPT}
                    multiple
                    onChange={(event) => void handleFiles(event.target.files)}
                  />
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
                            await fetch(withFormId("/api/training/save"), {
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
                        aria-label={`删除 ${item.imageName}`}
                        className={`absolute right-2 top-2 z-10 rounded-full border border-rose-200 bg-white/95 px-2 py-1 text-[11px] font-medium text-rose-600 shadow-sm transition hover:bg-rose-50 ${
                          deletingImageName === item.imageName ? "pointer-events-none opacity-60" : ""
                        }`}
                      >
                        {deletingImageName === item.imageName ? "删除中..." : "删除"}
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
                            缩略图加载中
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

        {annotatingItem && annotationDraft ? (
          <TrainingAnnotationWorkbench
            open
            imageName={annotationImageName}
            imageSrc={annotationImageSrc}
            apiPathBuilder={withFormId}
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
              await loadTrainingStatus();
              setNoticeMessage(`标注已存入训练池，当前训练样本总数 ${totalExamples || 0}。`);
              const uploadId = removeUploadAfterSaveRef.current;
              removeUploadAfterSaveRef.current = null;
              if (uploadId) {
                setUploads((current) => current.filter((u) => u.id !== uploadId));
              }
            }}
          />
        ) : null}

        <RecognitionAgentDock formId={currentFormId} modeLabel="训练模式" />
      </div>
    </main>
  );
}

export default function TrainingMode() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-100" />}>
      <TrainingModeContent />
    </Suspense>
  );
}
