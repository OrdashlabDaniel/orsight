import Link from "next/link";
import { ArrowLeft, CalendarRange, CreditCard, RotateCcw, ShieldCheck, Trash2, UserRound } from "lucide-react";

import { AdminMetricCard } from "@/components/AdminMetricCard";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { AdminUsageCharts } from "@/components/AdminUsageCharts";
import { VizIdentityBadges } from "@/components/VizIdentityBadges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  billingCreditsForTokenCount,
  billingSourceLabel,
  formatMoney,
  isAdminOverrideSubscription,
  paymentStatusLabel,
  shortId,
} from "@/lib/billing-admin";
import { loadAdminUserDetailSnapshot } from "@/lib/admin-data";
import {
  ADMIN_RANGE_PRESET_OPTIONS,
  buildCurrentBillingMonthRange,
  buildAdminTimeRange,
  currentUtcBillingMonth,
  listRecentUtcBillingMonths,
  type AdminTimeRange,
} from "@/lib/admin-time-range";

import {
  changeStripePlanAction,
  clearBillingOverrideAction,
  setBillingOverrideAction,
  setStripeCancelAtPeriodEndAction,
} from "../../billing/actions";
import {
  cancelStripeSubscriptionNowFromUserPageAction,
  clearUserUsageRecordsFromUserPageAction,
  deleteUserFromUserPageAction,
  grantAdminFromUserPageAction,
  revokeAdminFromUserPageAction,
  setLifetimeFreeFromUserPageAction,
} from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;

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

function buildUserDetailHref(params: {
  userId: string;
  month?: string | null;
  days?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const search = new URLSearchParams();
  if (params.month) {
    search.set("month", params.month);
  } else if (params.startDate && params.endDate) {
    search.set("startDate", params.startDate);
    search.set("endDate", params.endDate);
  } else if (params.days) {
    search.set("days", String(params.days));
  }
  const query = search.toString();
  return query ? `/users/${params.userId}?${query}` : `/users/${params.userId}`;
}

function buildUsageBoardHref(params: { userId: string; range: AdminTimeRange }) {
  const search = new URLSearchParams();
  search.set("userId", params.userId);
  search.set("startDate", params.range.startDateLabel);
  search.set("endDate", params.range.endDateLabel);
  return `/usage-board?${search.toString()}`;
}

function UserTimeRangeControls({
  userId,
  range,
}: {
  userId: string;
  range: AdminTimeRange;
}) {
  const selectedPresetDays = range.mode === "preset" ? range.days : null;
  const selectedMonth = range.mode === "month" ? range.startDateLabel.slice(0, 7) : null;
  const recentBillingMonths = listRecentUtcBillingMonths(6);

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100 bg-white">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base text-slate-950">User Usage Window</CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Filter this user&apos;s usage cards, charts, model mix, and recent usage events by billing month or UTC
              date range. Monthly shortcuts use the same calendar-month boundaries as Free/Normal/Pro quota accounting.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            <CalendarRange className="h-4 w-4" />
            Current UTC range: <span className="font-medium text-slate-900">{range.rangeLabel}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Billing months</div>
          <div className="flex flex-wrap gap-2">
            {recentBillingMonths.map((month) => {
              const selected = month === selectedMonth;
              return (
                <Link
                  key={month}
                  href={buildUserDetailHref({ userId, month })}
                  className={`inline-flex items-center rounded-xl border px-3 py-1.5 text-[12px] font-medium transition ${
                    selected
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {month}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
            Rolling
          </span>
          {ADMIN_RANGE_PRESET_OPTIONS.map((days) => {
            const selected = days === selectedPresetDays;
            return (
              <Link
                key={days}
                href={buildUserDetailHref({ userId, days })}
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
            href={buildUserDetailHref({ userId, month: currentUtcBillingMonth() })}
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Current month
          </Link>
        </div>

        <form method="GET" className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
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

function planPillClass(planId: string) {
  if (planId === "lifetime") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (planId === "normal") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (planId === "usage") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (planId === "business") return "bg-violet-50 text-violet-700 ring-violet-200";
  if (planId === "pro") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function subscriptionStatusLabel(status: string | null | undefined) {
  if (!status) return "free";
  return status;
}

function dailyCreditBuckets(logs: Array<{ created_at: string | null; total_tokens?: number | null; model_used?: string | null }>) {
  const map = new Map<string, number>();
  for (const log of logs) {
    if (!log.created_at) continue;
    const day = log.created_at.slice(0, 10);
    map.set(day, (map.get(day) || 0) + billingCreditsForTokenCount(log.total_tokens, log.model_used));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, tokens]) => ({ date, tokens }));
}

function modelCreditShares(logs: Array<{ total_tokens?: number | null; model_used?: string | null }>) {
  const map = new Map<string, number>();
  for (const log of logs) {
    const model = log.model_used?.trim() || "unknown";
    map.set(model, (map.get(model) || 0) + billingCreditsForTokenCount(log.total_tokens, log.model_used));
  }
  return [...map.entries()]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

const TOKEN_MILLION = 1_000_000;

function formatTokenMillions(value: number | null | undefined) {
  const safeValue = Math.max(0, Number(value || 0));
  const millions = safeValue / TOKEN_MILLION;
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: millions > 0 && millions < 0.01 ? 3 : 2,
  }).format(millions)}M`;
}

function formatPercent(value: number) {
  const safeValue = Math.max(0, Math.min(100, value));
  const decimals = safeValue > 0 && safeValue < 10 ? 1 : 0;
  return `${safeValue.toFixed(decimals)}%`;
}

function TokenAllowanceBar({
  title,
  remaining,
  total,
  used,
  caption,
  tone,
}: {
  title: string;
  remaining: number | null;
  total: number | null;
  used: number;
  caption: string;
  tone: "slate" | "emerald";
}) {
  const isUnlimited = total == null || total < 0 || remaining == null;
  const safeTotal = Math.max(0, Number(total || 0));
  const safeRemaining = isUnlimited ? safeTotal : Math.max(0, Number(remaining || 0));
  const percent = isUnlimited ? 100 : safeTotal > 0 ? Math.min(100, (safeRemaining / safeTotal) * 100) : 0;
  const barClassName = tone === "emerald" ? "bg-emerald-500" : "bg-slate-950";
  const trackClassName = tone === "emerald" ? "bg-emerald-50" : "bg-slate-100";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        <div className="font-mono text-xs font-semibold text-slate-900">
          {isUnlimited ? "Unlimited" : formatPercent(percent)}
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <div className="font-mono text-lg font-semibold text-slate-950">
          {isUnlimited ? "Unlimited" : `${formatTokenMillions(safeRemaining)} / ${formatTokenMillions(safeTotal)}`}
        </div>
        <div className="font-mono text-xs text-slate-500">used {formatTokenMillions(used)}</div>
      </div>
      <div
        className={`mt-3 h-1.5 overflow-hidden rounded-full ${trackClassName}`}
        aria-label={`${title}: ${isUnlimited ? "Unlimited" : `${formatPercent(percent)} remaining`}`}
        role="img"
      >
        <div className={`h-full rounded-full ${barClassName}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 text-xs text-slate-500">{caption}</div>
    </div>
  );
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};
  const month = asText(sp.month);
  const days = asNumber(sp.days);
  const startDate = asText(sp.startDate);
  const endDate = asText(sp.endDate);
  const range =
    month || days || (startDate && endDate)
      ? buildAdminTimeRange({ month, days, startDate, endDate })
      : buildCurrentBillingMonthRange();
  const snapshot = await loadAdminUserDetailSnapshot(id, range);
  const notice = asText(sp.notice);
  const err = asText(sp.err);

  if (!snapshot) {
    return (
      <div className="space-y-6">
        <Link
          href="/users"
          className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </Link>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          User not found.
        </div>
      </div>
    );
  }

  const { summary } = snapshot;
  const paymentCurrency =
    summary.effectiveSubscription?.currency || summary.planConfig.currency || "usd";
  const returnTo = `/users/${summary.user.id}`;
  const displayPlan = summary.lifetimeFree ? "lifetime" : summary.effectivePlan;
  const displaySubscription = summary.lifetimeFree
    ? "lifetime_free"
    : subscriptionStatusLabel(summary.effectiveSubscription?.status);
  const planQuotaTotal = summary.planConfig.includedCredits < 0 ? null : summary.planConfig.includedCredits;
  const planQuotaRemaining = summary.planUsage.remainingIncluded;
  const prepaidTotal = summary.tokenLedger.purchased;
  const prepaidRemaining = summary.tokenLedger.available;
  const dailyCredits = dailyCreditBuckets(snapshot.usageLogs);
  const modelCreditMix = modelCreditShares(snapshot.usageLogs);
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/users"
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Users
        </Link>
        <Link
          href={buildUsageBoardHref({ userId: summary.user.id, range })}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Open Usage Board
        </Link>
      </div>

      <AdminPageHeader
        eyebrow="User Control Center"
        title={summary.label}
        description="Single place for identity, billing controls, usage visibility, and destructive user operations."
      />

      <UserTimeRangeControls userId={summary.user.id} range={range} />

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          {notice}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {err}
        </div>
      ) : null}
      {snapshot.warnings.map((warning) => (
        <div
          key={warning}
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          {warning}
        </div>
      ))}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AdminMetricCard
          label="Images"
          value={summary.usage.images.toLocaleString("en-US")}
          description="Images processed across tracked usage_logs for this user."
          icon={<UserRound className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Raw Tokens"
          value={summary.usage.tokens.toLocaleString("en-US")}
          description="Prompt + completion token footprint kept for OpenAI usage audit."
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Billable Credits"
          value={summary.planUsage.used.toLocaleString("en-US")}
          description="Ordinary quota usage after model multipliers: gpt-5-mini 1x and gpt-5 5x. gpt-5.5 uses the separate Pro expert pool."
          icon={<CreditCard className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Estimated Cost"
          value={`$${summary.usage.costUsd.toFixed(2)}`}
          description="Usage-based estimate using the internal token pricing table."
          icon={<CreditCard className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Current Plan"
          value={summary.planConfig.displayName}
          description={`Used ${summary.planUsage.used.toLocaleString("en-US")} ${summary.planConfig.overageUnitName} this period.`}
          icon={<CreditCard className="h-5 w-5" />}
        />
      </div>

      <AdminUsageCharts
        daily={dailyCredits}
        modelShares={modelCreditMix}
        trendTitle="Billable Credit Trend"
        modelTitle="Model Credit Mix"
      />

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-100 bg-white">
            <CardTitle className="text-lg text-slate-950">Identity & Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-5 pt-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-medium text-slate-900">{summary.label}</div>
              <div className="mt-2 break-all text-sm text-slate-600">{summary.user.email || "-"}</div>
              <div className="mt-2 font-mono text-xs text-slate-400">{summary.user.id}</div>
              <div className="mt-3 text-xs text-slate-500">
                Created {summary.user.created_at ? new Date(summary.user.created_at).toLocaleString("en-US") : "-"}
              </div>
            </div>

            <VizIdentityBadges isRegisteredUser={true} isAdmin={summary.isAdmin} />

            <div className="grid gap-3">
              {!summary.isAdmin ? (
                <form action={grantAdminFromUserPageAction} className="grid gap-2">
                  <input type="hidden" name="userId" value={summary.user.id} />
                  <input type="hidden" name="email" value={summary.user.email || ""} />
                  <button
                    type="submit"
                    className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Grant Admin Access
                  </button>
                </form>
              ) : (
                <form action={revokeAdminFromUserPageAction} className="grid gap-2">
                  <input type="hidden" name="userId" value={summary.user.id} />
                  <input type="hidden" name="label" value={summary.label} />
                  <button
                    type="submit"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Revoke Admin Access
                  </button>
                </form>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Account State</div>
              <div className="mt-3 text-sm text-slate-700">
                Suspended: {summary.isSuspended ? "Yes" : "No"}
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Last seen: {summary.usage.lastSeenAt ? new Date(summary.usage.lastSeenAt).toLocaleString("en-US") : "-"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-100 bg-white">
            <CardTitle className="text-lg text-slate-950">Billing Control Center</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 p-5 pt-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plan</div>
                <div className="mt-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ring-1 ${planPillClass(displayPlan)}`}
                  >
                    {displayPlan}
                  </span>
                </div>
                <div className="mt-3 text-sm text-slate-700">{summary.planConfig.displayName}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</div>
                <div className="mt-3 text-sm font-medium text-slate-900">
                  {billingSourceLabel(summary.effectiveSubscription)}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {summary.lifetimeFree
                    ? "Lifetime free entitlement is active for this account."
                    : isAdminOverrideSubscription(summary.effectiveSubscription)
                    ? "Internal admin override is currently active."
                    : "Effective plan is coming from the real Stripe subscription state."}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subscription</div>
                <div className="mt-3 text-sm font-medium text-slate-900">
                  {displaySubscription}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Payment: {paymentStatusLabel(summary.effectiveSubscription?.latest_invoice_status)}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Period</div>
                <div className="mt-3 text-sm font-medium text-slate-900">
                  {summary.planUsage.used.toLocaleString("en-US")} used
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Estimated overage {formatMoney(summary.planUsage.estimatedOverageCents, paymentCurrency)}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <TokenAllowanceBar
                title="Plan quota remaining"
                remaining={planQuotaRemaining}
                total={planQuotaTotal}
                used={summary.planUsage.used}
                caption={`${summary.planConfig.displayName} monthly allowance, shown for the selected usage window.`}
                tone="slate"
              />
              <TokenAllowanceBar
                title="Prepaid credits remaining"
                remaining={prepaidRemaining}
                total={prepaidTotal}
                used={summary.tokenLedger.consumed}
                caption="One-time purchased AI credits. This balance carries until consumed."
                tone="emerald"
              />
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Admin Billing Entitlements</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    Use these controls for account-level exceptions. They change OrSight access rules directly without
                    deleting historical usage logs, so accounting stays auditable.
                  </p>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  Free quota: 1M credits/month
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lifetime Free</div>
                  <div className="mt-2 text-sm font-medium text-slate-900">
                    {summary.lifetimeFree ? "Active" : "Inactive"}
                  </div>
                  <p className="mt-2 min-h-12 text-xs leading-5 text-slate-500">
                    Active accounts bypass credit quota limits for internal exceptions.
                  </p>
                  <form action={setLifetimeFreeFromUserPageAction} className="mt-3">
                    <input type="hidden" name="userId" value={summary.user.id} />
                    <input type="hidden" name="label" value={summary.label} />
                    <input type="hidden" name="active" value={summary.lifetimeFree ? "0" : "1"} />
                    <button
                      type="submit"
                      className={
                        summary.lifetimeFree
                          ? "w-full rounded-2xl border border-rose-300 bg-white px-4 py-3 text-sm font-medium text-rose-800 hover:bg-rose-50"
                          : "w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                      }
                    >
                      {summary.lifetimeFree ? "Revoke Lifetime Free" : "Grant Lifetime Free"}
                    </button>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Free Credit Quota</div>
                  <div className="mt-2 text-sm font-medium text-slate-900">1M credits/month</div>
                  <p className="mt-2 min-h-12 text-xs leading-5 text-slate-500">
                    Free accounts are blocked when the current UTC month reaches the credit quota. gpt-5-mini uses 1x,
                    gpt-5 uses 5x, and gpt-5.5 is Pro-only for expert tasks.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr_0.8fr]">
              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-base font-semibold text-slate-900">Internal Plan Override</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Change the effective plan inside OrSight without touching the user&apos;s real Stripe subscription.
                </p>

                <form action={setBillingOverrideAction} className="mt-4 space-y-3">
                  <input type="hidden" name="ownerId" value={summary.user.id} />
                  <input type="hidden" name="label" value={summary.label} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <select
                    name="plan"
                    defaultValue={isAdminOverrideSubscription(summary.effectiveSubscription) ? summary.effectivePlan : "free"}
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  >
                    {snapshot.planConfigs.map((plan) => (
                      <option key={plan.planId} value={plan.planId}>
                        {plan.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Save Internal Override
                  </button>
                </form>

                <form action={clearBillingOverrideAction} className="mt-3">
                  <input type="hidden" name="ownerId" value={summary.user.id} />
                  <input type="hidden" name="label" value={summary.label} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button
                    type="submit"
                    disabled={!isAdminOverrideSubscription(summary.effectiveSubscription)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clear Internal Override
                  </button>
                </form>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-base font-semibold text-slate-900">Real Stripe Subscription</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Manage the user&apos;s real paid subscription. Prepaid Usage Credits are one-time checkout purchases, not a subscription plan.
                </p>

                {summary.realStripeSubscription?.stripe_subscription_id ? (
                  <>
                    <form action={changeStripePlanAction} className="mt-4 space-y-3">
                      <input type="hidden" name="ownerId" value={summary.user.id} />
                      <input type="hidden" name="label" value={summary.label} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <select
                        name="plan"
                        defaultValue={summary.realStripeSubscription?.plan === "pro" ? "pro" : "normal"}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                      >
                        {snapshot.planConfigs
                          .filter((plan) => plan.planId === "normal" || plan.planId === "pro")
                          .map((plan) => (
                            <option key={plan.planId} value={plan.planId}>
                              {plan.displayName}
                            </option>
                          ))}
                      </select>
                      <button
                        type="submit"
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Change Stripe Plan
                      </button>
                    </form>

                    <form action={setStripeCancelAtPeriodEndAction} className="mt-3">
                      <input type="hidden" name="ownerId" value={summary.user.id} />
                      <input type="hidden" name="label" value={summary.label} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <input
                        type="hidden"
                        name="cancelAtPeriodEnd"
                        value={summary.realStripeSubscription.cancel_at_period_end ? "0" : "1"}
                      />
                      <button
                        type="submit"
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {summary.realStripeSubscription.cancel_at_period_end
                          ? "Resume Auto-Renew"
                          : "Cancel At Period End"}
                      </button>
                    </form>

                    <form action={cancelStripeSubscriptionNowFromUserPageAction} className="mt-3">
                      <input type="hidden" name="userId" value={summary.user.id} />
                      <input type="hidden" name="label" value={summary.label} />
                      <button
                        type="submit"
                        className="w-full rounded-2xl border border-rose-300 bg-white px-4 py-3 text-sm font-medium text-rose-800 hover:bg-rose-50"
                      >
                        Cancel Subscription Now
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    This user does not currently have a real Stripe subscription.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-base font-semibold text-slate-900">Stripe Identifiers</h3>
                <div className="mt-4 space-y-4 text-sm text-slate-700">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</div>
                    <div className="mt-1 break-all font-mono text-xs text-slate-900">
                      {shortId(summary.effectiveSubscription?.stripe_customer_id)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subscription</div>
                    <div className="mt-1 break-all font-mono text-xs text-slate-900">
                      {shortId(summary.realStripeSubscription?.stripe_subscription_id)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest Invoice</div>
                    <div className="mt-1 break-all font-mono text-xs text-slate-900">
                      {shortId(summary.effectiveSubscription?.latest_invoice_id)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice Summary</div>
                    <div className="mt-1 text-sm text-slate-700">
                      Paid {formatMoney(summary.effectiveSubscription?.latest_invoice_amount_paid, paymentCurrency)}
                    </div>
                    <div className="mt-1 text-sm text-slate-700">
                      Remaining{" "}
                      {formatMoney(summary.effectiveSubscription?.latest_invoice_amount_remaining, paymentCurrency)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-white">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg text-slate-950">Recent Usage Events</CardTitle>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Reset this user&apos;s usage for manual billing tests without changing the account or plan.
              </p>
            </div>
            <form action={clearUserUsageRecordsFromUserPageAction}>
              <input type="hidden" name="userId" value={summary.user.id} />
              <input type="hidden" name="label" value={summary.label} />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" />
                Clear Usage Records
              </button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Model</th>
                  <th className="px-5 py-3 font-medium text-right">Images</th>
                  <th className="px-5 py-3 font-medium text-right">Requests</th>
                  <th className="px-5 py-3 font-medium text-right">Prompt</th>
                  <th className="px-5 py-3 font-medium text-right">Completion</th>
                  <th className="px-5 py-3 font-medium text-right">Raw Total</th>
                  <th className="px-5 py-3 font-medium text-right">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.usageLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 text-slate-600">
                      {log.created_at ? new Date(log.created_at).toLocaleString("en-US") : "-"}
                    </td>
                    <td className="px-5 py-4 font-medium text-slate-900">{log.action_type || "-"}</td>
                    <td className="px-5 py-4 text-slate-600">{log.model_used || "-"}</td>
                    <td className="px-5 py-4 text-right text-slate-700">
                      {(log.image_count || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-700">
                      {(log.request_count || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-700">
                      {(log.prompt_tokens || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-700">
                      {(log.completion_tokens || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-slate-900">
                      {(log.total_tokens || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-slate-900">
                      {billingCreditsForTokenCount(log.total_tokens, log.model_used).toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
                {snapshot.usageLogs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-center text-sm text-slate-500">
                      No usage events found for this user.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-rose-200">
        <CardHeader className="border-b border-rose-100 bg-rose-50/60">
          <CardTitle className="flex items-center gap-2 text-lg text-rose-900">
            <Trash2 className="h-5 w-5" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 pt-5 xl:grid-cols-[1fr_420px] xl:items-start">
          <div className="max-w-3xl text-sm leading-6 text-rose-900">
            Move this user into the recycle bin. Login is disabled immediately, admin access is removed, and usage logs
            are retained for 30 days so billing and usage remain auditable. The recycle bin can restore login or delete
            the user permanently.
          </div>
          <form action={deleteUserFromUserPageAction} className="grid gap-3 rounded-2xl border border-rose-200 bg-white p-4">
            <input type="hidden" name="userId" value={summary.user.id} />
            <input type="hidden" name="label" value={summary.label} />
            <label className="grid gap-1.5 text-xs font-medium text-rose-900">
              Current admin password
              <input
                name="adminPassword"
                type="password"
                autoComplete="current-password"
                required
                className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300 bg-white px-4 py-3 text-sm font-medium text-rose-800 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Move User to Recycle Bin
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
