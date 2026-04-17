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

export async function permanentlyDeleteRecycledUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || userId;
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    redirectRecycle({ err: "缺少 userId" });
    return;
  }

  const actor = await requireVizAdminActor("/viz/recycle");
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "密码校验失败";
    redirectRecycle({ err: msg });
    return;
  }

  const sb = createServiceRoleClient();
  let row;
  try {
    row = await getRecycledUserById(sb, userId);
  } catch (e) {
    redirectRecycle({ err: e instanceof Error ? e.message : "读取回收站失败" });
    return;
  }
  if (!row) {
    try {
      const authUser = await getRegisteredUserById(sb, userId);
      if (!authUser || (!authUser.banned_until && !authUser.deleted_at)) {
        redirectRecycle({ err: "记录不存在或已被清除" });
        return;
      }
    } catch (e) {
      redirectRecycle({ err: e instanceof Error ? e.message : "读取用户失败" });
      return;
    }
  }

  // Strong cleanup: ensure auth/admin rows are removed even if earlier soft-delete partially failed.
  // We MUST delete usage_logs FIRST to avoid foreign key violations when hard-deleting the auth user.
  const { error: usageDeleteError } = await sb.from("usage_logs").delete().eq("user_id", userId);
  if (usageDeleteError) {
    redirectRecycle({ err: `delete_usage:${usageDeleteError.message}` });
    return;
  }

  await sb.from("admin_users").delete().eq("id", userId);
  try {
    await hardDeleteAuthUser(sb, userId);
  } catch (e) {
    redirectRecycle({ err: `delete_auth:${e instanceof Error ? e.message : "unknown"}` });
    return;
  }

  try {
    await deleteRecycledUser(sb, userId);
  } catch (e) {
    redirectRecycle({ err: `delete_bin:${e instanceof Error ? e.message : "unknown"}` });
    return;
  }

  revalidatePath("/viz");
  revalidatePath("/viz/recycle");
  redirectRecycle({ notice: `已永久删除：${label}` });
}

export async function restoreRecycledUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || userId;
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    redirectRecycle({ err: "缺少 userId" });
    return;
  }

  const actor = await requireVizAdminActor("/viz/recycle");
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "密码校验失败";
    redirectRecycle({ err: msg });
    return;
  }

  const sb = createServiceRoleClient();
  let row;
  try {
    row = await getRecycledUserById(sb, userId);
  } catch (e) {
    redirectRecycle({ err: e instanceof Error ? e.message : "读取回收站失败" });
    return;
  }
  if (!row) {
    try {
      const authUser = await getRegisteredUserById(sb, userId);
      if (!authUser || (!authUser.banned_until && !authUser.deleted_at)) {
        redirectRecycle({ err: "记录不存在或已被清除" });
        return;
      }
    } catch (e) {
      redirectRecycle({ err: e instanceof Error ? e.message : "读取用户失败" });
      return;
    }
  }

  // Restore the user: clear recycle state and re-enable login directly in auth.users.
  try {
    const restored = await enableAuthUserLogin(sb, userId);
    if (!restored) {
      redirectRecycle({ err: "restore_auth:用户不存在或已被永久删除" });
      return;
    }
  } catch (e) {
    redirectRecycle({ err: `restore_auth:${e instanceof Error ? e.message : "unknown"}` });
    return;
  }

  try {
    await deleteRecycledUser(sb, userId);
  } catch (e) {
    redirectRecycle({ err: `delete_bin:${e instanceof Error ? e.message : "unknown"}` });
    return;
  }

  revalidatePath("/viz");
  revalidatePath("/viz/recycle");
  redirectRecycle({ notice: `已恢复用户登录权限：${label}` });
}
