import {
  changeStripePlanAction,
  clearBillingOverrideAction,
  setBillingOverrideAction,
  setStripeCancelAtPeriodEndAction,
} from "../../../(protected)/billing/actions";

import type {
  BillingPlanConfig,
  BillingPlanId,
  BillingSubscriptionRow,
} from "@/lib/billing-admin";
import {
  billingSourceLabel,
  formatMoney,
  isAdminOverrideSubscription,
  paymentStatusLabel,
  shortId,
} from "@/lib/billing-admin";

type Props = {
  ownerId: string;
  label: string;
  authEmail: string;
  returnTo: string;
  effectivePlan: BillingPlanId;
  planConfig: BillingPlanConfig;
  effectiveSubscription: BillingSubscriptionRow | null;
  realStripeSubscription: BillingSubscriptionRow | null;
  usage: {
    used: number;
    remainingIncluded: number | null;
    billableUsage: number;
    estimatedOverageCents: number;
  };
  billingLoadWarn?: string | null;
};

function planBadgeColor(planId: BillingPlanId) {
  if (planId === "normal") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (planId === "usage") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (planId === "business") return "bg-violet-50 text-violet-700 ring-violet-200";
  if (planId === "pro") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function subscriptionStatusLabel(row: BillingSubscriptionRow | null) {
  if (!row?.status) return "未订阅";
  if (row.status === "active") return "生效中";
  if (row.status === "trialing") return "试用中";
  if (row.status === "past_due") return "逾期";
  if (row.status === "canceled") return "已取消";
  if (row.status === "incomplete") return "未完成";
  if (row.status === "incomplete_expired") return "已失效";
  if (row.status === "unpaid") return "未支付";
  return row.status;
}

function periodText(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "按当前默认账期统计";

  const startText = start ? new Date(start).toLocaleDateString() : "未记录";
  const endText = end ? new Date(end).toLocaleDateString() : "未记录";
  return `${startText} - ${endText}`;
}

export function VizUserDetailBillingPanel({
  ownerId,
  label,
  authEmail,
  returnTo,
  effectivePlan,
  planConfig,
  effectiveSubscription,
  realStripeSubscription,
  usage,
  billingLoadWarn,
}: Props) {
  const paymentCurrency = effectiveSubscription?.currency || planConfig.currency;
  const hasOverride = isAdminOverrideSubscription(effectiveSubscription);

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">订阅与付费管理</h2>
          <p className="mt-1 text-sm text-slate-500">
            这个区域就是该用户的计费控制台。管理员可以直接查看套餐、订阅、支付状态，并在这里操作后台覆盖和真实
            Stripe 订阅。
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          当前账期：{periodText(effectiveSubscription?.current_period_start, effectiveSubscription?.current_period_end)}
        </div>
      </div>

      {billingLoadWarn ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {billingLoadWarn}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-500">当前套餐</p>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ring-1 ${planBadgeColor(effectivePlan)}`}
            >
              {effectivePlan}
            </span>
            {hasOverride ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                后台覆盖中
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-slate-700">{planConfig.displayName}</p>
          <p className="mt-1 text-xs text-slate-500">{planConfig.description || "暂无套餐说明。"}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-500">订阅状态</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{subscriptionStatusLabel(effectiveSubscription)}</p>
          <p className="mt-2 text-sm text-slate-600">
            来源：{billingSourceLabel(effectiveSubscription)}
          </p>
          {effectiveSubscription?.cancel_at_period_end ? (
            <p className="mt-2 text-xs text-amber-700">已设置为到期取消</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-500">支付状态</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">
            {paymentStatusLabel(effectiveSubscription?.latest_invoice_status)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            已付：{formatMoney(effectiveSubscription?.latest_invoice_amount_paid, paymentCurrency)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            待付：{formatMoney(effectiveSubscription?.latest_invoice_amount_remaining, paymentCurrency)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-500">本期用量</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{usage.used.toLocaleString()}</p>
          <p className="mt-2 text-sm text-slate-600">
            剩余：
            {usage.remainingIncluded == null ? " unlimited" : ` ${usage.remainingIncluded.toLocaleString()}`}
          </p>
          <p className="mt-1 text-sm text-slate-600">计费量：{usage.billableUsage.toLocaleString()}</p>
          <p className="mt-1 text-xs text-slate-500">
            预计超量：{formatMoney(usage.estimatedOverageCents, planConfig.currency)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.1fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-900">后台套餐覆盖</h3>
          <p className="mt-1 text-sm text-slate-500">
            这里决定 OrSight 内部对该用户生效的套餐结果。适合手动设为免费账户、测试账户或临时商务账户。
          </p>

          <form action={setBillingOverrideAction} className="mt-4 space-y-3">
            <input type="hidden" name="ownerId" value={ownerId} />
            <input type="hidden" name="label" value={label} />
            <input type="hidden" name="focus" value={ownerId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="block">
              <span className="text-xs font-medium text-slate-600">生效套餐</span>
              <select
                name="plan"
                defaultValue={hasOverride ? effectivePlan : "free"}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="free">free</option>
                <option value="normal">normal</option>
              </select>
            </label>
            <button
              type="submit"
              className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              保存后台覆盖
            </button>
          </form>

          <form action={clearBillingOverrideAction} className="mt-3">
            <input type="hidden" name="ownerId" value={ownerId} />
            <input type="hidden" name="label" value={label} />
            <input type="hidden" name="focus" value={ownerId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button
              type="submit"
              disabled={!hasOverride}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消后台覆盖
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-900">真实 Stripe 订阅</h3>
          <p className="mt-1 text-sm text-slate-500">
            这里改的是用户在 Stripe 里的真实订阅，不是后台覆盖。适合正式升降级、到期取消和恢复续费。
          </p>

          {realStripeSubscription?.stripe_subscription_id ? (
            <>
              <form action={changeStripePlanAction} className="mt-4 space-y-3">
                <input type="hidden" name="ownerId" value={ownerId} />
                <input type="hidden" name="label" value={label} />
                <input type="hidden" name="focus" value={ownerId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">切换到套餐</span>
                  <select
                    name="plan"
                    defaultValue="normal"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="normal">Normal</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  修改真实 Stripe 订阅
                </button>
              </form>

              <form action={setStripeCancelAtPeriodEndAction} className="mt-3">
                <input type="hidden" name="ownerId" value={ownerId} />
                <input type="hidden" name="label" value={label} />
                <input type="hidden" name="focus" value={ownerId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <input
                  type="hidden"
                  name="cancelAtPeriodEnd"
                  value={realStripeSubscription.cancel_at_period_end ? "0" : "1"}
                />
                <button
                  type="submit"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {realStripeSubscription.cancel_at_period_end ? "恢复自动续费" : "设置到期取消"}
                </button>
              </form>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
              该用户当前还没有真实 Stripe 订阅。你仍然可以通过左侧“后台套餐覆盖”把它设置为免费、测试或临时商务账户。
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-900">Stripe / 账单标识</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <div>
              <div className="text-xs font-medium text-slate-500">Customer</div>
              <div className="mt-1 break-all font-mono text-[12px] text-slate-900">
                {shortId(effectiveSubscription?.stripe_customer_id)}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Subscription</div>
              <div className="mt-1 break-all font-mono text-[12px] text-slate-900">
                {shortId(realStripeSubscription?.stripe_subscription_id)}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Invoice</div>
              <div className="mt-1 break-all font-mono text-[12px] text-slate-900">
                {shortId(effectiveSubscription?.latest_invoice_id)}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">登录邮箱</div>
              <div className="mt-1 break-all text-slate-900">{authEmail || "-"}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
