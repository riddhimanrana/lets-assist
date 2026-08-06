# Repository cleanup register

This register separates actionable repository defects from provider/account and Production-readiness blockers. A finding leaves the active section only when fixed with evidence, disproved with evidence, or moved to the external section with a named dependency.

## Repository-owned P0–P2

| ID        | Priority | Finding                                                                                                                                                   | Owner                  | Evidence / exit gate                                     |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------- |
| CLEAN-001 | P2       | Split oversized root action, report, moderation, and seed modules without changing public contracts.                                                      | Root cleanup PRs       | Maintainability check plus focused tests and build       |
| CLEAN-002 | P2       | Split oversized private CSF actions, dashboard assembly, and import-integrity tests.                                                                      | Private CSF cleanup PR | Private tests, root gitlink integration, isolated replay |
| CLEAN-003 | P1       | Triage and resolve production dependency advisories; no unreviewed high/critical finding.                                                                 | Dependency PR series   | Lockfile-only audit report and hosted CI                 |
| CLEAN-004 | P2       | Complete keyboard, focus, reduced-motion, and screen-reader acceptance for CSF roles and breakpoints.                                                     | CSF UX cleanup PR      | Automated checks plus sanitized browser evidence         |
| CLEAN-005 | P2       | Complete visible synthetic CSF mutation lifecycle for profile claim/resolution, imports, applications, points, meetings/clubs, close/reopen, and reports. | CSF acceptance PR      | Role matrix at desktop/tablet/phone                      |

No repository-owned P0 is currently recorded. This is not a claim that undiscovered defects are impossible.

## External/account blockers

| ID      | Dependency         | Blocker                                                                                                                                                                                                  | Required owner/action                                                          |
| ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| EXT-001 | GitHub Support     | Cached views and PR #97 refs for the removed raw workbook require server-side dereferencing/garbage collection. The available browser Support account does not include repository owner `riddhimanrana`. | Repository owner opens Support ticket with affected commit mappings and PR #97 |
| EXT-002 | Google             | Live OAuth chooser, Picker, Drive import, refresh/reconnect/revocation, 403, and 429 journeys require approved test account/configuration.                                                               | Google account owner authorizes Development-only run                           |
| EXT-003 | Hosted Development | Persistent Supabase Development, branch-scoped Vercel configuration, authenticated preview, and failed-deployment log access require an account with access to the repository's Vercel team.             | Infrastructure owner provisions/authorizes Development resources               |
| EXT-004 | Production         | Production migrations, provider credentials, aliases, and release acceptance are intentionally outside this program.                                                                                     | Separate release authorization                                                 |

## Completed milestones

| Milestone                           | Evidence                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root browser harness modularization | The former 3,277-line harness is split by launcher ownership, Docker lifecycle, verifier workflow, and CI contracts; all resulting test modules remain below 1,200 lines. |
| Test process isolation              | `bun run test` executes mock-sensitive groups in separate Bun processes and completes the root and private-plugin suites.                                                 |
| Artifact boundary                   | Generated browser output and formatter caches use ignored `.artifacts/`; the allowlisted cleaner is dry-run by default.                                                   |
