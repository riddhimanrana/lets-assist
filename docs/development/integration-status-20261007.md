# Development integration status, October 7, 2026

Root [PR 867](https://github.com/riddhimanrana/lets-assist/pull/867) is the
combined brand and infrastructure candidate. Private
[PR 643](https://github.com/riddhimanrana/lets-assist-plugins/pull/643) combines
brand layouts with audited CSF and Speech & Debate workflows. This page tracks
source integration. It does not certify hosted Development or Production.

| Area                                                           | Current result                                                                                                                                             | Required next evidence                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Brand, landing and account layouts                             | All six brand follow-up slices are integrated. Root project extraction is 1e20ac71; private combined source is 5a76115.                                    | Final signed-in desktop/mobile walkthrough.                                      |
| Login, scheduler, plugin workflow and Docker diagnostics fixes | Included in root candidate.                                                                                                                                | Required PR checks and final integrated full gate.                               |
| Root static checks                                             | Lint, typecheck and agent policy pass under Node 24.21.0.                                                                                                  | Repeat affected checks after later integration.                                  |
| Private source                                                 | All 567 private test files pass after officer/partner integration. Root lint and typecheck pass.                                                           | Private PR CI, then Development merge before root gitlink update.                |
| Independent CSF app                                            | Lint, typecheck, tests, build and data-access/route gates pass.                                                                                            | Hosted runtime and organization selection readback after release.                |
| Security regressions                                           | CSV control prefixes, notification URL normalization and Sheets status UI tests pass. Signup confirmation no longer claims unconfirmed delivery succeeded. | Final integrated source and browser checks.                                      |
| Dependencies                                                   | Next 16.4.0, React 19.3.0, Node 24.21.0, current Supabase clients and shadcn 4.21.4. Tailwind 4.3.3.                                                       | CLI 2.120.0 and Bun 1.4.2 compatibility work remains. See the dependency ledger. |
| Database                                                       | Officer and partner migrations are integrated after ledger 708. Four paper migrations and one rating migration are being reconciled.                       | Final combined replay/catalog and database/browser gates.                        |
| AI review                                                      | Private PR 643 received automatic review on bde1aef and ece31d6. Mobile DV navigation and Node runtime checklist findings are fixed.                       | Root review, review-on-push settings and final-head review remain unverified.    |
| Branch cleanup                                                 | Removed local claude/csf-partner-linking and codex/plugin-release-dvhs-csf-v1.2.85 after proving remote Development ancestry and no active worktree.       | Other feature branches remain until their work reaches remote Development.       |

## Preserved work

| Branch                         | Remaining work                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| codex/paper-attendance         | Source fixes pass 624 SQL assertions, 11 concurrency scenarios and 145 unit tests. Reconciliation with extracted brand components is in progress. |
| codex/csf-officer-approval     | Integrated root 6c02af74 and private ccc1ae5a. Refusal tests and forward migration 20261009020000 are included.                                   |
| claude/csf-partner-projects    | Integrated root 4b0379d5 and private 47244ace. Forward migration 20261009030000 and verified race fixes are included.                             |
| claude/platform-rating-prompts | Original untracked draft is preserved while an owned source pass adds wiring, refusal tests and migration 20261009040000.                         |
| claude/pass4-*                 | All six completed source slices are integrated. Their source worktrees remain preserved until remote Development contains the work.               |

The audit chat owns paper, officer and partner source repairs in their existing
worktrees. The integration owner controls PR 867, the private brand PR and all
release steps. Shared root Development and its unrelated dirty files remain
untouched. No feature worktree was removed.

## Provider gates

The [Development cutover procedure](development-cutover.md) requires a protected
environment, its database credential, verified external-writer shutdown and an
accepted maintenance-hold receipt before the root merge. Do not merge first:
the connected persistent Supabase Development branch applies migrations.

GitGuardian incidents 37947219 and 37948874 concern historical synthetic fixture
commits and still need provider disposition. Incident 16430109 flags password-form
declarations in 34a70ca8 and 34210edc7; local inspection confirmed that all password
defaults in both commits are empty strings. No credential was found in those
form defaults. Their provider status is still Triggered. Do not suppress the
scanner or rewrite shared history.

Root CodeQL check 113069683538 identified first-only escaping in a Sheets status
test. Commit bec23b1e uses replaceAll; all five tests pass. A fresh provider scan
must confirm that finding is closed.

The time-limited braces exception still expires October 21 and prints the
advisory. It is an accepted risk, not a patched dependency. New private source
also needs signed release integration before hosted plugin acceptance. Main,
Production, provider credentials and installed plugin selections have not been
changed by this integration.
