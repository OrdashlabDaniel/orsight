import { format } from "date-fns";
import { NextRequest, NextResponse } from "next/server";

import { requireVizAdminActor } from "@/lib/viz-admin-verify";
import {
  parseUsageDateBoundsFromSearchParams,
  utcEndOfDay,
  utcStartOfDay,
} from "@/lib/viz-usage-date-bounds";
import { buildUsageLogsXlsxBuffer, type UsageLogExportRow } from "@/lib/viz-usage-export-xlsx";
import { buildUserDisplayLabelMap } from "@/lib/viz-user-label-map";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const scope = (sp.get("scope") || "").trim();

  if (scope === "all") {
    await requireVizAdminActor("/viz");
  } else if (scope === "user") {
    const userId = (sp.get("userId") || "").trim();
    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ error: "invalid userId" }, { status: 400 });
    }
    await requireVizAdminActor(`/viz/users/${encodeURIComponent(userId)}`);
  } else {
    return NextResponse.json({ error: "scope must be all or user" }, { status: 400 });
  }

  const sb = createServiceRoleClient();
  const labelMap = await buildUserDisplayLabelMap(sb);

  let logs: UsageLogExportRow[] = [];

  if (scope === "all") {
    const { data, error } = await sb
      .from("usage_logs")
      .select("id,user_id,action_type,image_count,total_tokens,prompt_tokens,completion_tokens,model_used,created_at")
      .order("created_at", { ascending: false })
      .limit(10000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    logs = (data ?? []) as UsageLogExportRow[];
  } else {
    const userId = (sp.get("userId") || "").trim();
    const { fromDay, toDay, today } = parseUsageDateBoundsFromSearchParams(sp);

    let q = sb
      .from("usage_logs")
      .select("id,user_id,action_type,image_count,total_tokens,prompt_tokens,completion_tokens,model_used,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10000);

    if (fromDay || toDay) {
      q = q
        .gte("created_at", fromDay ? utcStartOfDay(fromDay) : "1970-01-01T00:00:00.000Z")
        .lte("created_at", toDay ? utcEndOfDay(toDay) : utcEndOfDay(today));
    }

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    logs = (data ?? []) as UsageLogExportRow[];
  }

  const buf = buildUsageLogsXlsxBuffer(logs, labelMap, "usage_logs");
  const bytes = Uint8Array.from(buf);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const dayStamp = format(new Date(), "yyyy-MM-dd");
  const filename =
    scope === "all" ? `orsight-usage-all-${dayStamp}.xlsx` : `orsight-usage-user-${dayStamp}.xlsx`;

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
