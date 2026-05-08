"use client";

import { useSearchParams } from "next/navigation";

function resolveErrorMessage(code: string | null): string | null {
  switch (code) {
    case "missing_credentials":
      return "Enter both the admin login name and password.";
    case "invalid_credentials":
      return "The admin login name or password is incorrect.";
    case "login_failed":
      return "Sign in failed. Please try again.";
    case "auth_callback_failed":
      return "Authentication callback failed. Please sign in again.";
    default:
      return null;
  }
}

export default function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const errorCode = searchParams.get("error");
  const message = resolveErrorMessage(errorCode);

  return (
    <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 text-sm font-semibold tracking-[0.16em] text-white shadow-sm">
          OA
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">OrSight Admin</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-slate-900">Admin Sign In</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use an admin login name and password to enter the backend.
          </p>
        </div>
      </div>

      {message ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {message}
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
        <span className="font-medium text-slate-800">Rule:</span>
        {" "}Only admin accounts can enter this backend. The admin directory and password are managed inside the console.
      </div>

      <form className="mt-6 space-y-4" action="/auth/password-login" method="post">
        <input type="hidden" name="next" value={nextPath} />

        <div>
          <label className="block text-sm font-medium text-slate-700">Admin Login Name</label>
          <input
            name="identifier"
            type="text"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500"
            placeholder="Enter admin login name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Password</label>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500"
            placeholder="Enter admin password"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          Sign In
        </button>
      </form>
    </div>
  );
}
