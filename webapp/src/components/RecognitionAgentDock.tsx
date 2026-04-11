"use client";

import { useEffect, useMemo, useState } from "react";

import type { AgentAsset, AgentThreadTurn } from "@/lib/agent-context-types";
import { DEFAULT_FORM_ID } from "@/lib/forms";
import { useLocale } from "@/i18n/LocaleProvider";

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

type AgentActionStatus = {
  phase: "running" | "done" | "error";
  message: string;
};

function formatTurnForChatApi(
  turn: AgentThreadTurn,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  let text = turn.content ?? "";
  if (turn.assets?.length) {
    for (const asset of turn.assets) {
      if (asset.kind === "image") {
        text += t("agent.apiImageLine", { name: asset.name, imageName: asset.imageName });
      } else {
        const ex =
          asset.excerpt.length > 4000 ? `${asset.excerpt.slice(0, 4000)}…` : asset.excerpt;
        text += t("agent.apiDocLine", { name: asset.name, ex });
      }
    }
  }
  if (turn.role === "assistant" && turn.suggestedRules?.trim()) {
    text += t("agent.apiRulesLine", { rules: turn.suggestedRules.trim() });
  }
  return text;
}

export function RecognitionAgentDock({
  formId = DEFAULT_FORM_ID,
  modeLabel,
}: RecognitionAgentDockProps) {
  const { t } = useLocale();
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
  const [actionStatus, setActionStatus] = useState<AgentActionStatus | null>(null);
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
        throw new Error(data.error || t("agent.errLoadRules"));
      }
      setAgentThread((current) =>
        current.length > 0 ? current : Array.isArray(data.agentThread) ? data.agentThread : [],
      );
      setWorkingRules(typeof data.workingRules === "string" ? data.workingRules : "");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("agent.errLoadRules"));
    } finally {
      setIsLoadingRules(false);
    }
  }

  async function saveRules(nextRules: string, nextThread: AgentThreadTurn[]) {
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
      throw new Error(data.error || t("agent.errSaveRules"));
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
        throw new Error(data.error || t("agent.errUploadCtx"));
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

    if (/\.(pdf|doc|docx|xlsx|xls)$/i.test(file.name)) {
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
      return file.type.startsWith("image/") || /\.(txt|csv|md|pdf|doc|docx|xlsx|xls)$/i.test(name);
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
    setActionStatus({ phase: "running", message: t("agent.analyzing") });

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
      setActionStatus({ phase: "running", message: t("agent.generating") });
      const res = await fetch(withFormId("/api/training/guidance-chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextThreadBase.map((turn) => ({
            role: turn.role,
            content: formatTurnForChatApi(turn, t),
          })),
          thread: nextThreadBase,
          currentWorkingRules: workingRules,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        assistantReply?: string;
        revisedWorkingRules?: string;
      };
      if (!res.ok) {
        setErrorMessage(data.error || t("agent.errChat"));
        setActionStatus({ phase: "error", message: data.error || t("agent.errGenCode") });
        return;
      }

      const assistantTurn: AgentThreadTurn = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: (data.assistantReply || "").trim() || t("agent.assistantEmpty"),
        ts: new Date().toISOString(),
      };

      const nextThread = [...nextThreadBase, assistantTurn];
      const nextRules = (data.revisedWorkingRules || workingRules || "").trim();

      setAgentThread(nextThread);
      setWorkingRules(nextRules);
      setAgentInput("");
      setPendingAttachments([]);
      setActionStatus({ phase: "running", message: t("agent.savingRules") });
      await saveRules(nextRules, nextThread);
      setNoticeMessage(t("agent.rulesUpdated"));
      setActionStatus({ phase: "done", message: t("agent.rulesSaved") });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("agent.errSend"));
      setActionStatus({
        phase: "error",
        message: error instanceof Error ? error.message : t("agent.errModify"),
      });
    } finally {
      setIsSending(false);
    }
  }

  function clearConversation() {
    setAgentThread([]);
    setAgentInput("");
    setPendingAttachments([]);
    setActionStatus(null);

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
          {t("agent.title")}
          {modeLabel ? ` · ${modeLabel}` : ""}
        </button>
      ) : null}

      {isOpen ? (
        <div className="fixed bottom-5 right-5 z-[120] flex h-[78vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{t("agent.title")}</div>
              {modeLabel ? <div className="text-xs text-slate-500">{modeLabel}</div> : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => setIsOpen(false)}
              >
                {t("agent.collapse")}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
            {isLoadingRules ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                {t("agent.loading")}
              </div>
            ) : null}
            {!isLoadingRules ? (
              <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-slate-500">
                {t("agent.intro1")} {t("agent.intro2")} {t("agent.intro3")}
              </div>
            ) : null}
            {!isLoadingRules && agentThread.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-6 text-slate-500">
                {t("agent.intro4")}
                <br />
                {t("agent.intro5")}
                <br />
                {t("agent.intro6")}
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
                    {turn.role === "user" ? t("agent.user") : t("agent.assistant")}
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
                      {asset.kind === "image"
                        ? t("agent.imageAsset", { name: asset.name })
                        : t("agent.docAsset", { name: asset.name })}
                    </button>
                  ))}
                  <div className="whitespace-pre-wrap break-words">{turn.content}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white p-4">
            {actionStatus ? (
              <div
                className={`mb-2 rounded-xl px-3 py-2 text-xs ${
                  actionStatus.phase === "done"
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : actionStatus.phase === "error"
                      ? "border border-rose-200 bg-rose-50 text-rose-700"
                      : "border border-blue-200 bg-blue-50 text-blue-700"
                }`}
              >
                {actionStatus.message}
              </div>
            ) : null}
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
                  {t("agent.dropHint")}
                </div>
              )}

              <textarea
                className="min-h-[96px] w-full resize-none rounded-2xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
                value={agentInput}
                onChange={(event) => setAgentInput(event.target.value)}
                onPaste={handlePaste}
                placeholder={t("agent.inputPh")}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={clearConversation}
              >
                {t("agent.clearChat")}
              </button>
              <label className="cursor-pointer rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                {t("agent.addAttachment")}
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
                {isPreparingAttachments ? t("agent.prepareAttach") : isSending ? t("agent.sending") : t("agent.send")}
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
                {t("agent.close")}
              </button>
            </div>
            <button
              type="button"
              className="absolute inset-0"
              aria-label={t("agent.closePreview")}
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
