-- Raise the Normal plan monthly quota to roughly a $3 internal AI cost budget.
-- Normal remains $9.99/month and still hard-stops once the included token quota
-- plus any prepaid token balance is exhausted.

update public.app_billing_plan_configs
set
  description = 'Monthly subscription with a hard 10,000,000 AI token quota.',
  included_credits = 10000000,
  overage_unit_name = 'tokens',
  updated_at = now()
where plan_id = 'normal';
