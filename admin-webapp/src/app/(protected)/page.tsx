import Link from "next/link";
import { ArrowRight, BarChart3, CreditCard, ShieldCheck, Users, Wallet } from "lucide-react";

import { AdminMetricCard } from "@/components/AdminMetricCard";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { AdminUsageCharts } from "@/components/AdminUsageCharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/billing-admin";
import { loadAdminDashboardSnapshot } from "@/lib/admin-data";

export default async function DashboardPage() {
  const snapshot = await loadAdminDashboardSnapshot();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Dashboard"
        description="Fresh backend control surface for high-level system health, user growth, billing posture, and recent AI usage."
        actions={
          <>
            <Link
              href="/users"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Manage Users
            </Link>
            <Link
              href="/usage-board"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-slate-800"
            >
              Open Usage Board
            </Link>
          </>
        }
      />

      {snapshot.warnings.map((warning) => (
        <div
          key={warning}
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-950"
        >
          {warning}
        </div>
      ))}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AdminMetricCard
          label="Registered Users"
          value={snapshot.totals.totalUsers.toLocaleString("en-US")}
          description="All auth users surfaced in the admin data layer."
          icon={<Users className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Admin Accounts"
          value={snapshot.totals.adminUsers.toLocaleString("en-US")}
          description="Users currently marked as admin inside public.admin_users."
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Paid Plans"
          value={snapshot.totals.paidUsers.toLocaleString("en-US")}
          description="Accounts whose effective internal plan is not Free."
          icon={<CreditCard className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Live Subscriptions"
          value={snapshot.totals.liveSubscriptions.toLocaleString("en-US")}
          description="Real Stripe subscriptions currently in an active or trialing state."
          icon={<BarChart3 className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Projected Revenue"
          value={formatMoney(snapshot.totals.projectedMonthlyRevenueCents)}
          description="Monthly base fees plus current-period overage estimate across effective plans."
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      <AdminUsageCharts daily={snapshot.dailyTokens} modelShares={snapshot.modelShares} />

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200">
          <CardHeader className="border-b border-slate-100 bg-white">
            <CardTitle className="text-base text-slate-950">Most Active Accounts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium text-right">Images</th>
                    <th className="px-4 py-3 font-medium text-right">Tokens</th>
                    <th className="px-4 py-3 font-medium text-right">Estimated Cost</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
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
                        ${entry.usage.costUsd.toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700">{entry.planConfig.displayName}</td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/users/${entry.user.id}`}
                          className="inline-flex items-center gap-2 text-[13px] font-medium text-blue-700 hover:text-blue-900"
                        >
                          View
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {snapshot.topUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                        No usage records yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-slate-200">
            <CardHeader className="border-b border-slate-100 bg-white">
              <CardTitle className="text-base text-slate-950">Plan Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-4">
              {snapshot.planBreakdown.map((entry) => (
                <div
                  key={entry.planId}
                  className="flex items-center justify-between rounded-[16px] border border-slate-200 bg-slate-50 px-3.5 py-3"
                >
                  <div>
                    <div className="text-[13px] font-medium uppercase tracking-wide text-slate-900">{entry.planId}</div>
                    <div className="mt-1 text-xs text-slate-500">Effective internal plan assignment</div>
                  </div>
                  <div className="text-[1.65rem] font-semibold text-slate-950">
                    {entry.count.toLocaleString("en-US")}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="border-b border-slate-100 bg-white">
              <CardTitle className="text-base text-slate-950">Newest Accounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-4">
              {snapshot.newestUsers.map((entry) => (
                <div
                  key={entry.user.id}
                  className="rounded-[16px] border border-slate-200 bg-white px-3.5 py-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{entry.label}</div>
                      <div className="mt-1 break-all text-xs text-slate-500">
                        {entry.user.email || entry.user.id}
                      </div>
                    </div>
                    <Link
                      href={`/users/${entry.user.id}`}
                      className="shrink-0 text-[13px] font-medium text-blue-700 hover:text-blue-900"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              ))}
              {snapshot.newestUsers.length === 0 ? (
                <p className="text-sm text-slate-500">No users available yet.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
