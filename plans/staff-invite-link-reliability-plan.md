# Plan: Staff invite link reliability

Fix staff invite onboarding so links work consistently across email/password and Google OAuth, while reducing fragile pre-validation and adding regression tests. We will implement in four incremental, test-driven phases so each phase is verifiable and safe to ship.

## Phases (4)

1. **Phase 1: Preserve invite context in OAuth start**
    - **Objective:** Ensure Google OAuth initiation preserves staff invite context through callback parameters.
    - **Files/Functions to Modify/Create:** `app/signup/SignupClient.tsx` (`handleGoogleSignIn`), `app/signup/actions.ts` (`signInWithGoogle`), `tests/app/signup/actions.staff-invite.test.ts`.
    - **Tests to Write:**
        - `signInWithGoogle includes staff invite params in redirectTo`
        - `signInWithGoogle omits invite params when not provided`
    - **Steps:**
        1. Write tests asserting callback redirect URL encoding for staff invite params.
        2. Run targeted tests and confirm failure.
        3. Implement minimal changes in signup client/action to pass invite context.
        4. Re-run targeted tests and confirm pass.

2. **Phase 2: Apply staff invite in OAuth callback**
    - **Objective:** Add server-side callback handling that validates staff token and grants staff membership after OAuth sign-in.
    - **Files/Functions to Modify/Create:** `app/auth/callback/route.ts`, `tests/app/auth/callback.staff-invite.test.ts`.
    - **Tests to Write:**
        - `callback grants staff membership for valid token`
        - `callback skips membership for expired/invalid token`
        - `callback handles duplicate member insert safely`
    - **Steps:**
        1. Add callback route tests for valid/invalid invite outcomes.
        2. Run tests and confirm failure.
        3. Implement helper logic to validate token and insert `organization_members` role `staff`.
        4. Re-run tests and confirm pass.

3. **Phase 3: Harden email signup invite flow and feedback**
    - **Objective:** Remove fragile pre-validation dependency and surface invite-processing outcomes without breaking account creation.
    - **Files/Functions to Modify/Create:** `app/signup/page.tsx`, `app/signup/actions.ts` (`signup`, `handleStaffTokenSignup`), `app/signup/SignupClient.tsx`, tests in `tests/app/signup/actions.staff-invite.test.ts`.
    - **Tests to Write:**
        - `signup returns invite outcome metadata when invite fails`
        - `signup still succeeds while reporting invite issue`
        - `signup processes valid staff invite`
    - **Steps:**
        1. Add tests for structured invite outcome states.
        2. Run tests and confirm failure.
        3. Implement structured result handling in server action and client toast/warning behavior.
        4. Re-run tests and confirm pass.

4. **Phase 4: End-to-end verification and Supabase alignment**
    - **Objective:** Validate full feature correctness with lint/type/tests and verify Supabase schema/policy assumptions.
    - **Files/Functions to Modify/Create:** test files from phases 1–3, optional docs note if needed.
    - **Tests to Write:**
        - Extend callback/signup tests to cover regression edge cases.
    - **Steps:**
        1. Run targeted invite tests, then broader test suite subset.
        2. Run typecheck and lint for touched files.
        3. Re-verify Supabase schema/policies relevant to invite fields and membership role.
        4. Document final verification outcome.

## Open Questions (2)

1. Keep `org` username parameter for backward compatibility now, or switch invite links to `org_id` immediately?
2. Should we tighten public readability of `staff_join_token*` columns in a follow-up migration after feature stabilization?
