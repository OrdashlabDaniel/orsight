import { NextResponse } from "next/server";

import { createForm, loadForms } from "@/lib/forms-store";
import { splitForms } from "@/lib/forms";
import { withAuthedStorageTenant } from "@/lib/storage-tenant";

type CreateFormPayload = {
  name?: unknown;
};

export async function GET() {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const forms = await loadForms();
      const { active, recycleBin } = splitForms(forms);
      return NextResponse.json({ forms, activeForms: active, recycleBin });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "首页加载失败。",
        },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const payload = (await request.json().catch(() => ({}))) as CreateFormPayload;
      const name = typeof payload.name === "string" ? payload.name.trim() : "";
      const form = await createForm(name || undefined);
      return NextResponse.json({ ok: true, form });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "创建填表失败。",
        },
        { status: 500 },
      );
    }
  });
}
