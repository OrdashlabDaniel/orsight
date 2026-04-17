import { revalidatePath } from "next/cache";

import { getRegisteredUserById, hardDeleteAuthUser } from "@/lib/viz-auth-user-rpc";
import { createServiceRoleClient } from "@/lib/supabase/service";

import type { VizAdminActor } from "@/lib/viz-admin-verify";
import { purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";

function isMissingRecycleBinTable(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const msg = (err?.message || "").toLowerCase();
  return (
    err?.code === "PGRST106" ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache") ||
    (msg.includes("relation") && msg.includes("viz_deleted_users") && msg.includes("does not exist"))
  );
}

async function bestEffortDeleteRecycleRow(userId: string) {
  const sb = createServiceRoleClient();
  const { error } = await sb.from("viz_deleted_users").delete().eq("id", userId);
  if (error && !isMissingRecycleBinTable(error)) {
    throw new Error(error.message);
  }
}

/**
 * Permanently delete a user and ALL related admin/viz data:
 * - Removes from admin_users
 * - Deletes usage_logs
 * - Deletes recycle-bin row (if table exists)
 * - Deletes the Auth user
 *
 * Caller must already have verified the acting admin's login password.
 */
export async function permanentlyDeleteUserAndData(
  userId: string,
  actor: VizAdminActor,
): Promise<{ ok: string } | { err: string }> {
  const sb = createServiceRoleClient();
  await purgeExpiredRecycledUsers(sb);

  const { data: admins } = await sb.from("admin_users").select("id");
  if (admins && admins.length === 1 && admins[0]!.id === userId) {
    return { err: "无法删除最后一位管理员：请先为其他账号赋予管理员权限。" };
  }

  const targetData = await getRegisteredUserById(sb, userId).catch((e) => {
    throw new Error(e instanceof Error ? e.message : "读取用户失败");
  });
  if (!targetData) {
    return { err: "用户不存在或已被删除" };
  }

  const email = targetData.email ?? userId;

  // Keep a small audit trail when recycle table exists (optional).
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
    return { err: `写入删除审计失败：${upsertRecycleErr.message}` };
  }

  // Remove admin role row (ignore missing).
  const { error: adminDeleteError } = await sb.from("admin_users").delete().eq("id", userId);
  if (adminDeleteError) {
    return { err: `移除管理员记录失败：${adminDeleteError.message}` };
  }

  // Delete usage logs (ignore missing).
  const { error: usageDeleteError } = await sb.from("usage_logs").delete().eq("user_id", userId);
  if (usageDeleteError) {
    return { err: `删除用量日志失败：${usageDeleteError.message}` };
  }

  // Delete auth user (the true account deletion).
  try {
    await hardDeleteAuthUser(sb, userId);
  } catch (e) {
    return { err: `删除登录账号失败：${e instanceof Error ? e.message : "unknown"}` };
  }

  // Clean recycle-bin/audit row if the table exists (so DB is actually gone).
  try {
    await bestEffortDeleteRecycleRow(userId);
  } catch (e) {
    return { err: `删除回收站记录失败：${e instanceof Error ? e.message : "unknown"}` };
  }

  revalidatePath("/viz");
  revalidatePath("/viz/recycle");
  revalidatePath(`/viz/users/${userId}`);

  return { ok: `已永久删除（含数据库用量日志）：${email}` };
}

