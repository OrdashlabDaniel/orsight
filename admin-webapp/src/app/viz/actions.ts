"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServiceRoleClient } from "@/lib/supabase/service";

function vizRedirect(path: string) {
  revalidatePath("/viz");
  redirect(path);
}

export async function grantAdminAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const returnView = String(formData.get("returnView") ?? "users").trim();

  if (!userId) {
    vizRedirect(`/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent("缺少 userId")}`);
    return;
  }

  const sb = createServiceRoleClient();

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

  if (!userId) {
    redirect("/viz?err=missing_user");
  }

  const returnView = String(formData.get("returnView") ?? "users").trim();

  const sb = createServiceRoleClient();

  const { error: usageDeleteError } = await sb
    .from("usage_logs")
    .delete()
    .eq("user_id", userId);
  if (usageDeleteError) {
    redirect(
      `/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(`delete_usage:${usageDeleteError.message}`)}`,
    );
  }

  const { error: adminDeleteError } = await sb
    .from("admin_users")
    .delete()
    .eq("id", userId);
  if (adminDeleteError) {
    redirect(
      `/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(`delete_admin:${adminDeleteError.message}`)}`,
    );
  }

  const { error: authDeleteError } = await sb.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    redirect(
      `/viz?view=${encodeURIComponent(returnView)}&err=${encodeURIComponent(`delete_auth:${authDeleteError.message}`)}`,
    );
  }

  revalidatePath("/viz");
  redirect(`/viz?view=${encodeURIComponent(returnView)}&ok=${encodeURIComponent(label)}`);
}
