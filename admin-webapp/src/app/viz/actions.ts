"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServiceRoleClient } from "@/lib/supabase/service";

export async function deleteUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || userId;

  if (!userId) {
    redirect("/viz?err=missing_user");
  }

  const sb = createServiceRoleClient();

  const { error: usageDeleteError } = await sb
    .from("usage_logs")
    .delete()
    .eq("user_id", userId);
  if (usageDeleteError) {
    redirect(`/viz?err=${encodeURIComponent(`delete_usage:${usageDeleteError.message}`)}`);
  }

  const { error: adminDeleteError } = await sb
    .from("admin_users")
    .delete()
    .eq("id", userId);
  if (adminDeleteError) {
    redirect(`/viz?err=${encodeURIComponent(`delete_admin:${adminDeleteError.message}`)}`);
  }

  const { error: authDeleteError } = await sb.auth.admin.deleteUser(userId);
  if (authDeleteError) {
    redirect(`/viz?err=${encodeURIComponent(`delete_auth:${authDeleteError.message}`)}`);
  }

  revalidatePath("/viz");
  redirect(`/viz?ok=${encodeURIComponent(label)}`);
}
