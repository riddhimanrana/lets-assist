# Development integration status, October 7, 2026

Root [PR 867](https://github.com/riddhimanrana/lets-assist/pull/867) is the
combined brand and infrastructure candidate. Private
[PR 643](https://github.com/riddhimanrana/lets-assist-plugins/pull/643) combines
brand layouts with audited CSF and Speech & Debate workflows. This page tracks
source integration. It does not certify hosted Development or Production.

| Area                                                           | Current result                                                                                                                                             | Required next evidence                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Brand, landing and account layouts                             | Included with audit conflict resolutions in root 182d01d2 and private bde1aef.                                                                             | Final signed-in desktop/mobile walkthrough.                                      |
| Login, scheduler, plugin workflow and Docker diagnostics fixes | Included in root candidate.                                                                                                                                | Required PR checks and final integrated full gate.                               |
| Root static checks                                             | Lint, typecheck and agent policy pass under Node 24.21.0.                                                                                                  | Repeat affected checks after later integration.                                  |
| Private source                                                 | All 554 plugin test files pass. Formatting and 31 release/host-pairing tests pass.                                                                         | Private PR CI, then Development merge before root gitlink update.                |
| Independent CSF app                                            | Lint, typecheck, tests, build and data-access/route gates pass.                                                                                            | Hosted runtime and organization selection readback after release.                |
| Security regressions                                           | CSV control prefixes, notification URL normalization and Sheets status UI tests pass. Signup confirmation no longer claims unconfirmed delivery succeeded. | Final integrated source and browser checks.                                      |
| Dependencies                                                   | Next 16.4.0, React 19.3.0, Node 24.21.0, current Supabase clients and shadcn 4.21.4. Tailwind 4.3.3.                                                       | CLI 2.120.0 and Bun 1.4.2 compatibility work remains. See the dependency ledger. |
| Database                                                       | Existing candidate has 708 migrations. File validation passes.                                                                                             | Final combined replay/catalog and database/browser gates.                        |
| AI review                                                      | Private PR 643 received automatic review on bde1aef. Its DV navigation finding is fixed in ece31d6.                                                        | Root review, review-on-push settings and final-head review remain unverified.    |
| Branch cleanup                                                 | Removed local claude/csf-partner-linking and codex/plugin-release-dvhs-csf-v1.2.85 after proving remote Development ancestry and no active worktree.       | Other feature branches remain until their work reaches remote Development.       |

## Preserved work

| Branch                         | Remaining work                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| codex/paper-attendance         | Repair consumed-source combine and export consistency defects; reconcile unpublished migrations after the combined ledger.            |
| codex/csf-officer-approval     | Add refusal coverage, reconcile unpublished migration order and raise the private schema floor.                                       |
| claude/csf-partner-projects    | Preserve newer archived-activity eligibility, use current conflict semantics and resolve recorded concurrency defects.                |
| claude/platform-rating-prompts | Preserve untracked implementation, resolve migration timestamp collision, fail closed on quota-check errors and wire/test the prompt. |
| claude/pass4-*                 | Active brand follow-up slices. Integrate only after the owner reports ready commits and checks.                                       |

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
commits and still need provider disposition. Their forward source fixes remain
included. Do not suppress the scanner or rewrite shared history.

The time-limited braces exception still expires October 21 and prints the
advisory. It is an accepted risk, not a patched dependency. New private source
also needs signed release integration before hosted plugin acceptance. Main,
Production, provider credentials and installed plugin selections have not been
changed by this integration.
