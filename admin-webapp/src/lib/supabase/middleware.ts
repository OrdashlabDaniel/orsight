import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { adminSupabaseCookieOptions } from "@/lib/supabase/cookies";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookieOptions: adminSupabaseCookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/api/health") ||
    request.nextUrl.pathname.startsWith("/viz");

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.searchParams.set("next", nextPath);
    return NextResponse.redirect(url);
  }

  if (user) {
    const path = request.nextUrl.pathname;
    // 公开可视化页 + 管理员信息页：已登录用户可访问，不做 admin_users 拦截
    const skipAdminGate = path.startsWith("/viz") || path.startsWith("/account");

    if (!skipAdminGate) {
      const { data: adminUser } = await supabase
        .from("admin_users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (!adminUser && !path.startsWith("/login")) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("error", "not_admin");
        await supabase.auth.signOut();
        return NextResponse.redirect(url);
      }

      if (adminUser && path.startsWith("/login")) {
        const url = request.nextUrl.clone();
        url.pathname = "/viz";
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
