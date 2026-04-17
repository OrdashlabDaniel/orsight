"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertAdminLoginPassword, requireVizAdminActor } from "@/lib/viz-admin-verify";
import { purgeExpiredRecycledUsers } from "@/lib/viz-recycle-purge";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { softDeleteUserToRecycle } from "@/lib/viz-user-soft-delete";

function redirectToUserDetail(userId: string, query: string, notice?: string, err?: string) {
  revalidatePath("/viz");
  revalidatePath(`/viz/users/${userId}`);
  const sp = new URLSearchParams(query);
  if (notice) {
    sp.set("notice", notice);
    sp.delete("err");
  }
  if (err) {
    sp.set("err", err);
    sp.delete("notice");
  }
  const qs = sp.toString();
  redirect(`/viz/users/${encodeURIComponent(userId)}${qs ? `?${qs}` : ""}`);
}

export async function grantAdminFromVizUserDetailAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const returnSearch = String(formData.get("returnSearch") ?? "").trim();
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    redirect("/viz?err=" + encodeURIComponent("缺少 userId"));
    return;
  }

  const actor = await requireVizAdminActor(`/viz/users/${encodeURIComponent(userId)}`);
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "密码校验失败";
    redirectToUserDetail(userId, returnSearch, undefined, msg);
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
      redirectToUserDetail(userId, returnSearch, "该账号已是管理员");
      return;
    }
    redirectToUserDetail(userId, returnSearch, undefined, `grant_admin:${error.message}`);
    return;
  }

  redirectToUserDetail(userId, returnSearch, `已赋予管理员权限：${email || userId}`);
}

export async function revokeAdminFromVizUserDetailAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const returnSearch = String(formData.get("returnSearch") ?? "").trim();

  if (!userId) {
    redirect("/viz?err=" + encodeURIComponent("缺少 userId"));
    return;
  }

  await requireVizAdminActor(`/viz/users/${encodeURIComponent(userId)}`);

  const sb = createServiceRoleClient();
  const { data: admins, error: listErr } = await sb.from("admin_users").select("id");
  if (listErr) {
    redirectToUserDetail(userId, returnSearch, undefined, `list_admin:${listErr.message}`);
    return;
  }

  if (admins && admins.length === 1 && admins[0].id === userId) {
    redirectToUserDetail(
      userId,
      returnSearch,
      undefined,
      "无法移除最后一位管理员：请先为其他账号赋予管理员权限后再移除此账号。",
    );
    return;
  }

  const { error: delErr } = await sb.from("admin_users").delete().eq("id", userId);
  if (delErr) {
    redirectToUserDetail(userId, returnSearch, undefined, `revoke_admin:${delErr.message}`);
    return;
  }

  redirectToUserDetail(userId, returnSearch, `已移除管理员权限：${label || userId}`);
}

export async function deleteUserFromVizUserDetailAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const returnView = String(formData.get("returnView") ?? "users").trim();
  const returnSearch = String(formData.get("returnSearch") ?? "").trim();
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    redirect("/viz?err=" + encodeURIComponent("缺少 userId"));
    return;
  }

  const actor = await requireVizAdminActor(`/viz/users/${encodeURIComponent(userId)}`);
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "密码校验失败";
    redirectToUserDetail(userId, returnSearch, undefined, msg);
    return;
  }

  const result = await softDeleteUserToRecycle(userId, actor, email || userId);
  if ("err" in result) {
    redirectToUserDetail(userId, returnSearch, undefined, result.err);
    return;
  }

  revalidatePath("/viz/recycle");
  redirect(`/viz?view=${encodeURIComponent(returnView)}&notice=${encodeURIComponent(result.ok)}`);
}
