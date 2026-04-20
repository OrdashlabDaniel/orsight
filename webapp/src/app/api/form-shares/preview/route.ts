import { NextResponse } from "next/server";

import { getAuthContextOrSkip } from "@/lib/auth-server";
import { getFormSharePreview } from "@/lib/form-shares";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token")?.trim() || "";
    if (!token) {
      return NextResponse.json({ error: "缺少分享令牌。" }, { status: 400 });
    }

    const [preview, viewer] = await Promise.all([
      getFormSharePreview(token),
      getAuthContextOrSkip().then(({ user }) =>
        user
          ? {
              id: user.id,
              email: user.email?.trim().toLowerCase() || null,
            }
          : null,
      ),
    ]);

    return NextResponse.json({ ok: true, preview, viewer });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取分享信息失败。" },
      { status: 500 },
    );
  }
}
