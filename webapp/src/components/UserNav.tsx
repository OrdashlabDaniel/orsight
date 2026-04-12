"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useLocale } from "@/i18n/LocaleProvider";
import { getDisplayUsernameFromUser } from "@/lib/auth-username";
import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { createClient } from "@/lib/supabase/browser";
import { isSupabaseAuthEnabled } from "@/lib/supabase";

export function UserNav() {
  const { locale, setLocale, t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState<string | null>(null);

  const supabaseOn = isSupabaseAuthEnabled();
  const devMock = isDevMockLoginEnabled();

  useEffect(() => {
    if (supabaseOn) {
      const supabase = createClient();
      void supabase.auth.getUser().then(({ data: { user } }) => {
        setDisplayName(user ? getDisplayUsernameFromUser(user) : null);
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        setDisplayName(user ? getDisplayUsernameFromUser(user) : null);
      });

      return () => {
        subscription.unsubscribe();
      };
    }

    if (devMock && !supabaseOn) {
      void fetch("/api/auth/dev-session")
        .then((r) => r.json() as Promise<{ mock?: boolean; username?: string | null }>)
        .then((d) => {
          if (d.mock && d.username) {
            setDisplayName(d.username);
          }
        })
        .catch(() => {});
      return;
    }

    return;
  }, [supabaseOn, devMock]);

  if (!supabaseOn && !devMock) {
    return null;
  }

  async function handleSignOut() {
    if (supabaseOn) {
      const supabase = createClient();
      await supabase.auth.signOut();
    } else {
      await fetch("/api/auth/dev-logout", { method: "POST" });
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-3 py-2 text-sm">
        <Link
          href="/"
          className="shrink-0 text-base font-semibold tracking-tight text-[var(--foreground)] hover:opacity-80"
        >
          Orsight
        </Link>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5 text-xs">
            <span className="sr-only">{t("nav.language")}</span>
            <button
              type="button"
              onClick={() => setLocale("zh")}
              className={`rounded-md px-2 py-1 ${locale === "zh" ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            >
              {t("nav.zh")}
            </button>
            <button
              type="button"
              onClick={() => setLocale("en")}
              className={`rounded-md px-2 py-1 ${locale === "en" ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
            >
              {t("nav.en")}
            </button>
          </div>
          {devMock && !supabaseOn ? (
            <span className="text-xs text-amber-700">{t("nav.mockLogin")}</span>
          ) : null}
          <Link
            href="/account"
            className={`text-[var(--muted-foreground)] hover:text-[var(--foreground)] ${pathname === "/account" ? "text-[var(--foreground)]" : ""}`}
          >
            {t("nav.account")}
          </Link>
          {displayName ? (
            <span className="max-w-[160px] truncate text-xs text-[var(--muted-foreground)]" title={displayName}>
              {displayName}
            </span>
          ) : null}
          <button type="button" onClick={() => void handleSignOut()} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            {t("nav.signOut")}
          </button>
        </div>
      </div>
    </header>
  );
}
