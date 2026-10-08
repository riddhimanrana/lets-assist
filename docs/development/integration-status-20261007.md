# Development integration status, October 7, 2026

Root [PR 867](https://github.com/riddhimanrana/lets-assist/pull/867) is the
combined brand and infrastructure candidate. Private
[PR 643](https://github.com/riddhimanrana/lets-assist-plugins/pull/643) combines
brand layouts with audited CSF and Speech & Debate workflows. This page tracks
source integration. It does not certify hosted Development or Production.

| Area                                                           | Current result                                                                                                                                                                                       | Required next evidence                                                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Brand, landing and account layouts                             | All six brand follow-up slices are integrated. Root project extraction is 1e20ac71; private Development merge is 6012a1b7.                                                                           | Signed-in browser gate waits for the signed plugin registry integration.                                            |
| Login, scheduler, plugin workflow and Docker diagnostics fixes | Included in root candidate.                                                                                                                                                                          | Required PR checks and completion of the registry, build and browser gates.                                         |
| Root static checks                                             | Lint, typecheck and agent policy pass under Node 24.21.0.                                                                                                                                            | Repeat affected checks after later integration.                                                                     |
| Private source                                                 | All 569 private test files pass. PR 643 merged into private Development as 6012a1b7 with required CI checks passing.                                                                                 | Signed release integration and hosted acceptance. Root gitlink is 6012a1b7.                                         |
| Independent CSF app                                            | Lint, typecheck, tests, build and data-access/route gates pass.                                                                                                                                      | Hosted runtime and organization selection readback after release.                                                   |
| Security regressions                                           | CSV control prefixes, notification URL normalization and Sheets status UI tests pass. Signup confirmation no longer claims unconfirmed delivery succeeded.                                           | Final integrated source and browser checks.                                                                         |
| Dependencies                                                   | Next 16.4.0, React 19.3.0, Node 24.21.0, current Supabase clients and shadcn 4.21.4. Tailwind 4.3.3.                                                                                                 | CLI 2.120.0 and Bun 1.4.2 compatibility work remains. See the dependency ledger.                                    |
| Database                                                       | Clean ledger 716 passes all 491 SQL files and 12,845 assertions. Forward 717 adds 35 passing export assertions and 79 catalog/cutover checks; its measured catalog changes only the export function. | Combined gate stopped at the unsigned plugin version mismatch before runtime/browser checks.                        |
| AI review                                                      | Private PR 643 received automatic review on creation and updates. All five review findings are fixed and resolved.                                                                                   | Root review completed on d6abe1d. Its two export findings are fixed in 2d3236b5; final-head review remains pending. |
| Branch cleanup                                                 | Removed local claude/csf-partner-linking and codex/plugin-release-dvhs-csf-v1.2.85 after proving remote Development ancestry and no active worktree.                                                 | Other feature branches remain until their work reaches remote Development.                                          |

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

## Provider gates

The [Development cutover procedure](development-cutover.md) requires a protected
environment, its database credential, verified external-writer shutdown and an
accepted maintenance-hold receipt before the root merge. Do not merge first:
the connected persistent Supabase Development branch applies migrations.

The GitHub Development environment now requires review by `riddhimanrana` and limits deployments to `development` and `codex/*`. The owner may approve their own run. Readback confirms that `DEVELOPMENT_DATABASE_URL` is still missing. No cutover or deployment has run.

Forward 717 export verification also passes 93 SQL assertions across snapshot, job protocol and deletion-crossover suites. The real local worker created, downloaded and digest-verified a private 49-dataset archive with delivery skipped and no refused egress. The synthetic account and archive were removed afterward. This verifies the worker path, not the browser journey.

The root unit rerun passes its 2,946-test general group with one skip, then stops in an isolated test because the unsigned DV source version 2.0.3 exceeds the published adoption range ending at 2.0.2. The database gate stops at the same release boundary. Neither is a complete green gate. The host import surface has been regenerated and its 144-module boundary check passes. Hosted CI at 0f58692d separately failed five access-audit tests because the runner lacks ripgrep. The infrastructure tooling update owns that prerequisite repair. CodeQL passed both language analyses on that head.

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
