import Link from "next/link";
import { redirect } from "next/navigation";

import { getDisplayUsernameFromUser, getGofoProfileFromUser } from "@/lib/auth-username";
import { getAuthUserOrSkip } from "@/lib/auth-server";
import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { isSupabaseAuthEnabled } from "@/lib/supabase";

import { SignOutButton } from "./SignOutButton";

export default async function AccountPage() {
  const supabaseOn = isSupabaseAuthEnabled();
  const devMock = isDevMockLoginEnabled();

  if (!supabaseOn && !devMock) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">用户信息</h1>
          <p className="mt-3 text-sm text-slate-600">
            当前未启用 Supabase 登录。配置{" "}
            <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code> 与{" "}
            <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
            后可在此查看账号信息；本地测试可启用{" "}
            <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_DEV_MOCK_LOGIN=true</code>。
          </p>
          <Link href="/" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
            返回填表模式
          </Link>
        </div>
      </main>
    );
  }

  const { user } = await getAuthUserOrSkip();

  if (!user) {
    redirect("/login?next=/account");
  }

  const createdAt = user.created_at ? new Date(user.created_at).toLocaleString("zh-CN") : "—";
  const isDevMockSession = devMock && !supabaseOn;
  const gofoProfile = getGofoProfileFromUser(user);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {isDevMockSession ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            当前为<strong>开发假登录</strong>会话，无 Supabase 账号数据。
          </p>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">用户信息</h1>
            <p className="mt-1 text-sm text-slate-500">当前登录账号</p>
          </div>
          <SignOutButton devMock={isDevMockSession} />
        </div>

        <dl className="mt-8 space-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">用户名</dt>
            <dd className="mt-1 text-slate-900">{getDisplayUsernameFromUser(user)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">内部标识（伪邮箱）</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-600">{user.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">用户 ID</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-800">{user.id}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">注册时间</dt>
            <dd className="mt-1 text-slate-900">{createdAt}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">是否 GOFO 员工</dt>
            <dd className="mt-1 text-slate-900">{gofoProfile.isGofoEmployee ? "是" : "否"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">站点</dt>
            <dd className="mt-1 text-slate-900">{gofoProfile.gofoSite || "—"}</dd>
          </div>
        </dl>

        <div className="mt-8 border-t border-slate-100 pt-6">
          <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
            ← 返回填表模式
          </Link>
        </div>
      </div>
    </main>
  );
}
