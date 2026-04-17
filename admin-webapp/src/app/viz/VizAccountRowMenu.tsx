"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";

import { deleteUserAction, grantAdminAction } from "./actions";

type Props = {
  userId: string;
  displayLabel: string;
  authEmail: string;
  isAdmin: boolean;
  returnView: "users" | "admins";
};

type ModalMode = "grant" | "delete" | null;

export function VizAccountRowMenu({ userId, displayLabel, authEmail, isAdmin, returnView }: Props) {
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<ModalMode>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div ref={wrapRef} className="relative inline-flex justify-end">
      <button
        type="button"
        id={menuId}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md active:scale-[0.98]"
      >
        <Pencil className="h-3.5 w-3.5 text-slate-500" aria-hidden />
        <span>编辑</span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition ${menuOpen ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {menuOpen ? (
        <div
          role="menu"
          aria-labelledby={menuId}
          className="absolute right-0 z-[60] mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {!isAdmin ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-xs text-slate-800 hover:bg-slate-50"
              onClick={() => {
                setMenuOpen(false);
                setModal("grant");
              }}
            >
              设为管理员
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-xs text-rose-700 hover:bg-rose-50"
            onClick={() => {
              setMenuOpen(false);
              setModal("delete");
            }}
          >
            删除用户
          </button>
        </div>
      ) : null}

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
                <>
                  将为 <strong className="text-slate-900">{displayLabel}</strong> 写入{" "}
                  <code className="rounded bg-slate-100 px-1 text-xs">admin_users</code>，不删除登录账号。
                </>
              ) : (
                <>
                  将把 <strong className="text-slate-900">{displayLabel}</strong>{" "}
                  移入回收站：立即停用登录与移除管理员记录，用量日志暂存最多 30 天，之后自动清除；也可在回收站提前永久删除。
                </>
              )}
            </p>
            <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{userId}</p>

            <form className="mt-4 space-y-3" action={modal === "grant" ? grantAdminAction : deleteUserAction}>
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="email" value={authEmail} />
              <input type="hidden" name="label" value={displayLabel} />
              <input type="hidden" name="returnView" value={returnView} />
              <label className="block">
                <span className="text-xs font-medium text-slate-600">当前管理员登录密码</span>
                <input
                  name="adminPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                  placeholder="输入密码以确认"
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
                      ? "rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                      : "rounded-xl border border-rose-300 bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700"
                  }
                >
                  {modal === "grant" ? "确认设为管理员" : "确认删除"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
