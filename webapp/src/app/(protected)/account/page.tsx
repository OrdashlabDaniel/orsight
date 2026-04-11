import { redirect } from "next/navigation";

import { getDisplayUsernameFromUser, getGofoProfileFromUser } from "@/lib/auth-username";
import { getAuthUserOrSkip } from "@/lib/auth-server";
import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { isSupabaseAuthEnabled } from "@/lib/supabase";

import { AccountDetailsView, AccountDisabledGate } from "./AccountClientViews";

export default async function AccountPage() {
  const supabaseOn = isSupabaseAuthEnabled();
  const devMock = isDevMockLoginEnabled();

  if (!supabaseOn && !devMock) {
    return <AccountDisabledGate />;
  }

  const { user } = await getAuthUserOrSkip();

  if (!user) {
    redirect("/login?next=/account");
  }

  const isDevMockSession = devMock && !supabaseOn;
  const gofoProfile = getGofoProfileFromUser(user);

  return (
    <AccountDetailsView
      payload={{
        displayUsername: getDisplayUsernameFromUser(user),
        email: user.email ?? null,
        id: user.id,
        createdAtIso: user.created_at ?? null,
        isGofoEmployee: gofoProfile.isGofoEmployee,
        gofoSite: gofoProfile.gofoSite ?? null,
        isDevMockSession,
      }}
    />
  );
}
