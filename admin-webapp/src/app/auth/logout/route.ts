import { NextRequest, NextResponse } from "next/server";

import { clearLegacyAdminSupabaseCookies, clearLocalAdminSessionCookie } from "@/lib/admin-local-auth";

function buildLogoutResponse(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.nextUrl.origin), 303);
  clearLocalAdminSessionCookie(response);
  clearLegacyAdminSupabaseCookies(request, response);
  return response;
}

export async function GET(request: NextRequest) {
  return buildLogoutResponse(request);
}

export async function POST(request: NextRequest) {
  return buildLogoutResponse(request);
}
