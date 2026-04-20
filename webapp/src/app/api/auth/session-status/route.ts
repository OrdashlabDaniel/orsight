import { NextResponse } from "next/server";

import { needsEmailConfirmation } from "@/lib/auth-email-confirmation";
import { getAuthUserDisabledState } from "@/lib/auth-user-status";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthEnabled } from "@/lib/supabase";

export async function GET() {
  if (!isSupabaseAuthEnabled()) {
    return NextResponse.json({ active: false as const, reason: "supabase_off" }, { status: 200 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ active: false as const, reason: "signed_out" }, { status: 200 });
  }

  const disabledState = await getAuthUserDisabledState(user);
  if (disabledState.disabled) {
    await supabase.auth.signOut();
    return NextResponse.json({ active: false as const, reason: disabledState.reason }, { status: 200 });
  }

  if (needsEmailConfirmation(user)) {
    await supabase.auth.signOut();
    return NextResponse.json({ active: false as const, reason: "confirm_email" }, { status: 200 });
  }

  return NextResponse.json({ active: true as const }, { status: 200 });
}
