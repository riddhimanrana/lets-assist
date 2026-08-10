# Repository cleanup register

This register separates actionable repository defects from provider/account and Production-readiness blockers. A finding leaves the active section only when fixed with evidence, disproved with evidence, or moved to the external section with a named dependency.

## Repository-owned P0–P2

| ID        | Priority | Finding                                                                                                                                                   | Owner             | Evidence / exit gate                             |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------ |
| CLEAN-004 | P2       | Complete keyboard, focus, reduced-motion, and screen-reader acceptance for CSF roles and breakpoints.                                                     | CSF UX cleanup PR | Automated checks plus sanitized browser evidence |
| CLEAN-005 | P2       | Complete visible synthetic CSF mutation lifecycle for profile claim/resolution, imports, applications, points, meetings/clubs, close/reopen, and reports. | CSF acceptance PR | Role matrix at desktop/tablet/phone              |
| AUD-001   | P0       | `public.trusted_member` INSERT policy has no `status` guard, so a user can self-grant trusted status and unlock organization and project creation.        | Production cutover | Forward migration with two guards plus `trusted_member_self_grant.test.sql`; live in Production until cutover |
| AUD-002   | P0       | `public.notifications` INSERT policy ends in `OR (auth.uid() IS NULL)`, letting any unauthenticated caller inject notifications for any user.             | Production cutover | Server callers moved off the browser client, disjunct removed, `notifications_rls.test.sql`; live in Production until cutover |
| AUD-003   | P1       | `public` default privileges granted `anon`/`authenticated` on every future table and function. Tables and sequences are fixed; the FUNCTIONS half is still open because Postgres grants EXECUTE to PUBLIC as a built-in default that ALTER DEFAULT PRIVILEGES does not suppress. | Production cutover | Tables done and pgTAP-proven; functions need an event trigger or a migration gate check |
| AUD-004   | P1       | `plugin_audit_logs_action_check` allows 22 action values while the code emits 28, so six lifecycle events — including plugin data deletion — go unaudited. | Plugin control plane PR | Forward migration with all 28 values; `logPluginAudit` stops swallowing `23514` |
| AUD-014   | P2       | Every `codex/csf-lifecycle-overhaul` migration timestamp predates this session's five, so merging Codex after these are applied would leave the ledger unordered. Neither set is applied remotely yet. | Merge order | Merge Codex into `development` before any hosted push, or renumber its migrations |
| AUD-013   | P2       | `RESEND_API_KEY` is flagged "Needs Attention" on both Production and Pre-Production in Vercel; email delivery is load-bearing for CSF campaigns, waiver notices, and certificates. | Account owner | Credential resolved or rotated before the cutover |
| AUD-012   | P2       | The browser notification service suppresses any notification whose `(user_id, type)` pair already exists, so repeat notices are silently dropped.          | Platform PR       | Dedupe key replaces the type-wide check; server path already fixed |
| AUD-006   | P2       | Three `server-only` modules drive notifications through the browser Supabase client, which is why the AUD-002 escape hatch exists.                          | Platform PR       | Server callers use the admin client; module-boundary test forbids `@/lib/supabase/client` in `server-only` modules |

See [the 2026-08-10 audit register](audit-register-20260810.md) for full evidence, reproduction, and fix specifications for AUD-001 through AUD-014.

Two repository-owned P0 findings are currently recorded, both live in Production and both scheduled for the production cutover by explicit decision.

## External/account blockers

| ID      | Dependency         | Blocker                                                                                                                                                                                                  | Required owner/action                                                          |
| ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| EXT-001 | GitHub Support     | Cached views and PR #97 refs for the removed raw workbook require server-side dereferencing/garbage collection. The available browser Support account does not include repository owner `riddhimanrana`. | Repository owner opens Support ticket with affected commit mappings and PR #97 |
| EXT-002 | Google             | Live OAuth chooser, Picker, Drive import, refresh/reconnect/revocation, 403, and 429 journeys require approved test account/configuration.                                                               | Google account owner authorizes Development-only run                           |
| EXT-003 | Hosted Development | **Resolved 2026-08-10.** Persistent Supabase Development branch exists (`ocbuygudvarsuxijxhau`, 218 migrations, advisors clean). `dev.lets-assist.com` is wired to the `development` branch with Valid Configuration. Branch-scoped Vercel Preview variables for the three Supabase keys are present and scoped to `development`. Authenticated preview access and deployment-log access both confirmed. | Closed — verified in the Vercel dashboard and against the Supabase branch |
| EXT-004 | Production         | Production migrations, provider credentials, aliases, and release acceptance are intentionally outside this program.                                                                                     | Separate release authorization                                                 |

## Completed milestones

| Milestone                           | Evidence                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root browser harness modularization | The former 3,277-line harness is split by launcher ownership, Docker lifecycle, verifier workflow, and CI contracts; all resulting test modules remain below 1,200 lines.                              |
| Test process isolation              | `bun run test` executes mock-sensitive groups in separate Bun processes and completes the root and private-plugin suites.                                                                              |
| Artifact boundary                   | Generated browser output and formatter caches use ignored `.artifacts/`; the allowlisted cleaner is dry-run by default.                                                                                |
| Production dependency audit         | `bun audit --production` reports no vulnerabilities and now runs inside `quality:static`; compatible direct dependencies are current and four major-version holds have explicit peer/runtime evidence. |
| Root module extraction              | Oversized root action, report, moderation, seed, and browser-harness code is split behind compatibility exports; maintainability checks, focused tests, and the production build pass.                 |
| Private CSF module extraction       | The private CSF actions, dashboard assembly, and import-integrity suites are split by domain; 2,337 private tests, root gitlink integration, and the isolated replay pass.                             |
| Compiled browser runtime            | Local CSF/DV E2E now uses the same compiled runtime as CI, eliminating the development hot-reload module invalidation failure; CSF passes 40/40 behavioral scenarios and DV passes 3/3.                |
| Fictional fixture identity          | CSF admin fixtures no longer reuse a real owner name or portrait; seed reruns synchronize the public profile through authenticated self-update RLS, with regression coverage and reviewed screenshots. |
| Isolated teardown                   | Dry-run ownership validation preceded deletion; the exact CSF stack then proved zero residual labeled containers, volumes, or networks and removed its generated work directory and secrets.           |
| Fresh-install dependency graph      | The global Ajv override that broke ESLint after a clean Bun install is removed, and the imported Shadcn Tailwind v4 stylesheet is now declared; both resolutions have regression coverage.             |
