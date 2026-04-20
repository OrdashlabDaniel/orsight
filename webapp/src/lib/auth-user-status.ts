import type { User } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase";

type UserWithStatus = User & {
  banned_until?: string | null;
  deleted_at?: string | null;
};

export type AuthUserDisabledState = {
  disabled: boolean;
  reason: "recycled" | null;
};

function hasFutureTimestamp(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return true;
  }
  return ms > Date.now();
}

function isAuthUserDisabled(user: UserWithStatus | null | undefined): boolean {
  if (!user) {
    return false;
  }
  return Boolean(user.deleted_at) || hasFutureTimestamp(user.banned_until);
}

export async function getAuthUserDisabledState(user: User | null): Promise<AuthUserDisabledState> {
  if (!user) {
    return { disabled: false, reason: null };
  }

  const directUser = user as UserWithStatus;
  if (isAuthUserDisabled(directUser)) {
    return { disabled: true, reason: "recycled" };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return { disabled: false, reason: null };
  }

  try {
    const { data, error } = await admin.auth.admin.getUserById(user.id);
    if (error) {
      return { disabled: false, reason: null };
    }
    if (isAuthUserDisabled((data.user as UserWithStatus | null) ?? null)) {
      return { disabled: true, reason: "recycled" };
    }
  } catch {
    return { disabled: false, reason: null };
  }

  return { disabled: false, reason: null };
}
