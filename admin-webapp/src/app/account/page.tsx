import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

async function signOutAction() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function AdminAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const displayName =
    typeof user.user_metadata?.pod_username === "string" && user.user_metadata.pod_username.trim()
      ? user.user_metadata.pod_username.trim()
      : user.email || "管理员";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">管理员信息</h1>
        <p className="mt-1 text-sm text-slate-500">当前后台登录账号</p>

        <dl className="mt-6 space-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">登录名</dt>
            <dd className="mt-1 text-slate-900">{displayName}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">邮箱（内部标识）</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-700">{user.email || "-"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">用户 ID</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-700">{user.id}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">登录时间</dt>
            <dd className="mt-1 text-slate-900">
              {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "-"}
            </dd>
          </div>
        </dl>

        <div className="mt-8 flex flex-wrap gap-3 border-t border-slate-200 pt-6">
          <Link
            href="/viz"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            返回可视化看板
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
            >
              退出登录
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
