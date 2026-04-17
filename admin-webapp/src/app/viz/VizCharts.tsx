"use client";

import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PIE_COLORS = [
  "#0f172a",
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
];

type Props = {
  daily: { date: string; tokens: number }[];
  modelShares: { name: string; tokens: number }[];
};

export function VizCharts({ daily, modelShares }: Props) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const pieRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  const [pieSize, setPieSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.max(0, Math.floor(entry.contentRect.width));
        const height = Math.max(0, Math.floor(entry.contentRect.height));
        if (entry.target === areaRef.current) {
          setAreaSize({ width, height });
        }
        if (entry.target === pieRef.current) {
          setPieSize({ width, height });
        }
      }
    });

    if (areaRef.current) {
      observer.observe(areaRef.current);
    }
    if (pieRef.current) {
      observer.observe(pieRef.current);
    }

    return () => observer.disconnect();
  }, [mounted]);

  if (!mounted) {
    return (
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">每日 Token 用量</h2>
          <p className="mt-1 text-sm text-slate-500">按 UTC 日期汇总 total_tokens</p>
          <div className="mt-6 h-72 w-full rounded-xl bg-slate-50" />
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">模型占比（Token）</h2>
          <p className="mt-1 text-sm text-slate-500">按 model_used 汇总</p>
          <div className="mt-6 h-72 w-full rounded-xl bg-slate-50" />
        </div>
      </div>
    );
  }

  const pieData = modelShares.map((m) => ({
    name: m.name.length > 28 ? `${m.name.slice(0, 26)}…` : m.name,
    value: m.tokens,
  }));

  const totalPie = pieData.reduce((s, d) => s + d.value, 0) || 1;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* overflow-hidden：避免 Recharts SVG/测量层溢出盖住下方「编辑」等可点击区域 */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">每日 Token 用量</h2>
        <p className="mt-1 text-sm text-slate-500">按 UTC 日期汇总 total_tokens</p>
        <div ref={areaRef} className="mt-6 h-72 w-full">
          {daily.length === 0 ? (
            <p className="text-sm text-slate-400">暂无数据</p>
          ) : areaSize.width > 0 && areaSize.height > 0 ? (
            <AreaChart width={areaSize.width} height={areaSize.height} data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="vizFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#64748b" />
              <YAxis tick={{ fontSize: 11 }} stroke="#64748b" width={56} />
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  fontSize: "13px",
                }}
              />
              <Area
                type="monotone"
                dataKey="tokens"
                name="Tokens"
                stroke="#2563eb"
                strokeWidth={2}
                fill="url(#vizFill)"
              />
            </AreaChart>
          ) : (
            <div className="h-full w-full rounded-xl bg-slate-50" />
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">模型占比（Token）</h2>
        <p className="mt-1 text-sm text-slate-500">按 model_used 汇总</p>
        <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:justify-center">
          {pieData.length === 0 ? (
            <p className="text-sm text-slate-400">暂无数据</p>
          ) : (
            <>
              <div ref={pieRef} className="h-64 w-64 shrink-0">
                {pieSize.width > 0 && pieSize.height > 0 ? (
                  <PieChart width={pieSize.width} height={pieSize.height}>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]!} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => [
                        typeof v === "number" ? v.toLocaleString() : String(v ?? ""),
                        "Tokens",
                      ]}
                      contentStyle={{
                        borderRadius: "12px",
                        border: "1px solid #e2e8f0",
                        fontSize: "13px",
                      }}
                    />
                  </PieChart>
                ) : (
                  <div className="h-full w-full rounded-full bg-slate-50" />
                )}
              </div>
              <ul className="w-full max-w-sm space-y-2 text-sm">
                {modelShares.map((m, i) => (
                  <li
                    key={m.name}
                    className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                        }}
                      />
                      <span className="truncate font-medium text-slate-800">{m.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-600">
                      {m.tokens.toLocaleString()} (
                      {((m.tokens / totalPie) * 100).toFixed(1)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
