import { NextResponse } from "next/server";

import { ensureStripeCustomerForUser, getStripe } from "@/lib/billing";
import { getAuthContextOrSkip } from "@/lib/auth-server";

export const runtime = "nodejs";

function getOrigin(request: Request) {
  const url = new URL(request.url);
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || `${url.protocol}//${url.host}`;
}

export async function POST(request: Request) {
  const { user, skipAuth } = await getAuthContextOrSkip();
  if (skipAuth || !user) {
    return NextResponse.json({ error: "Please sign in before opening billing portal." }, { status: 401 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const customerId = await ensureStripeCustomerForUser(user);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getOrigin(request)}/account`,
  });

  return NextResponse.json({ url: session.url });
}
