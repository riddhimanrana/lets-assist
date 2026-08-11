/**
 * Canonical AI model ids for the public platform.
 *
 * Every platform feature imports from here instead of pinning a model id
 * inline. History is the argument: services/moderation.ts pinned
 * google/gemini-2.0-flash-lite, the gateway retired it, and every
 * moderation call silently failed open for weeks. One module means one
 * place to roll the fleet forward when Google rotates generations.
 *
 * Tiers (AI Gateway pricing per 1M tokens, verified 2026-08-11):
 * - FAST  google/gemini-2.5-flash-lite  $0.10 in / $0.40 out — the default
 *   for every routine job: moderation, form parsing, sheet transcription.
 * - QUALITY  google/gemini-2.5-flash    $0.30 in / $2.50 out — escalation
 *   tier for low-confidence vision reads and harder structured extraction.
 *
 * Both are FREE-TIER ELIGIBLE on the AI Gateway (browse
 * vercel.com/ai-gateway/models with the Free Tier filter). That matters:
 * this team currently runs on free credit, and the newer 3.x flash line is
 * paid-tier only — pinning it returns 403 "free tier users do not have
 * access" until credits are purchased. When the team moves to paid credits,
 * bump these two constants (3.5-flash-lite / 3.6-flash are the successors)
 * and nothing else.
 */

export const AI_MODEL_FAST = "google/gemini-2.5-flash-lite";
export const AI_MODEL_QUALITY = "google/gemini-2.5-flash";

/** Availability chain: try FAST, fall through to QUALITY on provider errors. */
export const AI_MODEL_FALLBACK_CHAIN = [
  AI_MODEL_FAST,
  AI_MODEL_QUALITY,
] as const;
