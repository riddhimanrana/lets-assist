# Plan: Waiver Preview Signature Fix

Fix waiver preview/download failures caused by schema drift and misleading error handling, while preserving upload/e-signature/anonymous access flows. We will harden route queries, correct status semantics, and add regression tests so both organizer and signupee flows remain stable.

## Phases 4

1. **Phase 1: Route query hardening**
    - **Objective:** Remove brittle column assumptions in waiver preview/download route selects.
    - **Files/Functions to Modify/Create:** app/api/waivers/[signatureId]/preview/route.ts; app/api/waivers/[signatureId]/download/route.ts
    - **Tests to Write:** preview route tolerates schema without signature_file_url; download route tolerates schema without signature_file_url
    - **Steps:**
        1. Write failing tests that simulate schema without signature_file_url.
        2. Update route select strategy to schema-tolerant retrieval.
        3. Run target tests to confirm they pass.

2. **Phase 2: Correct error semantics**
    - **Objective:** Distinguish true not-found from query/schema failures.
    - **Files/Functions to Modify/Create:** app/api/waivers/[signatureId]/preview/route.ts; app/api/waivers/[signatureId]/download/route.ts
    - **Tests to Write:** returns 500 on Supabase query error; returns 404 only when signature truly missing; fallback by signup_id still works
    - **Steps:**
        1. Add failing tests for query-error and not-found branches.
        2. Implement explicit branching for query error vs missing row.
        3. Run target tests and ensure all pass.

3. **Phase 3: Legacy compatibility and auth path checks**
    - **Objective:** Preserve upload/e-signature/multi-signer priority and anonymous permission behavior.
    - **Files/Functions to Modify/Create:** app/api/waivers/[signatureId]/preview/route.ts; app/api/waivers/[signatureId]/download/route.ts; tests/integration/waiver-preview-download.test.ts
    - **Tests to Write:** anonymous access requires matching anonymousSignupId; upload_storage_path priority still works; signature_payload generation path still works
    - **Steps:**
        1. Add failing regression tests for route-level behavior.
        2. Adjust route logic to preserve priority/auth semantics.
        3. Re-run tests and verify green.

4. **Phase 4: End-to-end verification for reported failure**
    - **Objective:** Validate fix against real endpoint behavior and related user flows.
    - **Files/Functions to Modify/Create:** no functional file changes expected; verification updates only if needed
    - **Tests to Write:** extend/adjust integration assertions if gaps are discovered
    - **Steps:**
        1. Hit the reported preview/download endpoints locally after fixes.
        2. Validate organizer and signupee flows from current code paths.
        3. Run lint, typecheck, and focused waiver tests.

## Open Questions 2

1. Keep ancient signature_file_url redirect support when column is absent, or formally deprecate it?
2. Prefer generic client-safe 500 message or explicit query-error message for route failures?
