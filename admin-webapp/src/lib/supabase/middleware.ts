import { NextResponse, type NextRequest } from "next/server";

import { hasValidLocalAdminCookieFromRequest } from "@/lib/admin-local-auth";

export async function updateSession(request: NextRequest) {
  const hostHeader = request.headers.get("host") ?? "";
  const normalizedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const isLocalLoopbackHost =
    hostHeader.startsWith("127.0.0.1:") ||
    hostHeader === "127.0.0.1" ||
    hostHeader.startsWith("[::1]:") ||
    hostHeader === "[::1]" ||
    hostHeader.startsWith("::1:");

  if (isLocalLoopbackHost) {
    return new Response(null, {
      status: 307,
      headers: {
        Location: `http://localhost:3101${normalizedPath}`,
      },
    });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-orsight-admin-next", normalizedPath);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const isPublicPath =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/api/health");

  const hasLocalAdminSession = await hasValidLocalAdminCookieFromRequest(request);

  if (!hasLocalAdminSession && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", normalizedPath);
    return NextResponse.redirect(url);
  }

  if (hasLocalAdminSession && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
