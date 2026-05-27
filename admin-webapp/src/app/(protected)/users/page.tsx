import Link from "next/link";
import { Shield, Trash2, UserCheck, Users, Wallet } from "lucide-react";

import { AdminMetricCard } from "@/components/AdminMetricCard";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadAdminUsersSnapshot } from "@/lib/admin-data";

type SearchParams = Record<string, string | string[] | undefined>;

function asText(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function planPillClass(planId: string) {
  if (planId === "lifetime") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (planId === "normal") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (planId === "usage") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (planId === "business") return "bg-violet-50 text-violet-700 ring-violet-200";
  if (planId === "pro") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function statusLabel(isSuspended: boolean) {
  return isSuspended ? "Suspended" : "Active";
}

function statusClass(isSuspended: boolean) {
  return isSuspended
    ? "bg-amber-50 text-amber-800 ring-amber-200"
    : "bg-emerald-50 text-emerald-700 ring-emerald-200";
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const snapshot = await loadAdminUsersSnapshot();
  const sp = searchParams ? await searchParams : {};
  const ok = asText(sp.ok);
  const notice = asText(sp.notice);
  const err = asText(sp.err);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Users"
        description="Clean user management surface for identity, plan posture, usage footprint, and entry into each account's control center."
        actions={
          <Link
            href="/users/recycle"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Trash2 className="h-4 w-4" />
            Recycle Bin
          </Link>
        }
      />

      {ok ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-950">
          User moved to recycle bin: {ok}
        </div>
      ) : null}
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
          label="Total Users"
          value={snapshot.totals.totalUsers.toLocaleString("en-US")}
          description="Every user visible through the admin RPC layer."
          icon={<Users className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Admins"
          value={snapshot.totals.adminUsers.toLocaleString("en-US")}
          description="Accounts currently granted admin privileges inside public.admin_users."
          icon={<Shield className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Paid Plans"
          value={snapshot.totals.paidUsers.toLocaleString("en-US")}
          description="Users whose effective internal plan is not Free."
          icon={<Wallet className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Suspended"
          value={snapshot.totals.suspendedUsers.toLocaleString("en-US")}
          description="Accounts currently banned or marked deleted in auth metadata."
          icon={<UserCheck className="h-5 w-5" />}
        />
      </div>

      <Card className="border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-white">
          <CardTitle className="text-base text-slate-950">User Directory</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-[13px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium text-right">Images</th>
                  <th className="px-4 py-3 font-medium text-right">Tokens</th>
                  <th className="px-4 py-3 font-medium text-right">Estimated Cost</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Subscription</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshot.users.map((entry) => (
                  <tr key={entry.user.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900">{entry.label}</div>
                      <div className="mt-1 break-all text-xs text-slate-500">{entry.user.email || entry.user.id}</div>
                      <div className="mt-1 font-mono text-[11px] text-slate-400">{entry.user.id}</div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {entry.user.created_at ? new Date(entry.user.created_at).toLocaleString("en-US") : "-"}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${statusClass(entry.isSuspended)}`}
                      >
                        {statusLabel(entry.isSuspended)}
                      </span>
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
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ring-1 ${planPillClass(entry.lifetimeFree ? "lifetime" : entry.effectivePlan)}`}
                      >
                        {entry.lifetimeFree ? "lifetime" : entry.effectivePlan}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {entry.lifetimeFree ? "lifetime_free" : entry.effectiveSubscription?.status || "free"}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {entry.isAdmin ? "Admin" : "User"}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link
                        href={`/users/${entry.user.id}`}
                        className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open Control Center
                      </Link>
                    </td>
                  </tr>
                ))}
                {snapshot.users.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                      No users are available.
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
