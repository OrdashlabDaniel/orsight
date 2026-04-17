import { NextResponse } from "next/server";

import { getFormIdFromRequest } from "@/lib/form-request";
import { DEFAULT_FORM_ID, STARTER_FORM_2_ID, normalizeFormId } from "@/lib/forms";
import { normalizeTableFields } from "@/lib/table-fields";
import { loadTableFields, saveTableFields } from "@/lib/table-fields-store";
import { withAuthedStorageTenant } from "@/lib/storage-tenant";

export async function GET(request: Request) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const formId = getFormIdFromRequest(request);
      const tableFields = await loadTableFields(formId);
      return NextResponse.json({ tableFields });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to load table fields." },
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

      const formId = getFormIdFromRequest(request);
      const payload = (await request.json()) as { tableFields?: unknown };
      const normalizedFormId = normalizeFormId(formId);
      const tableFields = normalizeTableFields(payload.tableFields, {
        preserveEmpty: normalizedFormId !== DEFAULT_FORM_ID && normalizedFormId !== STARTER_FORM_2_ID,
        appendMissingBuiltIns: normalizedFormId === DEFAULT_FORM_ID || normalizedFormId === STARTER_FORM_2_ID,
      });
      const saved = await saveTableFields(tableFields, formId);
      return NextResponse.json({ ok: true, tableFields: saved });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to save table fields." },
        { status: 500 },
      );
    }
  });
}
