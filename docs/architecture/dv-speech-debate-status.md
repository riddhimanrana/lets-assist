# DV Speech & Debate Capability Report

Status date: June 21, 2026

This report is evidence-based. “Implemented” means a migration, service, UI, or executable test exists in the current checkout. It does not imply that every legacy DV screen has been migrated to the new model.

## Production workflow

The hardened workflow is:

`seasonal student membership → staff review → tournament registration → guardian commitment → reviewed judge allocation → attendance/completion → family service credit`

## Capability matrix

| Area | Status | Current implementation | Remaining production work |
| --- | --- | --- | --- |
| Local database replay | Implemented | `supabase db reset` replays migrations; seed SQL is fixture-only | Keep every future schema change in migrations |
| Deterministic fixtures | Implemented | Local admin, staff, students, sibling household, guardians, seasons, memberships, tournament, entry, judge shortage, and prior-season data | Add fixtures when a new invariant is introduced |
| Seasonal membership | Implemented foundation | Durable students plus one membership per student and season; explicit lifecycle and requirement records | Complete all correction/upload controls in the student UI |
| Households and guardians | Implemented foundation | Normalized guardian contacts and many-to-many household links; guardian accounts are optional | Staff merge/split UI and duplicate-resolution workflow |
| Family service obligations | Implemented foundation | Seasonal account and immutable credit ledger | Staff adjustment UI and completion-to-credit automation |
| Canonical tournaments | Implemented foundation | `public.projects` remains canonical with a unique DV tournament extension | Finish registration and entry management screens |
| Judges | Implemented foundation | Separate judge, availability, conflict, qualification, clearance, training, assignment, and completion models | Full staff operations UI and attendance workflow |
| Guardian email links | Implemented | Hashed, expiring, single-use availability tokens and public confirmation route | Add acknowledgement and contact-correction screens |
| Allocation | Implemented service layer | Deterministic eligibility, coverage, AI proposal validation, staff approval, and server revalidation | Staff review UI with candidate reasoning and shortage resolution |
| Tabroom | Implemented provider boundary | Fixture-first provider, read-only live opt-in, immutable snapshots, sync runs, hashes, errors, and diffs | Broaden normalization as the unofficial scraper exposes reliable fields |
| Communications | Implemented service layer | Recipient preview, deduplicated queue, delivery rows, platform email adapter, and audit events | Staff composition/preview UI and suppression management |
| RLS | Implemented for hardened tables | Student self-service, staff transitions, organization isolation, seasonal isolation, immutable audit/ledger behavior | Continue policy tests for every new table and storage path |
| Unit and database tests | Implemented | Allocation, Tabroom normalization, fixture replay, and role-based RLS tests | Expand transition and registration integration coverage |
| Browser tests | Implemented initial slice | Student seasonal workspace and single-use guardian availability journey | Add staff approval, partner registration, allocation approval, and outage journeys |
| Stack upgrade | Implemented compatible stage | Next.js 16.2.9, React 19.2.7, Supabase 2.108.2, Playwright 1.61, Tailwind 4.3.1, shadcn CLI 4.11 | Handle breaking dependency majors separately |

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
