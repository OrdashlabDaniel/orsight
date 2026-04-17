"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";

import { VizIdentityBadges } from "@/components/VizIdentityBadges";

import { deleteUserAction, grantAdminAction, revokeAdminAction } from "./actions";

type Props = {
  userId: string;
  displayLabel: string;
  authEmail: string;
  isRegisteredUser: boolean;
  isAdmin: boolean;
  canRevokeAdmin: boolean;
  returnView: "users" | "admins";
};

export function VizUserEditDrawer({
  userId,
  displayLabel,
  authEmail,
  isRegisteredUser,
  isAdmin,
  canRevokeAdmin,
  returnView,
}: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const drawer =
    open &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <button
          type="button"
          className="absolute inset-0 cursor-pointer bg-slate-900/45 backdrop-blur-[2px] transition-colors duration-200 hover:bg-slate-900/55"
          aria-label="关闭"
          onClick={() => setOpen(false)}
        />
        <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-slate-900">
                用户操作
              </h2>
              <p id={descriptionId} className="mt-1 truncate text-sm font-medium text-slate-800">
                {displayLabel}
              </p>
              <p className="mt-0.5 break-all font-mono text-[11px] leading-snug text-slate-500">{userId}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 cursor-pointer rounded-lg p-1.5 text-slate-500 transition-all duration-150 hover:bg-slate-100 hover:text-slate-900 hover:ring-2 hover:ring-slate-200/80 active:scale-95"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-5 px-5 py-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">当前身份</p>
              <VizIdentityBadges isRegisteredUser={isRegisteredUser} isAdmin={isAdmin} />
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
              <p className="mb-3 text-xs font-semibold text-slate-700">权限</p>
              <div className="flex flex-col gap-2">
                <Link
                  href={`/viz/users/${encodeURIComponent(userId)}`}
                  className="group inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50 hover:shadow-md active:translate-y-0 active:scale-[0.98]"
                >
                  查看详情
                  <span className="ml-2 text-slate-400 transition-colors duration-150 group-hover:text-slate-700">→</span>
                </Link>
                {!isAdmin ? (
                  <form action={grantAdminAction} className="w-full space-y-2">
                    <input type="hidden" name="userId" value={userId} />
                    <input type="hidden" name="email" value={authEmail} />
                    <input type="hidden" name="returnView" value={returnView} />
                    <label className="block text-left">
                      <span className="text-[11px] font-medium text-slate-600">管理员密码</span>
                      <input
                        name="adminPassword"
                        type="password"
                        autoComplete="current-password"
                        required
                        className="mt-0.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      className="w-full cursor-pointer rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25 active:scale-[0.98] active:shadow-sm"
                    >
                      设为管理员
                    </button>
                    <p className="mt-2 text-xs text-slate-500">
                      写入 <code className="rounded bg-white px-1">public.admin_users</code>，不删除账号。
                    </p>
                  </form>
                ) : (
                  <form action={revokeAdminAction} className="w-full">
                    <input type="hidden" name="userId" value={userId} />
                    <input type="hidden" name="label" value={displayLabel} />
                    <input type="hidden" name="returnView" value={returnView} />
                    <button
                      type="submit"
                      disabled={!canRevokeAdmin}
                      title={
                        !canRevokeAdmin
                          ? "至少需要保留一位管理员"
                          : "仅从 admin_users 移除，不删除登录账号"
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition-all duration-150 enabled:cursor-pointer enabled:hover:border-slate-400 enabled:hover:bg-slate-50 enabled:hover:shadow-md enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      移除管理员权限
                    </button>
                    {!canRevokeAdmin ? (
                      <p className="mt-2 text-xs text-amber-800">
                        当前为最后一位管理员，请先为其他账号赋予管理员权限后再移除此权限。
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        仅从 <code className="rounded bg-white px-1">admin_users</code> 移除，登录账号保留。
                      </p>
                    )}
                  </form>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-rose-200/80 bg-rose-50/50 p-4">
              <p className="mb-3 text-xs font-semibold text-rose-900">危险操作</p>
              <form action={deleteUserAction} className="w-full space-y-2">
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="label" value={displayLabel} />
                <input type="hidden" name="returnView" value={returnView} />
                <label className="block text-left">
                  <span className="text-[11px] font-medium text-rose-900">管理员密码</span>
                  <input
                    name="adminPassword"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="mt-0.5 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  className="w-full cursor-pointer rounded-lg border border-rose-300 bg-white px-4 py-2.5 text-sm font-medium text-rose-700 shadow-sm transition-all duration-150 hover:border-rose-400 hover:bg-rose-100 hover:shadow-md hover:shadow-rose-500/15 active:scale-[0.98]"
                >
                  删除用户（移入回收站）
                </button>
                <p className="mt-2 text-xs text-rose-800/90">
                  需先确认：移入回收站后停用登录并移除管理员记录；用量日志暂存最多 30 天，可在回收站永久删除。
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ position: "relative", zIndex: 50, pointerEvents: "auto" }}
        className="group inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50 hover:shadow-md active:translate-y-0 active:scale-[0.98] active:shadow-sm"
      >
        <Pencil
          className="h-3.5 w-3.5 text-slate-500 transition-colors duration-150 group-hover:text-blue-600"
          aria-hidden
        />
        <span className="transition-colors duration-150 group-hover:text-slate-900">编辑</span>
      </button>

      {drawer}
    </>
  );
}
