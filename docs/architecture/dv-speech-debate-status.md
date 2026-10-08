# DV Speech and Debate status

> Archived reference. Speech and Debate is no longer registered or offered by the app. The implementation and database history remain for reference; the instructions below describe its former operation.

Development is on hold as of October 7, 2026. The private source, migration
history, and existing organization data are retained. The catalog pause removes
the plugin from marketplace offerings and prevents new installation through the
existing active-catalog checks. It does not delete or upgrade organization
installations.

Normal platform fixtures preserve the inactive catalog entry. The explicit DV
fixture command remains available for isolated regression tests of retained
code. It is not a command to reopen the offering in a hosted environment.

The capability report below records earlier work. Its unfinished items are
paused, not an active development plan. Deployment of the catalog pause requires
the normal environment-specific migration workflow.

## Historical capability report

Status date: June 21, 2026

This report is evidence-based. “Implemented” means a migration, service, UI, or executable test exists in the current checkout. It does not imply that every legacy DV screen has been migrated to the new model.

## Production workflow

The hardened workflow is:

`seasonal student membership → staff review → tournament registration → guardian commitment → reviewed judge allocation → attendance/completion → family service credit`

## Capability matrix

| Area                       | Status                          | Current implementation                                                                                                                     | Remaining production work                                                          |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Local database replay      | Implemented                     | `supabase db reset` replays migrations; seed SQL is fixture-only                                                                           | Keep every future schema change in migrations                                      |
| Deterministic fixtures     | Implemented                     | Local admin, staff, students, sibling household, guardians, seasons, memberships, tournament, entry, judge shortage, and prior-season data | Add fixtures when a new invariant is introduced                                    |
| Seasonal membership        | Implemented foundation          | Durable students plus one membership per student and season; explicit lifecycle and requirement records                                    | Complete all correction/upload controls in the student UI                          |
| Households and guardians   | Implemented foundation          | Normalized guardian contacts and many-to-many household links; guardian accounts are optional                                              | Staff merge/split UI and duplicate-resolution workflow                             |
| Family service obligations | Implemented foundation          | Seasonal account and immutable credit ledger                                                                                               | Staff adjustment UI and completion-to-credit automation                            |
| Canonical tournaments      | Implemented foundation          | `public.projects` remains canonical with a unique DV tournament extension                                                                  | Finish registration and entry management screens                                   |
| Judges                     | Implemented foundation          | Separate judge, availability, conflict, qualification, clearance, training, assignment, and completion models                              | Full staff operations UI and attendance workflow                                   |
| Guardian email links       | Implemented                     | Hashed, expiring, single-use availability tokens and public confirmation route                                                             | Add acknowledgement and contact-correction screens                                 |
| Allocation                 | Implemented service layer       | Deterministic eligibility, coverage, AI proposal validation, staff approval, and server revalidation                                       | Staff review UI with candidate reasoning and shortage resolution                   |
| Tabroom                    | Implemented provider boundary   | Fixture-first provider, read-only live opt-in, immutable snapshots, sync runs, hashes, errors, and diffs                                   | Broaden normalization as the unofficial scraper exposes reliable fields            |
| Communications             | Implemented service layer       | Recipient preview, deduplicated queue, delivery rows, platform email adapter, and audit events                                             | Staff composition/preview UI and suppression management                            |
| RLS                        | Implemented for hardened tables | Student self-service, staff transitions, organization isolation, seasonal isolation, immutable audit/ledger behavior                       | Continue policy tests for every new table and storage path                         |
| Unit and database tests    | Implemented                     | Allocation, Tabroom normalization, fixture replay, and role-based RLS tests                                                                | Expand transition and registration integration coverage                            |
| Browser tests              | Implemented initial slice       | Student seasonal workspace and single-use guardian availability journey                                                                    | Add staff approval, partner registration, allocation approval, and outage journeys |
| Stack upgrade              | Implemented compatible stage    | Next.js 16.2.9, React 19.2.7, Supabase 2.108.2, Playwright 1.61, Tailwind 4.3.1, shadcn CLI 4.11                                           | Handle breaking dependency majors separately                                       |

## Known compatibility surface

Legacy DV tables and screens still exist while the hardened services are adopted incrementally. New code must use the typed services and seasonal tables. Do not add new behavior to profile-level paid flags, embedded parent columns, `"judge"` pseudo-entries, or legacy direct table mutations.

The shadcn update was reviewed with CLI dry-run and component diffs. Local components were not blanket-overwritten because they contain application-specific APIs and styling.

## Verification commands

```bash
export DV_LOCAL_TEST_PASSWORD='choose-a-local-only-password'
bun run dv:dev:reset
bun run dv:test:db
bun test ./lib/plugins/private/plugins/dv-speech-debate/services
bun run dv:test:e2e
bun run typecheck
bun run build
```

Live Tabroom access is never part of default development or CI:

```bash
DV_TABROOM_TOURNAMENT_ID=12345 bun run dv:tabroom:smoke
```

## Release gate

A DV release is blocked if migrations do not replay from empty, fixture data is nondeterministic, RLS permits cross-organization access or self-approval, credentials are committed, an AI proposal can persist without staff approval, or external integrations are required for local/CI tests.

## October 2026 membership remediation

The private candidate sends member draft saves and full application submissions
to `plugin_data.save_dv_membership_application`. The host migration
`20261007200000` depends on the account deletion write fence in `20261007040314`.
Both must ship with the private caller change. This service-only function checks
active membership, plugin access, the current season, and editable application
status before identity changes. Account deletion and plugin control-plane locks
serialize competing operations. Identity, household links, membership, audit,
and the hashed retry receipt commit together or roll back together.

A retry with the same actor, request ID, and payload returns the original result.
Changing the payload requires a new request ID. A successful retry does not undo
a later staff decision. Shared guardian contact corrections remain in application
data for staff review; the member write does not overwrite a shared contact.

The member form reopens drafts and applications returned for changes with their
saved values. Other states show their actual decision and keep the form closed.
This does not migrate legacy roster profiles or reconcile real household data.
The unused server action that created account fixtures and exported passwords
has been removed from the private candidate.

Local evidence: 30 pgTAP checks passed on the owned isolated stack, including
refused writes, partial failure rollback, retry identity, control-plane leases,
and pending account deletion. Component and adapter regressions passed locally.
These results do not establish a hosted Development or Production deployment.

The staff review candidate reads canonical, organization-and-season-scoped
membership pages. Full saved answers load only when staff opens one application.
Current-season decisions use `plugin_data.review_dv_membership_application`
from migration `20261007200000`. It keeps the existing staff/admin authority,
checks the observed status and update timestamp, and commits the decision,
requirement verification, audit event, and retry receipt together. New decisions
cannot review drafts or historical seasons through this normal workflow.

Approval requires every existing non-staff-review requirement to be verified or
waived. It records the staff-review requirement as verified. It does not infer
missing requirement policy, change manual payment records, or copy legacy paid
flags. Future requirement writers must lock the membership parent before its
requirement rows, matching the review transaction's lock order. Historical
corrections still require an explicit maintenance workflow.

Local component, retry-identity, tenant read, fresh-authorization, and RPC adapter
tests cover the new boundary. The 28-check pgTAP review suite is committed for
execution once the owned local database recovers from disk pressure. Do not
claim this migration has passed database or browser acceptance until those gates
run on the integrated candidate. The DV browser suite now includes a staff
approval journey that checks the stored decision, staff requirement, audit, and
receipt; that new journey is also awaiting the recovered local stack.
