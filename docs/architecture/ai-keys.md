# AI key architecture (moderation vs product AI vs plugins)

This project now supports scoped AI Gateway key resolution by workload.

## Why split keys

Using one key for everything makes it hard to:

- enforce least-privilege by workload
- set different budgets/rate limits
- monitor costs clearly
- isolate failures/abuse

## Current scoped resolution

Implemented in `lib/ai/gateway.ts` via `gatewayModel(scope, modelId)`.

### Scopes

- `moderation`
- `platform`
- `plugin`

### Environment variable resolution order

- `moderation`:
  1. `AI_GATEWAY_API_KEY_MODERATION`
  2. `AI_GATEWAY_API_KEY`
- `platform`:
  1. `AI_GATEWAY_API_KEY_PLATFORM`
  2. `AI_GATEWAY_API_KEY`
- `plugin`:
  1. `AI_GATEWAY_API_KEY_PLUGIN`
  2. `AI_GATEWAY_API_KEY_PLATFORM`
  3. `AI_GATEWAY_API_KEY`

If only `AI_GATEWAY_API_KEY` is set, behavior remains backward-compatible.

## Mapped workloads in code

### Moderation scope

- `services/moderation.ts`
- `app/admin/moderation/ai-generation.ts`

### Platform scope

- `app/api/ai/parse-project/route.ts`
- `app/api/ai/analyze-waiver/route.ts`

## Recommended production setup

Set separate keys in Vercel project envs:

- `AI_GATEWAY_API_KEY_MODERATION`
- `AI_GATEWAY_API_KEY_PLATFORM`
- `AI_GATEWAY_API_KEY_PLUGIN` (optional until plugin BYOK rollout)

Keep `AI_GATEWAY_API_KEY` only as migration fallback, then remove once all scoped keys are set.

## Plugin / organization BYOK strategy (next phase)

For plugins/org-level key isolation, prefer request-scoped routing:

1. Store plugin/org provider credentials encrypted at rest (never client-exposed).
2. Decrypt server-side only for execution.
3. Use provider scoping per request (e.g., gateway provider options / BYOK flow).
4. Tag usage with `plugin_id`, `organization_id`, `feature` for observability.
5. Enforce per-plugin/org quotas and hard limits.

## Should AI be used for import parsing?

Short answer: **deterministic parser first, AI as optional fallback**.

Recommended approach:

1. Keep deterministic parsing as primary path (already implemented).
2. Trigger AI only for ambiguous mapping cases (e.g., no clear email column).
3. Require confidence threshold + human review before sending invites.
4. Never auto-send invites from AI-only extraction without preview.

This preserves reliability and keeps invitation flows auditable.
