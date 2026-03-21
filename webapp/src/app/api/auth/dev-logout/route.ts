import { NextResponse } from "next/server";

import { DEV_MOCK_COOKIE_NAME, isDevMockLoginEnabled } from "@/lib/dev-mock-auth";

export async function POST() {
  if (!isDevMockLoginEnabled()) {
    return NextResponse.json({ error: "未启用开发假登录。" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEV_MOCK_COOKIE_NAME, "", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
