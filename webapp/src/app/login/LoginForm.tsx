"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  buildEmailVerifiedHref,
  buildSignupVerificationCallbackPath,
  EMAIL_VERIFIED_STORAGE_KEY,
  readEmailVerifiedEvent,
} from "@/lib/auth-email-verified";
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
import { POST_LOGIN_DEFAULT_PATH } from "@/lib/post-login-home";
import { isLoginStrictlyRequired, isSupabaseAuthEnabled } from "@/lib/supabase";

export function LoginForm() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || POST_LOGIN_DEFAULT_PATH;
  const configReason = searchParams.get("reason") === "config";
  const confirmEmailReason = searchParams.get("reason") === "confirm_email";
  const recycledReason = searchParams.get("reason") === "recycled";
  const authCode = searchParams.get("code");

  const [mode, setMode] = useState<"login" | "register" | "awaitingEmailConfirm">("login");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [signupHadAutoSession, setSignupHadAutoSession] = useState(false);
  const [isGofoEmployee, setIsGofoEmployee] = useState(false);
  const [gofoSite, setGofoSite] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [handledAuthCode, setHandledAuthCode] = useState<string | null>(null);
  const [bannedOAuthNotice, setBannedOAuthNotice] = useState(false);

  const devMock = isDevMockLoginEnabled();
  const supabaseOn = isSupabaseAuthEnabled();
  const adminLoginUrl = getAdminAppLoginUrl();

  function isAlreadyRegisteredError(message: string) {
    const raw = message.toLowerCase();
    return raw.includes("already registered") || raw.includes("already exists") || raw.includes("user already exists");
  }

  function isAlreadyConfirmedError(message: string) {
    const raw = message.toLowerCase();
    return raw.includes("already confirmed") || raw.includes("email already confirmed");
  }

  function isEmailNotConfirmedError(message: string) {
    return message.toLowerCase().includes("email not confirmed");
  }

  const goToEmailVerified = useCallback(
    (email?: string | null) => {
      const targetEmail =
        typeof email === "string" && email.trim() ? email.trim().toLowerCase() : account.trim().toLowerCase();
      router.replace(buildEmailVerifiedHref(nextPath, targetEmail));
    },
    [account, nextPath, router],
  );

  async function resendSignupEmailFor(email: string, supabase = createClient()) {
    const emailRedirectTo = `${window.location.origin}${buildSignupVerificationCallbackPath(nextPath)}`;
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo },
    });
    return error;
  }

  async function moveToAwaitingConfirm(
    email: string,
    options?: {
      supabase?: ReturnType<typeof createClient>;
      tryResend?: boolean;
      keepMessage?: string;
      resetAutoSession?: boolean;
    },
  ) {
    const nextEmail = email.trim().toLowerCase();
    setAccount(nextEmail);
    setPassword("");
    setPasswordConfirm("");
    if (options?.resetAutoSession !== false) {
      setSignupHadAutoSession(false);
    }
    setMode("awaitingEmailConfirm");

    if (options?.keepMessage) {
      setMessage(options.keepMessage);
      return;
    }

    if (!options?.tryResend) {
      setMessage("");
      return;
    }

    const resendError = await resendSignupEmailFor(nextEmail, options.supabase);
    if (!resendError) {
      setMessage(t("login.signupEmailResent"));
      return;
    }
    if (isAlreadyConfirmedError(resendError.message || "")) {
      goToEmailVerified(nextEmail);
      return;
    }
    setMessage(resendError.message);
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) {
      return;
    }
    const hp = new URLSearchParams(hash);
    const errorCode = hp.get("error_code");
    const errorDesc = (hp.get("error_description") ?? "").toLowerCase();
    if (errorCode === "user_banned" || errorDesc.includes("banned")) {
      setBannedOAuthNotice(true);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  useEffect(() => {
    if (mode !== "login") {
      setBannedOAuthNotice(false);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "awaitingEmailConfirm" || typeof window === "undefined") {
      return;
    }

    const maybeRedirectToVerified = (raw?: string | null) => {
      const event = readEmailVerifiedEvent(raw ?? window.localStorage.getItem(EMAIL_VERIFIED_STORAGE_KEY));
      if (!event) {
        return false;
      }

      const currentEmail = account.trim().toLowerCase();
      if (event.email && currentEmail && event.email !== currentEmail) {
        return false;
      }

      window.localStorage.removeItem(EMAIL_VERIFIED_STORAGE_KEY);
      goToEmailVerified(event.email || currentEmail);
      return true;
    };

    maybeRedirectToVerified();

    function handleStorage(event: StorageEvent) {
      if (event.key !== EMAIL_VERIFIED_STORAGE_KEY || !event.newValue) {
        return;
      }
      maybeRedirectToVerified(event.newValue);
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [account, goToEmailVerified, mode]);

  useEffect(() => {
    if (!supabaseOn || !authCode || handledAuthCode === authCode) {
      return;
    }

    let cancelled = false;
    setHandledAuthCode(authCode);
    setLoading(true);
    setMessage("");

    (async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(authCode);
        if (error) {
          throw error;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const meta = user.user_metadata ?? {};
          const existing = meta[POD_USERNAME_METADATA_KEY];
          if (typeof existing !== "string" || !existing.trim()) {
            const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
            const name = typeof meta.name === "string" ? meta.name.trim() : "";
            const emailLocal =
              user.email && user.email.includes("@") ? user.email.split("@")[0]!.trim() : "";
            const podUsername = fullName || name || emailLocal || "user";
            await supabase.auth.updateUser({
              data: { [POD_USERNAME_METADATA_KEY]: podUsername },
            });
          }
        }

        if (!cancelled) {
          router.replace(nextPath);
          router.refresh();
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : t("login.errGoogleStart"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authCode, handledAuthCode, nextPath, router, supabaseOn, t]);

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
              <Link href={POST_LOGIN_DEFAULT_PATH} className="text-blue-600 hover:underline">
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
        if (password.length < 6) {
          setMessage(t("login.errPasswordShort"));
          return;
        }
        if (password !== passwordConfirm) {
          setMessage(t("login.errPasswordMismatch"));
          return;
        }
        const trimmedSite = gofoSite.trim();
        if (isGofoEmployee && !trimmedSite) {
          setMessage(t("login.errGofoSite"));
          return;
        }
        const emailRedirectTo = `${window.location.origin}${buildSignupVerificationCallbackPath(nextPath)}`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo,
            data: {
              [POD_USERNAME_METADATA_KEY]: email,
              [GOFO_EMPLOYEE_METADATA_KEY]: isGofoEmployee,
              [GOFO_SITE_METADATA_KEY]: isGofoEmployee ? trimmedSite : null,
            },
          },
        });
        if (error) {
          if (isAlreadyRegisteredError(error.message || "")) {
            await moveToAwaitingConfirm(email, { supabase, tryResend: true });
            return;
          }
          setMessage(error.message);
          return;
        }
        const identities = Array.isArray(data.user?.identities) ? data.user.identities : [];
        if (!data.session && identities.length === 0) {
          await moveToAwaitingConfirm(email, { supabase, tryResend: true });
          return;
        }
        const hadAutoSession = Boolean(data.session);
        if (hadAutoSession) {
          await supabase.auth.signOut();
        }
        setSignupHadAutoSession(hadAutoSession);
        await moveToAwaitingConfirm(email, { resetAutoSession: false });
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
        const em = error.message.toLowerCase();
        if (em.includes("banned") || em.includes("user is banned")) {
          setMessage(t("login.accountDisabledContactSupport"));
          return;
        }
        if (isEmailNotConfirmedError(error.message || "")) {
          await moveToAwaitingConfirm(loginEmail, { supabase, tryResend: true });
          return;
        }
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
      const checkRes = await fetch(`/api/auth/google/status?next=${encodeURIComponent(nextPath)}`, {
        method: "GET",
      });
      const check = (await checkRes.json().catch(() => null)) as
        | { ok?: boolean; reason?: string; message?: string }
        | null;
      if (!check?.ok) {
        if (check?.reason === "provider_disabled") {
          setMessage(t("login.errGoogleNotEnabled"));
        } else {
          setMessage(check?.message || t("login.errGoogleStart"));
        }
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) {
        const raw = error.message.toLowerCase();
        if (raw.includes("provider is not enabled") || raw.includes("unsupported provider")) {
          setMessage(t("login.errGoogleNotEnabled"));
        } else {
          setMessage(error.message || t("login.errGoogleStart"));
        }
        return;
      }
      if (data.url) {
        window.location.assign(data.url);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendSignupEmail() {
    setMessage("");
    setLoading(true);
    try {
      const email = account.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        setMessage(t("login.errEmail"));
        return;
      }
      const error = await resendSignupEmailFor(email);
      if (error) {
        if (isAlreadyConfirmedError(error.message || "")) {
          goToEmailVerified(email);
          return;
        }
        setMessage(error.message);
        return;
      }
      setMessage(t("login.signupEmailResent"));
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
        {confirmEmailReason ? (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900">
            {t("login.confirmEmailBeforeAccess")}
          </p>
        ) : null}
        {recycledReason ? (
          <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-sm text-rose-900">
            {t("login.recycledBeforeAccess")}
          </p>
        ) : null}
        {bannedOAuthNotice ? (
          <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-sm text-rose-900">
            {t("login.accountDisabledContactSupport")}
          </p>
        ) : null}
        <h1 className="text-center text-2xl font-semibold text-slate-900">OrSight</h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          {mode === "login"
            ? t("login.subtitleLogin")
            : mode === "register"
              ? t("login.subtitleRegister")
              : t("login.subtitleAwaitingConfirm")}
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

        {mode === "awaitingEmailConfirm" ? (
          <div className="mt-8 space-y-4">
            <p className="text-sm text-slate-600">{t("login.confirmEmailBody", { email: account.trim() })}</p>
            <p className="text-xs leading-relaxed text-slate-500">{t("login.confirmEmailAuthRowNote")}</p>
            {signupHadAutoSession ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t("login.warnConfirmEmailSetting")}
              </div>
            ) : null}
            {message ? (
              <div
                className={
                  message === t("login.signupEmailResent")
                    ? "rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                    : "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                }
              >
                {message}
              </div>
            ) : null}
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleResendSignupEmail()}
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("login.resendSignupEmailBtn")}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setMode("login");
                setMessage("");
                setPassword("");
                setPasswordConfirm("");
                setSignupHadAutoSession(false);
                setIsGofoEmployee(false);
                setGofoSite("");
              }}
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("login.toLogin")}
            </button>
          </div>
        ) : (
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
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("login.password")}</span>
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
            {mode === "register" ? (
              <>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">{t("login.passwordConfirm")}</span>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={6}
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
                  />
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={isGofoEmployee}
                    onChange={(e) => setIsGofoEmployee(e.target.checked)}
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
                    placeholder={t("login.sitePh")}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
                  />
                </label>
              </>
            ) : null}

            {message ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {message}
              </div>
            ) : null}

            {mode === "login" ? (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void handleGoogleLogin()}
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                >
                  {t("login.googleBtn")}
                </button>
                <p className="text-center text-xs text-slate-500">{t("login.googleHint")}</p>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-slate-900 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              {loading ? t("login.wait") : mode === "login" ? t("login.loginBtn") : t("login.registerSubmitBtn")}
            </button>
          </form>
        )}

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
                setPassword("");
                setPasswordConfirm("");
                setIsGofoEmployee(false);
                setGofoSite("");
              }}
            >
              {t("login.toRegister")}
            </button>
          ) : mode === "register" ? (
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => {
                setMode("login");
                setMessage("");
                setPassword("");
                setPasswordConfirm("");
                setIsGofoEmployee(false);
                setGofoSite("");
              }}
            >
              {t("login.toLogin")}
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
