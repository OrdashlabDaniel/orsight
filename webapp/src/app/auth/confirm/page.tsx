"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { useLocale } from "@/i18n/LocaleProvider";

function EmailConfirmContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const tokenHash = (searchParams.get("token_hash") || "").trim();
  const type = (searchParams.get("type") || "signup").trim();
  const redirectTo = (searchParams.get("redirect_to") || "").trim();
  const requestKey = useMemo(() => `${tokenHash}:${type}:${redirectTo}`, [redirectTo, tokenHash, type]);
  const hasRequiredParams = Boolean(tokenHash && redirectTo);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!hasRequiredParams) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/auth/confirm-email-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenHash, type, redirectTo }),
          cache: "no-store",
        });
        const payload = (await res.json().catch(() => null)) as {
          ok?: boolean;
          redirectTo?: string;
          error?: string;
        } | null;

        if (cancelled) {
          return;
        }

        if (payload?.ok && payload.redirectTo) {
          window.location.replace(payload.redirectTo);
          return;
        }

        setMessage(payload?.error || t("authConfirm.failed"));
      } catch {
        if (!cancelled) {
          setMessage(t("authConfirm.failed"));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasRequiredParams, redirectTo, requestKey, t, tokenHash, type]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">OrSight</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          {hasRequiredParams ? message || t("authConfirm.checking") : t("authConfirm.invalid")}
        </p>
      </div>
    </main>
  );
}

export default function EmailConfirmPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-slate-500">Loading...</p>
          </div>
        </main>
      }
    >
      <EmailConfirmContent />
    </Suspense>
  );
}
