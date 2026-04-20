"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { useLocale } from "@/i18n/LocaleProvider";
import { buildFormFillHref } from "@/lib/forms";
import type { FormSharePreview } from "@/lib/form-shares";

type SharePreviewResponse = {
  ok?: boolean;
  preview?: FormSharePreview | null;
  viewer?: { id: string; email: string | null } | null;
  error?: string;
};

type ShareAcceptResponse = {
  ok?: boolean;
  form?: { id: string; name: string } | null;
  alreadyAccepted?: boolean;
  error?: string;
};

function SharePageContent() {
  const { locale, t } = useLocale();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") || "").trim();
  const [isLoading, setIsLoading] = useState(true);
  const [preview, setPreview] = useState<FormSharePreview | null>(null);
  const [viewer, setViewer] = useState<{ id: string; email: string | null } | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptedForm, setAcceptedForm] = useState<{ id: string; name: string } | null>(null);

  const loginHref = useMemo(() => {
    if (!token) {
      return "/login";
    }
    return `/login?next=${encodeURIComponent(`/share?token=${token}`)}`;
  }, [token]);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      setErrorMessage(t("formShare.missingToken"));
      return;
    }

    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const response = await fetch(`/api/form-shares/preview?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as SharePreviewResponse | null;
        if (!response.ok) {
          throw new Error(payload?.error || t("formShare.errLoad"));
        }
        if (cancelled) {
          return;
        }
        setPreview(payload?.preview || null);
        setViewer(payload?.viewer || null);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : t("formShare.errLoad"));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t, token]);

  const status = preview?.status || "active";
  const viewerEmail = viewer?.email?.toLowerCase() || "";
  const restrictedToOtherEmail = Boolean(preview?.targetEmail && viewerEmail && viewerEmail !== preview.targetEmail);
  const acceptedByViewer = Boolean(preview?.acceptedAt && preview?.targetOwnerId && viewer?.id === preview.targetOwnerId);

  async function handleAcceptShare() {
    if (!token) {
      setErrorMessage(t("formShare.missingToken"));
      return;
    }
    setAccepting(true);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      const response = await fetch("/api/form-shares/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json().catch(() => null)) as ShareAcceptResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || t("formShare.errAccept"));
      }
      if (payload?.form) {
        setAcceptedForm({ id: payload.form.id, name: payload.form.name });
      }
      setPreview((current) =>
        current
          ? {
              ...current,
              status: "accepted",
              acceptedAt: Date.now(),
              targetOwnerId: viewer?.id || current.targetOwnerId,
              targetFormId: payload?.form?.id || current.targetFormId,
            }
          : current,
      );
      setNoticeMessage(
        payload?.alreadyAccepted ? t("formShare.acceptedAlready") : t("formShare.acceptedNow", { name: payload?.form?.name || "" }),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("formShare.errAccept"));
    } finally {
      setAccepting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{t("formShare.title")}</h1>
        <p className="mt-2 text-sm text-slate-500">{t("formShare.intro")}</p>

        {noticeMessage ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {noticeMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {errorMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            {t("formShare.loading")}
          </div>
        ) : !preview ? (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            {t("formShare.invalid")}
          </div>
        ) : (
          <>
            <div className="mt-8 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("formShare.formLabel")}</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{preview.formName}</div>
                {preview.formDescription ? <div className="mt-1 text-sm text-slate-600">{preview.formDescription}</div> : null}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("formShare.fromLabel")}</div>
                <div className="mt-1">{preview.inviterEmail || t("formShare.unknownSender")}</div>
              </div>
              {preview.targetEmail ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("formShare.targetLabel")}</div>
                  <div className="mt-1">{preview.targetEmail}</div>
                </div>
              ) : null}
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("formShare.expiresLabel")}</div>
                <div className="mt-1">
                  {new Date(preview.expiresAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN")}
                </div>
              </div>
            </div>

            {status === "revoked" ? (
              <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t("formShare.revoked")}
              </p>
            ) : null}
            {status === "expired" ? (
              <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t("formShare.expired")}
              </p>
            ) : null}
            {status === "accepted" && !acceptedByViewer && !acceptedForm ? (
              <p className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {t("formShare.alreadyUsed")}
              </p>
            ) : null}
            {restrictedToOtherEmail ? (
              <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t("formShare.restrictedEmail", { email: preview.targetEmail || "" })}
              </p>
            ) : null}

            {acceptedForm || (acceptedByViewer && preview.targetFormId) ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={buildFormFillHref(acceptedForm?.id || preview.targetFormId || "")}
                  className="inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  {t("formShare.openForm")}
                </Link>
                <Link
                  href="/forms"
                  className="inline-flex rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {t("formShare.backHome")}
                </Link>
              </div>
            ) : status === "active" ? (
              <div className="mt-6 space-y-3">
                {!viewer ? (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {t("formShare.signInNeeded")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  {!viewer ? (
                    <Link
                      href={loginHref}
                      className="inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      {t("formShare.signIn")}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleAcceptShare()}
                      disabled={accepting || restrictedToOtherEmail}
                      className="inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {accepting ? t("formShare.accepting") : t("formShare.accept")}
                    </button>
                  )}
                  <Link
                    href="/forms"
                    className="inline-flex rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {t("formShare.backHome")}
                  </Link>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
          <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              Loading…
            </div>
          </div>
        </main>
      }
    >
      <SharePageContent />
    </Suspense>
  );
}
