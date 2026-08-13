# CSF Acceptance Completion Design

## Goal

Close the highest-value repository-owned DVHS CSF acceptance gaps without
duplicating existing unit, service, or database coverage. All browser mutations
must run only in the marker-validated isolated CSF environment with fictional
fixtures.

## Existing Coverage Inventory

- The browser suite already covers exact-email profile confirmation, explicit
  decline into officer review, unsafe officer rejection, profile-merge safety,
  staff roster presentation, post publication/pinning/replies, role navigation,
  and Help menu reachability.
- Private-plugin tests already cover profile writes, claim rendering, role-aware
  Help filtering, staff option derivation, import parsing/readiness/history,
  post action outcome contracts, and announcement queue status.
- pgTAP already covers atomic profile claims and link requests, staff RBAC and
  recovery-seat constraints, import reconciliation/commit integrity, post
  mutation receipts, and durable communications.
- The remaining repository-owned gaps are visible add-member mutation,
  successful officer account review, officer assignment, a synthetic historical
  workbook preview/reconcile/commit lifecycle, browser-visible post/email
  queued-versus-not-queued truth, and browser verification of role-filtered Help
  content.

## Test Design

Use focused Playwright journeys instead of one cross-domain monolith:

1. Add a namespaced fictional student through **Members → Add member** and prove
   both the visible directory result and durable profile/cohort state.
2. Create a disposable, corroborated account-review request, approve it through
   **Members → Account connections**, and prove the account/profile link and
   organization membership.
3. Assign the connected fictional member to an existing assignable position
   through **More → Staff access**, prove the visible officer row and durable
   assignment, then retire only test-owned state.
4. Upload the repository's synthetic historical workbook (or a smaller
   in-memory workbook with the same supported schema), prove that Preview,
   Reconcile, and Commit are distinct visible boundaries, make the required
   reasoned row decisions, commit, and verify normalized durable results.
5. Extend the existing class Stream journey with one no-email publication and
   one email-requested publication. Assert separate visible post and email
   outcomes and the corresponding absence/presence of a durable campaign.
   Provider dispatch remains disabled; queued never means sent or delivered.
6. Open Help as representative member, posting officer, and administrator
   actors. Assert required role-specific guides and the absence of guides for
   capabilities the actor does not hold.

Prefer extending the existing domain specs when their fixtures and cleanup are
already suitable. Add a new focused spec only when sharing a lifecycle fixture
materially reduces setup and avoids duplicated mutation logic.

## Fixture and Safety Rules

- Use only reserved `local.test`/`students.local.test` identities, random
  namespaced identifiers, and synthetic workbook rows.
- Never call Google, Resend, Gmail, Production, Preview, or hosted Development.
- Require the existing isolated-stack marker and use the harness-owned compiled
  Next.js server.
- Disable outbound workers and assert durable queue state rather than provider
  delivery.
- Clean up mutable test-owned rows in dependency order. Where immutable audit
  history prevents deletion, de-identify or retire the fixture using the
  repository's established pattern.
- Keep generated Playwright output under ignored `.artifacts/`; commit no traces,
  screenshots, storage state, cookies, or generated reports.

## Failure Classification

- Harness blockers include missing private submodule access, unavailable Docker
  or browser binaries, isolated-stack bootstrap failure, local resource
  exhaustion, and absent run-scoped fixture credentials.
- Product failures include a visible workflow that loads but violates the
  contract, an authorized mutation that is refused incorrectly, an unauthorized
  mutation that succeeds, a durable-state mismatch, or an uncaught browser,
  server, or request failure during a valid isolated journey.
- Report local, hosted Development, and Production evidence separately. This
  task authorizes local isolated verification only.

## Verification

Run the narrowest changed Playwright specs first, then the complete CSF browser
gate if the environment permits. Run focused root/private tests affected by the
edits, format checking, lint, typecheck, strict submodule validation, and the CSF
workflow gate when its isolated prerequisites are available. A blocked gate is
reported with its exact prerequisite or infrastructure failure and is never
described as a product failure.
