"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { permanentlyDeleteRecycledUserMutation, restoreRecycledUserMutation } from "./actions";

type Row = {
  id: string;
  email: string | null;
  deleted_at: string;
  purge_at: string;
  deleted_by_email: string | null;
};

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString("en-US");
}

function daysUntil(value: string) {
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) {
    return "Unknown";
  }
  const remainingMs = target - Date.now();
  if (remainingMs <= 0) {
    return "Due now";
  }
  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export function UserRecycleBinClient({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<Row | null>(null);
  const [actionType, setActionType] = useState<"delete" | "restore" | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [flash, setFlash] = useState<{ ok?: string; err?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const visibleRows = useMemo(() => rows.filter((row) => !hiddenIds.includes(row.id)), [hiddenIds, rows]);

  function closeDialog() {
    setTarget(null);
    setActionType(null);
  }

  async function submitCurrentAction(formData: FormData) {
    const currentAction = actionType;
    const userId = String(formData.get("userId") ?? "").trim();
    if (!currentAction || !userId) {
      setFlash({ err: "Missing action target. Please try again." });
      return;
    }

    setFlash(null);
    const result =
      currentAction === "delete"
        ? await permanentlyDeleteRecycledUserMutation(formData)
        : await restoreRecycledUserMutation(formData);

    setFlash(result);
    if ("err" in result) {
      return;
    }

    setHiddenIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    closeDialog();
    router.refresh();
  }

  return (
    <>
      {flash ? (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            flash.err
              ? "border border-rose-200 bg-rose-50 text-rose-900"
              : "border border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {flash.err || flash.ok}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Deleted</th>
              <th className="px-5 py-3 font-medium">Auto Permanent Delete</th>
              <th className="px-5 py-3 font-medium">Deleted By</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-5 py-4">
                  <Link href={`/users/${row.id}`} className="font-medium text-slate-950 hover:text-blue-700">
                    {row.email || row.id}
                  </Link>
                  <div className="mt-1 max-w-[360px] truncate font-mono text-[11px] text-slate-400">{row.id}</div>
                </td>
                <td className="px-5 py-4 text-slate-600">{formatDate(row.deleted_at)}</td>
                <td className="px-5 py-4 text-slate-600">
                  <div>{formatDate(row.purge_at)}</div>
                  <div className="mt-1 text-xs text-slate-400">{daysUntil(row.purge_at)}</div>
                </td>
                <td className="px-5 py-4 text-slate-600">{row.deleted_by_email || "-"}</td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setFlash(null);
                        setTarget(row);
                        setActionType("restore");
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setFlash(null);
                        setTarget(row);
                        setActionType("delete");
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Permanently
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-500">
                  The recycle bin is empty.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {target && actionType ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
            aria-label="Close"
            onClick={closeDialog}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={`text-base font-semibold ${actionType === "delete" ? "text-rose-900" : "text-blue-900"}`}>
                  {actionType === "delete" ? "Delete Permanently" : "Restore Login"}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {actionType === "delete"
                    ? "This permanently removes the auth user and retained usage logs. This cannot be undone."
                    : "This clears the recycle-bin lock and allows the user to sign in again."}
                </p>
              </div>
              <button
                type="button"
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={closeDialog}
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 break-all font-mono text-[11px] text-slate-500">{target.id}</p>
            <form
              className="mt-4 space-y-3"
              action={(formData) =>
                startTransition(async () => {
                  await submitCurrentAction(formData);
                })
              }
            >
              <input type="hidden" name="userId" value={target.id} />
              <input type="hidden" name="label" value={target.email || target.id} />
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Current admin password</span>
                <input
                  name="adminPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  className={`mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 ${
                    actionType === "delete"
                      ? "focus:border-rose-400 focus:ring-rose-200"
                      : "focus:border-blue-400 focus:ring-blue-200"
                  }`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={closeDialog}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className={`rounded-xl px-4 py-2 text-sm font-medium text-white ${
                    actionType === "delete" ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isPending ? "Working..." : actionType === "delete" ? "Confirm Permanent Delete" : "Confirm Restore"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
