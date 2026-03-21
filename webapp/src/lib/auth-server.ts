import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  createDevMockUser,
  decodeDevMockUsername,
  DEV_MOCK_COOKIE_NAME,
  isDevMockLoginEnabled,
} from "@/lib/dev-mock-auth";
import { createClient } from "@/lib/supabase/server";
import { isLoginStrictlyRequired, isSupabaseAuthEnabled } from "@/lib/supabase";

async function getDevMockAuthUser(): Promise<User | null> {
  if (!isDevMockLoginEnabled()) {
    return null;
  }
  const jar = await cookies();
  const raw = jar.get(DEV_MOCK_COOKIE_NAME)?.value;
  const username = raw ? decodeDevMockUsername(raw) : null;
  if (!username) {
    return null;
  }
  return createDevMockUser(username);
}

/** 未启用 Supabase 登录时跳过校验（本地纯离线） */
export async function getAuthUserOrSkip(): Promise<{ user: User | null; skipAuth: boolean }> {
  /** 与中间件一致：默认要登录；仅当显式关闭 REQUIRE_LOGIN 且未启用 Supabase 时跳过 */
  if (!isLoginStrictlyRequired() && !isSupabaseAuthEnabled()) {
    return { user: null, skipAuth: true };
  }

  if (isSupabaseAuthEnabled()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { user, skipAuth: false };
  }

  if (isDevMockLoginEnabled()) {
    const user = await getDevMockAuthUser();
    return { user, skipAuth: false };
  }

  return { user: null, skipAuth: false };
}
