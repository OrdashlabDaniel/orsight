# OrSight Admin Console Deployment

This document captures the production deployment checklist for the rebuilt OrSight admin console.

## Deployment Target

- App directory: `admin-webapp`
- Vercel project: `admin-webapp`
- Recommended production domain: `admin.orsight.com`
- Supabase project: `orsight`

The admin console is intentionally deployed separately from the customer-facing app so that admin-only routes, service-role access, and operational secrets are isolated from the public product surface.

## Required Database Migration

Run this migration before the first production login:

```text
webapp/supabase/migrations/20260509_admin_console_accounts.sql
```

It creates `public.admin_console_accounts`, enables RLS, and revokes direct access from browser-facing roles. The admin app accesses it only through server-side service-role calls.

## Required Vercel Environment Variables

Server-only secrets:

```text
SUPABASE_SERVICE_ROLE_KEY
ADMIN_LOCAL_SESSION_SECRET
ADMIN_BOOTSTRAP_IDENTIFIER
ADMIN_BOOTSTRAP_DISPLAY_NAME
ADMIN_BOOTSTRAP_PASSWORD
OPENAI_ADMIN_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

Public browser-safe variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Billing and Stripe catalog configuration:

```text
STRIPE_PRICE_NORMAL_MONTHLY
STRIPE_PRICE_USAGE_CREDIT_30K
STRIPE_PRICE_USAGE_CREDIT_50K
STRIPE_PRICE_USAGE_CREDIT_70K
STRIPE_PRICE_USAGE_CREDIT_100K
BILLING_ENFORCE
BILLING_FREE_SEAT_LIMIT
BILLING_FREE_MONTHLY_CREDITS
BILLING_FREE_MONTHLY_COST_LIMIT_CENTS
BILLING_FREE_MONTHLY_IMAGE_LIMIT
BILLING_FREE_ESTIMATED_COST_USD_PER_IMAGE
BILLING_FREE_USAGE_UNIT
BILLING_USAGE_CREDIT_30K_TOKENS
BILLING_USAGE_CREDIT_30K_PRICE_CENTS
BILLING_USAGE_CREDIT_50K_TOKENS
BILLING_USAGE_CREDIT_50K_PRICE_CENTS
BILLING_USAGE_CREDIT_70K_TOKENS
BILLING_USAGE_CREDIT_70K_PRICE_CENTS
BILLING_USAGE_CREDIT_100K_TOKENS
BILLING_USAGE_CREDIT_100K_PRICE_CENTS
```

## First Admin Login

When `admin_console_accounts` is empty, the app bootstraps the first active admin from:

```text
ADMIN_BOOTSTRAP_IDENTIFIER
ADMIN_BOOTSTRAP_DISPLAY_NAME
ADMIN_BOOTSTRAP_PASSWORD
```

`ADMIN_BOOTSTRAP_EMAIL` is optional and can be added when you want the first admin profile to include an email address.

After the first login, the admin can change their password from the admin account page. Future admin accounts should be managed inside the admin console rather than through environment variables.

## Production Deploy Flow

1. Confirm the migration has been applied in Supabase.
2. Confirm all required Vercel environment variables exist for Production.
3. Run `npm run build` inside `admin-webapp`.
4. Push the commit to the deployment branch or run `vercel --prod` from `admin-webapp`.
5. Verify login, account page, users page, billing page, and usage board.
6. Point `admin.orsight.com` to the Vercel project after the deployment is stable.

## Security Notes

- Never commit `.env.local`, Stripe secrets, OpenAI admin keys, Supabase service-role keys, or admin passwords.
- Keep the admin console on a separate Vercel project from the user-facing product.
- Use server-only environment variables for every secret that can mutate users, billing, OpenAI accounting, or Stripe records.
