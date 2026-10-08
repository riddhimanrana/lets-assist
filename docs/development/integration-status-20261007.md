# Development integration status, October 8, 2026

Root [PR 867](https://github.com/riddhimanrana/lets-assist/pull/867) combines the
brand redesign, infrastructure audit, paper attendance, officer approval,
partner projects and rating prompts. It targets Development. Root main and
Production have not changed.

| Area                        | Current result                                                                                                                                                                                                                                                                                                                        | Remaining evidence                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source consolidation        | All 96 local root branch heads are ancestors of the integrated candidate. Claude confirmed that every finished redesign change is included.                                                                                                                                                                                           | Merge PR 867 after the Development maintenance gate.                                                                                                                                      |
| Private source and releases | Private PRs 645 and 646 merged the final CSF interface corrections into private Development and main. Approved tag `dvhs-csf/v1.2.87` points to `2c55aba805d50a981d1bc50c0755dcde5c7830ca`; the signing workflow published the release. Root still pins the signed 1.2.86 / 2.0.3 pair at `d100831bd2fe3374715de20510d9ae2a77dcfba8`. | Integrate the verified 1.2.87 signature, then hosted acceptance. Organization installs remain unchanged.                                                                                  |
| Speech and Debate           | Migration 718 hides the offering and clears forced upgrades. Standard seeds keep it hidden. Code, releases and data remain preserved. Explicit local fixtures opt in for retained regression coverage.                                                                                                                                | Apply the reviewed ledger through the Development cutover.                                                                                                                                |
| Members layout              | Keep the current redesign, with Members under Classes. The user chose to archive the older top-level Members alternative.                                                                                                                                                                                                             | No alternative-layout integration is planned.                                                                                                                                             |
| Toolchain                   | Bun 1.4.2 pins agree across root, SDK, private app and CI. Node 24.21.0, Next 16.4.0 and Supabase CLI 2.120.0 are integrated.                                                                                                                                                                                                         | The braces exception remains time-limited through October 21.                                                                                                                             |
| Local checks                | Final Claude root changes pass lint, typecheck and focused render tests. The private suite passed 570 files; the later public-heading review correction passed its focused test and private CI. Attended/cancelled sign-ups render without unusable Reject controls.                                                                  | Full checks on the final signed candidate.                                                                                                                                                |
| GitHub quality              | [Run 37714711844](https://github.com/riddhimanrana/lets-assist/actions/runs/37714711844) passed full quality, production build and 495 SQL files with 12,886 assertions at `f3b585ab`.                                                                                                                                                | The concurrency harness then failed on outdated lock assumptions. Commit `8ed761fb` fixes them and passed a fresh local replay. Final integrated rerun and browser gates remain required. |
| Database ledger             | A fresh 720-migration replay preserves attendance correction history after account deletion. All nine retention assertions pass; restoring the old cascade causes three failures. The measured catalog changes only `private.project_attendance_changes`.                                                                             | The accepted catalog passes and rejects the old cascade. Final signed release ledger and full integrated acceptance remain.                                                               |
| Development                 | Readback remains at ledger 687. CSF worker controls are off, but three database cron jobs remain active.                                                                                                                                                                                                                              | Owner database credential, external writer hold, protected bootstrap and prepared maintenance receipt before merge.                                                                       |
| Cleanup                     | Local patches, untracked configuration, private Git history and local evidence are archived before retirement.                                                                                                                                                                                                                        | Delete feature branches only after proving ancestry to remote Development.                                                                                                                |

## Publication and controller evidence

Signed release runs 37712612944 and 37712613235 published both embedded releases
from the approved private source. The paired root workflow verified both
signatures and pushed `a982101c`. Its immediate pull-request readback was stale;
fresh GitHub and Git readbacks proved the pushed commit. The controller now
retries only that bounded stale-head state and rejects a competing head. It does
not repeat the push. Fifteen workflow tests pass.

The publication controller also preserves availability-only pgTAP queries.
Those checks do not select serving versions and must not be treated as malformed
release assertions. Forty-seven single/batch integration tests pass.

Migration 719 records both signed releases without reactivating Speech and
Debate or advancing organization installs. Its accepted ledger digest is
`17fbc32edbdd067c47a56399c17df4365dd264e47445234036bd0648b718eada`.
The independent CSF application remains at its existing release.

The protected Development bootstrap now pauses only its three reviewed cron
jobs before installing the request guard. Sixty-one controller tests pass. A
fresh 687 baseline SQL replay proved unknown-job refusal without partial
shutdown, successful shutdown and an idempotent retry. Failed setup receipts and
the corrected replay remain separate. The owned stack was removed and the
parent stack's resource identities stayed unchanged.

## Preserved work and cleanup

The local archive under the primary checkout's ignored
`.artifacts/consolidation-20261008/` contains working patches and configuration
from 44 root/private repository views, a bare private-history repository,
archive manifests and local evidence. It includes the older Members navigation
alternative that the user chose not to integrate. Never commit or upload this
archive because its local environment files can contain credentials.

Claude's final root commits `bc8f87ca`, `26811493` and `f9e9099c` are merged.
Private commit `022cb85` is included in the approved 1.2.87 source. The local
skip-worktree registry override was excluded.

Claude's pass-four dirty copies were compared with the integrated private
source. They are identical or superseded. No finished redesign work is missing.
The current integration checkout remains active until delivery. Preserve the
shared local database, Claude's `brandwalk2` stack and the parent integration
stack during cleanup.

## Historical local evidence and incident

The earlier 717 replay passed 492 SQL files and 12,865 assertions, advisors,
architecture and plugin isolation. Its first ad hoc catalog check omitted the
local-fixture wrapper. A fresh corrected check matched all 1,434 release objects
and proved fixture rollback. Both failed and corrected receipts remain local.

The first 718 pause replay found that the SQL seed reactivated Speech and Debate.
The seed correction passed a fresh five-assertion replay. The later 719 replay
passed all 21 publication/pause assertions. Each owned stack was removed after
verification, with the parent stack's resource identities unchanged.

A reviewer intended to use a mock CLI but invoked installed CLI 2.119.0 for
shared-local `start` and `db start` at 00:37:31 to 00:37:33 UTC on October 8.
Readback found that the healthy database, volume and network predated those
calls, with no observed restart or replacement. No pre-command data snapshot or
retained Docker event history establishes a complete impact comparison. No
shared reset, reseed, cleanup or repair followed. These calls are excluded from
test evidence. Their receipts are preserved in the local archive.

## Provider gates

The [Development cutover procedure](development-cutover.md) requires its owner
database credential, an operator hold on external writes and a protected
maintenance receipt before merging. The persistent Supabase Development branch
automatically applies migrations after the merge. Several pending migrations
contract permissions, so application/database ordering matters.

The GitHub Development environment requires owner review and permits only
`development` and `codex/*` deployments. The owner may review their own run.
`DEVELOPMENT_DATABASE_URL` is absent. The personal token in the local credential
vault returned HTTP 401 when reading the Development branch configuration.
No password was reset and no hosted cutover mutation has run.

GitGuardian still marks incidents 37947219, 37948874 and 16430109 as Triggered.
Local historical inspection found synthetic test values in the first two and
empty password-form defaults in the third. The provider still needs to record
the disposition. Do not suppress scanning or rewrite shared history.

CodeQL reports no findings on the integrated source. A canceled Vercel Preview
is not hosted acceptance. Private release publication, local green checks and
GitHub quality checks do not prove a Development deployment or a Production
release.
