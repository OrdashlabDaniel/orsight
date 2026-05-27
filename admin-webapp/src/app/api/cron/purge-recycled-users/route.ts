import { NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const sb = createServiceRoleClient();
    const purged = await purgeExpiredRecycledUsers(sb);
    return NextResponse.json({ ok: true, purged });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown purge error." },
      { status: 500 },
    );
  }
}
