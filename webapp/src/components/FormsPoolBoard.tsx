"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useLocale } from "@/i18n/LocaleProvider";
import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { isSupabaseAuthEnabled } from "@/lib/supabase";
import { getLocalizedFormDescription, getLocalizedFormName } from "@/lib/form-display";
import {
  DEFAULT_FORM_ID,
  buildFormFillHref,
  buildFormSetupHref,
  splitForms,
  type FormDefinition,
} from "@/lib/forms";

type FormsResponse = {
  forms?: FormDefinition[];
  error?: string;
};

type FormMutationResponse = {
  form?: FormDefinition | null;
  error?: string;
};

type FormShareResponse = {
  acceptUrl?: string;
  emailSent?: boolean;
  emailError?: string | null;
  expiresAt?: number;
  targetEmail?: string | null;
  error?: string;
};

type FormShareAcceptResponse = {
  form?: FormDefinition | null;
  alreadyAccepted?: boolean;
  error?: string;
};

export default function FormsPoolBoard() {
  const { locale, t } = useLocale();
  const formTitle = useCallback((form: FormDefinition) => getLocalizedFormName(form, locale), [locale]);
  const formDesc = useCallback((form: FormDefinition) => getLocalizedFormDescription(form, locale), [locale]);

  function statusLabel(form: FormDefinition) {
    return form.ready ? t("formsPool.statusDone") : t("formsPool.statusDraft");
  }

  function remainingRecycleText(deletedAt?: number | null) {
    if (!deletedAt) {
      return t("formsPool.recycleKept");
    }
    const remainingMs = deletedAt + 30 * 24 * 60 * 60 * 1000 - Date.now();
    if (remainingMs <= 0) {
      return t("formsPool.recycleSoon");
    }
    return t("formsPool.recycleDays", { n: Math.ceil(remainingMs / (24 * 60 * 60 * 1000)) });
  }
  const [forms, setForms] = useState<FormDefinition[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [workingKey, setWorkingKey] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [noticeMessage, setNoticeMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FormDefinition | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [purgeTarget, setPurgeTarget] = useState<FormDefinition | null>(null);
  const [purgePassword, setPurgePassword] = useState("");
  const [purgeError, setPurgeError] = useState("");
  const [shareTarget, setShareTarget] = useState<FormDefinition | null>(null);
  const [shareRecipientEmail, setShareRecipientEmail] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareInfoMessage, setShareInfoMessage] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState<number | null>(null);
  const [acceptShareInput, setAcceptShareInput] = useState("");
  const [acceptShareError, setAcceptShareError] = useState("");

  const { active, recycleBin } = useMemo(() => splitForms(forms), [forms]);

  const purgeNeedsPassword = useMemo(() => isSupabaseAuthEnabled() || isDevMockLoginEnabled(), []);

  const loadForms = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/forms", { cache: "no-store" });
      const payload = (await response.json()) as FormsResponse;
      if (!response.ok) {
        throw new Error(payload.error || t("formsPool.errLoad"));
      }
      setForms(payload.forms || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formsPool.errLoad"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  async function mutateForm(formId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as FormMutationResponse;
    if (!response.ok) {
      throw new Error(payload.error || t("formsPool.errMutate"));
    }
    return payload.form || null;
  }

  async function handleCreateForm() {
    setWorkingKey("create");
    setErrorMessage("");
    setNoticeMessage("");
    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as FormMutationResponse;
      if (!response.ok || !payload.form) {
        throw new Error(payload.error || t("formsPool.errCreate"));
      }
      window.location.href = buildFormSetupHref(payload.form.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formsPool.errCreate"));
    } finally {
      setWorkingKey("");
    }
  }

  async function handleCloneForm(form: FormDefinition) {
    setWorkingKey(`clone:${form.id}`);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      const cloned = await mutateForm(form.id, { action: "duplicate" });
      if (cloned) {
        setForms((current) => {
          const sourceIndex = current.findIndex((item) => item.id === form.id);
          if (sourceIndex < 0) {
            return [...current, cloned];
          }
          const next = [...current];
          next.splice(sourceIndex + 1, 0, cloned);
          return next;
        });
      }
      setNoticeMessage(cloned ? t("formsPool.cloned", { name: formTitle(cloned) }) : t("formsPool.clonedShort"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formsPool.errClone"));
    } finally {
      setWorkingKey("");
    }
  }

  function openDeleteConfirm(form: FormDefinition) {
    setErrorMessage("");
    setDeleteError("");
    setDeleteTarget(form);
  }

  async function handleDeleteForm(form: FormDefinition, fromModal = false) {
    setWorkingKey(`delete:${form.id}`);
    setErrorMessage("");
    setNoticeMessage("");
    if (fromModal) {
      setDeleteError("");
    }
    try {
      await mutateForm(form.id, { action: "delete" });
      await loadForms();
      setNoticeMessage(t("formsPool.trashed", { name: formTitle(form) }));
      setDeleteTarget(null);
      setDeleteError("");
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("formsPool.errDelete");
      if (fromModal) {
        setDeleteError(msg);
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setWorkingKey("");
    }
  }

  function cancelDeleteConfirm() {
    if (deleteTarget && workingKey === `delete:${deleteTarget.id}`) {
      return;
    }
    setDeleteTarget(null);
    setDeleteError("");
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    await handleDeleteForm(deleteTarget, true);
  }

  async function handleRestoreForm(form: FormDefinition) {
    setWorkingKey(`restore:${form.id}`);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      await mutateForm(form.id, { action: "restore" });
      await loadForms();
      setNoticeMessage(t("formsPool.restored", { name: formTitle(form) }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formsPool.errRestore"));
    } finally {
      setWorkingKey("");
    }
  }

  function openPurgeConfirm(form: FormDefinition) {
    setErrorMessage("");
    setPurgeError("");
    if (!purgeNeedsPassword) {
      void executePermanentDelete(form, undefined, false);
      return;
    }
    setPurgeTarget(form);
    setPurgePassword("");
  }

  async function executePermanentDelete(form: FormDefinition, password: string | undefined, fromModal: boolean) {
    setWorkingKey(`purge:${form.id}`);
    setErrorMessage("");
    setNoticeMessage("");
    if (fromModal) {
      setPurgeError("");
    }
    try {
      await mutateForm(form.id, {
        action: "permanent-delete",
        ...(password != null && password !== "" ? { password } : {}),
      });
      await loadForms();
      setNoticeMessage(t("formsPool.purged", { name: formTitle(form) }));
      setPurgeTarget(null);
      setPurgePassword("");
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("formsPool.errPurge");
      if (fromModal) {
        setPurgeError(msg);
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setWorkingKey("");
    }
  }

  async function confirmPermanentDelete() {
    if (!purgeTarget) {
      return;
    }
    const trimmed = purgePassword.trim();
    if (purgeNeedsPassword && !trimmed) {
      setPurgeError(t("formsPool.purgePasswordRequired"));
      return;
    }
    await executePermanentDelete(purgeTarget, trimmed, true);
  }

  function cancelPermanentDelete() {
    setPurgeTarget(null);
    setPurgePassword("");
    setPurgeError("");
  }

  function openShareDialog(form: FormDefinition) {
    setErrorMessage("");
    setNoticeMessage("");
    setShareTarget(form);
    setShareRecipientEmail("");
    setShareError("");
    setShareInfoMessage("");
    setShareLink("");
    setShareExpiresAt(null);
  }

  function closeShareDialog() {
    if (shareTarget && workingKey === `share:${shareTarget.id}`) {
      return;
    }
    setShareTarget(null);
    setShareRecipientEmail("");
    setShareError("");
    setShareInfoMessage("");
    setShareLink("");
    setShareExpiresAt(null);
  }

  async function handleCreateShare(form: FormDefinition, mode: "link" | "email") {
    const recipientEmail = shareRecipientEmail.trim().toLowerCase();
    if (mode === "email" && (!recipientEmail || !recipientEmail.includes("@"))) {
      setShareError(t("login.errEmail"));
      return;
    }

    setWorkingKey(`share:${form.id}`);
    setShareError("");
    setShareInfoMessage("");
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: mode === "email" ? recipientEmail : "" }),
      });
      const payload = (await response.json().catch(() => null)) as FormShareResponse | null;
      if (!response.ok || !payload?.acceptUrl) {
        throw new Error(payload?.error || t("formsPool.errShare"));
      }
      setShareLink(payload.acceptUrl);
      setShareExpiresAt(typeof payload.expiresAt === "number" ? payload.expiresAt : null);
      if (payload.emailSent) {
        setShareInfoMessage(t("formsPool.shareEmailSent"));
      } else if (mode === "email") {
        setShareInfoMessage(t("formsPool.shareEmailFallback"));
      } else {
        setShareInfoMessage("");
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : t("formsPool.errShare"));
    } finally {
      setWorkingKey("");
    }
  }

  async function handleCopyShareLink() {
    if (!shareLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLink);
      setShareInfoMessage(t("formsPool.shareCopied"));
    } catch {
      setShareError(t("formsPool.errShare"));
    }
  }

  function openShareMailApp() {
    if (!shareLink || !shareRecipientEmail.trim()) {
      return;
    }
    const subject = encodeURIComponent(`OrSight: ${shareTarget?.name || "Shared form"}`);
    const body = encodeURIComponent(`${shareTarget?.name || "Shared form"}\n\n${shareLink}`);
    window.location.href = `mailto:${encodeURIComponent(shareRecipientEmail.trim())}?subject=${subject}&body=${body}`;
  }

  function extractShareToken(rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return "";
    }

    const tokenMatch = trimmed.match(/(?:[?&#]|^)token=([^&#\s]+)/i);
    if (tokenMatch?.[1]) {
      try {
        return decodeURIComponent(tokenMatch[1]).trim();
      } catch {
        return tokenMatch[1].trim();
      }
    }

    try {
      const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      const url =
        trimmed.startsWith("http://") || trimmed.startsWith("https://")
          ? new URL(trimmed)
          : trimmed.startsWith("/")
            ? new URL(trimmed, base)
            : null;
      const token = url?.searchParams.get("token")?.trim();
      if (token) {
        return token;
      }
    } catch {
      // Fall through to token-only input.
    }

    return /\s/.test(trimmed) ? "" : trimmed;
  }

  async function handleAcceptSharedForm() {
    const token = extractShareToken(acceptShareInput);
    if (!token) {
      setAcceptShareError(t("formsPool.acceptSharedInvalid"));
      return;
    }

    setWorkingKey("accept-share");
    setAcceptShareError("");
    setErrorMessage("");
    setNoticeMessage("");
    try {
      const response = await fetch("/api/form-shares/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json().catch(() => null)) as FormShareAcceptResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || t("formShare.errAccept"));
      }

      setAcceptShareInput("");
      await loadForms();
      setNoticeMessage(
        payload?.alreadyAccepted
          ? t("formsPool.acceptSharedAcceptedAlready")
          : t("formsPool.acceptSharedAccepted", { name: payload?.form?.name || t("formsPool.acceptSharedAcceptedShort") }),
      );
    } catch (error) {
      setAcceptShareError(error instanceof Error ? error.message : t("formShare.errAccept"));
    } finally {
      setWorkingKey("");
    }
  }

  async function handleRename(formId: string) {
    const nextName = editingName.trim();
    if (!nextName) {
      setErrorMessage(t("formsPool.errRenameEmpty"));
      return;
    }

    setWorkingKey(`rename:${formId}`);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      const form = await mutateForm(formId, { action: "update", name: nextName });
      await loadForms();
      setEditingId(null);
      setEditingName("");
      setNoticeMessage(form ? t("formsPool.renamed", { name: formTitle(form) }) : t("formsPool.renamedShort"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formsPool.errRename"));
    } finally {
      setWorkingKey("");
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--background)] px-3 py-8 text-[var(--foreground)]">
      <div className="mx-auto w-[80%] max-w-full space-y-6">
        <header className="border-b border-[var(--border)] pb-6">
          <h1 className="text-xl font-medium tracking-tight">{t("formsPool.title")}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("formsPool.subtitle")}</p>
          {noticeMessage ? (
            <div className="mt-4 rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900">
              {noticeMessage}
            </div>
          ) : null}
          {errorMessage ? (
            <div className="mt-4 rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm text-red-800">
              {errorMessage}
            </div>
          ) : null}
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {active.map((form) => {
            const isBusy = Boolean(workingKey) && workingKey.includes(form.id);
            const isDefaultForm = form.id === DEFAULT_FORM_ID;
            return (
              <article key={form.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {editingId === form.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          maxLength={48}
                          autoFocus
                          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRename(form.id)}
                          disabled={isBusy}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {t("formsPool.save")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditingName("");
                          }}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
                        >
                          {t("formsPool.cancel")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-lg font-semibold text-slate-900">{formTitle(form)}</h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(form.id);
                              setEditingName(form.name);
                            }}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            {t("formsPool.rename")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCloneForm(form)}
                            disabled={isBusy}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {t("formsPool.clone")}
                          </button>
                        <button
                          type="button"
                          onClick={() => openShareDialog(form)}
                          disabled={isBusy}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {t("formsPool.share")}
                        </button>
                          {!isDefaultForm ? (
                            <button
                              type="button"
                              onClick={() => openDeleteConfirm(form)}
                              disabled={isBusy}
                              className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              {t("formsPool.delete")}
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}
                    <p className="mt-2 text-sm text-slate-600">{formDesc(form)}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                      form.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {statusLabel(form)}
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {form.ready ? (
                    <Link
                      href={buildFormFillHref(form.id)}
                      className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {t("formsPool.enterFill")}
                    </Link>
                  ) : (
                    <Link
                      href={buildFormSetupHref(form.id)}
                      className="inline-flex rounded-lg border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                    >
                      {t("formsPool.continueSetup")}
                    </Link>
                  )}
                  <Link
                    href={buildFormSetupHref(form.id)}
                    className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    {t("formsPool.configTemplate")}
                  </Link>
                </div>
              </article>
            );
          })}

          <article className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{t("formsPool.newFormTitle")}</h2>
            <p className="mt-2 text-sm text-slate-600">{t("formsPool.newFormDesc")}</p>
            <div className="mt-5">
              <button
                type="button"
                onClick={() => void handleCreateForm()}
                disabled={workingKey === "create" || isLoading}
                className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {workingKey === "create" ? t("formsPool.creating") : t("formsPool.newForm")}
              </button>
            </div>
          </article>

          <article className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{t("formsPool.acceptSharedTitle")}</h2>
            <p className="mt-2 text-sm text-slate-600">{t("formsPool.acceptSharedDesc")}</p>
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAcceptSharedForm();
              }}
            >
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{t("formsPool.acceptSharedInputLabel")}</span>
                <input
                  type="text"
                  value={acceptShareInput}
                  onChange={(event) => {
                    setAcceptShareInput(event.target.value);
                    setAcceptShareError("");
                  }}
                  placeholder={t("formsPool.acceptSharedPlaceholder")}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </label>
              <p className="mt-2 text-xs text-slate-500">{t("formsPool.acceptSharedHint")}</p>
              {acceptShareError ? (
                <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {acceptShareError}
                </p>
              ) : null}
              <div className="mt-5">
                <button
                  type="submit"
                  disabled={workingKey === "accept-share" || isLoading}
                  className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {workingKey === "accept-share" ? t("formsPool.acceptSharedAccepting") : t("formsPool.acceptSharedButton")}
                </button>
              </div>
            </form>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{t("formsPool.recycleTitle")}</h2>
            <span className="text-xs text-slate-500">{t("formsPool.recycleHint")}</span>
          </div>

          {isLoading ? (
            <p className="mt-4 text-sm text-slate-500">{t("formsPool.loading")}</p>
          ) : recycleBin.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">{t("formsPool.recycleEmpty")}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {recycleBin.map((form) => (
                <li
                  key={form.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{formTitle(form)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {form.deletedAt != null
                        ? t("formsPool.deletedAt", {
                            time: new Date(form.deletedAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN"),
                            remain: remainingRecycleText(form.deletedAt),
                          })
                        : remainingRecycleText(form.deletedAt)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRestoreForm(form)}
                      disabled={workingKey === `restore:${form.id}`}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50"
                    >
                      {t("formsPool.restore")}
                    </button>
                    <button
                      type="button"
                      onClick={() => openPurgeConfirm(form)}
                      disabled={workingKey === `purge:${form.id}`}
                      className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {t("formsPool.purge")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {deleteTarget ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                cancelDeleteConfirm();
              }
            }}
          >
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 id="delete-dialog-title" className="text-lg font-semibold text-slate-900">
                {t("formsPool.deleteConfirmTitle")}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {t("formsPool.deleteConfirmBody", { name: formTitle(deleteTarget) })}
              </p>
              {deleteError ? (
                <p className="mt-3 text-sm text-rose-700" role="alert">
                  {deleteError}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelDeleteConfirm}
                  disabled={workingKey === `delete:${deleteTarget.id}`}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("formsPool.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDelete()}
                  disabled={workingKey === `delete:${deleteTarget.id}`}
                  className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                >
                  {workingKey === `delete:${deleteTarget.id}`
                    ? t("formsPool.deleteConfirming")
                    : t("formsPool.deleteConfirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {purgeTarget ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purge-dialog-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                cancelPermanentDelete();
              }
            }}
          >
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 id="purge-dialog-title" className="text-lg font-semibold text-slate-900">
                {t("formsPool.purgeConfirmTitle")}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {t("formsPool.purgeConfirmBody", { name: formTitle(purgeTarget) })}
              </p>
              <label className="mt-4 block">
                <span className="text-sm font-medium text-slate-700">{t("formsPool.purgePasswordLabel")}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={purgePassword}
                  onChange={(event) => {
                    setPurgePassword(event.target.value);
                    setPurgeError("");
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  placeholder={t("formsPool.purgePasswordPlaceholder")}
                />
              </label>
              {purgeError ? (
                <p className="mt-2 text-sm text-rose-700" role="alert">
                  {purgeError}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelPermanentDelete}
                  disabled={Boolean(workingKey)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("formsPool.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void confirmPermanentDelete()}
                  disabled={Boolean(workingKey)}
                  className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                >
                  {workingKey === `purge:${purgeTarget.id}` ? t("formsPool.purgeConfirming") : t("formsPool.purgeConfirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {shareTarget ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeShareDialog();
              }
            }}
          >
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 id="share-dialog-title" className="text-lg font-semibold text-slate-900">
                {t("formsPool.shareDialogTitle")}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {t("formsPool.shareDialogBody")}
              </p>
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {formTitle(shareTarget)}
              </div>

              <label className="mt-4 block">
                <span className="text-sm font-medium text-slate-700">{t("formsPool.shareEmailLabel")}</span>
                <input
                  type="email"
                  value={shareRecipientEmail}
                  onChange={(event) => {
                    setShareRecipientEmail(event.target.value);
                    setShareError("");
                  }}
                  placeholder={t("formsPool.shareEmailPlaceholder")}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </label>
              <p className="mt-2 text-xs text-slate-500">{t("formsPool.shareEmailHint")}</p>

              {shareLink ? (
                <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {t("formsPool.shareLinkLabel")}
                  </div>
                  <div className="break-all text-sm text-slate-700">{shareLink}</div>
                  {shareExpiresAt ? (
                    <div className="text-xs text-slate-500">
                      {t("formsPool.shareExpires", {
                        time: new Date(shareExpiresAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN"),
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {shareInfoMessage ? (
                <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  {shareInfoMessage}
                </p>
              ) : null}
              {shareError ? (
                <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {shareError}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreateShare(shareTarget, "email")}
                  disabled={workingKey === `share:${shareTarget.id}`}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {workingKey === `share:${shareTarget.id}` ? t("formsPool.shareCreating") : t("formsPool.shareSendInvite")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateShare(shareTarget, "link")}
                  disabled={workingKey === `share:${shareTarget.id}`}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {workingKey === `share:${shareTarget.id}` ? t("formsPool.shareCreating") : t("formsPool.shareCreateLink")}
                </button>
                {shareLink ? (
                  <button
                    type="button"
                    onClick={() => void handleCopyShareLink()}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t("formsPool.shareCopyLink")}
                  </button>
                ) : null}
                {shareLink && shareRecipientEmail.trim() ? (
                  <button
                    type="button"
                    onClick={openShareMailApp}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t("formsPool.shareOpenMailApp")}
                  </button>
                ) : null}
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={closeShareDialog}
                  disabled={workingKey === `share:${shareTarget.id}`}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("formsPool.cancel")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
