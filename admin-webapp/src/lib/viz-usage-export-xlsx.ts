import * as XLSX from "xlsx";

import { estimateLogCostUsd } from "@/lib/usage-metrics";

export type UsageLogExportRow = {
  id: string;
  user_id: string;
  action_type: string;
  image_count: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  model_used: string;
  created_at: string;
};

export function buildUsageLogsXlsxBuffer(
  logs: UsageLogExportRow[],
  userLabelById: Map<string, string>,
  sheetName: string,
): Buffer {
  const rows = logs.map((log) => ({
    id: log.id,
    created_at_utc: log.created_at,
    user_id: log.user_id,
    user_label: userLabelById.get(log.user_id) || "",
    action_type: log.action_type,
    model_used: log.model_used,
    image_count: log.image_count ?? 0,
    prompt_tokens: log.prompt_tokens ?? 0,
    completion_tokens: log.completion_tokens ?? 0,
    total_tokens: log.total_tokens ?? 0,
    estimated_cost_usd: Number(estimateLogCostUsd(log).toFixed(6)),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "usage");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  return out;
}
