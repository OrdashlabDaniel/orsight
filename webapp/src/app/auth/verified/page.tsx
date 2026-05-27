"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { useLocale } from "@/i18n/LocaleProvider";
import {
  buildLoginAfterVerificationHref,
  createEmailVerifiedEventForFlow,
  EMAIL_VERIFIED_STORAGE_KEY,
} from "@/lib/auth-email-verified";

function EmailVerifiedPageContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  const flowId = (searchParams.get("flowId") || "").trim();
  const loginHref = useMemo(() => buildLoginAfterVerificationHref(nextPath), [nextPath]);
  const flowKey = `${email}:${flowId}`;
  const [flowStatusState, setFlowStatusState] = useState<{
    key: string;
    status: "checking" | "success" | "unverified";
  }>({ key: "", status: "checking" });
  const flowStatus = flowStatusState.key === flowKey ? flowStatusState.status : "checking";
  const status: "checking" | "success" | "unverified" = !email ? "success" : flowId ? flowStatus : "unverified";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!email) {
      window.localStorage.removeItem(EMAIL_VERIFIED_STORAGE_KEY);
      return;
    }
    if (!flowId) {
      window.localStorage.removeItem(EMAIL_VERIFIED_STORAGE_KEY);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/auth/email-confirmation-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, flowId }),
          cache: "no-store",
        });
        const payload = (await res.json().catch(() => null)) as { confirmed?: boolean } | null;
        if (cancelled) {
          return;
        }
        if (payload?.confirmed) {
          window.localStorage.setItem(EMAIL_VERIFIED_STORAGE_KEY, createEmailVerifiedEventForFlow(email, flowId));
          setFlowStatusState({ key: flowKey, status: "success" });
          return;
        }
      } catch {
        // Treat network/API failures as not verified so this page never shows a false success state.
      }

      if (!cancelled) {
        window.localStorage.removeItem(EMAIL_VERIFIED_STORAGE_KEY);
        setFlowStatusState({ key: flowKey, status: "unverified" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [email, flowId, flowKey]);

  function clearVerifiedFlag() {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(EMAIL_VERIFIED_STORAGE_KEY);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold text-slate-900">
          {status === "success" ? t("authVerified.title") : t("login.subtitleAwaitingConfirm")}
        </h1>
        <p className="mt-4 text-center text-sm leading-6 text-slate-600">
          {status === "checking"
            ? t("login.loading")
            : status === "unverified"
              ? t("login.confirmEmailBeforeAccess")
              : email
                ? t("authVerified.bodyWithEmail", { email })
                : t("authVerified.body")}
        </p>
        <div className="mt-8">
          <Link
            href={loginHref}
            onClick={clearVerifiedFlag}
            className="block w-full rounded-xl border border-slate-300 bg-white py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("authVerified.goLogin")}
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function EmailVerifiedPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-center text-sm text-slate-500">Loading…</p>
          </div>
        </main>
      }
    >
      <EmailVerifiedPageContent />
    </Suspense>
  );
}
