import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { needsEmailConfirmation } from "@/lib/auth-email-confirmation";
import { getAuthUserDisabledState } from "@/lib/auth-user-status";
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

export async function getAuthContextOrSkip(): Promise<{
  user: User | null;
  skipAuth: boolean;
  supabase: SupabaseClient | null;
}> {
  if (!isLoginStrictlyRequired() && !isSupabaseAuthEnabled()) {
    return { user: null, skipAuth: true, supabase: null };
  }

  if (isSupabaseAuthEnabled()) {
    const supabase = await createClient();
    let {
      data: { user },
    } = await supabase.auth.getUser();
    const disabledState = await getAuthUserDisabledState(user);
    if (disabledState.disabled || (user && needsEmailConfirmation(user))) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore cookie clearing failures in server components; downstream should still treat this as signed out.
      }
      user = null;
    }
    return { user, skipAuth: false, supabase };
  }

  if (isDevMockLoginEnabled()) {
    const user = await getDevMockAuthUser();
    return { user, skipAuth: false, supabase: null };
  }

  return { user: null, skipAuth: false, supabase: null };
}

/** 未启用 Supabase 登录时跳过校验（本地纯离线） */
export async function getAuthUserOrSkip(): Promise<{ user: User | null; skipAuth: boolean }> {
  const { user, skipAuth } = await getAuthContextOrSkip();
  return { user, skipAuth };
}
