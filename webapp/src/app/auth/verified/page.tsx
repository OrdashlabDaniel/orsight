"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { useLocale } from "@/i18n/LocaleProvider";
import {
  buildLoginAfterVerificationHref,
  createEmailVerifiedEvent,
  EMAIL_VERIFIED_STORAGE_KEY,
} from "@/lib/auth-email-verified";

function EmailVerifiedPageContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  const loginHref = useMemo(() => buildLoginAfterVerificationHref(nextPath), [nextPath]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EMAIL_VERIFIED_STORAGE_KEY, createEmailVerifiedEvent(email));
  }, [email]);

  function clearVerifiedFlag() {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.removeItem(EMAIL_VERIFIED_STORAGE_KEY);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold text-slate-900">{t("authVerified.title")}</h1>
        <p className="mt-4 text-center text-sm leading-6 text-slate-600">
          {email ? t("authVerified.bodyWithEmail", { email }) : t("authVerified.body")}
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
