import { NextResponse } from "next/server";

import {
  findAuthUserByEmail,
  hasEmailVerificationFlow,
  hasConfirmedEmailVerificationFlow,
  isAuthUserEmailConfirmed,
  markEmailVerificationFlow,
} from "@/lib/auth-email-verification-server";

function normalizeEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.includes("@") ? email : "";
}

function normalizeFlowId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    flowId?: unknown;
    recoverExpiredLink?: unknown;
  } | null;
  const email = normalizeEmail(body?.email);
  const flowId = normalizeFlowId(body?.flowId);
  const recoverExpiredLink = body?.recoverExpiredLink === true;
  if (!email || !flowId) {
    return NextResponse.json(
      { confirmed: false, authConfirmed: false, error: "missing_params" },
      { status: 400 },
    );
  }

  const user = await findAuthUserByEmail(email);
  let confirmed = hasConfirmedEmailVerificationFlow(user, flowId);
  const authConfirmed = Boolean(user && isAuthUserEmailConfirmed(user));
  let recovered = false;

  if (!confirmed && recoverExpiredLink && authConfirmed && hasEmailVerificationFlow(user, flowId)) {
    await markEmailVerificationFlow(user, flowId, "confirm_page");
    confirmed = true;
    recovered = true;
  }

  return NextResponse.json({ confirmed, authConfirmed, recovered });
}
