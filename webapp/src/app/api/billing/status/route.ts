import { NextResponse } from "next/server";

import { getBillingStatusForUser, syncStripeBillingForUser } from "@/lib/billing";
import { getAuthContextOrSkip } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function GET() {
  const { user, skipAuth } = await getAuthContextOrSkip();
  if (skipAuth || !user) {
    return NextResponse.json({ error: "Please sign in to view billing status." }, { status: 401 });
  }

  try {
    await syncStripeBillingForUser(user);
  } catch (error) {
    console.error("Failed to refresh Stripe billing status:", error);
  }

  return NextResponse.json({ billing: await getBillingStatusForUser(user.id) });
}
