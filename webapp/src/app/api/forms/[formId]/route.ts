import { NextResponse } from "next/server";

import { verifyLoginPasswordForUser } from "@/lib/verify-login-password";
import {
  duplicateForm,
  getFormById,
  markFormReady,
  permanentlyDeleteForm,
  restoreForm,
  softDeleteForm,
  updateForm,
} from "@/lib/forms-store";
import { normalizeFormId } from "@/lib/forms";
import { withAuthedStorageTenant } from "@/lib/storage-tenant";

type RouteContext = {
  params: Promise<{ formId: string }>;
};

type UpdateFormPayload = {
  action?: unknown;
  name?: unknown;
  description?: unknown;
  templateSource?: unknown;
  password?: unknown;
};

function normalizeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function GET(_request: Request, context: RouteContext) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const { formId } = await context.params;
      const form = await getFormById(formId);
      if (!form) {
        return NextResponse.json({ error: "填表不存在。" }, { status: 404 });
      }
      return NextResponse.json({ form });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "读取填表失败。",
        },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request, context: RouteContext) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const { formId } = await context.params;
      const normalizedFormId = normalizeFormId(formId);
      const payload = (await request.json().catch(() => ({}))) as UpdateFormPayload;
      const action = typeof payload.action === "string" ? payload.action : "update";

      if (action === "duplicate") {
        const form = await duplicateForm(normalizedFormId);
        return NextResponse.json({ ok: true, form });
      }

      if (action === "delete") {
        const form = await softDeleteForm(normalizedFormId);
        return NextResponse.json({ ok: true, form });
      }

      if (action === "restore") {
        const form = await restoreForm(normalizedFormId);
        return NextResponse.json({ ok: true, form });
      }

      if (action === "permanent-delete") {
        if (!skipAuth && user) {
          const pw = typeof payload.password === "string" ? payload.password.trim() : "";
          if (!pw) {
            return NextResponse.json({ error: "请输入登录密码以确认永久删除。" }, { status: 400 });
          }
          const verified = await verifyLoginPasswordForUser(user, pw);
          if (!verified.ok) {
            return NextResponse.json({ error: verified.message }, { status: verified.status });
          }
        }
        await permanentlyDeleteForm(normalizedFormId);
        return NextResponse.json({ ok: true });
      }

      if (action === "ready") {
        const form = await markFormReady(normalizedFormId);
        return NextResponse.json({ ok: true, form });
      }

      const name = normalizeText(payload.name, 48);
      const description = normalizeText(payload.description, 160);
      const templateSource =
        payload.templateSource === "blank" ||
        payload.templateSource === "manual" ||
        payload.templateSource === "excel" ||
        payload.templateSource === "image" ||
        payload.templateSource === "copied"
          ? payload.templateSource
          : undefined;

      const form = await updateForm(normalizedFormId, {
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(templateSource ? { templateSource } : {}),
      });

      return NextResponse.json({ ok: true, form });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "更新填表失败。",
        },
        { status: 500 },
      );
    }
  });
}
