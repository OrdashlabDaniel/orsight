# Admin OpenAI Reconciliation

This backend now has a dedicated reconciliation layer inside the admin `Usage Board`.

## What it does

- Pulls finance-truth from OpenAI `GET /v1/organization/costs`
- Pulls token and request detail from OpenAI `GET /v1/organization/usage/completions`
- Compares both against local `usage_logs`
- Surfaces variance, line items, model deltas, project-level cost, and API-key-level cost
- Filters the official layer and the local attribution layer to the same selected OpenAI `project_id`
- Exports both estimated and conservative local attribution columns for downstream cost accounting

## Required setup

1. Create an OpenAI organization admin key with access to the organization usage and cost endpoints.
2. Add the key to `admin-webapp/.env.local`:

```env
OPENAI_ADMIN_KEY=sk-admin-...
```

3. Restart `admin-webapp`.

## Recommended accounting architecture

- Route each billable workspace through a dedicated OpenAI `project_id`
- Keep local app-user attribution in `usage_logs`
- Treat OpenAI `Costs API` as workspace-truth
- Treat local user rows as conservative attribution, not invoice-truth

This is the lowest-management path that still prevents local accounting from understating actual spend.

## Optional webapp configuration

These values live in `webapp/.env.local`:

```env
# One default OpenAI project for the whole app
OPENAI_PROJECT_ID=proj_...

# Or a per-form map when different forms/workspaces should reconcile to different projects
OPENAI_FORM_PROJECT_MAP_JSON={"form-1":"proj_default","form-customer-a":"proj_customer_a"}

# Internal reference only, useful for local export / attribution labels
OPENAI_API_KEY_ID=key_...
OPENAI_FORM_API_KEY_ID_MAP_JSON={"form-1":"key_default"}
```

## Where to get the missing pieces

- OpenAI admin key: OpenAI admin console / organization administration area
- Exact workspace or customer cost: route each billable workspace through a dedicated OpenAI `project_id`
- Exact service boundary cost: route each service or worker through a dedicated OpenAI `api_key_id`

## Accuracy model

### Finance truth

OpenAI `Costs API` is the invoice-authoritative source and should be treated as the final spend truth.

### Analytical detail

OpenAI `Usage Completions API` is used for token, request, model, and tier analysis. It is highly useful for diagnostics, but OpenAI documents that usage may not reconcile perfectly to costs.

### Local attribution

Local `usage_logs` are still an attribution layer. They are useful for app-user analysis, but they are not invoice truth.

## Current limits in this repository

- `usage_logs` now persist `form_id`, `request_count`, `cached_input_tokens`, `openai_project_id`, `openai_api_key_id`, `service_tier`, `pricing_tier`, `openai_endpoint`, `estimated_cost_usd`, and `conservative_cost_usd`
- `guidance_chat`, `preview_fill`, and `template_from_image` now record OpenAI project routing and request metadata directly from live responses
- `extract_table` now records `form_id`, project scope, API key scope, pricing basis version, and conservative request-count attribution, but some deep sub-request metadata inside the extraction pipeline is still aggregated before persistence
- some business events still aggregate multiple upstream OpenAI calls into one local row by design, because that keeps management complexity under control while preserving conservative cost attribution

Because of that, exact official per-app-user reconciliation is not possible yet unless the traffic is segmented in OpenAI itself.

## Recommended next upgrade

Capture these fields on every upstream OpenAI call before business aggregation:

- `project_id`
- `api_key_id`
- `service_tier`
- `model`
- `input_tokens`
- `input_cached_tokens`
- `output_tokens`
- `request_id`

That upgrade will make local attribution materially closer to official OpenAI truth.
