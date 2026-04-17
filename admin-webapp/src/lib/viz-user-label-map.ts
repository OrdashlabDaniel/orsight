import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Best-effort display label for usage_logs.user_id (admin_users + list_registered_users).
 */
export async function buildUserDisplayLabelMap(sb: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const { data: admins } = await sb.from("admin_users").select("id,email");
  for (const row of admins ?? []) {
    const id = String(row.id);
    const label = (typeof row.email === "string" && row.email.trim()) || id;
    map.set(id, label);
  }

  const { data: reg, error } = await sb.rpc("list_registered_users");
  if (!error && reg) {
    for (const u of reg as Array<Record<string, unknown>>) {
      const id = String(u.id ?? "");
      if (!id) continue;
      const display =
        (typeof u.pod_username === "string" && u.pod_username.trim()) ||
        (typeof u.email === "string" && u.email.trim()) ||
        "unknown";
      if (!map.has(id)) {
        map.set(id, display);
      }
    }
  }

  return map;
}
