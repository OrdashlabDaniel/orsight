"use client";

import Link from "next/link";
import { useState } from "react";

import { useLocale } from "@/i18n/LocaleProvider";
import type { BillingPlanConfig, BillingStatus, TokenPackId } from "@/lib/billing";

import { SignOutButton } from "./SignOutButton";

export function AccountDisabledGate() {
  const { t } = useLocale();
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{t("account.noAuthTitle")}</h1>
        <p className="mt-3 text-sm text-slate-600">{t("account.noAuthBody")}</p>
        <Link href="/forms" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
          {t("account.backForms")}
        </Link>
      </div>
    </main>
  );
}

export type AccountDetailsPayload = {
  displayUsername: string;
  email: string | null;
  id: string;
  createdAtIso: string | null;
  isDevMockSession: boolean;
  billing: BillingStatus;
  availablePlans: BillingPlanConfig[];
  billingNotice?: string | null;
};

const TOKEN_MILLION = 1_000_000;

function formatTokenMillions(value: number | null | undefined, locTag: string) {
  const safeValue = Math.max(0, Number(value || 0));
  const millions = safeValue / TOKEN_MILLION;
  return `${new Intl.NumberFormat(locTag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: millions > 0 && millions < 0.01 ? 3 : 2,
  }).format(millions)}M`;
}

function formatPercent(value: number) {
  const safeValue = Math.max(0, Math.min(100, value));
  const decimals = safeValue > 0 && safeValue < 10 ? 1 : 0;
  return `${safeValue.toFixed(decimals)}%`;
}

function TokenAllowanceBar({
  title,
  remaining,
  total,
  used,
  locTag,
  tone,
}: {
  title: string;
  remaining: number | null;
  total: number | null;
  used: number;
  locTag: string;
  tone: "slate" | "emerald";
}) {
  const isUnlimited = total == null || total < 0 || remaining == null;
  const safeTotal = Math.max(0, Number(total || 0));
  const safeRemaining = isUnlimited ? safeTotal : Math.max(0, Number(remaining || 0));
  const percent = isUnlimited ? 100 : safeTotal > 0 ? Math.min(100, (safeRemaining / safeTotal) * 100) : 0;
  const barClassName = tone === "emerald" ? "bg-emerald-500" : "bg-slate-950";
  const trackClassName = tone === "emerald" ? "bg-emerald-50" : "bg-slate-100";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-slate-500">{title}</div>
        <div className="font-mono text-xs font-semibold text-slate-900">
          {isUnlimited ? "Unlimited" : formatPercent(percent)}
        </div>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="font-mono text-sm font-semibold text-slate-950">
          {isUnlimited ? "Unlimited" : `${formatTokenMillions(safeRemaining, locTag)} / ${formatTokenMillions(safeTotal, locTag)}`}
        </div>
        <div className="font-mono text-[11px] text-slate-500">
          used {formatTokenMillions(used, locTag)}
        </div>
      </div>
      <div
        className={`mt-3 h-1.5 overflow-hidden rounded-full ${trackClassName}`}
        aria-label={`${title}: ${isUnlimited ? "Unlimited" : `${formatPercent(percent)} remaining`}`}
        role="img"
      >
        <div className={`h-full rounded-full ${barClassName}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function AccountDetailsView({ payload }: { payload: AccountDetailsPayload }) {
  const { locale, t } = useLocale();
  const [billingBusy, setBillingBusy] = useState<"normal" | "pro" | TokenPackId | "portal" | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const locTag = locale === "en" ? "en-US" : "zh-CN";
  const billing = payload.billing;
  const availablePlans = payload.availablePlans;
  const isMeteredUsage = billing.billingModel === "monthly_plus_usage";
  const tokenPack = billing.tokenPack;
  const tokenPacks = billing.tokenPacks?.length ? billing.tokenPacks : tokenPack ? [tokenPack] : [];
  const quotaText =
    billing.monthlyQuota < 0
      ? "Unlimited"
      : `${billing.monthlyUsed.toLocaleString(locTag)} / ${billing.monthlyQuota.toLocaleString(locTag)}`;
  const remainingText =
    billing.effectiveRemaining == null ? "Unlimited" : billing.effectiveRemaining.toLocaleString(locTag);
  const includedRemainingText =
    billing.remainingIncluded == null ? "Unlimited" : billing.remainingIncluded.toLocaleString(locTag);
  const estimatedOverageText =
    billing.estimatedOverageCents > 0
      ? new Intl.NumberFormat(locTag, {
          style: "currency",
          currency: (billing.plan === "free" ? "usd" : "usd").toUpperCase(),
        }).format(billing.estimatedOverageCents / 100)
      : "$0.00";
  const billingCopy =
    locale === "en"
      ? {
          title: "Billing",
          description: "Monthly fees, quotas, overage billing, and subscription controls are managed here.",
          subscriptionStatus: "Subscription status",
          paymentStatus: "Payment status",
          unbilled: "unbilled",
          currentUsage: "Current credits",
          remainingQuota: "Remaining credits",
          monthlyFee: "Monthly fee",
          billingModel: "Billing model",
          billableUsage: "Billable usage",
          estimatedOverage: "Estimated overage",
          currentPlan: "Current plan",
          includes: "Includes",
          overage: "Overage",
          selectPlan: "Select",
          manageSubscription: "Manage subscription",
        }
      : {
          title: "计费",
          description: "月费、额度、超量计费和订阅控制都在这里统一查看。",
          subscriptionStatus: "订阅状态",
          paymentStatus: "支付状态",
          unbilled: "未出账",
          currentUsage: "本期 credits",
          remainingQuota: "剩余 credits",
          monthlyFee: "月费",
          billingModel: "计费模式",
          billableUsage: "本期可计费量",
          estimatedOverage: "预估超量费用",
          currentPlan: "当前方案",
          includes: "含",
          overage: "超量",
          selectPlan: "选择",
          manageSubscription: "管理订阅",
        };

  async function startCheckout(plan: "normal" | "pro") {
    setBillingError(null);
    setBillingBusy(plan);
    try {
      const requestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${plan}_${Date.now()}`;
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, requestId }),
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Unable to start checkout.");
      }
      window.location.href = data.url;
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Unable to start checkout.");
      setBillingBusy(null);
    }
  }

  async function startTokenPackCheckout(packId: TokenPackId) {
    const selectedPack = tokenPacks.find((pack) => pack.packId === packId) || tokenPack;
    if (!selectedPack) return;

    setBillingError(null);
    setBillingBusy(packId);
    try {
      const requestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${packId}_${Date.now()}`;
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseType: "token_pack",
          packId: selectedPack.packId,
          requestId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Unable to start usage credit checkout.");
      }
      window.location.href = data.url;
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Unable to start usage credit checkout.");
      setBillingBusy(null);
    }
  }

  async function openBillingPortal() {
    setBillingError(null);
    setBillingBusy("portal");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Unable to open billing portal.");
      }
      window.location.href = data.url;
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Unable to open billing portal.");
      setBillingBusy(null);
    }
  }

  const createdAt =
    payload.createdAtIso != null
      ? new Date(payload.createdAtIso).toLocaleString(locTag)
      : "—";

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {payload.billingNotice === "success" ? (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            Checkout completed. Stripe billing is refreshing now, and your subscription status should appear here shortly.
          </p>
        ) : null}
        {payload.billingNotice === "cancelled" ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Checkout was cancelled before payment was completed. No subscription changes were made.
          </p>
        ) : null}
        {payload.billingNotice === "manage" ? (
          <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            A Stripe subscription already exists for this account, so we sent you to the billing portal instead of creating a duplicate subscription.
          </p>
        ) : null}
        {payload.billingNotice === "token-pack-success" ? (
          <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            Usage credits purchased. Your prepaid credit balance will update after Stripe confirms the payment.
          </p>
        ) : null}
        {payload.billingNotice === "token-pack-cancelled" ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Usage credit checkout was cancelled. No prepaid credits were added.
          </p>
        ) : null}
        {payload.isDevMockSession ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t("account.mockSessionBanner")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t("account.title")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("account.subtitle")}</p>
          </div>
          <SignOutButton devMock={payload.isDevMockSession} />
        </div>

        <dl className="mt-8 space-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">{t("account.username")}</dt>
            <dd className="mt-1 text-slate-900">{payload.displayUsername}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">{t("account.internalEmail")}</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-600">{payload.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">{t("account.userId")}</dt>
            <dd className="mt-1 break-all font-mono text-xs text-slate-800">{payload.id}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">{t("account.created")}</dt>
            <dd className="mt-1 text-slate-900">{createdAt}</dd>
          </div>
        </dl>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{billingCopy.title}</h2>
              <p className="mt-1 text-xs text-slate-500">{billingCopy.description}</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-700 ring-1 ring-slate-200">
              {billing.planLabel}
            </span>
          </div>

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">{billingCopy.subscriptionStatus}</div>
              <div className="mt-1 font-medium text-slate-900">{billing.subscriptionStatus || "free"}</div>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">{billingCopy.paymentStatus}</div>
              <div className="mt-1 font-medium text-slate-900">{billing.paymentStatus || billingCopy.unbilled}</div>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">{billingCopy.currentUsage}</div>
              <div className="mt-1 font-medium text-slate-900">{quotaText}</div>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">{billingCopy.remainingQuota}</div>
              <div className="mt-1 font-medium text-slate-900">{remainingText}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">{billingCopy.monthlyFee}</div>
              <div className="mt-1 font-medium text-slate-900">
                ${(billing.monthlyBaseCents / 100).toFixed(2)}
              </div>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">{billingCopy.billingModel}</div>
              <div className="mt-1 font-medium text-slate-900">{billing.billingModel}</div>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">{billingCopy.billableUsage}</div>
              <div className="mt-1 font-medium text-slate-900">{billing.billableUsage.toLocaleString(locTag)}</div>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="text-xs text-slate-500">{billingCopy.estimatedOverage}</div>
              <div className="mt-1 font-medium text-slate-900">{estimatedOverageText}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <TokenAllowanceBar
              title="Plan quota remaining"
              remaining={billing.remainingIncluded}
              total={billing.monthlyQuota < 0 ? null : billing.monthlyQuota}
              used={billing.monthlyUsed}
              locTag={locTag}
              tone="slate"
            />
            <TokenAllowanceBar
              title="Prepaid credits remaining"
              remaining={billing.prepaidCreditsAvailable}
              total={billing.prepaidCreditsPurchased}
              used={billing.prepaidCreditsConsumed}
              locTag={locTag}
              tone="emerald"
            />
          </div>

          {tokenPacks.length ? (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-white p-4 ring-1 ring-emerald-50">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Prepaid usage credits</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Buy credits first, then extra ordinary AI usage consumes your prepaid credit balance. gpt-5-mini
                    uses 1x and gpt-5 uses 5x. gpt-5.5 uses the separate Pro expert pool.
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-right ring-1 ring-slate-200">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Prepaid balance
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {billing.prepaidCreditsAvailable.toLocaleString(locTag)} credits
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                {tokenPacks.map((pack) => (
                  <div key={pack.packId} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-900">{pack.displayName}</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {pack.credits.toLocaleString(locTag)} prepaid credits
                        </div>
                      </div>
                      <div className="text-right text-sm font-semibold text-slate-950">
                        ${(pack.priceCents / 100).toFixed(2)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startTokenPackCheckout(pack.packId)}
                      disabled={billingBusy !== null || !billing.configured || !pack.stripePriceId}
                      className="mt-3 w-full rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {billingBusy === pack.packId ? "Opening..." : `Buy $${(pack.priceCents / 100).toFixed(2)}`}
                    </button>
                    {!pack.stripePriceId ? (
                      <p className="mt-2 text-[11px] text-amber-700">
                        Stripe price id is not configured for this credit pack yet.
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {isMeteredUsage ? (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-4 ring-1 ring-blue-50">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Metered overage billing</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Monthly included credits are used first. Extra usage is billed by Stripe in{" "}
                    {billing.meteredUnitSize.toLocaleString(locTag)}-credit units at the end of the billing period.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">Included remaining</div>
                  <div className="mt-1 font-medium text-slate-900">{includedRemainingText}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">Overage credits</div>
                  <div className="mt-1 font-medium text-slate-900">{billing.billableUsage.toLocaleString(locTag)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">Billable units</div>
                  <div className="mt-1 font-medium text-slate-900">
                    {billing.meteredBillableUnits.toLocaleString(locTag)}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="text-xs text-slate-500">Estimated overage</div>
                  <div className="mt-1 font-medium text-slate-900">{estimatedOverageText}</div>
                </div>
              </div>
            </div>
          ) : null}

          {!billing.configured ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Billing is not configured yet. Add Stripe keys, price ids, webhook secret, and run the billing
              migration before enforcing quotas.
            </p>
          ) : null}
          {billing.message ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
              {billing.message}
            </p>
          ) : null}
          {billingError ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
              {billingError}
            </p>
          ) : null}

          {availablePlans.length ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {availablePlans.map((plan) => {
                if (plan.planId === "free") {
                  return null;
                }
                const isCurrent = billing.plan === plan.planId;
                const checkoutPlan = plan.planId === "normal" || plan.planId === "pro" ? plan.planId : null;
                return (
                  <div
                    key={plan.planId}
                    className={`rounded-2xl border p-4 ${
                      isCurrent ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{plan.displayName}</div>
                        <div className="mt-1 text-xs text-slate-500">{plan.description}</div>
                      </div>
                      {isCurrent ? (
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200">
                          {billingCopy.currentPlan}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-600">
                      <div>{billingCopy.monthlyFee} ${(plan.monthlyBaseCents / 100).toFixed(2)}</div>
                      <div>
                        {billingCopy.includes} {plan.includedCredits.toLocaleString(locTag)} {plan.overageUnitName}
                      </div>
                      <div>
                        {billingCopy.overage} ${(plan.overageUnitCents / 100).toFixed(2)} / {plan.overageUnitName}
                      </div>
                    </div>
                    {!isCurrent ? (
                      <button
                        type="button"
                        onClick={() => checkoutPlan && startCheckout(checkoutPlan)}
                        disabled={billingBusy !== null || !billing.configured || !checkoutPlan}
                        className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {billingBusy === plan.planId ? "Opening..." : `${billingCopy.selectPlan} ${plan.displayName}`}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {billing.stripeCustomerId ? (
              <button
                type="button"
                onClick={openBillingPortal}
                disabled={billingBusy !== null || !billing.configured}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {billingBusy === "portal" ? "Opening..." : billingCopy.manageSubscription}
              </button>
            ) : null}
          </div>
        </section>

        <div className="mt-8 border-t border-slate-100 pt-6">
          <Link href="/forms" className="text-sm font-medium text-blue-600 hover:underline">
            {t("account.backForms")}
          </Link>
        </div>
      </div>
    </main>
  );
}
