/**
 * Canonical AI model ids for the public platform.
 *
 * Every platform feature imports from here instead of pinning a model id
 * inline. History is the argument: services/moderation.ts pinned
 * google/gemini-2.0-flash-lite, the gateway retired it, and every
 * moderation call silently failed open for weeks. One module means one
 * place to roll the fleet forward when Google rotates generations.
 *
 * Tiers (AI Gateway pricing per 1M tokens, verified 2026-08-11 on the
 * team's paid-tier account):
 * - FAST  google/gemini-2.5-flash-lite  $0.10 in / $0.40 out — cheapest
 *   model in the catalog and the default for every routine job:
 *   moderation, form parsing, sheet transcription. Verified reading a full
 *   handwritten signup sheet correctly at ~$0.0006/page.
 * - QUALITY  google/gemini-3.6-flash    $1.50 in / $7.50 out — the current
 *   strongest flash, used only as the escalation tier for low-confidence
 *   vision reads and as the availability fallback.
 *
 * The wide generation gap is deliberate: FAST optimizes cost on jobs it
 * provably handles, and if Google retires the 2.5 line the fallback chain
 * degrades to QUALITY instead of failing — then this file gets a two-line
 * bump (3.5-flash-lite is the successor lite tier).
 */

export const AI_MODEL_FAST = "google/gemini-2.5-flash-lite";
export const AI_MODEL_QUALITY = "google/gemini-3.6-flash";

/** Availability chain: try FAST, fall through to QUALITY on provider errors. */
export const AI_MODEL_FALLBACK_CHAIN = [
  AI_MODEL_FAST,
  AI_MODEL_QUALITY,
] as const;
