"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getDisplayUsernameFromUser } from "@/lib/auth-username";
import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { createClient } from "@/lib/supabase/browser";
import { isSupabaseAuthEnabled } from "@/lib/supabase";

export function UserNav() {
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
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] items-center justify-end gap-3 px-4 py-2 text-sm">
        {devMock && !supabaseOn ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">假登录</span>
        ) : null}
        <Link href="/account" className={`font-medium ${pathname === "/account" ? "text-blue-600" : "text-slate-600 hover:text-slate-900"}`}>
          用户信息
        </Link>
        {displayName ? (
          <span className="max-w-[200px] truncate text-slate-500" title={displayName}>
            {displayName}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
        >
          退出登录
        </button>
      </div>
    </header>
  );
}
