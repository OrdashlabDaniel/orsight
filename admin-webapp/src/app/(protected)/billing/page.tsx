import Link from "next/link";
import { CreditCard, Database, Gauge, ShieldCheck } from "lucide-react";

import { AdminMetricCard } from "@/components/AdminMetricCard";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  billingSourceLabel,
  formatMoney,
  paymentStatusLabel,
} from "@/lib/billing-admin";
import { loadAdminBillingSnapshot } from "@/lib/admin-data";

import { savePlanConfigAction, syncPlanToStripeAction } from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;

function asText(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function planPillClass(planId: string) {
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

function intEnv(name: string, fallback: number) {
  const parsed = Number.parseInt((process.env[name] || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const snapshot = await loadAdminBillingSnapshot();
  const usageCreditPacks = [
    {
      label: "$3",
      tokenEnv: "BILLING_USAGE_CREDIT_30K_TOKENS",
      priceEnv: "BILLING_USAGE_CREDIT_30K_PRICE_CENTS",
      stripeEnv: "STRIPE_PRICE_USAGE_CREDIT_30K",
      fallbackTokens: 3_000_000,
      fallbackPriceCents: 300,
    },
  ].map((pack) => ({
    ...pack,
    tokens: intEnv(pack.tokenEnv, pack.fallbackTokens),
    priceCents: intEnv(pack.priceEnv, pack.fallbackPriceCents),
    stripePriceId: (process.env[pack.stripeEnv] || "").trim(),
  }));
  const sp = searchParams ? await searchParams : {};
  const notice = asText(sp.notice);
  const err = asText(sp.err);
  const focus = asText(sp.focus);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Billing"
        description="Billing catalog is Free, Normal, Pro, and prepaid Usage Credits. Free stops at 1M ordinary credits, Normal stops at 30M, Pro stops at 100M plus a separate gpt-5.5 expert pool, and $3 buys 3M prepaid ordinary credits."
        actions={
          <Link
            href="/users"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Go to Users
          </Link>
        }
      />

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-950">
          {notice}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-900">
          {err}
        </div>
      ) : null}
      {snapshot.warnings.map((warning) => (
        <div
          key={warning}
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-950"
        >
          {warning}
        </div>
      ))}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Paid Accounts"
          value={snapshot.totals.paidUsers.toLocaleString("en-US")}
          description="Users whose effective plan is not Free."
          icon={<CreditCard className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Live Stripe Subs"
          value={snapshot.totals.liveSubscriptions.toLocaleString("en-US")}
          description="Real Stripe subscriptions in active or trialing state."
          icon={<Gauge className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Admin Overrides"
          value={snapshot.totals.adminOverrides.toLocaleString("en-US")}
          description="Accounts currently running on internal admin plan overrides."
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Projected Revenue"
          value={formatMoney(snapshot.totals.projectedMonthlyRevenueCents)}
          description="Current monthly subscription revenue across effective plans."
          icon={<Database className="h-5 w-5" />}
        />
      </div>

      <Card className="border-emerald-100 bg-emerald-50/40">
        <CardHeader className="border-b border-emerald-100 bg-white/70">
          <CardTitle className="text-base text-slate-950">Prepaid Usage Credits</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-4">
          {usageCreditPacks.map((pack) => (
            <div key={pack.stripeEnv} className="rounded-2xl border border-emerald-100 bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{pack.label} pack</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {pack.tokens.toLocaleString("en-US")} credits
                  </div>
                </div>
                <div className="text-sm font-semibold text-emerald-700">{formatMoney(pack.priceCents)}</div>
              </div>
              <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Stripe price id</div>
              <div className="mt-1 break-all font-mono text-xs text-slate-700">
                {pack.stripePriceId || `Missing ${pack.stripeEnv}`}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-white">
          <CardTitle className="text-base text-slate-950">Plan Catalog</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 pt-4 xl:grid-cols-3">
          {snapshot.planConfigs.map((config) => (
            <div key={config.planId} className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-950">{config.displayName}</div>
                  <div className="mt-1 text-[13px] text-slate-500">{config.description || "No description."}</div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ring-1 ${planPillClass(config.planId)}`}
                >
                  {config.planId}
                </span>
              </div>

              <form action={savePlanConfigAction} className="mt-4 space-y-3">
                <input type="hidden" name="planId" value={config.planId} />

                <div>
                  <label className="text-xs font-medium text-slate-600">Display Name</label>
                  <input
                    name="displayName"
                    defaultValue={config.displayName}
                    className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-600">Description</label>
                  <textarea
                    name="description"
                    defaultValue={config.description}
                    rows={2}
                    className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600">Billing Model</label>
                    <select
                      name="billingModel"
                      defaultValue={config.billingModel}
                      className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="free_quota">Free quota</option>
                      <option value="monthly_quota">Monthly quota</option>
                      <option value="monthly_plus_usage">Monthly + metered usage</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Currency</label>
                    <input
                      name="currency"
                      defaultValue={config.currency}
                      className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm uppercase text-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600">Base fee (cents)</label>
                    <input
                      name="monthlyBaseCents"
                      type="number"
                      min="0"
                      defaultValue={config.monthlyBaseCents}
                      className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Monthly credit quota</label>
                    <input
                      name="includedCredits"
                      type="number"
                      min="0"
                      defaultValue={config.includedCredits}
                      className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600">Overage unit</label>
                    <input
                      name="overageUnitName"
                      defaultValue={config.overageUnitName}
                      className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Overage unit (cents)</label>
                    <input
                      name="overageUnitCents"
                      type="number"
                      min="0"
                      defaultValue={config.overageUnitCents}
                      className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600">Sort order</label>
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={config.sortOrder}
                      className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Meter event name</label>
                    <input
                      name="stripeMeterEventName"
                      defaultValue={config.stripeMeterEventName || ""}
                      placeholder="orsight_usage"
                      className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" name="isPublic" value="1" defaultChecked={config.isPublic} />
                    Public
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" name="isActive" value="1" defaultChecked={config.isActive} />
                    Active
                  </label>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                  <div>Base product: {config.stripeBaseProductId || "-"}</div>
                  <div className="mt-1">Base price: {config.stripeBasePriceId || "-"}</div>
                  <div className="mt-1">Usage product: {config.stripeUsageProductId || "-"}</div>
                  <div className="mt-1">Usage price: {config.stripeUsagePriceId || "-"}</div>
                  <div className="mt-1">Meter: {config.stripeMeterEventName || "-"}</div>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Save Plan Config
                </button>
              </form>

              {config.planId !== "free" ? (
                <form action={syncPlanToStripeAction} className="mt-3">
                  <input type="hidden" name="planId" value={config.planId} />
                  <button
                    type="submit"
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Sync Assets To Stripe
                  </button>
                </form>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-white">
          <CardTitle className="text-lg text-slate-950">Subscription Audit</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Source</th>
                  <th className="px-5 py-3 font-medium">Subscription</th>
                  <th className="px-5 py-3 font-medium">Payment</th>
                  <th className="px-5 py-3 font-medium">Quota Used</th>
                  <th className="px-5 py-3 font-medium text-right">Monthly Value</th>
                  <th className="px-5 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.users.map((entry) => (
                  <tr
                    key={entry.user.id}
                    className={`${focus === entry.user.id ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-5 py-4">
                      <div className="font-medium text-slate-900">{entry.label}</div>
                      <div className="mt-1 break-all text-xs text-slate-500">{entry.user.email || entry.user.id}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ring-1 ${planPillClass(entry.effectivePlan)}`}
                      >
                        {entry.effectivePlan}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{billingSourceLabel(entry.effectiveSubscription)}</td>
                    <td className="px-5 py-4 text-slate-600">
                      {subscriptionStatusLabel(entry.effectiveSubscription?.status)}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {paymentStatusLabel(entry.effectiveSubscription?.latest_invoice_status)}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {entry.planUsage.used.toLocaleString("en-US")} /{" "}
                      {entry.planConfig.includedCredits.toLocaleString("en-US")} {entry.planConfig.overageUnitName}
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-slate-900">
                      {formatMoney(
                        entry.planConfig.monthlyBaseCents + entry.planUsage.estimatedOverageCents,
                        entry.planConfig.currency,
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/users/${entry.user.id}`}
                        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open User
                      </Link>
                    </td>
                  </tr>
                ))}
                {snapshot.users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-500">
                      No billing rows available.
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
