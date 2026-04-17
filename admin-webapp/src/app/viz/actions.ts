"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertAdminLoginPassword, requireVizAdminActor } from "@/lib/viz-admin-verify";
import { purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { softDeleteUserToRecycle } from "@/lib/viz-user-soft-delete";

function vizRedirect(path: string) {
  revalidatePath("/viz");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}_r=${Date.now()}`);
}

export async function grantAdminAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const returnView = String(formData.get("returnView") ?? "users").trim();
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    vizRedirect(`/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent("缺少 userId")}`);
    return;
  }

  const actor = await requireVizAdminActor();
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "密码校验失败";
    vizRedirect(`/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(msg)}`);
    return;
  }

  const sb = createServiceRoleClient();
  await purgeExpiredRecycledUsers(sb);

  const { error } = await sb.from("admin_users").insert({
    id: userId,
    email: email || "unknown",
  });

  if (error) {
    if (error.code === "23505") {
      vizRedirect(
        `/viz?view=${encodeURIComponent(returnView)}&notice=${encodeURIComponent("该账号已是管理员")}`,
      );
      return;
    }
    vizRedirect(
      `/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(`grant_admin:${error.message}`)}`,
    );
    return;
  }

  vizRedirect(
    `/viz?view=${encodeURIComponent(returnView)}&notice=${encodeURIComponent(`已赋予管理员权限：${email || userId}`)}`,
  );
}

export async function revokeAdminAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const returnView = String(formData.get("returnView") ?? "users").trim();

  if (!userId) {
    vizRedirect(`/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent("缺少 userId")}`);
    return;
  }

  await requireVizAdminActor("/viz");

  const sb = createServiceRoleClient();

  const { data: admins, error: listErr } = await sb.from("admin_users").select("id");
  if (listErr) {
    vizRedirect(
      `/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(`list_admin:${listErr.message}`)}`,
    );
    return;
  }

  if (admins && admins.length === 1 && admins[0].id === userId) {
    vizRedirect(
      `/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(
        "无法移除最后一位管理员：请先为其他账号赋予管理员权限后再移除此账号。",
      )}`,
    );
    return;
  }

  const { error: delErr } = await sb.from("admin_users").delete().eq("id", userId);
  if (delErr) {
    vizRedirect(
      `/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(`revoke_admin:${delErr.message}`)}`,
    );
    return;
  }

  vizRedirect(
    `/viz?view=${encodeURIComponent(returnView)}&notice=${encodeURIComponent(`已移除管理员权限：${label || userId}`)}`,
  );
}

export async function deleteUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || userId;
  const email = String(formData.get("email") ?? "").trim();
  const returnView = String(formData.get("returnView") ?? "users").trim();
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    vizRedirect(`/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent("缺少 userId")}`);
    return;
  }

  const actor = await requireVizAdminActor();
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "密码校验失败";
    vizRedirect(`/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(msg)}`);
    return;
  }

  const result = await softDeleteUserToRecycle(userId, actor, label || email);
  if ("err" in result) {
    vizRedirect(`/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(result.err)}`);
    return;
  }

  vizRedirect(`/viz?view=${encodeURIComponent(returnView)}&notice=${encodeURIComponent(result.ok || label)}`);
}
