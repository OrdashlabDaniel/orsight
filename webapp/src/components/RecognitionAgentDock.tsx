"use client";

import { useEffect, useMemo, useState } from "react";

import type { AgentAsset, AgentThreadTurn } from "@/lib/agent-context-types";
import { DEFAULT_FORM_ID } from "@/lib/forms";

const RECOGNITION_AGENT_DRAFT_PREFIX = "__recognition_agent_draft__:";

type RecognitionAgentDockProps = {
  formId?: string;
  modeLabel?: string;
};

type PendingAttachment = {
  id: string;
  name: string;
  asset: AgentAsset;
};

type PersistedRecognitionAgentDraft = {
  isOpen?: boolean;
  agentThread?: AgentThreadTurn[];
  agentInput?: string;
  pendingAttachments?: PendingAttachment[];
};

type ImagePreviewState = {
  name: string;
  src: string;
};

function formatTurnForChatApi(turn: AgentThreadTurn): string {
  let text = turn.content ?? "";
  if (turn.assets?.length) {
    for (const asset of turn.assets) {
      if (asset.kind === "image") {
        text += `\n[附图 ${asset.name}，存储名 ${asset.imageName}，服务端会在视觉阶段附带该图]`;
      } else {
        const ex =
          asset.excerpt.length > 4000 ? `${asset.excerpt.slice(0, 4000)}…` : asset.excerpt;
        text += `\n[文档 ${asset.name} 摘录]\n${ex}`;
      }
    }
  }
  if (turn.role === "assistant" && turn.suggestedRules?.trim()) {
    text += `\n（整理出的可执行补充规则）\n${turn.suggestedRules.trim()}`;
  }
  return text;
}

export function RecognitionAgentDock({
  formId = DEFAULT_FORM_ID,
  modeLabel,
}: RecognitionAgentDockProps) {
  const draftStorageKey = useMemo(() => `${RECOGNITION_AGENT_DRAFT_PREFIX}${formId}`, [formId]);
  const withFormId = useMemo(
    () => (path: string) =>
      formId === DEFAULT_FORM_ID ? path : `${path}${path.includes("?") ? "&" : "?"}formId=${encodeURIComponent(formId)}`,
    [formId],
  );

  const [isOpen, setIsOpen] = useState(false);
  const [agentThread, setAgentThread] = useState<AgentThreadTurn[]>([]);
  const [workingRules, setWorkingRules] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);

  function buildImagePreviewSrc(imageName: string) {
    return withFormId(`/api/training/image?raw=1&imageName=${encodeURIComponent(imageName)}`);
  }

  function openImagePreview(name: string, imageName: string) {
    setImagePreview({
      name,
      src: buildImagePreviewSrc(imageName),
    });
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) {
        setIsOpen(false);
        setAgentThread([]);
        setAgentInput("");
        setPendingAttachments([]);
        setWorkingRules("");
        setDraftHydrated(true);
        return;
      }
      const parsed = JSON.parse(raw) as PersistedRecognitionAgentDraft;
      setIsOpen(Boolean(parsed.isOpen));
      setAgentThread(Array.isArray(parsed.agentThread) ? parsed.agentThread : []);
      setAgentInput(typeof parsed.agentInput === "string" ? parsed.agentInput : "");
      setPendingAttachments(Array.isArray(parsed.pendingAttachments) ? parsed.pendingAttachments : []);
    } catch {
      setIsOpen(false);
      setAgentThread([]);
      setAgentInput("");
      setPendingAttachments([]);
      setWorkingRules("");
    } finally {
      setDraftHydrated(true);
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }
    const payload: PersistedRecognitionAgentDraft = {
      isOpen,
      agentThread,
      agentInput,
      pendingAttachments,
    };
    window.localStorage.setItem(draftStorageKey, JSON.stringify(payload));
  }, [agentInput, agentThread, draftHydrated, draftStorageKey, isOpen, pendingAttachments]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void loadRules();
  }, [formId, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRules() {
    setIsLoadingRules(true);
    try {
      const res = await fetch(withFormId("/api/training/rules"));
      const data = (await res.json()) as {
        error?: string;
        agentThread?: AgentThreadTurn[];
        workingRules?: string;
      };
      if (!res.ok) {

      }
      setAgentThread((current) =>
        current.length > 0 ? current : Array.isArray(data.agentThread) ? data.agentThread : [],
      );
      setWorkingRules(typeof data.workingRules === "string" ? data.workingRules : "");
    } catch (error) {

    } finally {
      setIsLoadingRules(false);
    }
  }

  async function saveRules(nextRules: string, nextThread: AgentThreadTurn[]) {
    try {
      const res = await fetch(withFormId("/api/training/rules"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingRules: nextRules,
          agentThread: nextThread,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {

      }

    } catch (error) {

    }
  }

  async function processFileToAsset(file: File): Promise<AgentAsset | null> {
    const maxBytes = 12 * 1024 * 1024;
    if (file.size > maxBytes) {

    }

    if (file.type.startsWith("image/")) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("formId", formId);
      const res = await fetch("/api/training/context-asset", { method: "POST", body: fd });
      const data = (await res.json()) as {
        error?: string;
        imageName?: string;
        originalName?: string;
      };
      if (!res.ok) {

      }
      if (!data.imageName) {
        throw new Error(data.error || "上传上下文图片失败");
      }
      return {
        kind: "image",
        name: file.name || data.originalName || "image",
        imageName: data.imageName,
      };
    }

    if (/\.(txt|csv|md)$/i.test(file.name)) {
      const excerpt = (await file.text()).trim().slice(0, 12000);
      return excerpt ? { kind: "document", name: file.name, excerpt } : null;
    }

    if (/\.(pdf|doc|docx)$/i.test(file.name)) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/training/parse-document", { method: "POST", body: fd });
      const data = (await res.json()) as { text?: string; error?: string; warning?: string };
      if (!res.ok) {

      }
      const excerpt = (data.text || "").trim().slice(0, 12000);
      if (!excerpt) {

      }
      return { kind: "document", name: file.name, excerpt };
    }

    return null;
  }

  async function addPendingFiles(files: File[]) {
    const allowed = files.filter((file) => {
      const name = file.name.toLowerCase();
      return file.type.startsWith("image/") || /\.(txt|csv|md|pdf|doc|docx)$/i.test(name);
    });

    if (allowed.length < files.length) {

    }
    if (allowed.length === 0) {
      return;
    }

    setIsPreparingAttachments(true);
    const prepared: PendingAttachment[] = [];
    const failures: string[] = [];

    for (const file of allowed) {
      try {
        const asset = await processFileToAsset(file);
        if (asset) {
          prepared.push({
            id: crypto.randomUUID(),
            name: file.name,
            asset,
          });
        }
      } catch (error) {

      }
    }

    if (prepared.length > 0) {
      setPendingAttachments((current) => [...current, ...prepared]);

    }
    if (failures.length > 0) {

    }

    setIsPreparingAttachments(false);
  }

  async function sendMessage() {
    const text = agentInput.trim();
    if ((!text && pendingAttachments.length === 0) || isSending || isPreparingAttachments) {
      return;
    }

    setIsSending(true);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      const userTurn: AgentThreadTurn = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        ts: new Date().toISOString(),
        ...(pendingAttachments.length > 0
          ? { assets: pendingAttachments.map((pending) => pending.asset) }
          : {}),
      };

      const nextThreadBase = [...agentThread, userTurn];
      const res = await fetch(withFormId("/api/training/guidance-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextThreadBase.map((turn) => ({
            role: turn.role,
            content: formatTurnForChatApi(turn),
          })),
          currentWorkingRules: workingRules,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        assistantReply?: string;
        revisedWorkingRules?: string;
      };
      if (!res.ok) {
        setErrorMessage(data.error || "识别规则对话请求失败");
        return;
      }

      const assistantTurn: AgentThreadTurn = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: (data.assistantReply || "").trim() || "（助手未返回说明文字）",
        ts: new Date().toISOString(),
      };

      const nextThread = [...nextThreadBase, assistantTurn];
      const nextRules = (data.revisedWorkingRules || workingRules || "").trim();

      setAgentThread(nextThread);
      setWorkingRules(nextRules);
      setAgentInput("");
      setPendingAttachments([]);
      await saveRules(nextRules, nextThread);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "发送失败");
    } finally {
      setIsSending(false);
    }
  }

  function clearConversation() {
    setAgentThread([]);
    setAgentInput("");
    setPendingAttachments([]);

  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
    if (files.length > 0) {
      event.preventDefault();
      void addPendingFiles(files);
    }
  }

  return (
    <>
      {!isOpen ? (
        <button
          type="button"
          className="fixed bottom-5 right-5 z-[120] rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-2xl transition hover:bg-slate-800"
          onClick={() => setIsOpen(true)}
        >
          识别管家 {modeLabel ? `· ${modeLabel}` : ""}
        </button>
      ) : null}

      {isOpen ? (
        <div className="fixed bottom-5 right-5 z-[120] flex h-[78vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">识别管家</div>
              {modeLabel ? <div className="text-xs text-slate-500">{modeLabel}</div> : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => setIsOpen(false)}
              >
                收起
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
            {isLoadingRules ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                正在加载规则与对话…
              </div>
            ) : null}
            {!isLoadingRules ? (
              <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-slate-500">
                识别管家统管当前这一份填表的识别效果：对话与「工作识别规则」仅保存在本填表内，与项目内其他填表互不干扰。填表模式与训练模式共用同一套规则。
                仅讨论截图识别：字段含义、OCR 优先级、歧义处理等；软件架构、接口、权限等不会写入规则正文。
              </div>
            ) : null}
            {!isLoadingRules && agentThread.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-6 text-slate-500">
                用自然语言描述特殊场景下希望模型如何读图；可附带截图或文档作示例。
                <br />
                发送后助手会更新「工作识别规则」，并用于本填表的填表识别与训练相关流程。
                <br />
                在训练页打开识别管家，与在填表页打开的是同一填表、同一规则存档。
              </div>
            ) : null}
            <div className="space-y-3">
              {agentThread.map((turn) => (
                <div
                  key={turn.id}
                  className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${
                    turn.role === "user" ? "ml-6 bg-blue-50 text-slate-800" : "mr-6 bg-white text-slate-700"
                  }`}
                >
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {turn.role === "user" ? "用户" : "助手"}
                  </div>
                  {turn.assets?.map((asset) => (
                    <button
                      type="button"
                      key={`${turn.id}-${asset.kind}-${asset.name}`}
                      className={`mb-2 block w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-left text-xs ${
                        asset.kind === "image"
                          ? "text-blue-700 hover:border-blue-300 hover:bg-blue-50"
                          : "text-slate-600"
                      }`}
                      onClick={() => {
                        if (asset.kind === "image") {
                          openImagePreview(asset.name, asset.imageName);
                        }
                      }}
                      disabled={asset.kind !== "image"}
                    >
                      {asset.kind === "image" ? `图片：${asset.name}` : `文档：${asset.name}`}
                    </button>
                  ))}
                  <div className="whitespace-pre-wrap break-words">{turn.content}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white p-4">
            {errorMessage ? (
              <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</div>
            ) : null}
            {noticeMessage ? (
              <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{noticeMessage}</div>
            ) : null}

            <div
              className={`mb-2 rounded-2xl border-2 border-dashed p-3 transition ${
                dragActive ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                void addPendingFiles(Array.from(event.dataTransfer.files || []));
              }}
            >
              {pendingAttachments.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pendingAttachments.map((pending) => (
                    <span
                      key={pending.id}
                      className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-slate-700"
                    >
                      {pending.asset.kind === "image" ? (
                        <button
                          type="button"
                          className="max-w-[180px] truncate text-blue-700 hover:text-blue-900"
                          onClick={() => openImagePreview(pending.name, (pending.asset as Extract<AgentAsset, { kind: "image" }>).imageName)}
                        >
                          {pending.name}
                        </button>
                      ) : (
                        <span className="max-w-[180px] truncate">{pending.name}</span>
                      )}
                      <button
                        type="button"
                        className="text-rose-500 hover:text-rose-700"
                        onClick={() =>
                          setPendingAttachments((current) => current.filter((item) => item.id !== pending.id))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mb-2 text-center text-xs text-slate-500">
                  拖拽图片或文档到此处，或使用下方按钮选择文件（图片 / txt / csv / md / pdf / doc / docx）
                </div>
              )}

              <textarea
                className="min-h-[96px] w-full resize-none rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
                value={agentInput}
                onChange={(event) => setAgentInput(event.target.value)}
                onPaste={handlePaste}
                placeholder="输入要调整的识别规则说明…"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={clearConversation}
              >
                清空对话
              </button>
              <label className="cursor-pointer rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                添加附件
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,.txt,.csv,.md,.pdf,.doc,.docx"
                  onChange={(event) => {
                    const files = event.target.files;
                    if (files?.length) {
                      void addPendingFiles(Array.from(files));
                    }
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
                onClick={() => void sendMessage()}
                disabled={isSending || isPreparingAttachments || (!agentInput.trim() && pendingAttachments.length === 0)}
              >
                {isPreparingAttachments ? "处理附件中…" : isSending ? "发送中…" : "发送"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {imagePreview ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/75 p-4">
          <div className="relative flex h-[88vh] w-[min(94vw,1200px)] flex-col overflow-hidden rounded-3xl bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{imagePreview.name}</div>

              </div>
              <button
                type="button"
                className="rounded-full border border-white/20 px-3 py-1 text-sm text-white hover:bg-white/10"
                onClick={() => setImagePreview(null)}
              >
                关闭
              </button>
            </div>
            <button
              type="button"
              className="absolute inset-0"
              aria-label="关闭预览"
              onClick={() => setImagePreview(null)}
            />
            <div className="relative z-[1] flex min-h-0 flex-1 items-center justify-center p-4">
              <img
                src={imagePreview.src}
                alt={imagePreview.name}
                className="max-h-full max-w-full rounded-2xl object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
