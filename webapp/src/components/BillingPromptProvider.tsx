"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import type { BillingStatus, TokenPackId } from "@/lib/billing";

type BillingStatusResponse = {
  billing?: BillingStatus;
  error?: string;
  code?: string;
};

type PromptReason = "login" | "quota" | "nav";

const PROMPT_SESSION_KEY = "orsight:billing-prompt-shown:v1";
const BILLING_REQUIRED_CODES = new Set([
  "billing_required",
  "free_cost_budget_exceeded",
  "free_image_quota_exceeded",
  "free_seats_full",
]);

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Math.max(0, cents) / 100);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function shouldPromoteBilling(billing: BillingStatus) {
  return billing.enabled && billing.configured && !billing.lifetimeFree && billing.plan === "free";
}

function modalCopy(reason: PromptReason, billing: BillingStatus | null) {
  if (reason === "quota" || billing?.upgradeRequired) {
    if (billing && billing.plan !== "free") {
      return {
        title: "Your monthly allowance is used up",
        body: "Your current plan allowance is exhausted. Buy prepaid Usage Credits to continue right away.",
      };
    }

    return {
      title: "Your free usage is used up",
      body: "Upgrade to Normal for a monthly token allowance, or buy prepaid Usage Credits to continue right away.",
    };
  }

  if (reason === "nav") {
    return {
      title: "Choose your OrSight plan",
      body: "Normal is the best value for regular use. Usage Credits are prepaid, flexible, and priced higher for occasional extra usage.",
    };
  }

  return {
    title: "Get more from OrSight",
    body: "Free accounts have a small monthly trial budget. Upgrade when you are ready, or keep Usage Credits as a prepaid backup.",
  };
}

export function BillingPromptProvider({ children }: { children: ReactNode }) {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PromptReason>("login");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshBillingStatus = useCallback(
    async (options?: { allowLoginPrompt?: boolean; keepOpen?: boolean; isCancelled?: () => boolean }) => {
      try {
        const response = await fetch("/api/billing/status", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as BillingStatusResponse | null;
        if (options?.isCancelled?.() || !response.ok || !payload?.billing) return null;

        setBilling(payload.billing);

        if (payload.billing.enabled && !payload.billing.lifetimeFree && payload.billing.upgradeRequired) {
          setReason("quota");
          setOpen(true);
          return payload.billing;
        }

        if (!shouldPromoteBilling(payload.billing)) {
          if (!options?.keepOpen) {
            setOpen(false);
            setBusy(null);
            setError(null);
          }
          return payload.billing;
        }

        if (options?.allowLoginPrompt && window.sessionStorage.getItem(PROMPT_SESSION_KEY) !== "1") {
          window.sessionStorage.setItem(PROMPT_SESSION_KEY, "1");
          setReason("login");
          setOpen(true);
        }

        return payload.billing;
      } catch {
        // Billing prompts should never block the app shell.
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    void refreshBillingStatus({
      allowLoginPrompt: true,
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
  }, [refreshBillingStatus]);

  useEffect(() => {
    function refreshAfterReturn() {
      void refreshBillingStatus();
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        refreshAfterReturn();
      }
    }

    window.addEventListener("pageshow", refreshAfterReturn);
    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("pageshow", refreshAfterReturn);
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshBillingStatus]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);

      if (response.status === 402) {
        void response
          .clone()
          .json()
          .then((payload: BillingStatusResponse) => {
            if (!payload?.billing && !BILLING_REQUIRED_CODES.has(payload?.code || "")) return;

            if (payload.billing) {
              setBilling(payload.billing);
            }
            setReason("quota");
            setOpen(true);
          })
          .catch(() => {});
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    function openBillingPlans() {
      setReason("nav");
      setOpen(true);
      void refreshBillingStatus({ keepOpen: true });
    }

    window.addEventListener("orsight:open-billing-plans", openBillingPlans);
    return () => window.removeEventListener("orsight:open-billing-plans", openBillingPlans);
  }, [refreshBillingStatus]);

  async function startCheckout(payload: { plan?: "normal"; purchaseType?: "token_pack"; packId?: TokenPackId }) {
    setError(null);
    const busyKey = payload.purchaseType === "token_pack" ? payload.packId || "token_pack" : payload.plan || "normal";
    setBusy(busyKey);

    try {
      const requestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${busyKey}_${Date.now()}`;
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Checkout could not be opened.");
      }
      window.location.href = body.url;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Checkout could not be opened.");
      setBusy(null);
    }
  }

  const copy = modalCopy(reason, billing);
  const tokenPacks = billing?.tokenPacks || [];
  const hasNormalPlan = billing?.plan === "normal";
  const normalPriceLabel = formatCurrency(billing?.plan === "normal" ? billing.monthlyBaseCents : 999);
  const normalQuota = billing?.plan === "normal" ? billing.monthlyQuota : 1_000_000;

  return (
    <>
      {children}
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-48px)] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">OrSight Billing</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{copy.title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy.body}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-2xl border border-slate-950 bg-slate-950 p-5 text-white">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Best value</p>
                    <h3 className="mt-2 text-xl font-semibold">Normal</h3>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-950">
                    {normalPriceLabel}/mo
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-200">
                  Includes {normalQuota < 0 ? "unlimited" : formatNumber(normalQuota)} AI tokens per month. Best for
                  users who work with OrSight regularly.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!hasNormalPlan) {
                      void startCheckout({ plan: "normal" });
                    }
                  }}
                  disabled={hasNormalPlan || busy !== null || !billing?.configured}
                  className="mt-5 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {hasNormalPlan ? "Normal is active" : busy === "normal" ? "Opening Checkout..." : "Upgrade to Normal"}
                </button>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Prepaid backup</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">Usage Credits</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Buy credits first, then extra AI usage consumes your prepaid token balance. Packs are intentionally
                  more expensive than Normal.
                </p>
                <div className="mt-4 grid gap-2">
                  {tokenPacks.length ? (
                    tokenPacks.map((pack) => (
                      <button
                        key={pack.packId}
                        type="button"
                        onClick={() => startCheckout({ purchaseType: "token_pack", packId: pack.packId })}
                        disabled={busy !== null || !billing?.configured || !pack.stripePriceId}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span>
                          <span className="block font-semibold text-slate-950">{pack.displayName}</span>
                          <span className="block text-xs text-slate-500">
                            {formatNumber(pack.credits)} prepaid tokens
                          </span>
                        </span>
                        <span className="font-semibold text-slate-950">
                          {busy === pack.packId ? "Opening..." : formatCurrency(pack.priceCents)}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      Usage Credit prices are not configured yet.
                    </p>
                  )}
                </div>
              </section>
            </div>

            {billing ? (
              <div className="border-t border-slate-100 px-6 py-4 text-xs text-slate-500">
                Current plan: <span className="font-semibold text-slate-700">{billing.planLabel}</span>
                {billing.prepaidTokensAvailable > 0 ? (
                  <span> - Prepaid balance: {formatNumber(billing.prepaidTokensAvailable)} tokens</span>
                ) : null}
              </div>
            ) : null}
            {error ? <div className="px-6 pb-5 text-sm text-red-600">{error}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
