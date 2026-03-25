"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";

import { adminAuth } from "./actions";

export default function LoginForm() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [mode, setMode] = useState<"login" | "register">("login");

  const [flash, formAction, isPending] = useActionState(adminAuth, null);

  const isOk = flash?.startsWith("OK:") ?? false;
  const message = flash ? (isOk ? flash.slice(3) : flash.startsWith("ERR:") ? flash.slice(4) : flash) : null;
  const isError = flash != null && !isOk;

  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-xl">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-900">OrSight Admin</h1>
        <p className="mt-2 text-slate-600">管理员后台 · 登录或注册</p>
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs text-slate-600 leading-relaxed">
          <span className="font-medium text-slate-800">数据库：</span>
          本应用通过环境变量 <code className="rounded bg-white px-1">NEXT_PUBLIC_SUPABASE_URL</code>、
          <code className="rounded bg-white px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>（登录会话）与{" "}
          <code className="rounded bg-white px-1">SUPABASE_SERVICE_ROLE_KEY</code>（服务端注册/bootstrap）连接
          <strong> 与主站 OrSight 同一套 </strong>
          Supabase 项目；数据在 PostgreSQL（含 <code className="rounded bg-white px-1">auth.users</code>、
          <code className="rounded bg-white px-1">public.admin_users</code> 等表）。
          若登录/注册提示网络错误：多为<strong>本机 Node 连不上 Supabase</strong>（与是否部署上线无关）。请先打开{" "}
          <a href="/api/health/supabase" className="text-blue-600 underline" target="_blank" rel="noreferrer">
            /api/health/supabase
          </a>{" "}
          看 JSON 里 <code className="rounded bg-white px-1">ok</code> 是否为 true；亦可再试{" "}
          <code className="rounded bg-white px-1">npm run dev:ipv4</code>。
        </p>
      </div>

      <div className="flex rounded-xl border border-slate-200 p-1 text-sm">
        <button
          type="button"
          className={`flex-1 rounded-lg py-2 font-medium transition-colors ${
            mode === "login" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
          onClick={() => setMode("login")}
        >
          登录
        </button>
        <button
          type="button"
          className={`flex-1 rounded-lg py-2 font-medium transition-colors ${
            mode === "register" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
          onClick={() => setMode("register")}
        >
          注册
        </button>
      </div>

      {urlError === "not_admin" && (
        <div className="p-3 text-sm text-rose-600 bg-rose-50 rounded-lg border border-rose-200">
          <strong>已登录成功，但无后台权限：</strong>
          你的账号不在 <code className="rounded bg-rose-100 px-1">public.admin_users</code> 中。
          请让管理员在 Supabase → Authentication → Users 复制你的用户 ID，并在 SQL Editor 执行：{" "}
          <code className="block mt-1 break-all rounded bg-rose-100 px-1 py-0.5 text-xs">
            {`insert into public.admin_users (id, email) values ('用户UUID', '你的登录名');`}
          </code>
          仅当 <code className="rounded bg-rose-100 px-1">admin_users</code> 为空时，首位注册会自动成为管理员。
        </div>
      )}

      {message && (
        <div
          className={`p-3 text-sm rounded-lg ${
            isOk ? "text-emerald-800 bg-emerald-50 border border-emerald-200" : ""
          } ${isError ? "text-rose-600 bg-rose-50 border border-rose-200" : ""}`}
        >
          {message}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="intent" value={mode} />

        <div>
          <label className="block text-sm font-medium text-slate-700">登录名</label>
          <p className="mt-0.5 text-xs text-slate-500">
            与主站规则相同：任意字符均可，系统会映射为 Supabase 伪邮箱。
            <strong className="text-slate-700">登录名必须与注册时完全一致</strong>（区分大小写，例如{" "}
            <code className="rounded bg-slate-100 px-1">IAHAMD</code> 与 <code className="rounded bg-slate-100 px-1">iahamd</code>{" "}
            是两个账号）。
          </p>
          <input
            name="identifier"
            type="text"
            autoComplete="username"
            required
            className="w-full px-4 py-2 mt-1 text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="例如 IAH 或你的邮箱"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">密码</label>
          <input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={6}
            className="w-full px-4 py-2 mt-1 text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="w-full px-4 py-2 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isPending ? "请稍候…" : mode === "login" ? "登录" : "注册"}
        </button>
      </form>
    </div>
  );
}
