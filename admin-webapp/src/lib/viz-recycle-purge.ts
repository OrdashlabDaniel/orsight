import type { SupabaseClient } from "@supabase/supabase-js";

import { hardDeleteAuthUser } from "@/lib/viz-auth-user-rpc";
import { deleteRecycledUser, listRecycledUsers } from "@/lib/viz-recycle-store";

async function authUserExists(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await sb.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404 || error.message.toLowerCase().includes("not found")) {
      return false;
    }
    throw new Error(`auth.admin.getUserById: ${error.message}`);
  }
  return Boolean(data.user);
}

/**
 * Permanently removes expired recycle-bin rows and orphaned rows whose auth user
 * no longer exists. Safe to call on each request (no-op when nothing is due).
 *
 * Important: this function never "recovers" disabled auth users that are not in
 * the recycle store. The recycle bin is an explicit admin action, not a scanner
 * over every banned/deleted auth row.
 */
export async function purgeExpiredRecycledUsers(sb: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  const recycleRows = await listRecycledUsers(sb);

  const rowsById = new Map<string, { id: string; purge_at: string }>();
  for (const row of recycleRows) {
    const exists = await authUserExists(sb, row.id);
    if (!exists || row.purge_at <= nowIso) {
      rowsById.set(row.id, row);
    }
  }

  const rows = Array.from(rowsById.values());
  if (!rows.length) {
    return 0;
  }

  let n = 0;
  for (const row of rows) {
    const id = row.id;
    // Ensure all user-related rows are actually gone (idempotent best-effort).
    // We MUST delete usage_logs FIRST to avoid foreign key violations when hard-deleting the auth user.
    const { error: usageError } = await sb.from("usage_logs").delete().eq("user_id", id);
    if (usageError) {
      continue;
    }

    const { error: adminError } = await sb.from("admin_users").delete().eq("id", id);
    if (adminError) {
      continue;
    }

    if (await authUserExists(sb, id)) {
      try {
        await hardDeleteAuthUser(sb, id);
      } catch {
        // Don't count this row as purged if auth deletion unexpectedly fails.
        continue;
      }
    }

    try {
      await deleteRecycledUser(sb, id);
      n += 1;
    } catch {
      // ignore and keep row for retry
    }
  }
  return n;
}

export function defaultPurgeAtIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString();
}
