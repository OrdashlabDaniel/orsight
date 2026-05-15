import * as XLSX from "xlsx";

import { type AdminUsageLogRow } from "@/lib/admin-data";
import { type AdminTimeRange } from "@/lib/admin-time-range";
import { aggregateUsageLogs, conservativeLogCostUsd, estimatedLogCostUsd } from "@/lib/usage-metrics";

type AdminUserDirectoryEntry = {
  id: string;
  label: string;
  email: string | null;
};

type RegisteredUserLookupRow = {
  id: string;
  email: string | null;
  pod_username: string | null;
};

export type AdminUsageExportDataset = {
  exportedAt: string;
  exportedBy: string;
  warnings: string[];
  range: AdminTimeRange;
  user: AdminUserDirectoryEntry | null;
  openAIProjectId: string | null;
  usageLogs: AdminUsageLogRow[];
  userDirectory: Map<string, AdminUserDirectoryEntry>;
};

export type AdminUsageExportScope = {
  userId?: string;
  range: AdminTimeRange;
  openAIProjectId?: string;
};

const USAGE_EXPORT_PAGE_SIZE = 2000;
const USAGE_EXPORT_SELECT_BASE =
  "id,user_id,action_type,image_count,total_tokens,prompt_tokens,completion_tokens,model_used,created_at";
const USAGE_EXPORT_SELECT_WITH_CACHE = USAGE_EXPORT_SELECT_BASE.replace(
  "completion_tokens",
  "cached_input_tokens,completion_tokens",
);
const USAGE_EXPORT_SELECT_FULL =
  "id,user_id,form_id,action_type,image_count,request_count,total_tokens,prompt_tokens,cached_input_tokens,completion_tokens,model_used,openai_project_id,openai_api_key_id,service_tier,pricing_tier,openai_endpoint,pricing_basis_version,estimated_cost_usd,conservative_cost_usd,created_at";

function isMissingCachedInputTokensColumnMessage(message: string) {
  return /cached_input_tokens/i.test(message) && /(column|schema cache|does not exist)/i.test(message);
}

function isMissingExtendedUsageLogColumnsMessage(message: string) {
  return /(request_count|openai_project_id|openai_api_key_id|service_tier|pricing_tier|estimated_cost_usd|conservative_cost_usd|form_id)/i.test(
    message,
  ) && /(column|schema cache|does not exist)/i.test(message);
}

function normalizeUsageLogRow(row: Partial<AdminUsageLogRow>): AdminUsageLogRow {
  return {
    id: String(row.id || ""),
    user_id: String(row.user_id || ""),
    form_id: typeof row.form_id === "string" ? row.form_id : null,
    action_type: typeof row.action_type === "string" ? row.action_type : null,
    image_count: typeof row.image_count === "number" ? row.image_count : row.image_count ?? null,
    request_count: typeof row.request_count === "number" ? row.request_count : row.request_count ?? null,
    total_tokens: typeof row.total_tokens === "number" ? row.total_tokens : row.total_tokens ?? null,
    prompt_tokens: typeof row.prompt_tokens === "number" ? row.prompt_tokens : row.prompt_tokens ?? null,
    cached_input_tokens:
      typeof row.cached_input_tokens === "number" ? row.cached_input_tokens : row.cached_input_tokens ?? null,
    completion_tokens:
      typeof row.completion_tokens === "number" ? row.completion_tokens : row.completion_tokens ?? null,
    model_used: typeof row.model_used === "string" ? row.model_used : null,
    openai_project_id: typeof row.openai_project_id === "string" ? row.openai_project_id : null,
    openai_api_key_id: typeof row.openai_api_key_id === "string" ? row.openai_api_key_id : null,
    service_tier: typeof row.service_tier === "string" ? row.service_tier : null,
    pricing_tier: typeof row.pricing_tier === "string" ? row.pricing_tier : null,
    openai_endpoint: typeof row.openai_endpoint === "string" ? row.openai_endpoint : null,
    pricing_basis_version: typeof row.pricing_basis_version === "string" ? row.pricing_basis_version : null,
    estimated_cost_usd:
      typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : row.estimated_cost_usd ?? null,
    conservative_cost_usd:
      typeof row.conservative_cost_usd === "number" ? row.conservative_cost_usd : row.conservative_cost_usd ?? null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
  };
}

function setColumnWidths(worksheet: XLSX.WorkSheet, widths: number[]) {
  worksheet["!cols"] = widths.map((width) => ({ wch: width }));
}

function addAutofilter(worksheet: XLSX.WorkSheet) {
  if (!worksheet["!ref"]) {
    return;
  }
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}

function getDirectoryEntry(
  userDirectory: Map<string, AdminUserDirectoryEntry>,
  userId: string,
): AdminUserDirectoryEntry {
  return (
    userDirectory.get(userId) || {
      id: userId,
      label: userId,
      email: null,
    }
  );
}

async function listUsageLogsForExport(
  sb: Awaited<ReturnType<typeof import("@/lib/supabase/server").createAdminClient>>,
  scope: AdminUsageExportScope,
): Promise<AdminUsageLogRow[]> {
  const usageLogs: AdminUsageLogRow[] = [];

  for (let start = 0; ; start += USAGE_EXPORT_PAGE_SIZE) {
    let query = sb
      .from("usage_logs")
      .select(USAGE_EXPORT_SELECT_FULL)
      .neq("action_type", "billing_reservation")
      .gte("created_at", scope.range.startIso)
      .lt("created_at", scope.range.endIso)
      .order("created_at", { ascending: false })
      .range(start, start + USAGE_EXPORT_PAGE_SIZE - 1);

    if (scope.userId) {
      query = query.eq("user_id", scope.userId);
    }
    if (scope.openAIProjectId) {
      query = query.eq("openai_project_id", scope.openAIProjectId);
    }

    const fullResult = await query;
    let data: Partial<AdminUsageLogRow>[] | null = fullResult.data as Partial<AdminUsageLogRow>[] | null;
    let error = fullResult.error;

    if (error && (isMissingExtendedUsageLogColumnsMessage(error.message) || isMissingCachedInputTokensColumnMessage(error.message))) {
      let fallbackQuery = sb
        .from("usage_logs")
        .select(
          isMissingCachedInputTokensColumnMessage(error.message)
            ? USAGE_EXPORT_SELECT_BASE
            : USAGE_EXPORT_SELECT_WITH_CACHE,
        )
        .neq("action_type", "billing_reservation")
        .gte("created_at", scope.range.startIso)
        .lt("created_at", scope.range.endIso)
        .order("created_at", { ascending: false })
        .range(start, start + USAGE_EXPORT_PAGE_SIZE - 1);

      if (scope.userId) {
        fallbackQuery = fallbackQuery.eq("user_id", scope.userId);
      }

      const fallbackResult = await fallbackQuery;
      data = fallbackResult.data as Partial<AdminUsageLogRow>[] | null;
      error = fallbackResult.error;
    }

    if (error) {
      throw new Error(`usage_logs: ${error.message}`);
    }

    const rows = ((data ?? []) as Partial<AdminUsageLogRow>[]).map(normalizeUsageLogRow);
    usageLogs.push(...rows);

    if (rows.length < USAGE_EXPORT_PAGE_SIZE) {
      break;
    }
  }

  return usageLogs;
}

async function buildUserDirectory(
  sb: Awaited<ReturnType<typeof import("@/lib/supabase/server").createAdminClient>>,
  warnings: string[],
): Promise<Map<string, AdminUserDirectoryEntry>> {
  const directory = new Map<string, AdminUserDirectoryEntry>();

  const { data: adminRows, error: adminError } = await sb.from("admin_users").select("id,email");
  if (adminError) {
    warnings.push(`admin_users: ${adminError.message}`);
  } else {
    for (const row of adminRows ?? []) {
      const id = String(row.id || "");
      if (!id) {
        continue;
      }

      directory.set(id, {
        id,
        label: normalizeLabel(typeof row.email === "string" ? row.email : null, id),
        email: typeof row.email === "string" ? row.email : null,
      });
    }
  }

  const { data: registeredRows, error: registeredError } = await sb.rpc("list_registered_users");
  if (registeredError) {
    warnings.push(`list_registered_users RPC: ${registeredError.message}`);
    return directory;
  }

  for (const row of (registeredRows ?? []) as RegisteredUserLookupRow[]) {
    const id = String(row.id || "");
    if (!id) {
      continue;
    }

    const label = normalizeLabel(row.pod_username, normalizeLabel(row.email, id));
    directory.set(id, {
      id,
      label,
      email: typeof row.email === "string" ? row.email : null,
    });
  }

  return directory;
}

function buildOverviewSheet(dataset: AdminUsageExportDataset): XLSX.WorkSheet {
  const totals = aggregateUsageLogs(dataset.usageLogs);
  const scopeLabel = dataset.user ? `Single user: ${dataset.user.label}` : "All users";
  const overviewRows = [
    ["Metric", "Value"],
    ["Export Scope", scopeLabel],
    ["OpenAI Project Scope", dataset.openAIProjectId || "All projects"],
    ["Filtered User ID", dataset.user?.id || "All users"],
    ["Filtered User Email", dataset.user?.email || "-"],
    ["Date Range UTC", dataset.range.rangeLabel],
    ["Exported At UTC", dataset.exportedAt],
    ["Exported By", dataset.exportedBy],
    ["Usage Records", totals.recordCount],
    ["Active Users", totals.uniqueActiveUsers],
    ["Images", totals.totalImages],
    ["Tokens", totals.totalTokens],
    ["Estimated Cost (USD)", Number(totals.totalEstimatedCost.toFixed(6))],
    ["Conservative Cost (USD)", Number(totals.totalConservativeCost.toFixed(6))],
    ["Warnings", dataset.warnings.length > 0 ? dataset.warnings.join(" | ") : "None"],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(overviewRows);
  setColumnWidths(worksheet, [26, 88]);
  return worksheet;
}

function buildUsageEventsSheet(dataset: AdminUsageExportDataset): XLSX.WorkSheet {
  const rows = dataset.usageLogs.map((log) => {
    const user = getDirectoryEntry(dataset.userDirectory, log.user_id);
    return {
      event_id: log.id,
      created_at_utc: log.created_at || "",
      user_id: log.user_id,
      user_label: user.label,
      user_email: user.email || "",
      form_id: log.form_id || "",
      action_type: log.action_type || "",
      model_used: log.model_used || "",
      openai_project_id: log.openai_project_id || "",
      openai_api_key_id: log.openai_api_key_id || "",
      service_tier: log.service_tier || "",
      pricing_tier: log.pricing_tier || "",
      openai_endpoint: log.openai_endpoint || "",
      pricing_basis_version: log.pricing_basis_version || "",
      request_count: log.request_count ?? 1,
      image_count: log.image_count ?? 0,
      prompt_tokens: log.prompt_tokens ?? 0,
      cached_input_tokens: log.cached_input_tokens ?? 0,
      completion_tokens: log.completion_tokens ?? 0,
      total_tokens: log.total_tokens ?? 0,
      estimated_cost_usd: Number(estimatedLogCostUsd(log).toFixed(6)),
      conservative_cost_usd: Number(conservativeLogCostUsd(log).toFixed(6)),
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  setColumnWidths(worksheet, [38, 22, 38, 24, 30, 18, 20, 18, 18, 14, 12, 14, 18, 16, 22, 12, 12, 16, 18]);
  addAutofilter(worksheet);
  return worksheet;
}

function buildUserSummarySheet(dataset: AdminUsageExportDataset): XLSX.WorkSheet {
  const summaryMap = new Map<
    string,
    {
      user_id: string;
      user_label: string;
      user_email: string;
      usage_records: number;
      request_count: number;
      image_count: number;
      prompt_tokens: number;
      cached_input_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
      conservative_cost_usd: number;
      latest_event_utc: string;
    }
  >();

  for (const log of dataset.usageLogs) {
    const user = getDirectoryEntry(dataset.userDirectory, log.user_id);
    const current = summaryMap.get(log.user_id) || {
      user_id: log.user_id,
      user_label: user.label,
      user_email: user.email || "",
      usage_records: 0,
      request_count: 0,
      image_count: 0,
      prompt_tokens: 0,
      cached_input_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      conservative_cost_usd: 0,
      latest_event_utc: "",
    };

    current.usage_records += 1;
    current.request_count += Math.max(1, Number(log.request_count || 1));
    current.image_count += Math.max(0, Number(log.image_count || 0));
    current.prompt_tokens += Math.max(0, Number(log.prompt_tokens || 0));
    current.cached_input_tokens += Math.max(0, Number(log.cached_input_tokens || 0));
    current.completion_tokens += Math.max(0, Number(log.completion_tokens || 0));
    current.total_tokens += Math.max(0, Number(log.total_tokens || 0));
    current.estimated_cost_usd += estimatedLogCostUsd(log);
    current.conservative_cost_usd += conservativeLogCostUsd(log);
    if ((log.created_at || "") > current.latest_event_utc) {
      current.latest_event_utc = log.created_at || current.latest_event_utc;
    }

    summaryMap.set(log.user_id, current);
  }

  const rows = [...summaryMap.values()]
    .map((row) => ({
      ...row,
      estimated_cost_usd: Number(row.estimated_cost_usd.toFixed(6)),
      conservative_cost_usd: Number(row.conservative_cost_usd.toFixed(6)),
    }))
    .sort((a, b) => {
      return (
        b.conservative_cost_usd - a.conservative_cost_usd ||
        b.total_tokens - a.total_tokens ||
        a.user_label.localeCompare(b.user_label)
      );
    });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  setColumnWidths(worksheet, [38, 24, 30, 14, 14, 12, 14, 16, 14, 16, 18, 22]);
  addAutofilter(worksheet);
  return worksheet;
}

function buildModelSummarySheet(dataset: AdminUsageExportDataset): XLSX.WorkSheet {
  const summaryMap = new Map<
    string,
    {
      model_used: string;
      usage_records: number;
      request_count: number;
      image_count: number;
      prompt_tokens: number;
      cached_input_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
      conservative_cost_usd: number;
    }
  >();

  for (const log of dataset.usageLogs) {
    const key = normalizeLabel(log.model_used, "unknown");
    const current = summaryMap.get(key) || {
      model_used: key,
      usage_records: 0,
      request_count: 0,
      image_count: 0,
      prompt_tokens: 0,
      cached_input_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      conservative_cost_usd: 0,
    };

    current.usage_records += 1;
    current.request_count += Math.max(1, Number(log.request_count || 1));
    current.image_count += Math.max(0, Number(log.image_count || 0));
    current.prompt_tokens += Math.max(0, Number(log.prompt_tokens || 0));
    current.cached_input_tokens += Math.max(0, Number(log.cached_input_tokens || 0));
    current.completion_tokens += Math.max(0, Number(log.completion_tokens || 0));
    current.total_tokens += Math.max(0, Number(log.total_tokens || 0));
    current.estimated_cost_usd += estimatedLogCostUsd(log);
    current.conservative_cost_usd += conservativeLogCostUsd(log);

    summaryMap.set(key, current);
  }

  const rows = [...summaryMap.values()]
    .map((row) => ({
      ...row,
      estimated_cost_usd: Number(row.estimated_cost_usd.toFixed(6)),
      conservative_cost_usd: Number(row.conservative_cost_usd.toFixed(6)),
    }))
    .sort((a, b) => {
      return b.conservative_cost_usd - a.conservative_cost_usd || b.total_tokens - a.total_tokens;
    });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  setColumnWidths(worksheet, [18, 14, 14, 12, 14, 16, 14, 16, 18]);
  addAutofilter(worksheet);
  return worksheet;
}

export async function loadAdminUsageExportDataset(
  scope: AdminUsageExportScope,
  options: {
    exportedAt: string;
    exportedBy: string;
    createAdminClient: typeof import("@/lib/supabase/server").createAdminClient;
  },
): Promise<AdminUsageExportDataset> {
  const warnings: string[] = [];
  const sb = await options.createAdminClient();
  const [usageLogs, userDirectory] = await Promise.all([
    listUsageLogsForExport(sb, scope),
    buildUserDirectory(sb, warnings),
  ]);

  const user = scope.userId ? getDirectoryEntry(userDirectory, scope.userId) : null;

  return {
    exportedAt: options.exportedAt,
    exportedBy: options.exportedBy,
    warnings,
    range: scope.range,
    user,
    openAIProjectId: scope.openAIProjectId || null,
    usageLogs,
    userDirectory,
  };
}

export function buildAdminUsageExportWorkbookBuffer(dataset: AdminUsageExportDataset): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, buildOverviewSheet(dataset), "overview");
  XLSX.utils.book_append_sheet(workbook, buildUsageEventsSheet(dataset), "usage_events");
  XLSX.utils.book_append_sheet(workbook, buildUserSummarySheet(dataset), "user_summary");
  XLSX.utils.book_append_sheet(workbook, buildModelSummarySheet(dataset), "model_summary");

  workbook.Props = {
    Title: "OrSight Usage Export",
    Subject: "Usage records for cost accounting",
    Author: "OrSight Admin",
    CreatedDate: new Date(dataset.exportedAt),
  };

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}
