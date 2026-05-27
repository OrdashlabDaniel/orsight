import { redirect } from "next/navigation";

import { getDisplayUsernameFromUser } from "@/lib/auth-username";
import { getAuthUserOrSkip } from "@/lib/auth-server";
import {
  ensureStripeCustomerForUser,
  getBillingStatusForUser,
  listPublicBillingPlans,
  syncStripeSubscriptionsForCustomer,
} from "@/lib/billing";
import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { isSupabaseAuthEnabled } from "@/lib/supabase";

import { AccountDetailsView, AccountDisabledGate } from "./AccountClientViews";

type AccountPageProps = {
  searchParams?: Promise<{
    billing?: string | string[] | undefined;
  }>;
};

function normalizeSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const supabaseOn = isSupabaseAuthEnabled();
  const devMock = isDevMockLoginEnabled();

  if (!supabaseOn && !devMock) {
    return <AccountDisabledGate />;
  }

  const { user } = await getAuthUserOrSkip();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const billingNotice = normalizeSingle(resolvedSearchParams?.billing);

  if (!user) {
    redirect("/login?next=/account");
  }

  const isDevMockSession = devMock && !supabaseOn;

  if (billingNotice === "success") {
    try {
      const customerId = await ensureStripeCustomerForUser(user);
      await syncStripeSubscriptionsForCustomer(customerId, user.id);
    } catch (error) {
      console.error("Failed to refresh Stripe billing state after checkout success:", error);
    }
  }

  const billing = await getBillingStatusForUser(user.id);
  const availablePlans = await listPublicBillingPlans();

  return (
    <AccountDetailsView
      payload={{
        displayUsername: getDisplayUsernameFromUser(user),
        email: user.email ?? null,
        id: user.id,
        createdAtIso: user.created_at ?? null,
        isDevMockSession,
        billing,
        availablePlans,
        billingNotice,
      }}
    />
  );
}
