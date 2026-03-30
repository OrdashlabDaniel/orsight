import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";

import { VizIdentityBadges } from "@/components/VizIdentityBadges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TOKEN_PRICING } from "@/lib/usage-metrics";
import { createAdminClient } from "@/lib/supabase/server";

import {
  deleteUserFromUserPageAction,
  grantAdminFromUserPageAction,
  revokeAdminFromUserPageAction,
} from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;

function costForLog(log: any) {
  const model = (log.model_used || "gpt-4o-mini") as keyof typeof TOKEN_PRICING;
  const rates = TOKEN_PRICING[model] || TOKEN_PRICING["gpt-4o-mini"];
  return (log.prompt_tokens || 0) * rates.prompt + (log.completion_tokens || 0) * rates.completion;
}

export default async function UserDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedParams = await params;
  const userId = resolvedParams.id;
  const supabase = await createAdminClient();
  const sp = searchParams ? await searchParams : {};
  const noticeMsg = typeof sp.notice === "string" ? sp.notice : null;
  const errMsg = typeof sp.err === "string" ? sp.err : null;

  // Fetch user details
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const user = userData?.user;

  // Fetch user's usage logs
  const { data: logs } = await supabase
    .from("usage_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const { data: admins } = await supabase.from("admin_users").select("id").order("created_at", { ascending: false });
  const isAdmin = Boolean(admins?.some((a) => a.id === userId));
  const soleAdmin = (admins?.length || 0) === 1;

  const totalImages = (logs ?? []).reduce((n, l) => n + (l.image_count || 0), 0);
  const totalTokens = (logs ?? []).reduce((n, l) => n + (l.total_tokens || 0), 0);
  const totalCost = (logs ?? []).reduce((n, l) => n + costForLog(l), 0);

  if (!user) {
    return (
      <div className="space-y-6">
        <div className="p-4 bg-rose-50 text-rose-700 rounded-xl border border-rose-200">
          User not found.
        </div>
        <Link href="/users" className="text-blue-600 hover:underline flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to Users
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/users"
          className="rounded-lg p-2 text-slate-500 transition-all duration-150 hover:-translate-y-px hover:bg-slate-200 hover:text-slate-900 active:translate-y-0 active:scale-[0.98]"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{user.email}</h1>
          <p className="mt-1 text-slate-600">用户详细信息与用量明细</p>
        </div>
      </div>

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">处理图片数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalImages.toLocaleString()}</div>
            <p className="text-xs text-slate-500">image_count 合计</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Token 总量</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalTokens.toLocaleString()}</div>
            <p className="text-xs text-slate-500">total_tokens 合计</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">估算费用</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">${totalCost.toFixed(4)}</div>
            <p className="text-xs text-slate-500">按内置单价估算</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">身份</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <VizIdentityBadges isRegisteredUser={true} isAdmin={isAdmin} />
            {!isAdmin ? (
              <form action={grantAdminFromUserPageAction}>
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="email" value={user.email || ""} />
                <button
                  type="submit"
                  className="w-full cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25 active:scale-[0.98]"
                >
                  设为管理员
                </button>
              </form>
            ) : (
              <form action={revokeAdminFromUserPageAction}>
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="label" value={user.email || userId} />
                <button
                  type="submit"
                  disabled={soleAdmin}
                  title={soleAdmin ? "至少需要保留一位管理员" : "仅从 admin_users 移除，不删除登录账号"}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition-all duration-150 enabled:cursor-pointer enabled:hover:border-slate-400 enabled:hover:bg-slate-50 enabled:hover:shadow-md enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  移除管理员权限
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-rose-900">危险操作</p>
            <p className="text-sm text-rose-800">删除用户会移除 auth.users + admin_users + usage_logs，不可恢复。</p>
          </div>
          <form
            action={deleteUserFromUserPageAction}
            onSubmit={(e) => {
              // client confirm won't run in Server Components; kept for progressive enhancement
              // (Next will ignore it server-side). The /viz drawer has confirm already.
            }}
          >
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="label" value={user.email || userId} />
            <button
              type="submit"
              className="cursor-pointer rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 shadow-sm transition-all duration-150 hover:border-rose-400 hover:bg-rose-100 hover:shadow-md hover:shadow-rose-500/15 active:scale-[0.98]"
            >
              删除用户
            </button>
          </form>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="px-6 py-4">Date & Time</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Model</th>
                <th className="px-6 py-4 text-right">Images</th>
                <th className="px-6 py-4 text-right">Prompt Tokens</th>
                <th className="px-6 py-4 text-right">Completion Tokens</th>
                <th className="px-6 py-4 text-right">Total Tokens</th>
                <th className="px-6 py-4 text-right">Est. Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs?.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-slate-600">
                    {format(new Date(log.created_at), "MMM d, yyyy HH:mm:ss")}
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-900">{log.action_type}</td>
                  <td className="px-6 py-4 text-slate-600">
                    <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-xs font-medium text-slate-700">
                      {log.model_used}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-slate-600">{log.image_count}</td>
                  <td className="px-6 py-4 text-right text-slate-600">{log.prompt_tokens.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-slate-600">{log.completion_tokens.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-900">{log.total_tokens.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-900">
                    ${costForLog(log).toFixed(4)}
                  </td>
                </tr>
              ))}
              {(!logs || logs.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                    No usage logs found for this user.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
