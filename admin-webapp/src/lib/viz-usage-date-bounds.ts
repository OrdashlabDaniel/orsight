function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseISODateOnly(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function addDays(dateOnly: string, deltaDays: number) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return isoDay(d);
}

export type UsageDateBounds = {
  fromDay: string | null;
  toDay: string | null;
  today: string;
};

/**
 * Mirrors /viz/users/[id] time filter: range 7|30|90|all|custom with from/to.
 */
export function resolveUsageDateBounds(
  range: string,
  fromQ: string | null,
  toQ: string | null,
  now = new Date(),
): UsageDateBounds {
  const today = isoDay(now);
  let fromDay: string | null = null;
  let toDay: string | null = null;

  if (fromQ || toQ) {
    fromDay = fromQ;
    toDay = toQ;
  } else if (range === "7" || range === "30" || range === "90") {
    const days = Number(range);
    toDay = today;
    fromDay = addDays(today, -(days - 1));
  } else if (range === "all") {
    fromDay = null;
    toDay = null;
  } else {
    toDay = today;
    fromDay = addDays(today, -29);
  }

  return { fromDay, toDay, today };
}

export function parseUsageDateBoundsFromSearchParams(sp: URLSearchParams): UsageDateBounds {
  const range = (sp.get("range") || "30").trim();
  const fromQ = parseISODateOnly(sp.get("from"));
  const toQ = parseISODateOnly(sp.get("to"));
  return resolveUsageDateBounds(range, fromQ, toQ);
}

export function utcStartOfDay(dateOnly: string) {
  return `${dateOnly}T00:00:00.000Z`;
}

export function utcEndOfDay(dateOnly: string) {
  return `${dateOnly}T23:59:59.999Z`;
}
