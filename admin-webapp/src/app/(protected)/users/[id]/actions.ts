"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { hardDeleteAuthUser } from "@/lib/viz-auth-user-rpc";
import { createAdminClient } from "@/lib/supabase/server";

function redirectBack(userId: string, qs: Record<string, string>) {
  const search = new URLSearchParams(qs).toString();
  revalidatePath(`/users/${userId}`);
  redirect(`/users/${userId}${search ? `?${search}` : ""}`);
}

export async function grantAdminFromUserPageAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!userId) {
    redirect("/users?err=missing_user");
  }

  const sb = await createAdminClient();
  const { error } = await sb.from("admin_users").insert({
    id: userId,
    email: email || "unknown",
  });

  if (error) {
    if (error.code === "23505") {
      redirectBack(userId, { notice: "该账号已是管理员" });
      return;
    }
    redirectBack(userId, { err: `grant_admin:${error.message}` });
    return;
  }

  redirectBack(userId, { notice: `已赋予管理员权限：${email || userId}` });
}

export async function revokeAdminFromUserPageAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();

  if (!userId) {
    redirect("/users?err=missing_user");
  }

  const sb = await createAdminClient();

  const { data: admins, error: listErr } = await sb.from("admin_users").select("id");
  if (listErr) {
    redirectBack(userId, { err: `list_admin:${listErr.message}` });
    return;
  }

  if (admins && admins.length === 1 && admins[0].id === userId) {
    redirectBack(userId, { err: "无法移除最后一位管理员：请先为其他账号赋予管理员权限后再移除此账号。" });
    return;
  }

  const { error: delErr } = await sb.from("admin_users").delete().eq("id", userId);
  if (delErr) {
    redirectBack(userId, { err: `revoke_admin:${delErr.message}` });
    return;
  }

  redirectBack(userId, { notice: `已移除管理员权限：${label || userId}` });
}

export async function deleteUserFromUserPageAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || userId;

  if (!userId) {
    redirect("/users?err=missing_user");
  }

  const sb = await createAdminClient();

  const { error: usageDeleteError } = await sb.from("usage_logs").delete().eq("user_id", userId);
  if (usageDeleteError) {
    redirectBack(userId, { err: `delete_usage:${usageDeleteError.message}` });
    return;
  }

  const { error: adminDeleteError } = await sb.from("admin_users").delete().eq("id", userId);
  if (adminDeleteError) {
    redirectBack(userId, { err: `delete_admin:${adminDeleteError.message}` });
    return;
  }

  try {
    await hardDeleteAuthUser(sb, userId);
  } catch (e) {
    redirectBack(userId, { err: `delete_auth:${e instanceof Error ? e.message : "unknown"}` });
    return;
  }

  revalidatePath("/users");
  redirect(`/users?ok=${encodeURIComponent(label)}`);
}

