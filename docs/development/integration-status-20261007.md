# Development integration status, October 7, 2026

Root [PR 867](https://github.com/riddhimanrana/lets-assist/pull/867) is the
combined brand and infrastructure candidate. Private
[PR 643](https://github.com/riddhimanrana/lets-assist-plugins/pull/643) combines
brand layouts with audited CSF and Speech & Debate workflows. This page tracks
source integration. It does not certify hosted Development or Production.

| Area                                                           | Current result                                                                                                                                                                                                                               | Required next evidence                                                                                                                                                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand, landing and account layouts                             | All six brand follow-up slices are integrated. Root project extraction is 1e20ac71; private Development merge is 6012a1b7.                                                                                                                   | Signed-in browser gate waits for the signed plugin registry integration.                                                                                                                                                              |
| Login, scheduler, plugin workflow and Docker diagnostics fixes | Included in root candidate.                                                                                                                                                                                                                  | Required PR checks and completion of the registry, build and browser gates.                                                                                                                                                           |
| Root static checks                                             | Lint, typecheck and agent policy pass under Node 24.21.0.                                                                                                                                                                                    | Repeat affected checks after later integration.                                                                                                                                                                                       |
| Private source                                                 | All 569 private test files pass. PR 643 merged into private Development as 6012a1b7 with required CI checks passing.                                                                                                                         | Signed release integration and hosted acceptance. Root gitlink is 6012a1b7.                                                                                                                                                           |
| Independent CSF app                                            | Lint, typecheck, tests, build and data-access/route gates pass.                                                                                                                                                                              | Hosted runtime and organization selection readback after release.                                                                                                                                                                     |
| Security regressions                                           | CSV control prefixes, notification URL normalization and Sheets status UI tests pass. Signup confirmation no longer claims unconfirmed delivery succeeded.                                                                                   | Final integrated source and browser checks.                                                                                                                                                                                           |
| Dependencies                                                   | Next 16.4.0, React 19.3.0, Node 24.21.0, current Supabase clients and shadcn 4.21.4. Tailwind 4.3.3.                                                                                                                                         | CLI 2.120.0 is integrated; its PostgreSQL 17.11 replay passed SQL and security checks, and the accepted catalog matches all 1,434 release entries. Bun 1.4.2 work is preserved separately until the private app pin can move with it. |
| Database                                                       | Fresh 717 replay on CLI 2.120.0 and PostgreSQL 17.11 passes 492 SQL files and 12,865 assertions, advisors, architecture and plugin isolation. The corrected fixture-excluding catalog check passes with all 1,434 release entries unchanged. | Combined gate stopped at the unsigned plugin version mismatch before runtime/browser checks.                                                                                                                                          |
| AI review                                                      | Private PR 643 received automatic review on creation and updates. All five review findings are fixed and resolved.                                                                                                                           | Root review completed on d6abe1d. Its two export findings are fixed in 2d3236b5; final-head review remains pending.                                                                                                                   |
| Branch cleanup                                                 | Removed local claude/csf-partner-linking and codex/plugin-release-dvhs-csf-v1.2.85 after proving remote Development ancestry and no active worktree.                                                                                         | Other feature branches remain until their work reaches remote Development.                                                                                                                                                            |

## Preserved work

| Branch                         | Remaining work                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| codex/paper-attendance         | Final paper source 56f64463 is integrated. Fixture corrections 41f27cfc pass 144 assertions and leave no fixture rows.                          |
| codex/csf-officer-approval     | Integrated root 6c02af74 and private ccc1ae5a. Refusal tests and forward migration 20261009020000 are included.                                 |
| claude/csf-partner-projects    | Integrated root 4b0379d5 and private 47244ace. Forward migration 20261009030000 and verified race fixes are included.                           |
| claude/platform-rating-prompts | Completed source c89303b6 is integrated, including prompt wiring, refusal tests and migration 20261009040000. Original draft remains preserved. |
| claude/pass4-*                 | All six completed source slices are integrated. Their source worktrees remain preserved until remote Development contains the work.             |

Paper, officer and partner source repairs are integrated from their preserved
worktrees. The integration owner controls PR 867, the private brand PR and all
release steps. Shared root Development and its unrelated dirty files remain
untouched. No feature worktree was removed.

## Local tooling verification and incident

Supabase CLI 2.120.0 replayed all 717 migrations on PostgreSQL 17.11 (`supabase/postgres:17.11.0.004`). The 492-file SQL suite passes 12,865 assertions, followed by advisor, architecture and plugin-isolation checks. The first catalog check returned 0 because its ad hoc runner omitted the repository's local-fixture wrapper. A focused fresh retry proved that the only differences were the seven known fixture helpers; all 1,434 release objects match. The existing wrapper returned 1 and rollback restored the helpers. The failed and corrected receipts are retained separately. Both owned temporary stacks were removed, with the parent integration stack's resource IDs unchanged.

The CLI patch passes 54 focused tests on the integrated Bun 1.3.14 tree. Full lint and type checking pass under Node 24.21.0. The separate Bun 1.4.2 candidate is preserved in the infrastructure worktree; it cannot join this candidate while the private application pins 1.3.14. Package-manager equality remains enforced.

A reviewer intended to use a mock CLI but invoked installed CLI 2.119.0 for shared-local `start` and `db start` at 00:37:31–00:37:33 UTC on October 8. Both returned success. Subsequent read-only inspection found the existing healthy database, volume and network predated those calls, with no observed restart or replacement. There is no pre-command data snapshot, and the Docker event buffer did not retain the incident interval, so no complete data-diff or transient-effect claim is supported. No shared reset, reseed, cleanup or repair followed. These accidental calls are excluded from test evidence. Sanitized incident and verification receipts remain in the infrastructure worktree's ignored `.artifacts/toolchain-upgrade-20261007/` directory.

## Provider gates

The [Development cutover procedure](development-cutover.md) requires a protected
environment, its database credential, verified external-writer shutdown and an
accepted maintenance-hold receipt before the root merge. Do not merge first:
the connected persistent Supabase Development branch applies migrations.

The GitHub Development environment now requires review by `riddhimanrana` and limits deployments to `development` and `codex/*`. The owner may approve their own run. Readback confirms that `DEVELOPMENT_DATABASE_URL` is still missing. No cutover or deployment has run.

Forward 717 export verification also passes 93 SQL assertions across snapshot, job protocol and deletion-crossover suites. The real local worker created, downloaded and digest-verified a private 49-dataset archive with delivery skipped and no refused egress. The synthetic account and archive were removed afterward. This verifies the worker path, not the browser journey.

The root unit rerun passes its 2,946-test general group with one skip, then stops in an isolated test because the unsigned DV source version 2.0.3 exceeds the published adoption range ending at 2.0.2. The database gate stops at the same release boundary. Neither is a complete green gate. The host import surface has been regenerated and its 144-module boundary check passes. Hosted CI at 0f58692d separately failed five access-audit tests because the runner lacks ripgrep. Commit b2e63902 installs ripgrep before all shared quality gates; 17 focused tests pass on the integrated tree. Its first hosted rerun exposed a regex lint issue, repaired in 4067da43. That run now reaches the same unsigned plugin contract failure as local verification. CodeQL passed both language analyses on that head.

GitGuardian incidents 37947219 and 37948874 concern historical synthetic fixture
commits and still need provider disposition. Incident 16430109 flags password-form
declarations in 34a70ca8, 34210edc7 and 56f64463; local inspection confirmed that all password
defaults in those commits are empty strings. No credential was found in those
form defaults. Their provider status is still Triggered. Do not suppress the
scanner or rewrite shared history.

Root CodeQL check 113069683538 identified first-only escaping in a Sheets status
test. Commit bec23b1e uses replaceAll; all five tests pass. Latest candidate CodeQL analyses report zero findings for Actions and JavaScript/TypeScript. Final-head checks remain pending.

The time-limited braces exception still expires October 21 and prints the
advisory. It is an accepted risk, not a patched dependency. New private source
also needs signed release integration before hosted plugin acceptance. Main,
Production, provider credentials and installed plugin selections have not been
changed by this integration.
