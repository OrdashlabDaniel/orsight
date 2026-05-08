import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

type AdminMetricCardProps = {
  label: string;
  value: string;
  description: string;
  icon?: ReactNode;
};

export function AdminMetricCard({
  label,
  value,
  description,
  icon,
}: AdminMetricCardProps) {
  return (
    <Card className="border-slate-200/90 bg-white">
      <CardContent className="p-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-slate-500">{label}</p>
            <p className="mt-2 text-[2rem] font-semibold tracking-tight text-slate-950">{value}</p>
            <p className="mt-1.5 max-w-[22ch] text-[11px] leading-5 text-slate-500">{description}</p>
          </div>
          {icon ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-slate-600">
              {icon}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
