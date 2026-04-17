"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type PresetDays = "7" | "30" | "90" | "all";

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clampDateStr(s: string): string {
  // input[type=date] already normalizes, we just guard empty
  return (s || "").slice(0, 10);
}

export function UserTimeRangeControls() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [mounted, setMounted] = useState(false);

  const preset = (sp.get("range") as PresetDays) || "30";
  const fromQ = sp.get("from") || "";
  const toQ = sp.get("to") || "";

  const today = useMemo(() => toISODate(new Date()), []);

  const [from, setFrom] = useState(clampDateStr(fromQ));
  const [to, setTo] = useState(clampDateStr(toQ));

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setFrom(clampDateStr(fromQ));
    setTo(clampDateStr(toQ));
  }, [fromQ, toQ, mounted]);

  function push(next: URLSearchParams) {
    next.delete("notice");
    next.delete("err");
    const qs = next.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  function setPreset(days: PresetDays) {
    const next = new URLSearchParams(sp.toString());
    next.set("range", days);
    next.delete("from");
    next.delete("to");
    push(next);
  }

  function applyCustom() {
    const next = new URLSearchParams(sp.toString());
    next.set("range", "custom");
    if (from) next.set("from", from);
    else next.delete("from");
    if (to) next.set("to", to);
    else next.delete("to");
    push(next);
  }

  if (!mounted) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">时间范围</p>
            <p className="mt-1 text-xs text-slate-500">用于筛选本用户的 usage_logs，并更新下方图表与明细</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="h-9 w-20 rounded-xl bg-slate-100" />
            <div className="h-9 w-20 rounded-xl bg-slate-100" />
            <div className="h-9 w-20 rounded-xl bg-slate-100" />
            <div className="h-9 w-16 rounded-xl bg-slate-100" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="h-[70px] rounded-xl bg-slate-50" />
          <div className="h-[70px] rounded-xl bg-slate-50" />
          <div className="h-11 rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">时间范围</p>
          <p className="mt-1 text-xs text-slate-500">用于筛选本用户的 usage_logs，并更新下方图表与明细</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ["7", "近 7 天"],
            ["30", "近 30 天"],
            ["90", "近 90 天"],
            ["all", "全部"],
          ] as Array<[PresetDays, string]>).map(([k, label]) => {
            const active = preset === k && !fromQ && !toQ;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setPreset(k)}
                className={`rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150 active:scale-[0.98] ${
                  active
                    ? "bg-slate-900 text-white shadow-inner hover:bg-slate-800"
                    : "border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:shadow-md"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">开始日期</span>
          <input
            type="date"
            max={to || today}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">结束日期</span>
          <input
            type="date"
            min={from || undefined}
            max={today}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
          />
        </label>
        <button
          type="button"
          onClick={applyCustom}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25 active:scale-[0.98]"
        >
          应用
        </button>
      </div>
    </div>
  );
}

