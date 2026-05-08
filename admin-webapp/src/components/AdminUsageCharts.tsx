"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DailyPoint = {
  date: string;
  tokens: number;
};

type DailySpendPoint = {
  date: string;
  spendUsd: number;
};

type ModelSharePoint = {
  name: string;
  tokens: number;
};

type AdminUsageChartsProps = {
  daily: DailyPoint[];
  modelShares: ModelSharePoint[];
  spendDaily?: DailySpendPoint[];
  trendMode?: "tokens" | "spend";
  trendTitle?: string;
  modelTitle?: string;
  spendEmptyText?: string;
};

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCompactUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTooltipValue(
  value: string | number | ReadonlyArray<string | number> | undefined,
) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "number") {
    return value.toLocaleString("en-US");
  }
  return value || "";
}

function formatTooltipUsd(
  value: string | number | ReadonlyArray<string | number> | undefined,
) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  }
  return value || "";
}

export function AdminUsageCharts({
  daily,
  modelShares,
  spendDaily = [],
  trendMode = "tokens",
  trendTitle = "Usage Trend",
  modelTitle = "Model Mix",
  spendEmptyText = "Official spend data is unavailable for the selected scope.",
}: AdminUsageChartsProps) {
  const topModelShares = modelShares.slice(0, 6);
  const wantsSpendTrend = trendMode === "spend";
  const usingSpendTrend = wantsSpendTrend && spendDaily.length > 0;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
      <Card className="overflow-hidden border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70">
          <CardTitle className="text-[15px] text-slate-900">{trendTitle}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {usingSpendTrend ? (
            <div className="h-[280px] px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spendDaily} margin={{ top: 12, right: 16, left: 6, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    tickFormatter={formatCompactUsd}
                  />
                  <Tooltip
                    formatter={(value) => formatTooltipUsd(value)}
                    labelClassName="text-slate-700"
                    contentStyle={{
                      borderRadius: 14,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
                    }}
                  />
                  <Bar dataKey="spendUsd" fill="#7c3aed" radius={[8, 8, 0, 0]} maxBarSize={64} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : wantsSpendTrend ? (
            <div className="flex h-[280px] items-center justify-center px-6 text-center text-sm text-slate-500">
              {spendEmptyText}
            </div>
          ) : daily.length > 0 ? (
            <div className="h-[280px] px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 12, right: 16, left: 6, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={formatCompactNumber}
                  />
                  <Tooltip
                    formatter={(value) => formatTooltipValue(value)}
                    labelClassName="text-slate-700"
                    contentStyle={{
                      borderRadius: 14,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
                    }}
                  />
                  <Bar dataKey="tokens" fill="#0f172a" radius={[8, 8, 0, 0]} maxBarSize={64} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[280px] items-center justify-center px-6 text-sm text-slate-500">
              No usage data yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70">
          <CardTitle className="text-[15px] text-slate-900">{modelTitle}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {topModelShares.length > 0 ? (
            <div className="h-[280px] px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topModelShares} layout="vertical" margin={{ top: 8, right: 18, left: 24, bottom: 8 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatCompactNumber}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fill: "#334155", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={78}
                  />
                  <Tooltip
                    formatter={(value) => formatTooltipValue(value)}
                    labelClassName="text-slate-700"
                    contentStyle={{
                      borderRadius: 14,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
                    }}
                  />
                  <Bar dataKey="tokens" fill="#2563eb" radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[280px] items-center justify-center px-6 text-sm text-slate-500">
              No model usage yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
