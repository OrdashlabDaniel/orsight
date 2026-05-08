import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === "/viz" || pathname.startsWith("/viz/")) {
    const url = request.nextUrl.clone();

    const userDetailMatch = pathname.match(/^\/viz\/users\/([^/]+)$/);
    if (userDetailMatch?.[1]) {
      url.pathname = `/users/${userDetailMatch[1]}`;
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/viz/recycle")) {
      url.pathname = "/users";
      return NextResponse.redirect(url);
    }

    url.pathname = "/usage-board";
    return NextResponse.redirect(url);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
