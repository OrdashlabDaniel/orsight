import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { buildEmailVerifiedHref } from "@/lib/auth-email-verified";
import { POD_USERNAME_METADATA_KEY } from "@/lib/auth-username";
import { POST_LOGIN_DEFAULT_PATH } from "@/lib/post-login-home";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const callbackType = searchParams.get("type");
  const verifiedFlag = searchParams.get("verified") === "1";
  const next = searchParams.get("next");
  const nextPath = next?.startsWith("/") ? next : POST_LOGIN_DEFAULT_PATH;
  const isSignupVerification = verifiedFlag || callbackType === "signup";

  if (code || (tokenHash && callbackType)) {
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
      const authProvider =
        user && typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "";
      const shouldShowVerifiedPage = isSignupVerification || (!callbackType && authProvider === "email");

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

      if (shouldShowVerifiedPage) {
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore sign-out failures here; the success page still allows the user to continue to login.
        }
        return NextResponse.redirect(`${origin}${buildEmailVerifiedHref(nextPath, user?.email)}`);
      }

      return NextResponse.redirect(`${origin}${nextPath}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
