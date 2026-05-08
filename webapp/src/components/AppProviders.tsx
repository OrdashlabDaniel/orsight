"use client";

import type { ReactNode } from "react";

import { DeploymentBanner } from "@/components/DeploymentBanner";
import { LocaleProvider } from "@/i18n/LocaleProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <DeploymentBanner />
      {children}
    </LocaleProvider>
  );
}
