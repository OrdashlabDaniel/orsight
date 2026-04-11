"use client";

import Link from "next/link";

import { useLocale } from "@/i18n/LocaleProvider";

import { SignOutButton } from "./SignOutButton";

export function AccountDisabledGate() {
  const { t } = useLocale();
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{t("account.noAuthTitle")}</h1>
        <p className="mt-3 text-sm text-slate-600">{t("account.noAuthBody")}</p>
        <Link href="/forms" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
          {t("account.backForms")}
        </Link>
      </div>
    </main>
  );
}

export type AccountDetailsPayload = {
  displayUsername: string;
  email: string | null;
  id: string;
  createdAtIso: string | null;
  isGofoEmployee: boolean;
  gofoSite: string | null;
  isDevMockSession: boolean;
};

export function AccountDetailsView({ payload }: { payload: AccountDetailsPayload }) {
  const { locale, t } = useLocale();
  const locTag = locale === "en" ? "en-US" : "zh-CN";
  const createdAt =
    payload.createdAtIso != null
      ? new Date(payload.createdAtIso).toLocaleString(locTag)
      : "—";

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {payload.isDevMockSession ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t("account.mockSessionBanner")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t("account.title")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("account.subtitle")}</p>
          </div>
          <SignOutButton devMock={payload.isDevMockSession} />
        </div>

        <dl className="mt-8 space-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">{t("account.username")}</dt>
            <dd className="mt-1 text-slate-900">{payload.displayUsername}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">{t("account.internalEmail")}</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-600">{payload.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">{t("account.userId")}</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-800">{payload.id}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">{t("account.created")}</dt>
            <dd className="mt-1 text-slate-900">{createdAt}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">{t("account.gofoLabel")}</dt>
            <dd className="mt-1 text-slate-900">
              {payload.isGofoEmployee ? t("account.yes") : t("account.no")}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">{t("account.siteLabel")}</dt>
            <dd className="mt-1 text-slate-900">{payload.gofoSite || "—"}</dd>
          </div>
        </dl>

        <div className="mt-8 border-t border-slate-100 pt-6">
          <Link href="/forms" className="text-sm font-medium text-blue-600 hover:underline">
            {t("account.backForms")}
          </Link>
        </div>
      </div>
    </main>
  );
}
