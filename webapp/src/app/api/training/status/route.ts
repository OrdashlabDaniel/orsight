import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getFormIdFromRequest } from "@/lib/form-request";
import { getTrainingPoolStatus } from "@/lib/training";

export async function GET(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const formId = getFormIdFromRequest(request);
    const status = await getTrainingPoolStatus(formId);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load training status.",
      },
      { status: 500 },
    );
  }
}
