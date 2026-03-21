import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { POD_USERNAME_METADATA_KEY } from "@/lib/auth-username";

/** HttpOnly cookie：仅假登录使用 */
export const DEV_MOCK_COOKIE_NAME = "pod_dev_mock_login";

/**
 * 本地测试登录页用：仅在 `NODE_ENV === "development"` 且
 * `NEXT_PUBLIC_DEV_MOCK_LOGIN=true` 时生效；生产构建不会启用。
 */
export function isDevMockLoginEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }
  const v = (process.env.NEXT_PUBLIC_DEV_MOCK_LOGIN || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export function encodeDevMockUsername(username: string): string {
  const bytes = new TextEncoder().encode(username);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeDevMockUsername(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const bin = atob(padded + "=".repeat(padLen));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    const username = new TextDecoder().decode(bytes).trim();
    if (!username || username.length > 128) {
      return null;
    }
    return username;
  } catch {
    return null;
  }
}

export function getDevMockUsernameFromRequest(request: NextRequest): string | null {
  const raw = request.cookies.get(DEV_MOCK_COOKIE_NAME)?.value;
  if (!raw) {
    return null;
  }
  return decodeDevMockUsername(raw);
}

export function createDevMockUser(username: string): User {
  return {
    id: "dev-mock-session",
    aud: "authenticated",
    role: "authenticated",
    email: "dev-mock@local.invalid",
    email_confirmed_at: new Date().toISOString(),
    phone: "",
    confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: { [POD_USERNAME_METADATA_KEY]: username },
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    factors: [],
  } as User;
}
