# Phase 3 Complete: Legacy compatibility and auth path checks

Phase 3 compatibility hardening is complete for waiver preview/download flows. We preserved signature source priority behavior, added explicit regression tests around schema drift and auth-param forwarding, and restored preview parity for legacy typed signatures.

**Files created/changed:**

- app/api/waivers/[signatureId]/preview/route.ts
- app/api/waivers/[signatureId]/download/route.ts
- tests/integration/waiver-routes-schema-tolerance.test.ts
- tests/integration/waiver-routes-error-semantics.test.ts

**Functions created/changed:**

- GET in app/api/waivers/[signatureId]/preview/route.ts
- GET in app/api/waivers/[signatureId]/download/route.ts
- helper logic for PostgREST error classification and schema-tolerant select fallback in both routes

**Tests created/changed:**

- tests/integration/waiver-routes-schema-tolerance.test.ts
  - strengthened retry-path tests with terminal status assertions
  - validates missing-column retry and legacy redirect behavior
- tests/integration/waiver-routes-error-semantics.test.ts
  - validates 404 vs 500 semantics and fallback behavior
  - validates anonymousSignupId forwarding
  - validates preview support for legacy signature_text typed signatures

**Review Status:** APPROVED

**Git Commit Message:**
fix: harden waiver route compatibility paths

- preserve legacy signature flow while handling schema drift safely
- keep waiver priority order deterministic across preview/download
- add route-level tests for fallback, auth param wiring, and parity
