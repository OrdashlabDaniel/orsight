import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { adminSupabaseCookieOptions } from "@/lib/supabase/cookies";
import { getPublicSupabaseConfig } from "@/lib/supabase/env";

type PendingCookie = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const nextPath = (() => {
    const raw = url.searchParams.get("next") ?? "/viz";
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/viz";
  })();

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const { url: supabaseUrl, anonKey } = getPublicSupabaseConfig();
  const pendingCookies: PendingCookie[] = [];

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookieOptions: adminSupabaseCookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  const destination = error ? `${origin}/login?error=auth_callback_failed` : `${origin}${nextPath}`;
  const response = NextResponse.redirect(destination);

  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options ?? {});
  }

  return response;
}
