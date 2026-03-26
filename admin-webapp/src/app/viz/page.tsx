import Link from "next/link";
import { Image as ImageIcon, Zap, DollarSign, Users, Database } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  aggregateUsageLogs,
  dailyTokenBuckets,
  modelTokenShares,
  TOKEN_PRICING,
} from "@/lib/usage-metrics";
import { createServiceRoleClient } from "@/lib/supabase/service";

import { VizCharts } from "./VizCharts";
import { deleteUserAction } from "./actions";

export const metadata = {
  title: "用量可视化 · OrSight",
  description: "免登录用量看板（仅内网使用）",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type AdminUserLite = {
  id: string;
  email: string | null;
  created_at: string | null;
  usage: { images: number; tokens: number; cost: number };
};

type RegisteredUserLite = {
  id: string;
  email: string | null;
  created_at: string | null;
  pod_username?: string | null;
};

/** 同一账号可同时具备：注册用户（auth.users）+ 后台管理员（public.admin_users） */
function VizIdentityBadges({
  isRegisteredUser,
  isAdmin,
}: {
  isRegisteredUser: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        <span
          className={
            isRegisteredUser
              ? "rounded-md bg-slate-800 px-2 py-0.5 text-xs font-medium text-white"
              : "rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400 line-through"
          }
          title="auth.users 中的注册账号"
        >
          注册用户
        </span>
        <span
          className={
            isAdmin
              ? "rounded-md bg-blue-600 px-2 py-0.5 text-xs font-medium text-white"
              : "rounded-md border border-dashed border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-400"
          }
          title="public.admin_users 中有记录，可进后台"
        >
          后台管理员
        </span>
      </div>
      {isRegisteredUser && isAdmin ? (
        <p className="text-[11px] leading-snug text-slate-500">该账号同时具备以上两种身份</p>
      ) : null}
    </div>
  );
}

async function loadAllAdminUsers() {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("admin_users")
    .select("id,email,created_at")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`admin_users: ${error.message}`);
  }
  return data ?? [];
}

async function loadAllRegisteredUsers(): Promise<RegisteredUserLite[]> {
  const sb = createServiceRoleClient();

  const { data, error } = await sb.rpc("list_registered_users");
  if (error) {
    throw new Error(`list_registered_users RPC: ${error.message}`);
  }

  return (data ?? []).map((u: any) => ({
    id: String(u.id),
    email: typeof u.email === "string" ? u.email : null,
    created_at: typeof u.created_at === "string" ? u.created_at : null,
    pod_username: typeof u.pod_username === "string" && u.pod_username.trim() ? u.pod_username : null,
  }));
}

export default async function VizPage(props: { searchParams?: Promise<SearchParams> }) {
  const searchParams = props.searchParams ? await props.searchParams : {};
  let loadError: string | null = null;
  let logs: Parameters<typeof aggregateUsageLogs>[0] = [];
  let adminUsers: Awaited<ReturnType<typeof loadAllAdminUsers>> = [];
  let registeredUsers: RegisteredUserLite[] = [];
  let registeredUsersLoadWarn: string | null = null;

  try {
    const sb = createServiceRoleClient();
    const { data, error } = await sb
      .from("usage_logs")
      .select(
        "user_id,image_count,total_tokens,prompt_tokens,completion_tokens,model_used,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(10000);

    if (error) {
      loadError = error.message;
    } else {
      logs = data ?? [];
    }

    adminUsers = await loadAllAdminUsers();
    registeredUsers = await loadAllRegisteredUsers();
    if (registeredUsers.length === 0) {
      registeredUsersLoadWarn =
        "未读到注册用户列表：请确认已在数据库执行 webapp/supabase/list_registered_users_rpc.sql（RPC list_registered_users）。";
    }
  } catch (e) {
    loadError = e instanceof Error ? e.message : "无法连接数据库";
  }

  const agg = aggregateUsageLogs(logs);
  const daily = dailyTokenBuckets(logs);
  const modelShares = modelTokenShares(logs);
  const usageByUser = new Map<string, { images: number; tokens: number; cost: number }>();
  for (const log of logs) {
    const model = (log.model_used || "gpt-4o-mini") as keyof typeof TOKEN_PRICING;
    const rates = TOKEN_PRICING[model] || TOKEN_PRICING["gpt-4o-mini"];
    const prompt = (log.prompt_tokens || 0) * rates.prompt;
    const completion = (log.completion_tokens || 0) * rates.completion;
    const cur = usageByUser.get(log.user_id) || { images: 0, tokens: 0, cost: 0 };
    usageByUser.set(log.user_id, {
      images: cur.images + (log.image_count || 0),
      tokens: cur.tokens + (log.total_tokens || 0),
      cost: cur.cost + prompt + completion,
    });
  }
  const adminRows: AdminUserLite[] = adminUsers
    .map((u) => ({
      id: u.id,
      email: u.email || "unknown",
      created_at: u.created_at || null,
      usage: usageByUser.get(u.id) || { images: 0, tokens: 0, cost: 0 },
    }))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const adminIdSet = new Set(adminRows.map((u) => u.id));
  const registeredRows = registeredUsers
    .map((u) => {
      const display = (u.pod_username && u.pod_username.trim()) || u.email || "unknown";
      return {
        id: u.id,
        email: display,
        created_at: u.created_at,
        isRegisteredUser: true,
        isAdmin: adminIdSet.has(u.id),
        usage: usageByUser.get(u.id) || { images: 0, tokens: 0, cost: 0 },
      };
    })
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const adminOnlyRows = adminRows.map((u) => ({
    id: u.id,
    email: u.email || "unknown",
    created_at: u.created_at,
    isRegisteredUser: true,
    isAdmin: true,
    usage: u.usage,
  }));

  const okLabel = typeof searchParams.ok === "string" ? searchParams.ok : null;
  const errMsg = typeof searchParams.err === "string" ? searchParams.err : null;
  const viewParam = typeof searchParams.view === "string" ? searchParams.view : "users";
  const activeView: "users" | "admins" = viewParam === "admins" ? "admins" : "users";

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-100 to-slate-200/80">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              OrSight · 公开看板
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">用量可视化</h1>
            <p className="mt-1 text-sm text-slate-600">
              免登录 · 数据来自 <code className="rounded bg-slate-100 px-1">usage_logs</code>（最近最多 1 万条）
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/account"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              管理员信息
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {okLabel ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            已删除用户：<strong>{okLabel}</strong>
          </div>
        ) : null}
        {errMsg ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            删除失败：{errMsg}
          </div>
        ) : null}

        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>安全提示：</strong>
          本页<strong>无鉴权</strong>，任何能访问该地址的人都能看到汇总用量。请勿将含{" "}
          <code className="rounded bg-amber-100 px-1">SERVICE_ROLE</code> 的部署直接暴露公网；生产环境建议关闭此路由或加 IP
          / VPN 限制。
        </div>

        {loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
            <p className="font-medium">数据加载失败</p>
            <p className="mt-2 text-sm">{loadError}</p>
            <p className="mt-3 text-sm text-rose-700">
              请确认 <code className="rounded bg-rose-100 px-1">admin-webapp/.env.local</code> 中已配置{" "}
              <code className="rounded bg-rose-100 px-1">SUPABASE_SERVICE_ROLE_KEY</code>。
            </p>
          </div>
        ) : (
          <>
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">活跃用户数</CardTitle>
                  <Users className="h-4 w-4 text-slate-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900">
                    {agg.uniqueActiveUsers}
                  </div>
                  <p className="text-xs text-slate-500">在统计记录中出现过的 user_id</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">处理图片数</CardTitle>
                  <ImageIcon className="h-4 w-4 text-slate-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900">
                    {agg.totalImages.toLocaleString()}
                  </div>
                  <p className="text-xs text-slate-500">image_count 合计</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">Token 总量</CardTitle>
                  <Zap className="h-4 w-4 text-slate-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900">
                    {agg.totalTokens.toLocaleString()}
                  </div>
                  <p className="text-xs text-slate-500">当前样本内合计</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600">估算费用</CardTitle>
                  <DollarSign className="h-4 w-4 text-slate-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900">
                    ${agg.totalCost.toFixed(4)}
                  </div>
                  <p className="text-xs text-slate-500">按内置单价估算</p>
                </CardContent>
              </Card>
            </div>

            <div className="mb-8 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <Database className="h-4 w-4 shrink-0 text-slate-400" />
              <span>
                当前图表基于 <strong>{agg.recordCount.toLocaleString()}</strong> 条用量记录。
              </span>
            </div>

            <VizCharts daily={daily} modelShares={modelShares} />

            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">账号列表（可切换）</h2>
                <div className="inline-flex rounded-lg border border-slate-200 p-1 text-sm">
                  <Link
                    href="/viz?view=users"
                    className={`rounded-md px-3 py-1.5 ${
                      activeView === "users"
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    用户 ({registeredRows.length})
                  </Link>
                  <Link
                    href="/viz?view=admins"
                    className={`rounded-md px-3 py-1.5 ${
                      activeView === "admins"
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    管理员 ({adminRows.length})
                  </Link>
                </div>
              </div>
              <div className="mb-2 text-xs text-slate-500">
                {activeView === "users"
                  ? "用户视图：列出所有注册账号；「身份」列同时展示「注册用户」与是否「后台管理员」"
                  : "管理员视图：列出后台权限账号；二者在系统中是同一条 auth 用户，只是多了 admin_users 记录"}
              </div>
              {activeView === "users" && registeredUsersLoadWarn ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {registeredUsersLoadWarn}
                </div>
              ) : null}
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-rose-700">删除会移除 auth.users + admin_users + usage_logs</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">用户</th>
                      <th className="px-3 py-2 text-left">身份</th>
                      <th className="px-3 py-2 text-left">创建时间</th>
                      <th className="px-3 py-2 text-right">图片</th>
                      <th className="px-3 py-2 text-right">Tokens</th>
                      <th className="px-3 py-2 text-right">费用</th>
                      <th className="px-3 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeView === "admins" ? adminOnlyRows : registeredRows).map((u) => (
                      <tr key={u.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{u.email}</div>
                          <div className="max-w-[320px] truncate text-xs text-slate-500">{u.id}</div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <VizIdentityBadges
                            isRegisteredUser={u.isRegisteredUser}
                            isAdmin={u.isAdmin}
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-600">{u.created_at ? new Date(u.created_at).toLocaleString() : "-"}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{u.usage.images.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{u.usage.tokens.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-900">${u.usage.cost.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right">
                          <form action={deleteUserAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="label" value={u.email || u.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                            >
                              删除
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
