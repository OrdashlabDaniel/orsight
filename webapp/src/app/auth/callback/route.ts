import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { buildEmailVerifiedHref } from "@/lib/auth-email-verified";
import {
  findAuthUserByEmail,
  hasConfirmedEmailVerificationFlow,
} from "@/lib/auth-email-verification-server";
import { POD_USERNAME_METADATA_KEY } from "@/lib/auth-username";
import { POST_LOGIN_DEFAULT_PATH } from "@/lib/post-login-home";
import { createClient } from "@/lib/supabase/server";

function normalizeEmail(value: string | null | undefined) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.includes("@") ? email : "";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const callbackType = searchParams.get("type");
  const verifiedFlag = searchParams.get("verified") === "1";
  const callbackEmail = normalizeEmail(searchParams.get("email"));
  const verificationFlowId = (searchParams.get("flowId") || "").trim();
  const next = searchParams.get("next");
  const nextPath = next?.startsWith("/") ? next : POST_LOGIN_DEFAULT_PATH;
  // OAuth code exchanges (for example Google login) can arrive here and must continue to the app.
  const isSignupVerification = verifiedFlag || (Boolean(tokenHash) && callbackType === "signup");
  // Signup email confirmation is intentionally handled by /auth/confirm through a browser POST.
  // This GET callback must not consume signup token hashes or mark verification complete, because
  // email security scanners can prefetch GET links before the user clicks the email button.
  const canVerifyTokenHash = Boolean(tokenHash && callbackType && callbackType !== "signup");

  if (code || canVerifyTokenHash) {
    const supabase = await createClient();
    const authResult = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: callbackType as EmailOtpType,
        });

    if (!authResult.error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const meta = user.user_metadata ?? {};
        const existing = meta[POD_USERNAME_METADATA_KEY];
        if (typeof existing !== "string" || !existing.trim()) {
          const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
          const name = typeof meta.name === "string" ? meta.name.trim() : "";
          const emailLocal =
            user.email && user.email.includes("@") ? user.email.split("@")[0]!.trim() : "";
          const podUsername = fullName || name || emailLocal || "user";
          await supabase.auth.updateUser({
            data: { [POD_USERNAME_METADATA_KEY]: podUsername },
          });
        }
      }

      return NextResponse.redirect(`${origin}${nextPath}`);
    }

    if (isSignupVerification && verificationFlowId) {
      const existingUser = await findAuthUserByEmail(callbackEmail);
      if (hasConfirmedEmailVerificationFlow(existingUser, verificationFlowId)) {
        return NextResponse.redirect(`${origin}${buildEmailVerifiedHref(nextPath, callbackEmail, verificationFlowId)}`);
      }
    }
  }

  if (isSignupVerification && verificationFlowId) {
    const existingUser = await findAuthUserByEmail(callbackEmail);
    if (hasConfirmedEmailVerificationFlow(existingUser, verificationFlowId)) {
      return NextResponse.redirect(`${origin}${buildEmailVerifiedHref(nextPath, callbackEmail, verificationFlowId)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
