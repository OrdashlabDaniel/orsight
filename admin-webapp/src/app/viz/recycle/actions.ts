"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { enableAuthUserLogin, getRegisteredUserById, hardDeleteAuthUser } from "@/lib/viz-auth-user-rpc";
import { assertAdminLoginPassword, requireVizAdminActor } from "@/lib/viz-admin-verify";
import { deleteRecycledUser, getRecycledUserById } from "@/lib/viz-recycle-store";
import { createServiceRoleClient } from "@/lib/supabase/service";

function redirectRecycle(params: Record<string, string>) {
  const u = new URLSearchParams(params);
  u.set("_r", String(Date.now()));
  redirect(`/viz/recycle?${u.toString()}`);
}

export type RecycleActionResult = { ok: string } | { err: string };

async function permanentlyDeleteRecycledUser(formData: FormData): Promise<RecycleActionResult> {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || userId;
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    return { err: "缺少 userId" };
  }

  const actor = await requireVizAdminActor("/viz/recycle");
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "密码校验失败";
    return { err: msg };
  }

  const sb = createServiceRoleClient();
  let row;
  try {
    row = await getRecycledUserById(sb, userId);
  } catch (e) {
    return { err: e instanceof Error ? e.message : "读取回收站失败" };
  }
  if (!row) {
    try {
      const authUser = await getRegisteredUserById(sb, userId);
      if (!authUser || (!authUser.banned_until && !authUser.deleted_at)) {
        return { err: "记录不存在或已被清除" };
      }
    } catch (e) {
      return { err: e instanceof Error ? e.message : "读取用户失败" };
    }
  }

  // Strong cleanup: ensure auth/admin rows are removed even if earlier soft-delete partially failed.
  // We MUST delete usage_logs FIRST to avoid foreign key violations when hard-deleting the auth user.
  const { error: usageDeleteError } = await sb.from("usage_logs").delete().eq("user_id", userId);
  if (usageDeleteError) {
    return { err: `delete_usage:${usageDeleteError.message}` };
  }

  const { error: adminDeleteError } = await sb.from("admin_users").delete().eq("id", userId);
  if (adminDeleteError) {
    return { err: `delete_admin:${adminDeleteError.message}` };
  }

  try {
    await hardDeleteAuthUser(sb, userId);
  } catch (e) {
    return { err: `delete_auth:${e instanceof Error ? e.message : "unknown"}` };
  }

  try {
    await deleteRecycledUser(sb, userId);
  } catch (e) {
    return { err: `delete_bin:${e instanceof Error ? e.message : "unknown"}` };
  }

  try {
    const authUser = await getRegisteredUserById(sb, userId);
    if (authUser) {
      return { err: "delete_auth:用户仍存在，页面不会移除该记录，请检查数据库删除权限" };
    }
  } catch (e) {
    return { err: e instanceof Error ? e.message : "删除后校验失败" };
  }

  revalidatePath("/viz");
  revalidatePath("/viz/recycle");
  return { ok: `已永久删除：${label}` };
}

async function restoreRecycledUser(formData: FormData): Promise<RecycleActionResult> {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || userId;
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    return { err: "缺少 userId" };
  }

  const actor = await requireVizAdminActor("/viz/recycle");
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "密码校验失败";
    return { err: msg };
  }

  const sb = createServiceRoleClient();
  let row;
  try {
    row = await getRecycledUserById(sb, userId);
  } catch (e) {
    return { err: e instanceof Error ? e.message : "读取回收站失败" };
  }
  if (!row) {
    try {
      const authUser = await getRegisteredUserById(sb, userId);
      if (!authUser || (!authUser.banned_until && !authUser.deleted_at)) {
        return { err: "记录不存在或已被清除" };
      }
    } catch (e) {
      return { err: e instanceof Error ? e.message : "读取用户失败" };
    }
  }

  // Restore the user: clear recycle state and re-enable login directly in auth.users.
  try {
    const restored = await enableAuthUserLogin(sb, userId);
    if (!restored) {
      return { err: "restore_auth:用户不存在或已被永久删除" };
    }
  } catch (e) {
    return { err: `restore_auth:${e instanceof Error ? e.message : "unknown"}` };
  }

  try {
    await deleteRecycledUser(sb, userId);
  } catch (e) {
    return { err: `delete_bin:${e instanceof Error ? e.message : "unknown"}` };
  }

  revalidatePath("/viz");
  revalidatePath("/viz/recycle");
  return { ok: `已恢复用户登录权限：${label}` };
}

export async function permanentlyDeleteRecycledUserMutation(formData: FormData): Promise<RecycleActionResult> {
  return await permanentlyDeleteRecycledUser(formData);
}

export async function restoreRecycledUserMutation(formData: FormData): Promise<RecycleActionResult> {
  return await restoreRecycledUser(formData);
}

export async function permanentlyDeleteRecycledUserAction(formData: FormData) {
  const result = await permanentlyDeleteRecycledUser(formData);
  if ("err" in result) {
    redirectRecycle({ err: result.err });
    return;
  }
  redirectRecycle({ notice: result.ok });
}

export async function restoreRecycledUserAction(formData: FormData) {
  const result = await restoreRecycledUser(formData);
  if ("err" in result) {
    redirectRecycle({ err: result.err });
    return;
  }
  redirectRecycle({ notice: result.ok });
}
