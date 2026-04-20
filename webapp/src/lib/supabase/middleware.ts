import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { needsEmailConfirmation } from "@/lib/auth-email-confirmation";
import { getAuthUserDisabledState } from "@/lib/auth-user-status";
import { webappSupabaseCookieOptions } from "@/lib/supabase/cookies";
import {
  getDevMockUsernameFromRequest,
  isDevMockLoginEnabled,
} from "@/lib/dev-mock-auth";
import { POST_LOGIN_DEFAULT_PATH } from "@/lib/post-login-home";
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
  const isAuthVerified = pathname === "/auth/verified";
  const isPublicLegal = pathname === "/privacy" || pathname === "/terms";
  const isShareLanding = pathname === "/share";
  const isPublicRoute = isPublicLegal || isShareLanding || isAuthVerified;

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
      const next = request.nextUrl.searchParams.get("next") || POST_LOGIN_DEFAULT_PATH;
      url.pathname = next.startsWith("/") ? next : POST_LOGIN_DEFAULT_PATH;
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (!mockUser && !isLogin && !isAuthCallback && !isPublicRoute) {
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
    if (!isLogin && !isAuthCallback && !isPublicRoute) {
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
    cookieOptions: webappSupabaseCookieOptions,
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

  let {
    data: { user },
  } = await supabase.auth.getUser();

  let forcedLogoutReason: "confirm_email" | "recycled" | null = null;
  if (user) {
    const disabledState = await getAuthUserDisabledState(user);
    if (disabledState.disabled) {
      await supabase.auth.signOut();
      user = null;
      forcedLogoutReason = disabledState.reason;
    }
  }

  if (!forcedLogoutReason && user && needsEmailConfirmation(user)) {
    await supabase.auth.signOut();
    user = null;
    forcedLogoutReason = "confirm_email";
  }

  if (!user && !isLogin && !isAuthCallback && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (forcedLogoutReason) {
      url.searchParams.set("reason", forcedLogoutReason);
    }
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next") || POST_LOGIN_DEFAULT_PATH;
    url.pathname = next.startsWith("/") ? next : POST_LOGIN_DEFAULT_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
