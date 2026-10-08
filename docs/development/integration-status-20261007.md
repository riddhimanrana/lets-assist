# Development integration status, October 8, 2026

Root [PR 867](https://github.com/riddhimanrana/lets-assist/pull/867) combines the
brand redesign, infrastructure audit, paper attendance, officer approval,
partner projects and rating prompts. It targets Development. Root main and
Production have not changed.

| Area                        | Current result                                                                                                                                                                                                                                                                                                                                         | Remaining evidence                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source consolidation        | All 96 local root branch heads are ancestors of the integrated candidate. Claude confirmed that every finished redesign change is included.                                                                                                                                                                                                            | Merge PR 867 after the Development maintenance gate.                                                                                                          |
| Private source and releases | Signed CSF 1.2.87 is integrated. The archival change leaves its signed input tree unchanged. Historical Speech and Debate 2.0.3 remains in release history, outside the serving registry.                                                                                                                                                              | Merge the private archival PR, then update the exact root gitlink.                                                                                            |
| Speech and Debate           | Archived reference code. Removed from runtime registration, offerings and normal CI fixtures/browser gates. Source, historical releases and data remain.                                                                                                                                                                                               | Verify and merge the paired archival changes.                                                                                                                 |
| Members layout              | Keep the current redesign, with Members under Classes. The user chose to archive the older top-level Members alternative.                                                                                                                                                                                                                              | No alternative-layout integration is planned.                                                                                                                 |
| Toolchain                   | Bun 1.4.2 pins agree across root, SDK, private app and CI. Node 24.21.0, Next 16.4.0 and Supabase CLI 2.120.0 are integrated.                                                                                                                                                                                                                          | The braces exception remains time-limited through October 21.                                                                                                 |
| Local checks                | Lint, typecheck, formatting, strict gitlink and registry checks pass after signed 1.2.87 integration. All 570 private test files passed before its last public-heading review correction; the correction passed focused tests and private CI.                                                                                                          | Full integrated GitHub and browser acceptance.                                                                                                                |
| GitHub quality              | [Run 37717567936](https://github.com/riddhimanrana/lets-assist/actions/runs/37717567936) passed full quality, production build, 622 root and 602 plugin test files, and 497 SQL files with 12,903 assertions at `3ed4ff5e`.                                                                                                                            | Platform seeding then tried to grant access to inactive DV. The seed now grants access only to active catalog entries. The archival candidate needs final CI. |
| Database ledger             | Fresh CLI 2.120.0/PostgreSQL 17.11 replay applied all 721 migrations. Three release suites passed 24 assertions, attendance retention passed nine, and all 1,434 catalog objects match. Catalog checks reject the old cascade, a mismatched signed identity and a reactivated Speech and Debate offering. Published release metadata rejects mutation. | Full integrated database and browser acceptance.                                                                                                              |
| Development                 | Readback remains at ledger 687. CSF worker controls are off, but three database cron jobs remain active.                                                                                                                                                                                                                                               | Owner database credential, external writer hold, protected bootstrap and prepared maintenance receipt before merge.                                           |
| Cleanup                     | Local patches, untracked configuration, private Git history and local evidence are archived before retirement.                                                                                                                                                                                                                                         | Delete feature branches only after proving ancestry to remote Development.                                                                                    |

Calendar cleanup controls now disable removal while disconnected and explain
how to reconnect. Connected and disconnected render regressions pass. The full
CI run at `1bfc8190` was canceled to include this final review correction in the
integrated candidate. It provides no final acceptance claim.

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

The CSF 1.2.87 signing job in run 37716704739 published and verified the
immutable release. Automatic integration stopped because the default root base
lacks its required host migration. Manual run 37716877020 verified the signature,
reconstructed the source and passed generated integration checks on the reviewed
candidate. It pushed `262ca1b5`, then stopped because the separate PR-creation
token is absent. That verified commit was incorporated into PR 867. No extra PR
or publication was needed.

Ledger 721 adds CSF 1.2.87 after the attendance-retention fix. Its measured
structural catalog is identical to ledger 720. The new acceptance binds the
current signed CSF and retained DV identities. Fresh SQL checks proved exact
acceptance, drift refusal and rollback. The first metadata-drift attempt was
refused by the existing immutability trigger; the corrected verification records
that refusal and separately checks a mismatched expected digest. Both receipts
remain local, and the owned stacks were removed without changing the parent.

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

## Speech and Debate archival

The owner clarified that Speech and Debate is reference code, not a hidden offering. The integration removes its runtime registration, current release selection and catalog controls. Normal CI seeds and tests CSF only. The private source path, signed release history and existing database records remain intact. Restoring the product requires a reviewed code integration, not a visibility toggle.
