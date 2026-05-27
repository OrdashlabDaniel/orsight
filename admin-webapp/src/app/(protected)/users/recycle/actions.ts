"use server";

import { revalidatePath } from "next/cache";

import { enableAuthUserLogin, getRegisteredUserById } from "@/lib/viz-auth-user-rpc";
import { assertAdminLoginPassword, requireAdminActor } from "@/lib/viz-admin-verify";
import { deleteRecycledUser, getRecycledUserById } from "@/lib/viz-recycle-store";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { permanentlyDeleteUserAndData } from "@/lib/viz-user-hard-delete";

export type RecycleActionResult = { ok: string } | { err: string };

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function requireRecycleTarget(sb: ReturnType<typeof createServiceRoleClient>, userId: string) {
  const row = await getRecycledUserById(sb, userId);
  if (row) {
    return row;
  }

  const authUser = await getRegisteredUserById(sb, userId);
  if (authUser?.banned_until || authUser?.deleted_at) {
    return {
      id: authUser.id,
      email: authUser.pod_username || authUser.email,
      deleted_at: authUser.deleted_at || new Date().toISOString(),
      purge_at: new Date().toISOString(),
      deleted_by: null,
      deleted_by_email: null,
    };
  }

  return null;
}

export async function permanentlyDeleteRecycledUserMutation(formData: FormData): Promise<RecycleActionResult> {
  const userId = text(formData, "userId");
  const label = text(formData, "label") || userId;
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    return { err: "Missing user id." };
  }

  const actor = await requireAdminActor("/users/recycle");
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (error) {
    return { err: error instanceof Error ? error.message : "Admin password check failed." };
  }

  const sb = createServiceRoleClient();
  let target;
  try {
    target = await requireRecycleTarget(sb, userId);
  } catch (error) {
    return { err: error instanceof Error ? error.message : "Could not read recycle-bin record." };
  }

  if (!target) {
    return { err: "This user is not in the recycle bin, or was already permanently deleted." };
  }

  const result = await permanentlyDeleteUserAndData(userId, actor, target);
  if ("err" in result) {
    return result;
  }

  revalidatePath("/users");
  revalidatePath("/users/recycle");
  revalidatePath(`/users/${userId}`);
  return { ok: `Permanently deleted: ${label}` };
}

export async function restoreRecycledUserMutation(formData: FormData): Promise<RecycleActionResult> {
  const userId = text(formData, "userId");
  const label = text(formData, "label") || userId;
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    return { err: "Missing user id." };
  }

  const actor = await requireAdminActor("/users/recycle");
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (error) {
    return { err: error instanceof Error ? error.message : "Admin password check failed." };
  }

  const sb = createServiceRoleClient();
  let target;
  try {
    target = await requireRecycleTarget(sb, userId);
  } catch (error) {
    return { err: error instanceof Error ? error.message : "Could not read recycle-bin record." };
  }

  if (!target) {
    return { err: "This user is not in the recycle bin, or was already permanently deleted." };
  }

  try {
    const restored = await enableAuthUserLogin(sb, userId);
    if (!restored) {
      return { err: "The auth user no longer exists and cannot be restored." };
    }
    await deleteRecycledUser(sb, userId);
  } catch (error) {
    return { err: error instanceof Error ? error.message : "Could not restore user." };
  }

  revalidatePath("/users");
  revalidatePath("/users/recycle");
  revalidatePath(`/users/${userId}`);
  return { ok: `Restored login access: ${label}` };
}
