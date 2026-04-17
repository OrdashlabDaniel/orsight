import type { SupabaseClient } from "@supabase/supabase-js";

import { hardDeleteAuthUser, listRegisteredUsersWithStatus } from "@/lib/viz-auth-user-rpc";
import { deleteRecycledUser, listRecycledUsers } from "@/lib/viz-recycle-store";

function deriveDeletedAtFromBannedUntil(bannedUntil: string | null | undefined): string | null {
  if (!bannedUntil) return null;
  const d = new Date(bannedUntil);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() - 10);
  return d.toISOString();
}

function derivePurgeAtFromDeletedAt(deletedAt: string): string {
  const d = new Date(deletedAt);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString();
}

/**
 * Permanently removes expired recycle-bin rows and their usage_logs.
 * Safe to call on each request (no-op when nothing is due).
 */
export async function purgeExpiredRecycledUsers(sb: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  const recycleRows = await listRecycledUsers(sb);
  const recycleIds = new Set(recycleRows.map((row) => row.id));
  const authRows = await listRegisteredUsersWithStatus(sb);
  const derivedRows = authRows
    .filter((row) => !recycleIds.has(row.id) && (row.banned_until || row.deleted_at))
    .map((row) => {
      const deletedAt = row.deleted_at || deriveDeletedAtFromBannedUntil(row.banned_until) || new Date().toISOString();
      return {
        id: row.id,
        email: row.pod_username || row.email,
        deleted_at: deletedAt,
        purge_at: derivePurgeAtFromDeletedAt(deletedAt),
        deleted_by: null,
        deleted_by_email: null,
      };
    });

  const rows = [...recycleRows, ...derivedRows].filter((row) => row.purge_at <= nowIso);
  if (!rows.length) {
    return 0;
  }

  let n = 0;
  for (const row of rows) {
    const id = row.id;
    // Ensure all user-related rows are actually gone (idempotent best-effort).
    // We MUST delete usage_logs FIRST to avoid foreign key violations when hard-deleting the auth user.
    await sb.from("usage_logs").delete().eq("user_id", id);
    
    await sb.from("admin_users").delete().eq("id", id);
    try {
      await hardDeleteAuthUser(sb, id);
    } catch {
      // Don't count this row as purged if auth deletion unexpectedly fails.
      continue;
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
