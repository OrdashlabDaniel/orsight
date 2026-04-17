import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { unstable_noStore as noStore } from "next/cache";

import { listRegisteredUsersWithStatus } from "@/lib/viz-auth-user-rpc";
import { listRecycledUsers } from "@/lib/viz-recycle-store";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";

import { PostActionSearchRefresh } from "@/components/PostActionSearchRefresh";

import { RecycleBinClient } from "./RecycleBinClient";

export const metadata = {
  title: "用户回收站 · OrSight",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function deriveDeletedAtFromBannedUntil(bannedUntil: string | null | undefined): string | null {
  if (!bannedUntil) return null;
  const d = new Date(bannedUntil);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() - 10);
  return d.toISOString();
}

function derivePurgeAtFromDeletedAt(deletedAt: string): string {
  const d = new Date(deletedAt);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString();
}

export default async function VizRecyclePage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  noStore();
  const sp = searchParams ? await searchParams : {};
  const noticeMsg = typeof sp.notice === "string" ? sp.notice : null;
  const errMsg = typeof sp.err === "string" ? sp.err : null;

  const sb = createServiceRoleClient();
  let loadError: string | null = null;
  let rows: Array<{
    id: string;
    email: string | null;
    deleted_at: string;
    purge_at: string;
    deleted_by_email: string | null;
  }> = [];

  try {
    await purgeExpiredRecycledUsers(sb);
    rows = await listRecycledUsers(sb);
    const users = await listRegisteredUsersWithStatus(sb);
    const usernameById = new Map<string, string>();
    for (const u of users) {
      const label = (u.pod_username && u.pod_username.trim()) || (u.email && u.email.trim()) || "";
      if (label) {
        usernameById.set(u.id, label);
      }
    }

    // Prefer showing username (pod_username) over recycled row email.
    rows = rows.map((row) => ({
      ...row,
      email: usernameById.get(row.id) || row.email,
    }));
    const existingIds = new Set(rows.map((row) => row.id));
    const derivedRows = users
      .filter((user) => !existingIds.has(user.id) && (user.banned_until || user.deleted_at))
      .map((user) => {
        const deletedAt = user.deleted_at || deriveDeletedAtFromBannedUntil(user.banned_until) || new Date().toISOString();
        return {
          id: user.id,
          email: (user.pod_username && user.pod_username.trim()) || user.email,
          deleted_at: deletedAt,
          purge_at: derivePurgeAtFromDeletedAt(deletedAt),
          deleted_by_email: "system-recovered",
        };
      });
    rows = [...rows, ...derivedRows].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  } catch (e) {
    loadError = e instanceof Error ? e.message : "加载失败";
  }

  const rowsKey = rows.map((r) => r.id).join(",");

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-100 to-slate-200/80">
        <PostActionSearchRefresh />
        <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
          <div className="mx-auto flex w-[80%] max-w-full items-center gap-3 px-4 py-5">
            <Link
              href="/viz"
              className="inline-flex items-center justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
              aria-label="返回看板"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">OrSight · 回收站</p>
              <h1 className="text-xl font-bold text-slate-900">已删除用户（暂存）</h1>
              <p className="mt-1 text-sm text-slate-600">
                登录账号已移除；用量数据最多保留 30 天，到期自动清除，也可在此永久删除（需管理员密码）。
              </p>
            </div>
          </div>
        </header>

        <div className="mx-auto w-[80%] max-w-full space-y-4 px-4 py-6">
          {noticeMsg ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {noticeMsg}
            </div>
          ) : null}
          {errMsg ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {errMsg}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {loadError ? (
              <div className="p-6 text-sm text-rose-800">
                <p className="font-medium">无法读取回收站</p>
                <p className="mt-2">{loadError}</p>
              </div>
            ) : (
              <RecycleBinClient key={rowsKey} rows={rows} />
            )}
          </div>
        </div>
    </div>
  );
}
