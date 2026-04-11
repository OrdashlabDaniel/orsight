"use client";

import { useLocale } from "@/i18n/LocaleProvider";

export function LoginLoadingFallback() {
  const { t } = useLocale();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">{t("login.loading")}</div>
  );
}
