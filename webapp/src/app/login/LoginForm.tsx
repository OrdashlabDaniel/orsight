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
import { getAdminAppLoginUrl } from "@/lib/admin-app-url";
import { isDevMockLoginEnabled } from "@/lib/dev-mock-auth";
import { useLocale } from "@/i18n/LocaleProvider";
import { createClient } from "@/lib/supabase/browser";
import { isLoginStrictlyRequired, isSupabaseAuthEnabled } from "@/lib/supabase";

export function LoginForm() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const configReason = searchParams.get("reason") === "config";

  const [mode, setMode] = useState<"login" | "register" | "verify">("login");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [isGofoEmployee, setIsGofoEmployee] = useState(false);
  const [gofoSite, setGofoSite] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const devMock = isDevMockLoginEnabled();
  const supabaseOn = isSupabaseAuthEnabled();
  const adminLoginUrl = getAdminAppLoginUrl();

  if (!supabaseOn && !devMock) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            {configReason || isLoginStrictlyRequired() ? t("login.needConfigTitle") : t("login.supabaseOffTitle")}
          </h1>
          <p className="mt-3 text-sm text-slate-600">{t("login.configBody")}</p>
          <p className="mt-3 text-sm text-slate-600">{t("login.placeholderHint")}</p>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t("login.devMockHint")}
          </p>
          <p className="mt-4 text-sm text-slate-600">{t("login.noLoginHint")}</p>
          {adminLoginUrl ? (
            <p className="mt-4 text-center text-sm">
              <a
                href={adminLoginUrl}
                className="text-blue-600 underline-offset-2 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("login.adminLoginEntry")}
              </a>
            </p>
          ) : null}
          {!isLoginStrictlyRequired() ? (
            <p className="mt-4 text-sm text-slate-600">
              <Link href="/" className="text-blue-600 hover:underline">
                {t("login.backHome")}
              </Link>
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
        setMessage(mode === "login" ? t("login.errAccountLogin") : t("login.errAccountRegister"));
        return;
      }

      if (devMock && !supabaseOn) {
        if (mode !== "login") {
          setMessage(t("login.mockRegister"));
          return;
        }
        const res = await fetch("/api/auth/dev-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: trimmedAccount, password }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setMessage(data.error || t("login.errLogin"));
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
          setMessage(t("login.errEmail"));
          return;
        }
        const trimmedSite = gofoSite.trim();
        if (isGofoEmployee && !trimmedSite) {
          setMessage("已勾选 GOFO 员工时，站点为必填。");
          return;
        }
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
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
        setMessage("验证码已发送到邮箱，请输入验证码完成注册。");
        setAccount(email);
        setOtp("");
        setMode("verify");
        return;
      }

      if (mode === "verify") {
        const email = trimmedAccount.toLowerCase();
        if (!email.includes("@")) {
          setMessage(t("login.errEmail"));
          return;
        }
        const token = otp.trim();
        if (!token) {
          setMessage("请输入邮箱验证码。");
          return;
        }
        const { error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: "email",
        });
        if (error) {
          setMessage(error.message);
          return;
        }
        router.push(nextPath);
        router.refresh();
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

  async function handleGoogleLogin() {
    setMessage("");
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) {
        setMessage(error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    setMessage("");
    setLoading(true);
    try {
      const email = account.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        setMessage(t("login.errEmail"));
        return;
      }
      const trimmedSite = gofoSite.trim();
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
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
      setMessage("验证码已重新发送。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {devMock && !supabaseOn ? (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-900">
            {t("login.devMockBanner")}
          </p>
        ) : null}
        <h1 className="text-center text-2xl font-semibold text-slate-900">OrSight</h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          {mode === "login" ? t("login.subtitleLogin") : mode === "register" ? t("login.subtitleRegister") : "输入邮箱验证码"}
        </p>
        {adminLoginUrl ? (
          <p className="mt-3 text-center">
            <a
              href={adminLoginUrl}
              className="text-sm text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("login.adminLoginEntry")}
            </a>
          </p>
        ) : null}

        <form className="mt-8 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              {mode === "login" ? t("login.accountLogin") : t("login.accountRegister")}
            </span>
            <input
              type={mode === "login" ? "text" : "email"}
              required
              autoComplete={mode === "login" ? "username" : "email"}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={mode === "login" ? t("login.phLogin") : t("login.phRegister")}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            />
          </label>
          {mode === "register" || mode === "verify" ? (
            <>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={isGofoEmployee}
                  onChange={(e) => setIsGofoEmployee(e.target.checked)}
                  disabled={mode === "verify"}
                />
                <span className="text-sm text-slate-700">{t("login.gofo")}</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("login.site")}
                  {isGofoEmployee ? t("login.siteRequired") : t("login.siteOptional")}
                </span>
                <input
                  type="text"
                  value={gofoSite}
                  onChange={(e) => setGofoSite(e.target.value)}
                  required={isGofoEmployee}
                  disabled={mode === "verify"}
                  placeholder="例如：上海站 / 广州站"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
                />
              </label>
            </>
          ) : null}
          {mode === "login" ? (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("login.password")}</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </label>
          ) : null}

          {mode === "verify" ? (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">邮箱验证码</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6 位数字"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </label>
          ) : null}

          {message ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {message}
            </div>
          ) : null}

          {mode === "login" ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleGoogleLogin()}
              className="w-full rounded-xl border border-slate-300 bg-white py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              使用 Google 登录
            </button>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
          >
            {loading
              ? t("login.wait")
              : mode === "login"
                ? t("login.loginBtn")
                : mode === "register"
                  ? "发送邮箱验证码"
                  : "验证并完成注册"}
          </button>

          {mode === "verify" ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleResendOtp()}
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              重新发送验证码
            </button>
          ) : null}
        </form>

        <div className="mt-6 flex justify-center gap-2 text-sm">
          {devMock && !supabaseOn ? (
            <span className="text-slate-500">{t("login.noRegister")}</span>
          ) : mode === "login" ? (
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => {
                setMode("register");
                setMessage("");
                setOtp("");
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
                setOtp("");
                setIsGofoEmployee(false);
                setGofoSite("");
              }}
            >
              {t("login.toLogin")}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
