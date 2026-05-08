"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  changeAdminAccountPassword,
  updateAdminAccountProfile,
} from "@/lib/admin-account-store";
import { setLocalAdminSessionCookieOnStore } from "@/lib/admin-local-auth";
import { requireAdminActor } from "@/lib/viz-admin-verify";

function redirectAccount(params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  revalidatePath("/account");
  redirect(`/account${search ? `?${search}` : ""}`);
}

export async function updateAdminProfileAction(formData: FormData) {
  const actor = await requireAdminActor("/account");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const identifier = String(formData.get("identifier") ?? "").trim();
  const emailValue = String(formData.get("email") ?? "").trim();

  try {
    await updateAdminAccountProfile(actor.id, {
      displayName,
      identifier,
      email: emailValue || null,
    });
  } catch (error) {
    redirectAccount({
      err: error instanceof Error ? error.message : "Failed to update admin profile.",
    });
  }

  redirectAccount({ notice: "Admin profile updated." });
}

export async function changeAdminPasswordAction(formData: FormData) {
  const actor = await requireAdminActor("/account");
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const nextPassword = String(formData.get("nextPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !nextPassword || !confirmPassword) {
    redirectAccount({ err: "Please complete all password fields." });
  }
  if (nextPassword !== confirmPassword) {
    redirectAccount({ err: "New password and confirmation do not match." });
  }

  try {
    const updatedAccount = await changeAdminAccountPassword(actor.id, currentPassword, nextPassword);
    const cookieStore = await cookies();
    await setLocalAdminSessionCookieOnStore(cookieStore, {
      accountId: updatedAccount.id,
      sessionVersion: updatedAccount.sessionVersion,
    });
  } catch (error) {
    redirectAccount({
      err: error instanceof Error ? error.message : "Failed to update admin password.",
    });
  }

  redirectAccount({ notice: "Password updated." });
}
