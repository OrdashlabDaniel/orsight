import { createClient as createAnonSupabaseJsClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { getPublicSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type VizAdminActor = { id: string; email: string };

export async function requireVizAdminActor(loginNext = "/viz"): Promise<VizAdminActor> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email) {
    redirect(`/login?next=${encodeURIComponent(loginNext)}`);
  }

  const sb = createServiceRoleClient();
  const { data, error: adminErr } = await sb.from("admin_users").select("id").eq("id", user.id).maybeSingle();
  if (adminErr || !data) {
    redirect(`/viz?err=${encodeURIComponent("当前登录账号不是后台管理员，无法执行此操作")}`);
  }

  return { id: user.id, email: user.email };
}

/**
 * Verifies the actor's Supabase login password without touching the browser session cookies.
 */
export async function assertAdminLoginPassword(actorEmail: string, password: string): Promise<void> {
  const trimmed = password.trim();
  if (!trimmed) {
    throw new Error("请输入当前管理员登录密码");
  }

  const { url, anonKey } = getPublicSupabaseConfig();
  const ac = createAnonSupabaseJsClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await ac.auth.signInWithPassword({ email: actorEmail, password: trimmed });
  // await ac.auth.signOut(); // Do not sign out, it might invalidate the user's actual session if GoTrue behaves unexpectedly
  if (error) {
    throw new Error("管理员密码不正确");
  }
}
