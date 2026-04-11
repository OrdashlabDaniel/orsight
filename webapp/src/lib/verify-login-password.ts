import type { User } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { getPublicSupabaseAnonKey, getPublicSupabaseUrl } from "@/lib/supabase";

export type VerifyLoginPasswordResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

/**
 * 用于敏感操作（如永久删除）：用当前会话用户再验一次密码。
 * - Supabase：匿名客户端 signInWithPassword，不写浏览器 Cookie。
 * - 开发假登录：与 /api/auth/dev-login 一致，密码至少 6 位（无真实校验）。
 */
export async function verifyLoginPasswordForUser(user: User, rawPassword: unknown): Promise<VerifyLoginPasswordResult> {
  const password = typeof rawPassword === "string" ? rawPassword.trim() : "";

  if (user.id === "dev-mock-session" && isDevMockLoginEnabled()) {
    if (password.length < 6) {
      return { ok: false, status: 401, message: "密码至少 6 位（与假登录一致）。" };
    }
    return { ok: true };
  }

  const email = user.email?.trim();
  if (!email) {
    return { ok: false, status: 400, message: "当前账号无法通过密码验证（缺少邮箱）。" };
  }

  const url = getPublicSupabaseUrl();
  const key = getPublicSupabaseAnonKey();
  if (!url || !key) {
    return { ok: false, status: 500, message: "登录服务未配置。" };
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { ok: false, status: 401, message: "密码不正确。" };
  }

  return { ok: true };
}
