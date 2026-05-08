import type { ReactNode } from "react";

type AdminPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function AdminPageHeader({
  eyebrow = "OrSight Admin",
  title,
  description,
  actions,
}: AdminPageHeaderProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
          <h1 className="mt-1.5 text-[2rem] font-semibold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-2 text-[13px] leading-6 text-slate-600">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2 self-start lg:self-auto">{actions}</div> : null}
      </div>
    </div>
  );
}
