import { NextResponse } from "next/server";

import { acceptFormShareInvite } from "@/lib/form-shares";
import { withAuthedStorageTenant } from "@/lib/storage-tenant";

type AcceptPayload = {
  token?: unknown;
};

export async function POST(request: Request) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }
      if (!user) {
        return NextResponse.json({ error: "当前环境不支持接受分享。" }, { status: 400 });
      }

      const payload = (await request.json().catch(() => ({}))) as AcceptPayload;
      const token = typeof payload.token === "string" ? payload.token.trim() : "";
      if (!token) {
        return NextResponse.json({ error: "缺少分享令牌。" }, { status: 400 });
      }

      const result = await acceptFormShareInvite(token, user);
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "接受分享失败。" },
        { status: 400 },
      );
    }
  });
}
