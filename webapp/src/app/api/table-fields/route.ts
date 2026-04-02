import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { normalizeTableFields } from "@/lib/table-fields";
import { loadTableFields, saveTableFields } from "@/lib/table-fields-store";

export async function GET() {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const tableFields = await loadTableFields();
    return NextResponse.json({ tableFields });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load table fields." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const payload = (await request.json()) as { tableFields?: unknown };
    const tableFields = normalizeTableFields(payload.tableFields);
    const saved = await saveTableFields(tableFields);
    return NextResponse.json({ ok: true, tableFields: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save table fields." },
      { status: 500 },
    );
  }
}
