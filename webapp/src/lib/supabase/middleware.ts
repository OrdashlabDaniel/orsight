import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  getDevMockUsernameFromRequest,
  isDevMockLoginEnabled,
} from "@/lib/dev-mock-auth";
import {
  getPublicSupabaseAnonKey,
  getPublicSupabaseUrl,
  isLoginStrictlyRequired,
  isSupabaseAuthEnabled,
} from "@/lib/supabase";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isLogin = pathname === "/login";
  const isAuthCallback = pathname.startsWith("/auth/callback");
  const isPublicLegal = pathname === "/privacy" || pathname === "/terms";

  /**
   * 开发环境假登录：不配 Supabase 也可测登录页与会话。
   * 若同时关闭 `NEXT_PUBLIC_REQUIRE_LOGIN`，则不拦截路由（仍可主动访问 /login 测表单）。
   */
  if (
    isLoginStrictlyRequired() &&
    isDevMockLoginEnabled() &&
    !isSupabaseAuthEnabled()
  ) {
    const mockUser = getDevMockUsernameFromRequest(request);
    if (mockUser && isLogin) {
      const url = request.nextUrl.clone();
      const next = request.nextUrl.searchParams.get("next") || "/";
      url.pathname = next.startsWith("/") ? next : "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (!mockUser && !isLogin && !isAuthCallback && !isPublicLegal) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.delete("reason");
      const next = pathname + request.nextUrl.search;
      if (pathname !== "/" || request.nextUrl.search) {
        url.searchParams.set("next", next);
      }
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  /** 要求登录但未配置 Supabase → 只能进登录页看说明 */
  if (isLoginStrictlyRequired() && !isSupabaseAuthEnabled()) {
    if (!isLogin && !isAuthCallback && !isPublicLegal) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("reason", "config");
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  /** 未强制登录且未配 Supabase → 完全开放 */
  if (!isSupabaseAuthEnabled()) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = getPublicSupabaseUrl();
  const supabaseAnonKey = getPublicSupabaseAnonKey();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isLogin && !isAuthCallback && !isPublicLegal) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next") || "/";
    url.pathname = next.startsWith("/") ? next : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
