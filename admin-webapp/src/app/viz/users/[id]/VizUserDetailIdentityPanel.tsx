"use client";

import { useState } from "react";

import {
  deleteUserFromVizUserDetailAction,
  grantAdminFromVizUserDetailAction,
  revokeAdminFromVizUserDetailAction,
} from "./actions";

type Props = {
  userId: string;
  userEmail: string;
  returnSearch: string;
  isAdmin: boolean;
  canRevokeAdmin: boolean;
};

type ModalMode = "grant" | "delete" | null;

export function VizUserDetailIdentityPanel({ userId, userEmail, returnSearch, isAdmin, canRevokeAdmin }: Props) {
  const [modal, setModal] = useState<ModalMode>(null);

  return (
    <>
      {!isAdmin ? (
        <button
          type="button"
          onClick={() => setModal("grant")}
          className="w-full cursor-pointer rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25 active:scale-[0.98]"
        >
          设为管理员
        </button>
      ) : (
        <form action={revokeAdminFromVizUserDetailAction}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="label" value={userEmail || userId} />
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

      {!isAdmin ? (
        <p className="text-xs text-slate-500">
          写入 <code className="rounded bg-slate-100 px-1">public.admin_users</code>，不删除登录账号。操作需验证当前管理员密码。
        </p>
      ) : null}

      <div className="border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={() => setModal("delete")}
          className="w-full cursor-pointer rounded-lg border border-rose-300 bg-white px-3 py-2.5 text-sm font-medium text-rose-700 shadow-sm transition-all duration-150 hover:border-rose-400 hover:bg-rose-50 hover:shadow-md hover:shadow-rose-500/15 active:scale-[0.98]"
        >
          删除用户
        </button>
        <p className="mt-2 text-xs text-rose-700">
          移入回收站：将停用该账号登录并移除 <code className="rounded bg-rose-100 px-1">admin_users</code>；
          <code className="rounded bg-rose-100 px-1">usage_logs</code> 暂存最多 30 天。需验证当前管理员密码。
        </p>
      </div>

      {modal ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
            aria-label="关闭"
            onClick={() => setModal(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {modal === "grant" ? "设为管理员" : "删除用户"}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {modal === "grant" ? (
                <>确认要为该账号赋予后台管理员权限？请输入你的管理员登录密码。</>
              ) : (
                <>
                  确认将该用户移入回收站？登录将立即停用，用量数据在回收站最多保留 30 天。请输入你的管理员登录密码。
                </>
              )}
            </p>

            <form
              className="mt-4 space-y-3"
              action={modal === "grant" ? grantAdminFromVizUserDetailAction : deleteUserFromVizUserDetailAction}
            >
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="email" value={userEmail || ""} />
              <input type="hidden" name="returnSearch" value={returnSearch} />
              {modal === "delete" ? <input type="hidden" name="returnView" value="users" /> : null}
              <label className="block">
                <span className="text-xs font-medium text-slate-600">当前管理员登录密码</span>
                <input
                  name="adminPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setModal(null)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className={
                    modal === "grant"
                      ? "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      : "rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
                  }
                >
                  {modal === "grant" ? "确认" : "确认删除"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
