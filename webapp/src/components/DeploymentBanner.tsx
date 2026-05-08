"use client";

import { useLocale } from "@/i18n/LocaleProvider";
import { isStagingChannel } from "@/lib/app-environment";

/**
 * Shown when this build is configured as staging (NEXT_PUBLIC_APP_CHANNEL=staging).
 * Does not switch data by itself — operators must point staging deploys at a separate Supabase project.
 */
export function DeploymentBanner() {
  const { t } = useLocale();

  if (!isStagingChannel()) {
    return null;
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] border-b border-amber-700/40 bg-amber-100 px-3 py-2 text-center text-xs font-medium text-amber-950 shadow-sm"
    >
      <span className="block sm:inline">{t("deployment.bannerTitle")}</span>
      <span className="mx-2 hidden text-amber-800/70 sm:inline">·</span>
      <span className="block text-[11px] font-normal text-amber-900/90 sm:inline">{t("deployment.bannerHint")}</span>
    </div>
  );
}
