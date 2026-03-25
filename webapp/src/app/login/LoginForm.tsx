"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  GOFO_EMPLOYEE_METADATA_KEY,
  GOFO_SITE_METADATA_KEY,
  POD_USERNAME_METADATA_KEY,
  usernameToPodLoginEmail,
} from "@/lib/auth-username";
import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { createClient } from "@/lib/supabase/browser";
import { isLoginStrictlyRequired, isSupabaseAuthEnabled } from "@/lib/supabase";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const configReason = searchParams.get("reason") === "config";

  const [mode, setMode] = useState<"login" | "register">("login");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [isGofoEmployee, setIsGofoEmployee] = useState(false);
  const [gofoSite, setGofoSite] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const devMock = isDevMockLoginEnabled();
  const supabaseOn = isSupabaseAuthEnabled();

  if (!supabaseOn && !devMock) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            {configReason || isLoginStrictlyRequired() ? "需要配置登录" : "未启用 Supabase 登录"}
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            请在 <code className="rounded bg-slate-100 px-1">webapp/.env.local</code> 中填写真实的{" "}
            <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>（必须以{" "}
            <code className="rounded bg-slate-100 px-1">https://</code> 开头）与{" "}
            <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
            ，保存后<strong>重启</strong> <code className="rounded bg-slate-100 px-1">npm run dev</code>。
          </p>
          <p className="mt-3 text-sm text-slate-600">
            占位符如 <code className="rounded bg-slate-100 px-1">your_supabase_project_url</code>{" "}
            不会被识别为已配置。
          </p>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>本地测登录页：</strong>在 <code className="rounded bg-amber-100 px-1">.env.local</code>{" "}
            加 <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_DEV_MOCK_LOGIN=true</code>{" "}
            并重启，即可使用假登录（无需 Supabase）。详见 <code className="rounded bg-amber-100 px-1">AUTH.md</code>。
          </p>
          <p className="mt-4 text-sm text-slate-600">
            若你暂时<strong>不需要</strong>登录（纯本地调试），在{" "}
            <code className="rounded bg-slate-100 px-1">.env.local</code> 增加一行：{" "}
            <code className="rounded bg-slate-100 px-1">NEXT_PUBLIC_REQUIRE_LOGIN=false</code>{" "}
            后重启服务。
          </p>
          {!isLoginStrictlyRequired() ? (
            <p className="mt-4 text-sm text-slate-600">
              当前已关闭强制登录时，可{" "}
              <Link href="/" className="text-blue-600 hover:underline">
                返回首页
              </Link>
              。
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const trimmedAccount = account.trim();
      if (!trimmedAccount) {
        setMessage(mode === "login" ? "请输入邮箱或用户名。" : "请输入邮箱。");
        return;
      }

      if (devMock && !supabaseOn) {
        if (mode === "register") {
          setMessage("假登录模式下无需注册：切换到「登录」，任意用户名 + 6 位以上密码即可进入。");
          return;
        }
        const res = await fetch("/api/auth/dev-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: trimmedAccount, password }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setMessage(data.error || "登录失败。");
          return;
        }
        router.push(nextPath);
        router.refresh();
        return;
      }

      const supabase = createClient();

      if (mode === "register") {
        const email = trimmedAccount.toLowerCase();
        if (!email.includes("@")) {
          setMessage("请输入有效邮箱地址。");
          return;
        }
        const trimmedSite = gofoSite.trim();
        if (isGofoEmployee && !trimmedSite) {
          setMessage("已勾选 GOFO 员工时，站点为必填。");
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              [POD_USERNAME_METADATA_KEY]: email,
              [GOFO_EMPLOYEE_METADATA_KEY]: isGofoEmployee,
              [GOFO_SITE_METADATA_KEY]: isGofoEmployee ? trimmedSite : null,
            },
          },
        });
        if (error) {
          setMessage(error.message);
          return;
        }
        setMessage("注册成功，请前往邮箱完成验证后再登录。");
        setMode("login");
        setAccount(email);
        setIsGofoEmployee(false);
        setGofoSite("");
        return;
      }

      const loginEmail = trimmedAccount.includes("@")
        ? trimmedAccount.toLowerCase()
        : await usernameToPodLoginEmail(trimmedAccount);

      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      router.push(nextPath);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {devMock && !supabaseOn ? (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-900">
            <strong>开发假登录</strong>：未连接 Supabase；任意用户名 + 密码（≥6 位）即可进入。勿用于生产。
          </p>
        ) : null}
        <h1 className="text-center text-2xl font-semibold text-slate-900">OrSight</h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          {mode === "login" ? "登录后使用" : "注册新账号（需邮箱验证）"}
        </p>

        <form className="mt-8 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{mode === "login" ? "邮箱或用户名" : "邮箱"}</span>
            <input
              type={mode === "login" ? "text" : "email"}
              required
              autoComplete={mode === "login" ? "username" : "email"}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={mode === "login" ? "邮箱（新账号）或用户名（旧账号）" : "请输入可接收验证邮件的邮箱"}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            />
          </label>
          {mode === "register" ? (
            <>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={isGofoEmployee}
                  onChange={(e) => setIsGofoEmployee(e.target.checked)}
                />
                <span className="text-sm text-slate-700">我是 GOFO 员工</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  站点{isGofoEmployee ? "（必填）" : "（选填）"}
                </span>
                <input
                  type="text"
                  value={gofoSite}
                  onChange={(e) => setGofoSite(e.target.value)}
                  required={isGofoEmployee}
                  placeholder="例如：上海站 / 广州站"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
                />
              </label>
            </>
          ) : null}
          <label className="block">
            <span className="text-sm font-medium text-slate-700">密码</span>
            <input
              type="password"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            />
          </label>

          {message ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
          >
            {loading ? "请稍候…" : mode === "login" ? "登录" : "注册"}
          </button>
        </form>

        <div className="mt-6 flex justify-center gap-2 text-sm">
          {devMock && !supabaseOn ? (
            <span className="text-slate-500">假登录模式无真实注册</span>
          ) : mode === "login" ? (
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => {
                setMode("register");
                setMessage("");
                setIsGofoEmployee(false);
                setGofoSite("");
              }}
            >
              没有账号？注册
            </button>
          ) : (
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => {
                setMode("login");
                setMessage("");
                setIsGofoEmployee(false);
                setGofoSite("");
              }}
            >
              已有账号？登录
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
