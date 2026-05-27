import { NextResponse } from "next/server";

import {
  findAuthUserByEmail,
  findAuthUserById,
  getAuthUserEmail,
  rememberPendingEmailVerificationFlow,
} from "@/lib/auth-email-verification-server";

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.includes("@") ? email : "";
}

function normalizeFlowId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUserId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStartedAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    flowId?: unknown;
    userId?: unknown;
    startedAt?: unknown;
  } | null;

  const email = normalizeEmail(body?.email);
  const flowId = normalizeFlowId(body?.flowId);
  const userId = normalizeUserId(body?.userId);
  const startedAt = normalizeStartedAt(body?.startedAt);

  if (!email || !flowId) {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }

  const user = userId ? await findAuthUserById(userId) : await findAuthUserByEmail(email);
  if (!user || getAuthUserEmail(user) !== email) {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }

  await rememberPendingEmailVerificationFlow(user, flowId, startedAt);
  return NextResponse.json({ ok: true, confirmed: false });
}
