import { KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";

import { AdminMetricCard } from "@/components/AdminMetricCard";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listAdminAccounts } from "@/lib/admin-account-store";
import { requireAdminActor } from "@/lib/viz-admin-verify";

import { changeAdminPasswordAction, updateAdminProfileAction } from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;

function asText(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const actor = await requireAdminActor("/account");
  const accounts = await listAdminAccounts();
  const currentAccount = accounts.find((account) => account.id === actor.id) || actor;
  const sp = searchParams ? await searchParams : {};
  const notice = asText(sp.notice);
  const err = asText(sp.err);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Admin Account"
        description="Manage the current admin identity, rotate the admin password, and sign out from the console."
        actions={
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-[13px] font-medium text-rose-700 shadow-sm hover:bg-rose-100"
            >
              Sign Out
            </button>
          </form>
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="Current Admin"
          value={currentAccount.displayName}
          description={`Signed in as ${currentAccount.identifier}.`}
          icon={<UserRound className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Admin Login"
          value={currentAccount.identifier}
          description="This login name is required to enter the admin console."
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Directory Size"
          value={accounts.length.toLocaleString("en-US")}
          description="The local admin directory is ready to hold multiple admin accounts."
          icon={<KeyRound className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Contact Email"
          value={currentAccount.email || "-"}
          description="Optional email stored with this admin identity."
          icon={<Mail className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Created</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{formatDate(currentAccount.createdAt)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Password Changed
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {formatDate(currentAccount.passwordChangedAt)}
                </p>
              </div>
            </div>

            <form action={updateAdminProfileAction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Display Name</label>
                <input
                  name="displayName"
                  type="text"
                  required
                  defaultValue={currentAccount.displayName}
                  className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Login Name</label>
                <p className="mt-0.5 text-xs text-slate-500">
                  Used on the login screen. Allowed characters: letters, numbers, dot, dash, underscore, and @.
                </p>
                <input
                  name="identifier"
                  type="text"
                  required
                  defaultValue={currentAccount.identifier}
                  className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Email</label>
                <input
                  name="email"
                  type="email"
                  defaultValue={currentAccount.email || ""}
                  className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">
              Update the password used for the current admin login. Existing sessions are rotated when the password changes.
            </p>

            <form action={changeAdminPasswordAction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Current Password</label>
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">New Password</label>
                <input
                  name="nextPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">Confirm New Password</label>
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                >
                  Update Password
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Admin Directory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-slate-600">
            The login system now keeps a local admin directory, so this console can grow beyond a single hard-coded administrator.
          </p>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Login</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {accounts.map((account) => {
                  const isCurrent = account.id === actor.id;
                  return (
                    <tr key={account.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{account.displayName}</span>
                          {isCurrent ? (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                              Current
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{account.identifier}</td>
                      <td className="px-4 py-3 text-slate-700">{account.email || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(account.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
