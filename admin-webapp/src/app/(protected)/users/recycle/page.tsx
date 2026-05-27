import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { unstable_noStore as noStore } from "next/cache";

import { AdminMetricCard } from "@/components/AdminMetricCard";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";
import { deleteRecycledUser, listRecycledUsers } from "@/lib/viz-recycle-store";
import { createServiceRoleClient } from "@/lib/supabase/service";

import { UserRecycleBinClient } from "./UserRecycleBinClient";

export const metadata = {
  title: "User Recycle Bin - OrSight Admin",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type RecycleRow = {
  id: string;
  email: string | null;
  deleted_at: string;
  purge_at: string;
  deleted_by_email: string | null;
  auth_exists: boolean;
  auth_email: string | null;
};

function asText(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function dueCount(rows: RecycleRow[]) {
  const now = Date.now();
  return rows.filter((row) => {
    const ts = new Date(row.purge_at).getTime();
    return Number.isFinite(ts) && ts <= now;
  }).length;
}

function restoreAvailableCount(rows: RecycleRow[]) {
  return rows.length;
}

function userLabel(user: User, fallback: string | null) {
  const metadata = user.user_metadata ?? {};
  const podUsername = typeof metadata.pod_username === "string" ? metadata.pod_username.trim() : "";
  return podUsername || user.email || fallback || user.id;
}

export default async function UserRecycleBinPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  noStore();

  const sp = searchParams ? await searchParams : {};
  const notice = asText(sp.notice);
  const err = asText(sp.err);
  const sb = createServiceRoleClient();

  let rows: RecycleRow[] = [];
  let loadError: string | null = null;
  let purgedCount = 0;

  try {
    purgedCount = await purgeExpiredRecycledUsers(sb);
    const recycledRows = await listRecycledUsers(sb);
    const validRows: RecycleRow[] = [];

    for (const row of recycledRows) {
      const { data, error } = await sb.auth.admin.getUserById(row.id);
      if (error || !data.user) {
        await deleteRecycledUser(sb, row.id).catch(() => {});
        purgedCount += 1;
        continue;
      }
      validRows.push({
        ...row,
        email: userLabel(data.user, row.email),
        auth_exists: true,
        auth_email: data.user.email ?? null,
      });
    }

    rows = validRows.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Could not load recycle bin.";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/users"
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Users
        </Link>
      </div>

      <AdminPageHeader
        eyebrow="User Control Center"
        title="User Recycle Bin"
        description="Deleted users are disabled immediately and kept here for 30 days. Restore login while retained, or permanently remove the auth user and retained usage logs. Records whose auth user no longer exists are cleaned automatically."
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
      {purgedCount > 0 ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-950">
          Automatically cleaned {purgedCount.toLocaleString("en-US")} expired or invalid recycled user
          {purgedCount === 1 ? "" : "s"}.
        </div>
      ) : null}
      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-900">
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <AdminMetricCard
          label="In Recycle Bin"
          value={rows.length.toLocaleString("en-US")}
          description="Users currently disabled and waiting for restore or permanent deletion."
          icon={<Trash2 className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Due For Purge"
          value={dueCount(rows).toLocaleString("en-US")}
          description="Rows whose 30-day retention window has expired and will be removed automatically."
          icon={<Trash2 className="h-5 w-5" />}
        />
        <AdminMetricCard
          label="Restore Available"
          value={restoreAvailableCount(rows).toLocaleString("en-US")}
          description="Users can be restored only while the original auth row still exists."
          icon={<RotateCcw className="h-5 w-5" />}
        />
      </div>

      <UserRecycleBinClient rows={rows} />
    </div>
  );
}
