import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";

import { VizIdentityBadges } from "@/components/VizIdentityBadges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dailyTokenBuckets, modelTokenShares, TOKEN_PRICING } from "@/lib/usage-metrics";
import { createServiceRoleClient } from "@/lib/supabase/service";

import { VizCharts } from "../../VizCharts";
import {
  grantAdminFromVizUserDetailAction,
  revokeAdminFromVizUserDetailAction,
} from "./actions";
import { UserTimeRangeControls } from "./UserTimeRangeControls";

export const dynamic = "force-dynamic";

function costForLog(log: any) {
  const model = (log.model_used || "gpt-4o-mini") as keyof typeof TOKEN_PRICING;
  const rates = TOKEN_PRICING[model] || TOKEN_PRICING["gpt-4o-mini"];
  return (log.prompt_tokens || 0) * rates.prompt + (log.completion_tokens || 0) * rates.completion;
}

type SearchParams = Record<string, string | string[] | undefined>;

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseISODateOnly(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function utcStartOfDay(dateOnly: string) {
  return `${dateOnly}T00:00:00.000Z`;
}

function utcEndOfDay(dateOnly: string) {
  return `${dateOnly}T23:59:59.999Z`;
}

function addDays(dateOnly: string, deltaDays: number) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return isoDay(d);
}

export default async function VizUserDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id: userId } = await params;
  const sp = searchParams ? await searchParams : {};
  const range = typeof sp.range === "string" ? sp.range : "30";
  const fromQ = parseISODateOnly(sp.from);
  const toQ = parseISODateOnly(sp.to);

  const today = isoDay(new Date());
  let fromDay: string | null = null;
  let toDay: string | null = null;

  if (fromQ || toQ) {
    fromDay = fromQ;
    toDay = toQ;
  } else if (range === "7" || range === "30" || range === "90") {
    const days = Number(range);
    toDay = today;
    fromDay = addDays(today, -(days - 1));
  } else if (range === "all") {
    fromDay = null;
    toDay = null;
  } else {
    // default
    toDay = today;
    fromDay = addDays(today, -29);
  }

  const sb = createServiceRoleClient();

  const logsQuery = sb
    .from("usage_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const logsQueryRanged =
    fromDay || toDay
      ? logsQuery
          .gte("created_at", fromDay ? utcStartOfDay(fromDay) : "1970-01-01T00:00:00.000Z")
          .lte("created_at", toDay ? utcEndOfDay(toDay) : utcEndOfDay(today))
      : logsQuery;

  const [{ data: userData }, { data: logs }, { data: admins }] = await Promise.all([
    sb.auth.admin.getUserById(userId),
    logsQueryRanged,
    sb.from("admin_users").select("id").order("created_at", { ascending: false }),
  ]);

  const user = userData?.user;
  const isAdmin = Boolean(admins?.some((a) => a.id === userId));
  const soleAdmin = (admins?.length ?? 0) === 1;
  const canRevokeAdmin = !(soleAdmin && isAdmin);

  const returnParams = new URLSearchParams();
  if (typeof sp.range === "string" && sp.range) returnParams.set("range", sp.range);
  if (fromQ) returnParams.set("from", fromQ);
  if (toQ) returnParams.set("to", toQ);
  const returnSearch = returnParams.toString();

  const noticeMsg = typeof sp.notice === "string" ? sp.notice : null;
  const errMsg = typeof sp.err === "string" ? sp.err : null;

  if (!user) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">User not found.</div>
        <Link
          href="/viz"
          className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 transition-colors hover:text-blue-900"
        >
          <ArrowLeft className="h-4 w-4" /> 返回用量看板
        </Link>
      </div>
    );
  }

  const totalImages = (logs ?? []).reduce((n, l) => n + (l.image_count || 0), 0);
  const totalTokens = (logs ?? []).reduce((n, l) => n + (l.total_tokens || 0), 0);
  const totalCost = (logs ?? []).reduce((n, l) => n + costForLog(l), 0);
  const daily = dailyTokenBuckets(logs ?? []);
  const modelShares = modelTokenShares(logs ?? []);

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-100 to-slate-200/80">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-start gap-3 px-4 py-5">
          <Link
            href="/viz"
            className="mt-0.5 inline-flex items-center justify-center rounded-lg p-2 text-slate-500 transition-all duration-150 hover:-translate-y-px hover:bg-slate-200 hover:text-slate-900 active:translate-y-0 active:scale-[0.98]"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">OrSight · 用户详情</p>
            <h1 className="mt-1 truncate text-2xl font-bold text-slate-900">{user.email || "unknown"}</h1>
            <p className="mt-1 break-all font-mono text-[11px] leading-snug text-slate-500">{userId}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
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

        <UserTimeRangeControls />

        <VizCharts daily={daily} modelShares={modelShares} />

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
                <form action={grantAdminFromVizUserDetailAction}>
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="email" value={user.email || ""} />
                  <input type="hidden" name="returnSearch" value={returnSearch} />
                  <button
                    type="submit"
                    className="w-full cursor-pointer rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25 active:scale-[0.98]"
                  >
                    设为管理员
                  </button>
                  <p className="mt-2 text-xs text-slate-500">
                    写入 <code className="rounded bg-slate-100 px-1">public.admin_users</code>，不删除登录账号。
                  </p>
                </form>
              ) : (
                <form action={revokeAdminFromVizUserDetailAction}>
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="label" value={user.email || userId} />
                  <input type="hidden" name="returnSearch" value={returnSearch} />
                  <button
                    type="submit"
                    disabled={!canRevokeAdmin}
                    title={
                      !canRevokeAdmin
                        ? "至少需要保留一位管理员"
                        : "仅从 admin_users 移除，不删除登录账号"
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition-all duration-150 enabled:cursor-pointer enabled:hover:border-slate-400 enabled:hover:bg-slate-50 enabled:hover:shadow-md enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    移除管理员权限
                  </button>
                  {!canRevokeAdmin ? (
                    <p className="mt-2 text-xs text-amber-800">
                      当前为最后一位管理员，请先为其他账号赋予管理员权限后再移除此权限。
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      仅从 <code className="rounded bg-slate-100 px-1">admin_users</code> 移除，登录账号保留。
                    </p>
                  )}
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">用量明细</h2>
              <p className="mt-1 text-xs text-slate-600">按时间倒序展示该用户的 usage_logs</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-5 py-3 text-left">时间</th>
                  <th className="px-5 py-3 text-left">动作</th>
                  <th className="px-5 py-3 text-left">模型</th>
                  <th className="px-5 py-3 text-right">图片</th>
                  <th className="px-5 py-3 text-right">Prompt</th>
                  <th className="px-5 py-3 text-right">Completion</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">费用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(logs ?? []).map((log) => (
                  <tr key={log.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-600">
                      {log.created_at ? format(new Date(log.created_at), "MMM d, yyyy HH:mm:ss") : "-"}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-900">{log.action_type}</td>
                    <td className="px-5 py-3 text-slate-600">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        {log.model_used}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{log.image_count || 0}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{(log.prompt_tokens || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {(log.completion_tokens || 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {(log.total_tokens || 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">${costForLog(log).toFixed(4)}</td>
                  </tr>
                ))}
                {!logs || logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                      No usage logs found for this user.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

