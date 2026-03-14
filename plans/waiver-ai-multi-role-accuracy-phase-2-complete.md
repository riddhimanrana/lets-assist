# Phase 2 Complete: Improve AI prompt and role detection

Strengthened Gemini 2.5 Flash-Lite instructions to explicitly maximize multi-role and multi-section coverage and hardened fallback behavior for under-detected outputs. The route now escalates to vision fallback not only on zero fields, but also when role/field coverage is clearly insufficient.

**Files created/changed:**

- `app/api/ai/analyze-waiver/route.ts`

**Functions created/changed:**

- `POST` (prompt and under-detection logic)
- `VisionFallbackSchema` (added optional `signerRoles`)

**Tests created/changed:**

- Existing route tests re-run against updated logic (`tests/app/api/ai/analyze-waiver-route.test.ts`)

**Review Status:** APPROVED with minor recommendations

**Git Commit Message:**
feat: improve waiver ai multi-role coverage

- strengthen model instructions for repeated signer sections
- trigger vision fallback on under-detection, not only empty output
- merge fallback roles/fields safely into normalized output
