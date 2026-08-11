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
 * - FAST  google/gemini-3.5-flash-lite  $0.30 in / $2.50 out — the default
 *   for every routine job: moderation, form parsing, sheet transcription.
 * - QUALITY  google/gemini-3.6-flash    $1.50 in / $7.50 out — escalation
 *   tier for low-confidence vision reads and harder structured extraction.
 *
 * gemini-2.5-flash-lite is still served and nominally cheaper, but it is
 * two generations behind and the 2.x line is where retirements happen;
 * the savings are not worth another silent 404.
 */

export const AI_MODEL_FAST = "google/gemini-3.5-flash-lite";
export const AI_MODEL_QUALITY = "google/gemini-3.6-flash";

/** Availability chain: try FAST, fall through to QUALITY on provider errors. */
export const AI_MODEL_FALLBACK_CHAIN = [
  AI_MODEL_FAST,
  AI_MODEL_QUALITY,
] as const;
