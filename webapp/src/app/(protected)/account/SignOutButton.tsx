"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/browser";

type Props = {
  /** 开发假登录（无 Supabase） */
  devMock?: boolean;
};

export function SignOutButton({ devMock }: Props) {
  const router = useRouter();

  async function handleSignOut() {
    if (devMock) {
      await fetch("/api/auth/dev-logout", { method: "POST" });
    } else {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
    >
      退出登录
    </button>
  );
}
