import { NextRequest, NextResponse } from "next/server";

import { verifyAdminAccountPassword } from "@/lib/admin-account-store";
import {
  clearLegacyAdminSupabaseCookies,
  setLocalAdminSessionCookie,
} from "@/lib/admin-local-auth";

function safeNextPath(raw: FormDataEntryValue | null): string {
  const value = String(raw ?? "").trim();
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = safeNextPath(formData.get("next"));
  const origin = request.nextUrl.origin;

  if (!identifier || !password) {
    return NextResponse.redirect(
      `${origin}/login?error=missing_credentials&next=${encodeURIComponent(nextPath)}`,
      303,
    );
  }

  const account = await verifyAdminAccountPassword(identifier, password);
  if (!account) {
    return NextResponse.redirect(
      `${origin}/login?error=invalid_credentials&next=${encodeURIComponent(nextPath)}`,
      303,
    );
  }

  const response = NextResponse.redirect(`${origin}${nextPath}`, 303);
  await setLocalAdminSessionCookie(response, {
    accountId: account.id,
    sessionVersion: account.sessionVersion,
  });
  clearLegacyAdminSupabaseCookies(request, response);
  return response;
}
