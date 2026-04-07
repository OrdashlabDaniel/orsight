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
  workingRules?: string;
  workingRulesDirty?: boolean;
};

type ImagePreviewState = {
  name: string;
  src: string;
};

function formatTurnForChatApi(turn: AgentThreadTurn): string {
  let text = turn.content;
  if (turn.assets?.length) {
    for (const asset of turn.assets) {
      if (asset.kind === "image") {
        text += `\n[附图：${asset.name}，存储名 ${asset.imageName}]`;
      } else {
        text += `\n[文档：${asset.name} 摘录]\n${asset.excerpt.slice(0, 4000)}`;
      }
    }
  }
  return text;
}

export function RecognitionAgentDock({
  formId = DEFAULT_FORM_ID,
  modeLabel = "当前填表",
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
  const [workingRulesDirty, setWorkingRulesDirty] = useState(false);
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  const [agentInput, setAgentInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);
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
        setWorkingRulesDirty(false);
        setDraftHydrated(true);
        return;
      }
      const parsed = JSON.parse(raw) as PersistedRecognitionAgentDraft;
      setIsOpen(Boolean(parsed.isOpen));
      setAgentThread(Array.isArray(parsed.agentThread) ? parsed.agentThread : []);
      setAgentInput(typeof parsed.agentInput === "string" ? parsed.agentInput : "");
      setPendingAttachments(Array.isArray(parsed.pendingAttachments) ? parsed.pendingAttachments : []);
      if (typeof parsed.workingRules === "string") {
        setWorkingRules(parsed.workingRules);
      } else {
        setWorkingRules("");
      }
      setWorkingRulesDirty(Boolean(parsed.workingRulesDirty));
    } catch {
      setIsOpen(false);
      setAgentThread([]);
      setAgentInput("");
      setPendingAttachments([]);
      setWorkingRules("");
      setWorkingRulesDirty(false);
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
      workingRules: workingRulesDirty ? workingRules : "",
      workingRulesDirty,
    };
    window.localStorage.setItem(draftStorageKey, JSON.stringify(payload));
  }, [
    agentInput,
    agentThread,
    draftHydrated,
    draftStorageKey,
    isOpen,
    pendingAttachments,
    workingRules,
    workingRulesDirty,
  ]);

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
        throw new Error(data.error || "识别规则读取失败。");
      }
      setAgentThread((current) =>
        current.length > 0 ? current : Array.isArray(data.agentThread) ? data.agentThread : [],
      );
      if (!workingRulesDirty) {
        setWorkingRules(typeof data.workingRules === "string" ? data.workingRules : "");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "识别规则读取失败。");
    } finally {
      setIsLoadingRules(false);
    }
  }

  async function saveRules(nextRules: string, nextThread: AgentThreadTurn[]) {
    setIsSavingRules(true);
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
        throw new Error(data.error || "识别规则保存失败。");
      }
      setWorkingRulesDirty(false);
      setNoticeMessage("识别规则已保存，将在下次识别时生效。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "识别规则保存失败。");
    } finally {
      setIsSavingRules(false);
    }
  }

  async function processFileToAsset(file: File): Promise<AgentAsset | null> {
    const maxBytes = 12 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`「${file.name}」超过 12MB。`);
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
        throw new Error(data.error || "图片上传失败。");
      }
      if (!data.imageName) {
        throw new Error("图片上传后缺少存储名。");
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
        throw new Error(data.error || "文档解析失败。");
      }
      const excerpt = (data.text || "").trim().slice(0, 12000);
      if (!excerpt) {
        throw new Error(data.warning || "文档中未提取到文字。");
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
      setErrorMessage("部分文件已忽略：仅支持图片、截图、PDF、Word、TXT、CSV、Markdown。");
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
        failures.push(error instanceof Error ? error.message : `「${file.name}」处理失败。`);
      }
    }

    if (prepared.length > 0) {
      setPendingAttachments((current) => [...current, ...prepared]);
      setNoticeMessage(`已添加 ${prepared.length} 个待发附件。`);
    }
    if (failures.length > 0) {
      setErrorMessage(failures.join("；"));
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
        content: text || "（仅附件）",
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
        throw new Error(data.error || "发送失败。");
      }

      const assistantTurn: AgentThreadTurn = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.assistantReply || "已根据你的反馈更新识别规则。",
        ts: new Date().toISOString(),
      };

      const nextThread = [...nextThreadBase, assistantTurn];
      const nextRules = (data.revisedWorkingRules || workingRules || "").trim();

      setAgentThread(nextThread);
      setWorkingRules(nextRules);
      setWorkingRulesDirty(false);
      setAgentInput("");
      setPendingAttachments([]);
      await saveRules(nextRules, nextThread);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "发送失败。");
    } finally {
      setIsSending(false);
    }
  }

  function clearConversation() {
    setAgentThread([]);
    setAgentInput("");
    setPendingAttachments([]);
    setNoticeMessage("已清空对话记录和当前草稿。识别规则正文仍保留，如需重置请清空后保存。");
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
          识别管家
        </button>
      ) : null}

      {isOpen ? (
        <div className="fixed bottom-5 right-5 z-[120] flex h-[78vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">识别管家</div>
              <div className="text-xs text-slate-500">{modeLabel} · 只优化识别方式，不修改软件架构</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => setShowRulesEditor((value) => !value)}
              >
                {showRulesEditor ? "收起规则" : "查看规则"}
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => setIsOpen(false)}
              >
                关闭
              </button>
            </div>
          </div>

          {showRulesEditor ? (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <label className="mb-1 block text-xs font-medium text-slate-700">当前识别规则</label>
              <textarea
                className="min-h-[132px] w-full resize-y rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs leading-relaxed outline-none focus:border-blue-500"
                value={workingRules}
                onChange={(event) => {
                  setWorkingRules(event.target.value);
                  setWorkingRulesDirty(true);
                }}
                placeholder="这里存放模型根据你反馈整理出的识别规则。这里只影响识别方式，不修改页面、接口、权限、存储和字段结构。"
              />
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-rose-600"
                  onClick={clearConversation}
                >
                  清空对话
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:bg-blue-300"
                  onClick={() => void saveRules(workingRules, agentThread)}
                  disabled={isSavingRules}
                >
                  {isSavingRules ? "保存中..." : "保存识别规则"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
            {isLoadingRules ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                正在加载识别上下文...
              </div>
            ) : null}
            {!isLoadingRules && agentThread.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-6 text-slate-500">
                直接告诉我：
                <br />
                1. 哪些字段识别错了
                <br />
                2. 应该按什么标签和规则识别
                <br />
                3. 你可以附上截图、现场图片、PDF、说明文档
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
                    {turn.role === "user" ? "你" : "识别管家"}
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
                      {asset.kind === "image" ? `图片：${asset.name}（点击查看）` : `文档：${asset.name}`}
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
                  拖拽图片、截图、PDF、Word、TXT 到这里，或用下方按钮添加
                </div>
              )}

              <textarea
                className="min-h-[96px] w-full resize-none rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
                value={agentInput}
                onChange={(event) => setAgentInput(event.target.value)}
                onPaste={handlePaste}
                placeholder="告诉我哪些识别结果不对，应该如何识别；也可以直接贴截图或上传图片。"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="cursor-pointer rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                添加文件
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
                {isPreparingAttachments ? "处理附件中..." : isSending ? "发送中..." : "发送"}
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
                <div className="text-xs text-slate-300">点击遮罩或右上角关闭</div>
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
              aria-label="关闭图片预览"
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
