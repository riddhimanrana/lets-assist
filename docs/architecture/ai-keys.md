# AI Gateway authentication and plugin accounting

The host owns every AI Gateway credential. Plugins request a model through
`prepareTrackedAiCall` and never receive an API key or OIDC token. That wrapper
prepares telemetry for the plugin key, organization, feature, and model without
recording prompts or model output. The caller must invoke its `logUsage`
callback after the response to store token usage.

## Workload scopes

The host routes calls into three accounting scopes:

- `moderation` for safety and moderation work
- `platform` for product features owned by the main application
- `plugin` for code owned by an installed plugin

These scopes support separate Gateway budgets and incident isolation. They do
not authorize a request. The server route or action must still authorize the
user, organization, entitlement, plugin install, and feature before making an
AI call.

## Authentication order

`lib/ai/gateway.ts` resolves authentication in this order:

1. The scope's current key name.
2. A compatibility alias used by older deployments or documentation.
3. The shared `AI_GATEWAY_API_KEY` migration fallback.
4. Vercel OIDC when no API key exists.

Current key names:

- `AI_GATEWAY_KEY_MODERATION`
- `AI_GATEWAY_KEY_PLATFORM`
- `AI_GATEWAY_KEY_PLUGINS`

Compatibility aliases:

- `AI_GATEWAY_API_KEY_MODERATION`
- `AI_GATEWAY_API_KEY_PLATFORM`
- `AI_GATEWAY_KEY_PLUGIN`
- `AI_GATEWAY_API_KEY_PLUGIN`

Plugin work never falls back to a platform-scoped key. It may use the shared
migration key or Vercel OIDC. The plugin tracking context requires a plugin key
and organization ID, and each AI SDK call must forward `tracked.gatewayOptions`
to carry those tags into Vercel Gateway usage. Remove `AI_GATEWAY_API_KEY` after
every environment has either scoped keys or working OIDC.

The AI SDK refreshes Vercel OIDC tokens in Preview and Production. Local work
can use an explicit key, `vercel dev`, or a recently pulled Vercel OIDC token.
Passing an empty `apiKey` disables the SDK's OIDC path, so the host omits the
option when it selects OIDC.

## Plugin call requirements

Plugin AI code must:

- run on the server
- authorize the caller and active plugin install before model selection
- use the `plugin` scope and include `pluginKey`, `organizationId`, and `feature`
- use `prepareTrackedAiCall` so PostHog and `plugin_data.ai_usage_log` receive the
  same accounting identity
- keep telemetry inputs and outputs disabled
- require staff review before AI changes consequential organization state

Provider BYOK belongs in Vercel AI Gateway team settings. Do not store provider
credentials in plugin configuration, `plugin_data`, browser storage, or the
shared plugin upload bucket.
