export function flattenMessages(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out[key] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenMessages(v as Record<string, unknown>, key));
    }
  }
  return out;
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template;
  }
  let s = template;
  for (const [k, val] of Object.entries(params)) {
    s = s.split(`{${k}}`).join(String(val));
  }
  return s;
}
