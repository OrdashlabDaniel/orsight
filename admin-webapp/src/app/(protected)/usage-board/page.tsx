import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  Database,
  Download,
  Images,
  Scale,
  Wallet,
} from "lucide-react";

import { AdminMetricCard } from "@/components/AdminMetricCard";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { AdminUsageCharts } from "@/components/AdminUsageCharts";
import { HydrationSafeMount } from "@/components/HydrationSafeMount";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ADMIN_RANGE_PRESET_OPTIONS,
  buildAdminTimeRange,
  type AdminTimeRange,
} from "@/lib/admin-time-range";
import { loadAdminUsageBoardSnapshot } from "@/lib/admin-data";
import {
  listOpenAIProjects,
  loadAdminOpenAIReconciliationSnapshot,
  type AdminOpenAIReconciliationSnapshot,
} from "@/lib/openai-usage-reconciliation";
import { conservativeLogCostUsd } from "@/lib/usage-metrics";

type SearchParams = Record<string, string | string[] | undefined>;
const ORSIGHT_OPENAI_PROJECT_NAME = "POD";

function asText(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildUsageBoardHref(params: {
  userId?: string;
  days?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const search = new URLSearchParams();
  if (params.userId) {
    search.set("userId", params.userId);
  }
  if (params.startDate && params.endDate) {
    search.set("startDate", params.startDate);
    search.set("endDate", params.endDate);
  } else if (params.days) {
    search.set("days", String(params.days));
  }
  const query = search.toString();
  return query ? `/usage-board?${query}` : "/usage-board";
}

function buildExportHref(params: {
  userId?: string;
  range: AdminTimeRange;
  openaiProjectId?: string | null;
}) {
  const search = new URLSearchParams();
  if (params.userId) {
    search.set("userId", params.userId);
  }
  if (params.openaiProjectId) {
    search.set("openaiProjectId", params.openaiProjectId);
  }
  search.set("startDate", params.range.startDateLabel);
  search.set("endDate", params.range.endDateLabel);
  return `/api/admin/export-usage?${search.toString()}`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value == null) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedUsd(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US");
}

function varianceTextClass(value: number) {
  if (value > 0.01) {
    return "text-amber-700";
  }
  if (value < -0.01) {
    return "text-emerald-700";
  }
  return "text-slate-900";
}

function TimeRangeControls({
  userId,
  range,
  lockedProjectName,
}: {
  userId?: string;
  range: AdminTimeRange;
  lockedProjectName: string;
}) {
  const selectedPresetDays = range.mode === "preset" ? range.days : null;

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 bg-white">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <CardTitle className="text-base text-slate-950">Time Window</CardTitle>
            <CardDescription className="mt-2 leading-6">
              The local usage cards above and the official OpenAI reconciliation tables below use the same UTC date
              window. This board is locked to the OrSight OpenAI project, so the official layer always stays aligned
              with the same `POD` project in the OpenAI dashboard.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              <CalendarRange className="h-4 w-4" />
              Current UTC range: <span className="font-medium text-slate-900">{range.rangeLabel}</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              Official OpenAI project:
              <span className="font-medium text-slate-900">{lockedProjectName}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {ADMIN_RANGE_PRESET_OPTIONS.map((days) => {
            const selected = days === selectedPresetDays;
            return (
              <Link
                key={days}
                href={buildUsageBoardHref({
                  userId,
                  days,
                })}
                className={`inline-flex items-center rounded-xl border px-3 py-1.5 text-[12px] font-medium transition ${
                  selected
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {days}d
              </Link>
            );
          })}
          <Link
            href={buildUsageBoardHref({
              userId,
              days: 30,
            })}
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Reset
          </Link>
        </div>

        <form method="GET" className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
          {userId ? <input type="hidden" name="userId" value={userId} /> : null}
          <label className="grid gap-1.5 text-[12px] font-medium text-slate-600">
            Start date (UTC)
            <input
              type="date"
              name="startDate"
              defaultValue={range.startDateLabel}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none transition focus:border-slate-950"
            />
          </label>
          <label className="grid gap-1.5 text-[12px] font-medium text-slate-600">
            End date (UTC)
            <input
              type="date"
              name="endDate"
              defaultValue={range.endDateLabel}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none transition focus:border-slate-950"
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-[40px] items-center justify-center rounded-xl bg-slate-950 px-4 text-[13px] font-medium text-white shadow-sm hover:bg-slate-800"
          >
            Apply time window
          </button>
        </form>
      </CardContent>
    </Card>
  );
}

function DebugFeedbackPanel({ notes }: { notes: string[] }) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <details className="rounded-2xl border border-amber-200 bg-amber-50/70">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium text-amber-950 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Debug / System Notes
        </span>
        <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900">
          {notes.length}
        </span>
      </summary>
      <div className="border-t border-amber-200 px-4 py-3">
        <ul className="space-y-2 text-[12px] leading-6 text-amber-950">
          {notes.map((note, index) => (
            <li key={`${index}-${note}`} className="rounded-xl bg-white/60 px-3 py-2">
              {note}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function OpenAIReconciliationSection({
  range,
  selectedOpenAIProjectName,
  reconciliation,
  errorMessage,
}: {
  range: AdminTimeRange;
  selectedOpenAIProjectName?: string | null;
  reconciliation: AdminOpenAIReconciliationSnapshot | null;
  errorMessage: string | null;
}) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 bg-white">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <CardTitle className="text-base text-slate-950">OpenAI Reconciliation</CardTitle>
            <CardDescription className="mt-2 leading-6">
              Official invoice-aligned spend comes from OpenAI Costs API. The page then compares that official truth
              against OpenAI Usage Completions buckets and your local `usage_logs` attribution.
            </CardDescription>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            Window under review: <span className="font-medium text-slate-900">{range.rangeLabel}</span>
            {selectedOpenAIProjectName ? (
              <>
                {" · "}Project: <span className="font-medium text-slate-900">{selectedOpenAIProjectName}</span>
              </>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {errorMessage ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-[13px] text-slate-500">
            Official reconciliation is temporarily unavailable.
          </div>
        ) : reconciliation?.enabled ? (
          <>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-[12px] text-slate-600">
              OpenAI reconciliation uses UTC day boundaries from{" "}
              <span className="font-medium text-slate-900">{reconciliation.range.startDateLabel}</span> to{" "}
              <span className="font-medium text-slate-900">{reconciliation.range.endDateLabel}</span>. Last synced at{" "}
              <span className="font-medium text-slate-900">{formatDateTime(reconciliation.syncedAtIso)}</span>.
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <AdminMetricCard
                label="Official Cost"
                value={formatUsd(reconciliation.officialCostUsd)}
                description="Finance-truth pulled directly from OpenAI Costs API."
                icon={<Scale className="h-5 w-5" />}
              />
              <AdminMetricCard
                label="Usage-Derived Cost"
                value={formatUsd(reconciliation.officialUsageEstimatedCostUsd)}
                description="Rebuilt from OpenAI Usage Completions tokens and the retained price basis."
                icon={<Activity className="h-5 w-5" />}
              />
              <AdminMetricCard
                label="Local Estimated Cost"
                value={formatUsd(reconciliation.localEstimatedCostUsd)}
                description="Estimated from your own usage_logs attribution layer."
                icon={<Database className="h-5 w-5" />}
              />
              <AdminMetricCard
                label="Variance vs Official"
                value={formatSignedUsd(reconciliation.varianceUsd)}
                description="Local estimate minus invoice-authoritative OpenAI cost."
                icon={<Wallet className="h-5 w-5" />}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <AdminMetricCard
                label="Official Requests"
                value={reconciliation.officialRequests.toLocaleString("en-US")}
                description="Request count from OpenAI Usage Completions."
                icon={<Activity className="h-5 w-5" />}
              />
              <AdminMetricCard
                label="Local Events"
                value={reconciliation.localEventCount.toLocaleString("en-US")}
                description="App-level usage rows available for attribution in the same range."
                icon={<Database className="h-5 w-5" />}
              />
              <AdminMetricCard
                label="Token Coverage"
                value={formatPercent(reconciliation.tokenCoverageRatio)}
                description="How much of official text token volume is reflected in local logs."
                icon={<Images className="h-5 w-5" />}
              />
              <AdminMetricCard
                label="Cost Coverage"
                value={formatPercent(reconciliation.costCoverageRatio)}
                description="How close local estimated cost is to official OpenAI spend."
                icon={<Wallet className="h-5 w-5" />}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
              <div className="rounded-2xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <h3 className="text-[15px] font-semibold text-slate-900">Daily Reconciliation</h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Compare official OpenAI cost, OpenAI usage-derived analytical cost, and local attribution day by
                    day.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[940px] text-left text-[13px]">
                    <thead className="border-b border-slate-200 bg-white text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium text-right">Official Cost</th>
                        <th className="px-4 py-3 font-medium text-right">Usage Cost</th>
                        <th className="px-4 py-3 font-medium text-right">Local Cost</th>
                        <th className="px-4 py-3 font-medium text-right">Delta</th>
                        <th className="px-4 py-3 font-medium text-right">Official Requests</th>
                        <th className="px-4 py-3 font-medium text-right">Local Events</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconciliation.daily.map((entry) => {
                        const delta = entry.localEstimatedCostUsd - entry.officialCostUsd;
                        return (
                          <tr key={entry.date} className="hover:bg-slate-50">
                            <td className="px-4 py-3.5 font-medium text-slate-900">{entry.date}</td>
                            <td className="px-4 py-3.5 text-right text-slate-700">
                              {formatUsd(entry.officialCostUsd)}
                            </td>
                            <td className="px-4 py-3.5 text-right text-slate-700">
                              {formatUsd(entry.officialUsageEstimatedCostUsd)}
                            </td>
                            <td className="px-4 py-3.5 text-right text-slate-700">
                              {formatUsd(entry.localEstimatedCostUsd)}
                            </td>
                            <td className={`px-4 py-3.5 text-right font-medium ${varianceTextClass(delta)}`}>
                              {formatSignedUsd(delta)}
                            </td>
                            <td className="px-4 py-3.5 text-right text-slate-700">
                              {entry.officialRequests.toLocaleString("en-US")}
                            </td>
                            <td className="px-4 py-3.5 text-right text-slate-700">
                              {entry.localEventCount.toLocaleString("en-US")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <h3 className="text-[15px] font-semibold text-slate-900">Invoice Line Items</h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Direct spend grouping from OpenAI Costs API. This is the most finance-truth table on the page.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[360px] text-left text-[13px]">
                    <thead className="border-b border-slate-200 bg-white text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Line Item</th>
                        <th className="px-4 py-3 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconciliation.lineItems.map((entry) => (
                        <tr key={entry.lineItem} className="hover:bg-slate-50">
                          <td className="px-4 py-3.5 font-medium text-slate-900">{entry.lineItem}</td>
                          <td className="px-4 py-3.5 text-right text-slate-700">{formatUsd(entry.amountUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <h3 className="text-[15px] font-semibold text-slate-900">Project Cost Breakdown</h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Official cost grouped by OpenAI `project_id`. This is the cleanest path to exact workspace-level
                    reconciliation.
                  </p>
                </div>
                {reconciliation.projectBreakdown.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-[13px]">
                      <thead className="border-b border-slate-200 bg-white text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">Project ID</th>
                          <th className="px-4 py-3 font-medium text-right">Official Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reconciliation.projectBreakdown.map((entry) => (
                          <tr key={entry.projectId} className="hover:bg-slate-50">
                            <td className="px-4 py-3.5 font-mono text-[12px] text-slate-700">{entry.projectId}</td>
                            <td className="px-4 py-3.5 text-right text-slate-700">{formatUsd(entry.amountUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-6 text-[13px] text-slate-500">
                    OpenAI did not return any `project_id` tags in the selected range. If you want exact customer or
                    workspace cost, start isolating traffic by OpenAI project.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <h3 className="text-[15px] font-semibold text-slate-900">API Key Cost Breakdown</h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Official cost grouped by OpenAI `api_key_id`. This is the cleanest path to exact staff or service
                    boundary reconciliation.
                  </p>
                </div>
                {reconciliation.apiKeyBreakdown.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-[13px]">
                      <thead className="border-b border-slate-200 bg-white text-slate-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">API Key ID</th>
                          <th className="px-4 py-3 font-medium text-right">Official Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reconciliation.apiKeyBreakdown.map((entry) => (
                          <tr key={entry.apiKeyId} className="hover:bg-slate-50">
                            <td className="px-4 py-3.5 font-mono text-[12px] text-slate-700">{entry.apiKeyId}</td>
                            <td className="px-4 py-3.5 text-right text-slate-700">{formatUsd(entry.amountUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-6 text-[13px] text-slate-500">
                    OpenAI did not return any `api_key_id` tags in the selected range. If multiple internal services
                    share one key, official per-service truth is impossible until you split them.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200">
              <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <h3 className="text-[15px] font-semibold text-slate-900">Model Reconciliation</h3>
                <p className="mt-1 text-[12px] text-slate-500">
                  Compare OpenAI Usage Completions token buckets against your local attribution by model and tier.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1280px] text-left text-[13px]">
                  <thead className="border-b border-slate-200 bg-white text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Model</th>
                      <th className="px-4 py-3 font-medium">Tier</th>
                      <th className="px-4 py-3 font-medium text-right">Official Requests</th>
                      <th className="px-4 py-3 font-medium text-right">Official Input</th>
                      <th className="px-4 py-3 font-medium text-right">Cached Input</th>
                      <th className="px-4 py-3 font-medium text-right">Official Output</th>
                      <th className="px-4 py-3 font-medium text-right">Local Prompt</th>
                      <th className="px-4 py-3 font-medium text-right">Local Completion</th>
                      <th className="px-4 py-3 font-medium text-right">OpenAI Usage Cost</th>
                      <th className="px-4 py-3 font-medium text-right">Local Cost</th>
                      <th className="px-4 py-3 font-medium text-right">Cost Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reconciliation.modelComparison.map((entry) => (
                      <tr key={`${entry.model}-${entry.tier}`} className="hover:bg-slate-50">
                        <td className="px-4 py-3.5 font-medium text-slate-900">{entry.model}</td>
                        <td className="px-4 py-3.5 text-slate-600">{entry.tier}</td>
                        <td className="px-4 py-3.5 text-right text-slate-700">
                          {entry.officialRequests.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-700">
                          {entry.officialInputTokens.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-700">
                          {entry.officialCachedInputTokens.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-700">
                          {entry.officialOutputTokens.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-700">
                          {entry.localPromptTokens.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-700">
                          {entry.localCompletionTokens.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-700">
                          {formatUsd(entry.officialUsageEstimatedCostUsd)}
                        </td>
                        <td className="px-4 py-3.5 text-right text-slate-700">
                          {formatUsd(entry.localEstimatedCostUsd)}
                        </td>
                        <td
                          className={`px-4 py-3.5 text-right font-medium ${varianceTextClass(entry.costDeltaUsd)}`}
                        >
                          {formatSignedUsd(entry.costDeltaUsd)}
                        </td>
                      </tr>
                    ))}
                    {reconciliation.modelComparison.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-500">
                          No OpenAI reconciliation data available for the selected window.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-[13px] text-slate-500">
            Official reconciliation is not configured for this environment yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function UsageBoardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = searchParams ? await searchParams : {};
  const userId = asText(sp.userId) || undefined;
  const days = asNumber(sp.days);
  const startDate = asText(sp.startDate);
  const endDate = asText(sp.endDate);
  const range = buildAdminTimeRange({
    days,
    startDate,
    endDate,
  });
  const openAIProjects = await listOpenAIProjects();
  const selectedOpenAIProject =
    openAIProjects.find(
      (project) => project.name.trim().toLowerCase() === ORSIGHT_OPENAI_PROJECT_NAME.toLowerCase(),
    ) || null;
  const selectedOpenAIProjectId = selectedOpenAIProject?.id;
  const snapshot = await loadAdminUsageBoardSnapshot(userId, range, selectedOpenAIProjectId || undefined);
  const exportHref = buildExportHref({
    userId,
    range,
    openaiProjectId: selectedOpenAIProjectId || null,
  });

  let reconciliation: AdminOpenAIReconciliationSnapshot | null = null;
  let reconciliationError: string | null = null;

  if (!userId) {
    try {
      reconciliation = await loadAdminOpenAIReconciliationSnapshot(
        {
          days,
          startDate,
          endDate,
        },
        {
          projectIds: selectedOpenAIProjectId ? [selectedOpenAIProjectId] : undefined,
        },
      );
    } catch (error) {
      reconciliationError = error instanceof Error ? error.message : "Failed to load OpenAI reconciliation snapshot.";
    }
  }

  const showOfficialSummary = !userId && reconciliation?.enabled;
  const useOfficialSpendTrend = !userId;
  const showDebugPanel = process.env.NODE_ENV !== "production";
  const officialSpendDaily =
    showOfficialSummary && reconciliation
      ? reconciliation.daily.map((entry) => ({
          date: entry.date,
          spendUsd: entry.officialCostUsd,
        }))
      : [];
  const localAttributionMultiplier =
    showOfficialSummary && reconciliation && snapshot.totals.totalCost > 0
      ? Math.max(1, reconciliation.officialCostUsd / snapshot.totals.totalCost)
      : 1;
  const conservativeAttributedTotalCost = snapshot.totals.totalCost * localAttributionMultiplier;
  const debugNotes = showDebugPanel
    ? Array.from(
        new Set(
          [
            ...snapshot.warnings,
            ...(reconciliationError ? [`Official reconciliation error: ${reconciliationError}`] : []),
            ...(!userId && reconciliation ? reconciliation.warnings : []),
            ...(!selectedOpenAIProject
              ? [
                  `OpenAI project ${ORSIGHT_OPENAI_PROJECT_NAME} was not found in the admin project list, so official reconciliation is temporarily using the broader organization scope.`,
                ]
              : []),
            ...(showOfficialSummary
              ? [
                  `Official verification is active for ${range.rangeLabel}${
                    selectedOpenAIProject?.name ? ` using OpenAI project ${selectedOpenAIProject.name}` : ""
                  }.`,
                ]
              : []),
          ].filter((note): note is string => Boolean(note?.trim())),
        ),
      )
    : [];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Usage Board"
        description="Local usage attribution and official OpenAI cost reconciliation now run on the same selectable UTC time window, and the official layer is pinned to the OrSight `POD` project in the OpenAI dashboard."
        actions={
          <>
            <Link
              href={exportHref}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              Export Usage Workbook
            </Link>
            {snapshot.user ? (
            <Link
              href={buildUsageBoardHref({
                days: range.mode === "preset" ? range.days : null,
                startDate: range.mode === "custom" ? range.startDateLabel : null,
                endDate: range.mode === "custom" ? range.endDateLabel : null,
              })}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
                <ArrowLeft className="h-4 w-4" />
                Clear Filter
              </Link>
            ) : (
              <Link
                href="/users"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Go to Users
              </Link>
            )}
          </>
        }
      />

      <TimeRangeControls
        userId={userId}
        range={range}
        lockedProjectName={ORSIGHT_OPENAI_PROJECT_NAME}
      />

      {showDebugPanel ? (
        <HydrationSafeMount>
          <DebugFeedbackPanel notes={debugNotes} />
        </HydrationSafeMount>
      ) : null}

      {snapshot.user ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-950">
          Filtered to <strong>{snapshot.user.label}</strong>. The local metrics below and any export now reflect only
          this account inside the selected UTC range.
        </div>
      ) : null}

      {showOfficialSummary && reconciliation ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AdminMetricCard
            label="Total Spend"
            value={formatUsd(reconciliation.officialCostUsd)}
            description="Official total spend from OpenAI Costs API for the selected UTC range and project filter."
            icon={<Scale className="h-5 w-5" />}
          />
          <AdminMetricCard
            label="Official Requests"
            value={reconciliation.officialRequests.toLocaleString("en-US")}
            description="OpenAI Usage Completions request count inside the same official window."
            icon={<Activity className="h-5 w-5" />}
          />
          <AdminMetricCard
            label="Usage-Derived Cost"
            value={formatUsd(reconciliation.officialUsageEstimatedCostUsd)}
            description="Analytical rebuild from official OpenAI usage buckets and the retained pricing basis."
            icon={<Wallet className="h-5 w-5" />}
          />
          <AdminMetricCard
            label="Variance vs Official"
            value={formatSignedUsd(reconciliation.varianceUsd)}
            description="Local estimate minus official spend, kept visible for validation."
            icon={<Database className="h-5 w-5" />}
          />
        </div>
      ) : null}

      <AdminUsageCharts
        daily={snapshot.dailyTokens}
        modelShares={snapshot.modelShares}
        spendDaily={officialSpendDaily}
        trendMode={useOfficialSpendTrend ? "spend" : "tokens"}
        trendTitle={useOfficialSpendTrend ? "Official Spend Trend" : "Conservative Attribution Token Trend"}
        modelTitle="Conservative Attribution Model Mix"
        spendEmptyText="Official spend data is temporarily unavailable for the selected range or project filter."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Attribution Events"
          value={snapshot.totals.recordCount.toLocaleString("en-US")}
          description="All local attribution rows found inside the selected UTC range and project scope."
          icon={<Database className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Attributed Images"
          value={snapshot.totals.totalImages.toLocaleString("en-US")}
          description="Image count attributed to the same selected local usage rows."
          icon={<Images className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Attributed Tokens"
          value={snapshot.totals.totalTokens.toLocaleString("en-US")}
          description="Prompt + completion tokens recorded in local usage_logs for this selected scope."
          icon={<Activity className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Conservative Attributed Cost"
          value={formatUsd(conservativeAttributedTotalCost)}
          description={
            localAttributionMultiplier > 1
              ? `Local attribution uplifted ${localAttributionMultiplier.toFixed(2)}x so displayed cost does not fall below official spend.`
              : "Local attribution already meets or exceeds the selected official spend scope."
          }
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      {!userId ? (
        <OpenAIReconciliationSection
          range={range}
          selectedOpenAIProjectName={selectedOpenAIProject?.name || null}
          reconciliation={reconciliation}
          errorMessage={reconciliationError}
        />
      ) : null}

      {!snapshot.user ? (
        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-100 bg-white">
            <CardTitle className="text-base text-slate-950">Top Conservative Attribution Accounts</CardTitle>
            <CardDescription>
              These rankings are calculated from local `usage_logs` inside the currently selected UTC range and
              OpenAI project scope, then uplifted when needed so the displayed total does not fall below official
              spend.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium text-right">Images</th>
                    <th className="px-4 py-3 font-medium text-right">Tokens</th>
                    <th className="px-4 py-3 font-medium text-right">Conservative Cost</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshot.topUsers.map((entry) => (
                    <tr key={entry.user.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-900">{entry.label}</div>
                        <div className="mt-1 break-all text-xs text-slate-500">{entry.user.email || entry.user.id}</div>
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-700">
                        {entry.usage.images.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3.5 text-right text-slate-700">
                        {entry.usage.tokens.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-slate-900">
                        {formatUsd(entry.usage.costUsd * localAttributionMultiplier)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={buildUsageBoardHref({
                            userId: entry.user.id,
                            days: range.mode === "preset" ? range.days : null,
                            startDate: range.mode === "custom" ? range.startDateLabel : null,
                            endDate: range.mode === "custom" ? range.endDateLabel : null,
                          })}
                          className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Filter
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-white">
          <CardTitle className="text-base text-slate-950">Conservative Attribution Events</CardTitle>
          <CardDescription>
            Event-level local attribution rows from `usage_logs` within the selected UTC range and matching project
            scope when available.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1380px] text-left text-[13px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Form</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium text-right">Requests</th>
                  <th className="px-4 py-3 font-medium text-right">Images</th>
                  <th className="px-4 py-3 font-medium text-right">Prompt</th>
                  <th className="px-4 py-3 font-medium text-right">Cached</th>
                  <th className="px-4 py-3 font-medium text-right">Completion</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Conservative Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.usageLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3.5 text-slate-600">
                      {log.created_at ? formatDateTime(log.created_at) : "-"}
                    </td>
                    <td className="px-4 py-3.5">
                      {snapshot.user ? (
                        <div className="font-medium text-slate-900">{snapshot.user.label}</div>
                      ) : (
                        <div className="font-medium text-slate-900">
                          {snapshot.userLabelMap[log.user_id] || log.user_id}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{log.form_id || "-"}</td>
                    <td className="px-4 py-3.5 font-medium text-slate-900">{log.action_type || "-"}</td>
                    <td className="px-4 py-3.5 text-slate-600">{log.model_used || "-"}</td>
                    <td className="px-4 py-3.5 text-slate-600">{log.openai_project_id || "-"}</td>
                    <td className="px-4 py-3.5 text-right text-slate-700">
                      {(log.request_count || 1).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-700">
                      {(log.image_count || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-700">
                      {(log.prompt_tokens || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-700">
                      {(log.cached_input_tokens || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-700">
                      {(log.completion_tokens || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-slate-900">
                      {(log.total_tokens || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-slate-900">
                      {formatUsd(conservativeLogCostUsd(log) * localAttributionMultiplier)}
                    </td>
                  </tr>
                ))}
                {snapshot.usageLogs.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-10 text-center text-sm text-slate-500">
                      No usage events available in the selected time range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
