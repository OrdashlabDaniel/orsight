import { NextResponse } from "next/server";

import {
  DEV_MOCK_COOKIE_NAME,
  encodeDevMockUsername,
  isDevMockLoginEnabled,
} from "@/lib/dev-mock-auth";

export async function POST(request: Request) {
  if (!isDevMockLoginEnabled()) {
    return NextResponse.json({ error: "未启用开发假登录。" }, { status: 404 });
  }

  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "无效的请求体。" }, { status: 400 });
  }

  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username) {
    return NextResponse.json({ error: "请输入用户名。" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位（假登录任意密码即可）。" }, { status: 400 });
  }

  const value = encodeDevMockUsername(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEV_MOCK_COOKIE_NAME, value, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
