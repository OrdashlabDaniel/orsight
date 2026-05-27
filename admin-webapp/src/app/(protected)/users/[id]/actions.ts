"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getStripeAdmin,
  isMissingBillingTableErrorMessage,
  type BillingSubscriptionRow,
} from "@/lib/billing-admin";
import { createAdminClient } from "@/lib/supabase/server";
import { assertAdminLoginPassword, requireAdminActor } from "@/lib/viz-admin-verify";
import { softDeleteUserToRecycle } from "@/lib/viz-user-soft-delete";

function redirectBack(userId: string, qs: Record<string, string>) {
  const search = new URLSearchParams(qs).toString();
  revalidatePath(`/users/${userId}`);
  revalidatePath("/users");
  revalidatePath("/billing");
  revalidatePath("/usage-board");
  redirect(`/users/${userId}${search ? `?${search}` : ""}`);
}

async function requireUserPageAdmin(userId: string) {
  return await requireAdminActor(userId ? `/users/${encodeURIComponent(userId)}` : "/users");
}

type UserEntitlement = "lifetime_free";

function formText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function unixToIso(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

async function upsertUserEntitlement(
  userId: string,
  entitlement: UserEntitlement,
  active: boolean,
  notes: string | null,
) {
  const sb = await createAdminClient();
  const { error } = await sb.from("app_billing_user_entitlements").upsert(
    {
      owner_id: userId,
      entitlement,
      active,
      notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,entitlement" },
  );

  if (error) {
    throw new Error(`app_billing_user_entitlements:${error.message}`);
  }

  return sb;
}

async function loadLatestRealStripeSubscription(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  userId: string,
): Promise<BillingSubscriptionRow | null> {
  const { data, error } = await sb
    .from("app_subscriptions")
    .select("*")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    if (isMissingBillingTableErrorMessage(error.message)) {
      return null;
    }
    throw new Error(`app_subscriptions:${error.message}`);
  }

  return (
    ((data ?? []) as BillingSubscriptionRow[]).find(
      (row) =>
        row.stripe_subscription_id &&
        row.billing_source !== "admin_override" &&
        row.status !== "canceled",
    ) || null
  );
}

export async function setLifetimeFreeFromUserPageAction(formData: FormData) {
  const userId = formText(formData, "userId");
  const label = formText(formData, "label") || userId;
  const active = formText(formData, "active") === "1";

  if (!userId) {
    redirect("/users?err=missing_user");
  }

  await requireUserPageAdmin(userId);

  try {
    await upsertUserEntitlement(
      userId,
      "lifetime_free",
      active,
      active ? `Lifetime free set from admin control center for ${label}.` : "Lifetime free revoked from admin control center.",
    );
  } catch (error) {
    redirectBack(userId, { err: error instanceof Error ? error.message : "set_lifetime_free_failed" });
    return;
  }

  redirectBack(userId, {
    notice: active ? `Lifetime free enabled for ${label}` : `Lifetime free revoked for ${label}`,
  });
}

export async function cancelStripeSubscriptionNowFromUserPageAction(formData: FormData) {
  const userId = formText(formData, "userId");
  const label = formText(formData, "label") || userId;

  if (!userId) {
    redirect("/users?err=missing_user");
  }

  await requireUserPageAdmin(userId);

  const stripe = getStripeAdmin();
  if (!stripe) {
    redirectBack(userId, { err: "missing_STRIPE_SECRET_KEY" });
    return;
  }

  const sb = await createAdminClient();
  let row: BillingSubscriptionRow | null = null;
  try {
    row = await loadLatestRealStripeSubscription(sb, userId);
  } catch (error) {
    redirectBack(userId, { err: error instanceof Error ? error.message : "load_subscription_failed" });
    return;
  }

  if (!row?.stripe_subscription_id) {
    redirectBack(userId, { err: "user_has_no_active_real_stripe_subscription" });
    return;
  }

  try {
    const canceled = await stripe.subscriptions.cancel(row.stripe_subscription_id);
    const canceledWithPeriods = canceled as typeof canceled & {
      current_period_start?: number;
      current_period_end?: number;
    };
    const { error: updateError } = await sb
      .from("app_subscriptions")
      .update({
        status: canceled.status || "canceled",
        cancel_at_period_end: false,
        current_period_start: unixToIso(canceledWithPeriods.current_period_start) || row.current_period_start,
        current_period_end: unixToIso(canceledWithPeriods.current_period_end) || row.current_period_end,
        updated_at: new Date().toISOString(),
        raw: canceled as unknown as Record<string, unknown>,
      })
      .eq("owner_id", userId)
      .eq("stripe_subscription_id", row.stripe_subscription_id);

    if (updateError) {
      throw new Error(`app_subscriptions:${updateError.message}`);
    }
  } catch (error) {
    redirectBack(userId, {
      err: `cancel_stripe_subscription:${error instanceof Error ? error.message : "unknown_error"}`,
    });
    return;
  }

  redirectBack(userId, {
    notice: `Stripe subscription canceled for ${label}`,
  });
}

export async function grantAdminFromUserPageAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!userId) {
    redirect("/users?err=missing_user");
  }

  await requireUserPageAdmin(userId);

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

  await requireUserPageAdmin(userId);

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

export async function clearUserUsageRecordsFromUserPageAction(formData: FormData) {
  const userId = formText(formData, "userId");
  const label = formText(formData, "label") || userId;

  if (!userId) {
    redirect("/users?err=missing_user");
  }

  await requireUserPageAdmin(userId);

  const sb = await createAdminClient();
  const { count: usageCount, error: usageError } = await sb
    .from("usage_logs")
    .delete({ count: "exact" })
    .eq("user_id", userId);

  if (usageError) {
    redirectBack(userId, { err: `clear_usage_logs:${usageError.message}` });
    return;
  }

  const { count: ledgerCount, error: ledgerError } = await sb
    .from("app_billing_token_ledger")
    .delete({ count: "exact" })
    .eq("owner_id", userId)
    .eq("reason", "quota_overage_consumption");

  if (ledgerError && !isMissingBillingTableErrorMessage(ledgerError.message)) {
    redirectBack(userId, { err: `clear_usage_ledger:${ledgerError.message}` });
    return;
  }

  const usageDeleted = usageCount ?? 0;
  const ledgerDeleted = ledgerError ? 0 : ledgerCount ?? 0;
  redirectBack(userId, {
    notice: `Cleared ${usageDeleted.toLocaleString("en-US")} usage records and ${ledgerDeleted.toLocaleString(
      "en-US",
    )} prepaid consumption records for ${label}.`,
  });
}

export async function deleteUserFromUserPageAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || userId;
  const adminPassword = String(formData.get("adminPassword") ?? "");

  if (!userId) {
    redirect("/users?err=missing_user");
  }

  const actor = await requireUserPageAdmin(userId);
  try {
    await assertAdminLoginPassword(actor.email, adminPassword);
  } catch (error) {
    redirectBack(userId, { err: error instanceof Error ? error.message : "admin_password_check_failed" });
    return;
  }

  const result = await softDeleteUserToRecycle(userId, actor, label);
  if ("err" in result) {
    redirectBack(userId, { err: result.err });
    return;
  }

  revalidatePath("/users");
  revalidatePath("/users/recycle");
  revalidatePath("/billing");
  revalidatePath("/usage-board");
  redirect(`/users/recycle?notice=${encodeURIComponent(result.ok)}`);
}

