import { revalidatePath } from "next/cache";

import { getRegisteredUserById, hardDeleteAuthUser } from "@/lib/viz-auth-user-rpc";
import { createServiceRoleClient } from "@/lib/supabase/service";

import type { VizAdminActor } from "@/lib/viz-admin-verify";
import { purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";
import { deleteRecycledUser } from "@/lib/viz-recycle-store";

type PermanentDeleteFallback = {
  email?: string | null;
};

function isMissingRecycleBinTable(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const msg = (err?.message || "").toLowerCase();
  return (
    err?.code === "PGRST106" ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache") ||
    (msg.includes("relation") && msg.includes("viz_deleted_users") && msg.includes("does not exist"))
  );
}

/**
 * Permanently delete a user and ALL related admin/viz data:
 * - Removes from admin_users
 * - Deletes usage_logs
 * - Deletes recycle-bin row/storage fallback
 * - Deletes the Auth user when it still exists
 *
 * Caller must already have verified the acting admin's login password.
 */
export async function permanentlyDeleteUserAndData(
  userId: string,
  actor: VizAdminActor,
  fallback?: PermanentDeleteFallback | null,
): Promise<{ ok: string } | { err: string }> {
  const sb = createServiceRoleClient();
  await purgeExpiredRecycledUsers(sb);

  const { data: admins } = await sb.from("admin_users").select("id");
  if (admins && admins.length === 1 && admins[0]!.id === userId) {
    return {
      err: "Cannot delete the last admin. Grant admin access to another account first.",
    };
  }

  const targetData = await getRegisteredUserById(sb, userId).catch((e) => {
    throw new Error(e instanceof Error ? e.message : "Failed to read auth user.");
  });
  if (!targetData && !fallback) {
    return { err: "User does not exist or has already been deleted." };
  }

  const email = targetData?.email ?? fallback?.email ?? userId;

  const { error: upsertRecycleErr } = await sb.from("viz_deleted_users").upsert(
    {
      id: userId,
      email,
      purge_at: new Date().toISOString(),
      deleted_by: actor.id,
      deleted_by_email: actor.email,
    },
    { onConflict: "id" },
  );
  if (upsertRecycleErr && !isMissingRecycleBinTable(upsertRecycleErr)) {
    return { err: `Failed to write delete audit row: ${upsertRecycleErr.message}` };
  }

  const { error: adminDeleteError } = await sb.from("admin_users").delete().eq("id", userId);
  if (adminDeleteError) {
    return { err: `Failed to remove admin row: ${adminDeleteError.message}` };
  }

  const { error: usageDeleteError } = await sb.from("usage_logs").delete().eq("user_id", userId);
  if (usageDeleteError) {
    return { err: `Failed to delete usage logs: ${usageDeleteError.message}` };
  }

  if (targetData) {
    try {
      await hardDeleteAuthUser(sb, userId);
    } catch (e) {
      return { err: `Failed to delete auth user: ${e instanceof Error ? e.message : "unknown"}` };
    }
  }

  try {
    await deleteRecycledUser(sb, userId);
  } catch (e) {
    return { err: `Failed to delete recycle-bin row: ${e instanceof Error ? e.message : "unknown"}` };
  }

  revalidatePath("/viz");
  revalidatePath("/viz/recycle");
  revalidatePath(`/viz/users/${userId}`);
  revalidatePath("/users");
  revalidatePath("/users/recycle");
  revalidatePath(`/users/${userId}`);

  return { ok: `Permanently deleted user data: ${email}` };
}
