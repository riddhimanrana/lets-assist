# Repository cleanup register

This register separates actionable repository defects from provider/account and Production-readiness blockers. A finding leaves the active section only when fixed with evidence, disproved with evidence, or moved to the external section with a named dependency.

## Repository-owned P0–P2

| ID        | Priority | Finding                                                                                                                                                   | Owner             | Evidence / exit gate                             |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------ |
| CLEAN-004 | P2       | Complete keyboard, focus, reduced-motion, and screen-reader acceptance for CSF roles and breakpoints.                                                     | CSF UX cleanup PR | Automated checks plus sanitized browser evidence |
| CLEAN-005 | P2       | Complete visible synthetic CSF mutation lifecycle for profile claim/resolution, imports, applications, points, meetings/clubs, close/reopen, and reports. | CSF acceptance PR | Role matrix at desktop/tablet/phone              |

No repository-owned P0 is currently recorded. This is not a claim that undiscovered defects are impossible.

## External/account blockers

| ID      | Dependency         | Blocker                                                                                                                                                                                                  | Required owner/action                                                          |
| ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| EXT-001 | GitHub Support     | Cached views and PR #97 refs for the removed raw workbook require server-side dereferencing/garbage collection. The available browser Support account does not include repository owner `riddhimanrana`. | Repository owner opens Support ticket with affected commit mappings and PR #97 |
| EXT-002 | Google             | Live OAuth chooser, Picker, Drive import, refresh/reconnect/revocation, 403, and 429 journeys require approved test account/configuration.                                                               | Google account owner authorizes Development-only run                           |
| EXT-003 | Hosted Development | Persistent Supabase Development, branch-scoped Vercel configuration, authenticated preview, and failed-deployment log access require an account with access to the repository's Vercel team.             | Infrastructure owner provisions/authorizes Development resources               |
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
| Fresh-install dependency graph      | The global Ajv override that broke ESLint after a clean Bun install is removed; application Ajv 8 and ESLint's Ajv 6 contract resolve independently with a regression test.                            |
