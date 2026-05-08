import { differenceInCalendarDays } from "date-fns";

export const ADMIN_RANGE_PRESET_OPTIONS = [7, 30, 90, 180] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type AdminTimeRangeInput = {
  days?: number | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type AdminTimeRange = {
  mode: "preset" | "custom";
  days: number;
  startIso: string;
  endIso: string;
  startUnix: number;
  endUnix: number;
  startDateLabel: string;
  endDateLabel: string;
  rangeLabel: string;
};

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && ISO_DATE_RE.test(value));
}

function utcDateFromIsoDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildPresetRange(days: number): AdminTimeRange {
  const safeDays = ADMIN_RANGE_PRESET_OPTIONS.includes(days as (typeof ADMIN_RANGE_PRESET_OPTIONS)[number]) ? days : 30;
  const now = new Date();
  const utcTodayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = addUtcDays(utcTodayStart, -(safeDays - 1));
  const end = addUtcDays(utcTodayStart, 1);

  const startDateLabel = start.toISOString().slice(0, 10);
  const endDateLabel = new Date(end.getTime() - 1).toISOString().slice(0, 10);

  return {
    mode: "preset",
    days: safeDays,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(end.getTime() / 1000),
    startDateLabel,
    endDateLabel,
    rangeLabel: `${startDateLabel} to ${endDateLabel}`,
  };
}

export function buildAdminTimeRange(input: AdminTimeRangeInput): AdminTimeRange {
  if (isIsoDate(input.startDate) && isIsoDate(input.endDate)) {
    const start = utcDateFromIsoDate(input.startDate);
    const inclusiveEnd = utcDateFromIsoDate(input.endDate);
    if (inclusiveEnd >= start) {
      const exclusiveEnd = new Date(inclusiveEnd);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      const dayCount = differenceInCalendarDays(inclusiveEnd, start) + 1;
      return {
        mode: "custom",
        days: dayCount,
        startIso: start.toISOString(),
        endIso: exclusiveEnd.toISOString(),
        startUnix: Math.floor(start.getTime() / 1000),
        endUnix: Math.floor(exclusiveEnd.getTime() / 1000),
        startDateLabel: input.startDate,
        endDateLabel: input.endDate,
        rangeLabel: `${input.startDate} to ${input.endDate}`,
      };
    }
  }

  return buildPresetRange(input.days ?? 30);
}
