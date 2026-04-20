import { NextResponse } from "next/server";

import { createFormShareInvite } from "@/lib/form-shares";
import { normalizeFormId } from "@/lib/forms";
import { withAuthedStorageTenant } from "@/lib/storage-tenant";

type RouteContext = {
  params: Promise<{ formId: string }>;
};

type SharePayload = {
  recipientEmail?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }
      if (!user) {
        return NextResponse.json({ error: "当前环境不支持分享。" }, { status: 400 });
      }

      const { formId } = await context.params;
      const payload = (await request.json().catch(() => ({}))) as SharePayload;
      const recipientEmail =
        typeof payload.recipientEmail === "string" ? payload.recipientEmail.trim().toLowerCase() : "";
      const result = await createFormShareInvite({
        sourceFormId: normalizeFormId(formId),
        sourceOwnerId: user.id,
        sourceOwnerEmail: user.email,
        recipientEmail,
        origin: new URL(request.url).origin,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "创建分享失败。" },
        { status: 500 },
      );
    }
  });
}
