"use client";

import { useState } from "react";

import { permanentlyDeleteRecycledUserAction, restoreRecycledUserAction } from "./actions";

type Row = {
  id: string;
  email: string | null;
  deleted_at: string;
  purge_at: string;
  deleted_by_email: string | null;
};

export function RecycleBinClient({ rows }: { rows: Row[] }) {
  const [target, setTarget] = useState<Row | null>(null);
  const [actionType, setActionType] = useState<"delete" | "restore" | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">用户</th>
              <th className="px-4 py-3 text-left">删除时间</th>
              <th className="px-4 py-3 text-left">自动清除（UTC）</th>
              <th className="px-4 py-3 text-left">操作人</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  回收站为空
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{r.email || r.id}</div>
                    <div className="max-w-[320px] truncate font-mono text-[11px] text-slate-500">{r.id}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{new Date(r.deleted_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600">{r.purge_at.slice(0, 19).replace("T", " ")}</td>
                  <td className="px-4 py-3 text-slate-600">{r.deleted_by_email || "—"}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTarget(r);
                        setActionType("restore");
                      }}
                      className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                    >
                      恢复登录
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTarget(r);
                        setActionType("delete");
                      }}
                      className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      永久删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {target && actionType ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
            aria-label="关闭"
            onClick={() => {
              setTarget(null);
              setActionType(null);
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className={`text-base font-semibold ${actionType === "delete" ? "text-rose-900" : "text-blue-900"}`}>
              {actionType === "delete" ? "永久删除" : "恢复登录权限"}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {actionType === "delete" ? (
                <>
                  将彻底删除该用户在 <code className="rounded bg-slate-100 px-1 text-xs">usage_logs</code>{" "}
                  中的用量记录，且无法恢复。请输入当前管理员登录密码确认。
                </>
              ) : (
                <>
                  将解除该用户的封禁状态，允许其重新登录系统，并从回收站中移除此记录。请输入当前管理员登录密码确认。
                </>
              )}
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">{target.id}</p>
            <form
              className="mt-4 space-y-3"
              action={actionType === "delete" ? permanentlyDeleteRecycledUserAction : restoreRecycledUserAction}
            >
              <input type="hidden" name="userId" value={target.id} />
              <input type="hidden" name="label" value={target.email || target.id} />
              <label className="block">
                <span className="text-xs font-medium text-slate-600">当前管理员登录密码</span>
                <input
                  name="adminPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  className={`mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 ${
                    actionType === "delete" ? "focus:border-rose-400 focus:ring-rose-200" : "focus:border-blue-400 focus:ring-blue-200"
                  }`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setTarget(null);
                    setActionType(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className={`rounded-xl px-4 py-2 text-sm font-medium text-white ${
                    actionType === "delete" ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {actionType === "delete" ? "确认永久删除" : "确认恢复"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
