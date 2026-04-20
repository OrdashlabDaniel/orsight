import { NextResponse } from "next/server";

import { POST_LOGIN_DEFAULT_PATH } from "@/lib/post-login-home";
import { getPublicSupabaseAnonKey, getPublicSupabaseUrl, isSupabaseAuthEnabled } from "@/lib/supabase";

export async function GET(request: Request) {
  if (!isSupabaseAuthEnabled()) {
    return NextResponse.json({ ok: false, reason: "supabase_not_configured" }, { status: 200 });
  }

  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get("next") ?? POST_LOGIN_DEFAULT_PATH;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const authorizeUrl = new URL("/auth/v1/authorize", getPublicSupabaseUrl());
  authorizeUrl.searchParams.set("provider", "google");
  authorizeUrl.searchParams.set("redirect_to", redirectTo);

  const response = await fetch(authorizeUrl, {
    method: "GET",
    redirect: "manual",
    headers: {
      apikey: getPublicSupabaseAnonKey(),
      Authorization: `Bearer ${getPublicSupabaseAnonKey()}`,
      Accept: "application/json",
    },
  });

  if (response.status >= 300 && response.status < 400) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const payload = (await response.json().catch(() => null)) as
    | { msg?: string; message?: string; error_description?: string }
    | null;
  const message = payload?.msg || payload?.message || payload?.error_description || "Unknown Google auth error.";
  const lower = message.toLowerCase();
  const reason = lower.includes("provider is not enabled") || lower.includes("unsupported provider")
    ? "provider_disabled"
    : "unknown";

  return NextResponse.json({ ok: false, reason, message }, { status: 200 });
}
