import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { ArrowLeft } from "lucide-react";
import { unstable_noStore as noStore } from "next/cache";

import { deleteRecycledUser, listRecycledUsers } from "@/lib/viz-recycle-store";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";

import { PostActionSearchRefresh } from "@/components/PostActionSearchRefresh";

import { RecycleBinClient } from "./RecycleBinClient";

export const metadata = {
  title: "用户回收站 · OrSight",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function userLabel(user: User, fallback: string | null) {
  const metadata = user.user_metadata ?? {};
  const podUsername = typeof metadata.pod_username === "string" ? metadata.pod_username.trim() : "";
  return podUsername || user.email || fallback || user.id;
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
    const recycledRows = await listRecycledUsers(sb);
    const validRows: typeof rows = [];
    for (const row of recycledRows) {
      const { data, error } = await sb.auth.admin.getUserById(row.id);
      if (error || !data.user) {
        await deleteRecycledUser(sb, row.id).catch(() => {});
        continue;
      }
      validRows.push({
        ...row,
        email: userLabel(data.user, row.email),
      });
    }
    rows = validRows.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
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
