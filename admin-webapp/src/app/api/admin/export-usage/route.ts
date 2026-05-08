import { format } from "date-fns";
import { NextRequest, NextResponse } from "next/server";

import {
  buildAdminUsageExportWorkbookBuffer,
  loadAdminUsageExportDataset,
} from "@/lib/admin-usage-export";
import { buildAdminTimeRange } from "@/lib/admin-time-range";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActorOrNull } from "@/lib/viz-admin-verify";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function GET(request: NextRequest) {
  const actor = await getAdminActorOrNull();
  if (!actor) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
  }

  const userId = (request.nextUrl.searchParams.get("userId") || "").trim();
  const openAIProjectId = (request.nextUrl.searchParams.get("openaiProjectId") || "").trim();
  if (userId && !UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid userId." }, { status: 400 });
  }
  const days = Number.parseInt(request.nextUrl.searchParams.get("days") || "", 10);
  const startDate = (request.nextUrl.searchParams.get("startDate") || "").trim() || null;
  const endDate = (request.nextUrl.searchParams.get("endDate") || "").trim() || null;
  const range = buildAdminTimeRange({
    days: Number.isFinite(days) ? days : null,
    startDate,
    endDate,
  });

  const exportedAt = new Date().toISOString();
  const dataset = await loadAdminUsageExportDataset(
    { userId: userId || undefined, range, openAIProjectId: openAIProjectId || undefined },
    {
      exportedAt,
      exportedBy: actor.identifier,
      createAdminClient,
    },
  );

  const buffer = buildAdminUsageExportWorkbookBuffer(dataset);
  const filenameScope = dataset.user
    ? sanitizeFilenamePart(dataset.user.label || dataset.user.id) || "user"
    : "all-users";
  const filename = `orsight-usage-${filenameScope}-${format(new Date(exportedAt), "yyyy-MM-dd")}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
