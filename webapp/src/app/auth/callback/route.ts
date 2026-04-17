import { NextResponse } from "next/server";

import { POD_USERNAME_METADATA_KEY } from "@/lib/auth-username";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
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
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
