import type { EmailOtpType, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { buildEmailVerifiedHref } from "@/lib/auth-email-verified";
import {
  findAuthUserByEmail,
  hasConfirmedEmailVerificationFlow,
  markEmailVerificationFlow,
} from "@/lib/auth-email-verification-server";
import { POD_USERNAME_METADATA_KEY } from "@/lib/auth-username";
import { POST_LOGIN_DEFAULT_PATH } from "@/lib/post-login-home";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

function normalizeEmail(value: string | null | undefined) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.includes("@") ? email : "";
}

function normalizeType(value: unknown): EmailOtpType | null {
  const type = typeof value === "string" ? value.trim() : "";
  return EMAIL_OTP_TYPES.has(type) ? (type as EmailOtpType) : null;
}

function sameOriginUrl(value: unknown, origin: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return new URL(POST_LOGIN_DEFAULT_PATH, origin);
  }
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) {
      return new URL(POST_LOGIN_DEFAULT_PATH, origin);
    }
    return url;
  } catch {
    return new URL(POST_LOGIN_DEFAULT_PATH, origin);
  }
}

function parseVerificationTarget(redirectTo: URL) {
  const next = redirectTo.searchParams.get("next");
  const nextPath = next?.startsWith("/") ? next : POST_LOGIN_DEFAULT_PATH;
  return {
    nextPath,
    email: normalizeEmail(redirectTo.searchParams.get("email")),
    flowId: (redirectTo.searchParams.get("flowId") || "").trim(),
  };
}

function createServerVerificationFlowId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function ensurePodUsername(supabase: Awaited<ReturnType<typeof createClient>>, user: User | null) {
  if (!user) {
    return;
  }

  const meta = user.user_metadata ?? {};
  const existing = meta[POD_USERNAME_METADATA_KEY];
  if (typeof existing === "string" && existing.trim()) {
    return;
  }

  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  const emailLocal = user.email && user.email.includes("@") ? user.email.split("@")[0]!.trim() : "";
  const podUsername = fullName || name || emailLocal || "user";
  await supabase.auth.updateUser({
    data: { [POD_USERNAME_METADATA_KEY]: podUsername },
  });
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const body = (await request.json().catch(() => null)) as {
    tokenHash?: unknown;
    type?: unknown;
    redirectTo?: unknown;
  } | null;

  const tokenHash = typeof body?.tokenHash === "string" ? body.tokenHash.trim() : "";
  const type = normalizeType(body?.type);
  const redirectTo = sameOriginUrl(body?.redirectTo, origin);
  const target = parseVerificationTarget(redirectTo);
  const flowId = target.flowId || createServerVerificationFlowId();

  if (!tokenHash || !type) {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  }

  const supabase = await createClient();
  const authResult = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  let user = authResult.data.user ?? null;
  if (authResult.error) {
    const existingUser = target.email ? await findAuthUserByEmail(target.email) : null;
    if (hasConfirmedEmailVerificationFlow(existingUser, flowId)) {
      return NextResponse.json({
        ok: true,
        redirectTo: buildEmailVerifiedHref(target.nextPath, target.email, flowId),
      });
    }
    return NextResponse.json({ ok: false, error: authResult.error.message }, { status: 400 });
  }

  if (!user) {
    const userResult = await supabase.auth.getUser();
    user = userResult.data.user ?? null;
  }

  await ensurePodUsername(supabase, user);

  const verifiedEmail = normalizeEmail(user?.email) || target.email;
  if (!verifiedEmail) {
    return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });
  }

  await markEmailVerificationFlow(user, flowId, "confirm_page");

  try {
    await supabase.auth.signOut();
  } catch {
    // The account is confirmed either way; avoid failing the email confirmation page on sign-out cleanup.
  }

  return NextResponse.json({
    ok: true,
    redirectTo: buildEmailVerifiedHref(target.nextPath, verifiedEmail, flowId),
  });
}
