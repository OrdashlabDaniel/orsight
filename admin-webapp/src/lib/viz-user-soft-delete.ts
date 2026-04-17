import { revalidatePath } from "next/cache";

import { disableAuthUserLogin, getRegisteredUserById } from "@/lib/viz-auth-user-rpc";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { deleteRecycledUser, upsertRecycledUser } from "@/lib/viz-recycle-store";

import type { VizAdminActor } from "@/lib/viz-admin-verify";
import { defaultPurgeAtIso, purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";

/**
 * Moves a user into the recycle bin: removes admin_users row, soft-deletes auth user,
 * and keeps usage_logs until purge / permanent delete.
 * Caller must already have verified the acting admin's login password.
 */
export async function softDeleteUserToRecycle(
  userId: string,
  actor: VizAdminActor,
  fallbackEmail?: string | null,
): Promise<{ ok: string } | { err: string }> {
  const sb = createServiceRoleClient();
  await purgeExpiredRecycledUsers(sb);

  if (userId === actor.id) {
    return { err: "为避免误操作，不能在当前登录会话中删除自己。请用另一位管理员账号执行删除。" };
  }

  const { data: admins } = await sb.from("admin_users").select("id,email");
  const wasAdmin = Boolean(admins?.some((row) => row.id === userId));
  if (admins && admins.length === 1 && admins[0]!.id === userId) {
    return { err: "无法删除最后一位管理员：请先为其他账号赋予管理员权限。" };
  }

  const adminEmail =
    admins?.find((row) => row.id === userId)?.email && String(admins.find((row) => row.id === userId)?.email).trim()
      ? String(admins.find((row) => row.id === userId)?.email).trim()
      : null;
  const displayEmail = fallbackEmail?.trim() || adminEmail || userId;
  let authEmail = displayEmail;
  try {
    const targetData = await getRegisteredUserById(sb, userId);
    if (targetData?.email) {
      authEmail = targetData.email;
    }
  } catch (e) {
    return { err: e instanceof Error ? e.message : "读取 auth.users 失败" };
  }
  const deletedAt = new Date().toISOString();
  const purgeAt = defaultPurgeAtIso();

  try {
    await upsertRecycledUser(sb, {
      id: userId,
      email: displayEmail,
      deleted_at: deletedAt,
      purge_at: purgeAt,
      deleted_by: actor.id,
      deleted_by_email: actor.email,
    });
  } catch (e) {
    return { err: `写入回收站失败：${e instanceof Error ? e.message : "unknown"}` };
  }

  const { error: adminDeleteError } = await sb.from("admin_users").delete().eq("id", userId);
  if (adminDeleteError) {
    await deleteRecycledUser(sb, userId).catch(() => {});
    return { err: `移除管理员记录失败：${adminDeleteError.message}` };
  }

  // Recycle-bin flow must keep usage_logs for 30 days, so we disable login directly in auth.users
  // instead of hard-deleting the auth row.
  try {
    const disabledUser = await disableAuthUserLogin(sb, userId);
    if (disabledUser?.email) {
      authEmail = disabledUser.email;
    }
    if (!disabledUser) {
      if (wasAdmin) {
        await sb
          .from("admin_users")
          .upsert(
            {
              id: userId,
              email: displayEmail,
            },
            { onConflict: "id" },
          );
      }
      await deleteRecycledUser(sb, userId).catch(() => {});
      return { err: "删除登录账号失败：用户不存在或已被永久删除" };
    }
  } catch (e) {
    if (wasAdmin) {
      await sb
        .from("admin_users")
        .upsert(
          {
            id: userId,
            email: displayEmail,
          },
          { onConflict: "id" },
        );
    }
    await deleteRecycledUser(sb, userId).catch(() => {});
    return { err: `删除登录账号失败：${e instanceof Error ? e.message : "unknown"}` };
  }

  revalidatePath("/viz");
  revalidatePath("/viz/recycle");
  revalidatePath(`/viz/users/${userId}`);

  return {
    ok: `已移入回收站（登录已停用，用量数据暂存至 ${purgeAt.slice(0, 10)} UTC）：${displayEmail}${authEmail !== displayEmail ? ` [登录邮箱: ${authEmail}]` : ""}`,
  };
}
