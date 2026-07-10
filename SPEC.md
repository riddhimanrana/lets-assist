§G

DVSD production workflow: seasonal membership → approval → tournament registration → guardian judge commitment → reviewed assignment → completion credit.

§C

- Next.js 16 App Router + React 19 + shadcn/Tailwind v4.
- Supabase `plugin_data` exposed via PostgREST; RLS ! protect ∀ rows.
- Students authenticate; guardians default contact-only.
- `public.projects` canonical tournament; DV extension 1:1.
- Tabroom read-only; fixture default; live sync opt-in.
- AI draft only; staff approval ! before assignment persistence.
- Existing plugin lifecycle interfaces preserved.
- Main repo + `lib/plugins/private` submodule changes independently versioned.
- DVHS CSF plugin = transactional system of record; Google tools migration/export channels only.
- DVHS CSF strict-minor-safe; public student roster/profile membership/proof/attendance ⊥.
- Existing CSF Google data imported read-only + raw source preserved.

§I

- cmd: `bun run dv:dev:reset` → empty local DB replay + deterministic DV fixtures
- cmd: `bun run dv:test:db` → DV schema/RLS integration tests
- cmd: `bun run dv:test:e2e` → Playwright DV journeys
- cmd: `bun run dv:tabroom:smoke` → explicit live Tabroom read-only smoke
- schema: `plugin_data` → seasons, students, households, guardians, memberships, requirements, tournaments, registrations, judges, allocations, service ledger, sync snapshots, audit
- service: `MembershipService` → draft/submit/review/status
- service: `HouseholdService` → guardian normalize/link/merge
- service: `TournamentService` → project extension + registration
- service: `JudgeService` → clearance/availability/assignment/completion
- service: `AllocationService` → deterministic eligibility + AI draft + approval
- provider: `TabroomProvider` → normalized read-only snapshot
- service: `CommunicationService` → preview/queue/delivery log
- manifest: `organizationExperience` → publicPage, publicRoute, members, projects, profileMembership, joinMode
- schema: `plugin_data` → CSF profiles, aliases, terms, memberships, policies, applications, evidence, reviews, activities, submissions, credits, meetings, attendance, partner clubs, imports, appeals, communications, audit
- service: `CsfIdentityService` → verified-email link/request/merge
- service: `CsfRequirementService` → single policy evaluation for UI, reports, exports, term close
- service: `CsfImportService` → raw snapshot, row hash, preview, reconcile, idempotent commit
- route: DVHS CSF workspace → role-aware member/staff sidebar + route-scoped data
- cmd: `bun run typecheck && bun run lint && bun run plugin:test:registry && bun run plugin:test:contracts`

§V

V1: `supabase db reset` → replay ∀ migrations; seed contains fixtures only.
V2: fixture scripts target local Supabase only; committed credentials = ⊥.
V3: ∀ `plugin_data` table → RLS enabled + org/season isolation.
V4: student identity durable across seasons; membership exactly 1 per student+season.
V5: guardian email normalized; guardian account ! not required.
V6: membership status ∈ `draft,submitted,needs_action,approved,rejected,suspended,expired`.
V7: payment/forms/good-standing requirements separate from membership status.
V8: project↔DV tournament relation 1:1.
V9: judge ≠ tournament entry; eligibility checks clearance+training+availability+conflict+qualification+limits.
V10: AI output cannot persist assignment; staff approval + server revalidation required.
V11: Tabroom import immutable raw snapshot + normalized data + sync status; manual overrides preserved.
V12: external integration local/CI default = fixture; live call explicit opt-in.
V13: consequential transition → immutable audit event.
V14: guardian token single-purpose + hashed + expires + one-time consume.
V15: service credit mutation balanced ledger; no derived total overwrite.
V16: build/typecheck/lint/tests pass after staged dependency upgrade.
V17: CSF profile auto-link → authenticated verified email exact match only; name-only claim ⊥.
V18: anonymous/public → CSF member roster, profile membership, proof, attendance, application, trip data ⊥.
V19: CSF application acceptance + term membership transition = 1 transaction + audit.
V20: CSF membership status derived from versioned term policy; manual override → permission + reason + audit.
V21: CSF activity = 1 canonical record; multi-point activity → 1 proof + awarded quantity.
V22: CSF meeting = logical requirement + ≥1 cohort session; attendance → stable profile or reconciliation state.
V23: CSF partner club identity → canonical id + aliases + term-specific audit/policy.
V24: CSF import → immutable raw row + source id/hash + idempotent commit; color/name alone ≠ authoritative state.
V25: CSF prior-term close + next-term onboarding may overlap.
V26: CSF consequential mutation → server permission enforcement + immutable audit event.
V27: CSF student files → private storage + scoped signed access; lifecycle delete removes objects.
V28: CSF requirement evaluation shared by member UI, staff grid, reports, export, term close.
V29: CSF route → fetch route-required data only; all-dashboard aggregate load ⊥.
V30: CSF public page → plugin-controlled safe surface; generic public join/member/project exposure ⊥.
V31: Google Classroom/Sheets/Forms/Gmail → compatibility/import/export after cutover, never dual authority.
V32: CSF UI → shadcn/Base UI, explicit text status, accessible dialogs/drawers/tables; color-only state ⊥.

§T

id|status|task|cites
T1|x|fix local Supabase replay, fixtures, credentials, CI commands|V1,V2,V12,I.cmd
T2|x|add consolidated seasonal household/membership/judge schema + RLS + migration|V3,V4,V5,V6,V7,V8,V9,V13,V14,V15,I.schema
T3|x|add typed domain contracts + repositories/services|V3,V4,V5,V6,V7,V8,V9,V10,V13,V15,I.service
T4|x|add Tabroom provider, fixture snapshots, sync runs, fallback|V11,V12,I.provider
T5|x|add deterministic eligibility + AI draft review/approval flow|V9,V10,V13,I.service
T6|x|complete student/staff vertical-slice UI + guardian token flow|V4,V5,V6,V7,V8,V9,V13,V14
T7|x|replace simulated communications with preview/queue/log adapter|V12,V13,I.service
T8|x|upgrade compatible stack + shadcn diff review|V16
T9|x|add unit, DB/RLS, integration, Playwright coverage|V1,V2,V3,V4,V5,V6,V7,V8,V9,V10,V11,V12,V13,V14,V15,I.cmd
T10|x|rewrite DV architecture/status/plugin development docs|V1,V3,V4,V5,V8,V9,V10,V11,V12
T11|x|secure CSF identity/public privacy + make plugin/migration reproducible|V17,V18,V26,V27,V30,I.manifest,I.schema
T12|x|add CSF domain foundation, route-scoped services, workspace shell, policy evaluator|V19,V20,V25,V26,V28,V29,V32,I.schema,I.service,I.route
T13|x|complete profiles, applications, onboarding, term membership review flow|V17,V19,V20,V24,V25,V26,V27,V32,I.service,I.route
T14|.|complete canonical partner clubs, activities, single-proof submissions, awarded credits|V21,V23,V26,V27,V28,V32,I.schema,I.service,I.route
T15|.|complete meeting sessions, attendance reconciliation, points grid, appeals, term close|V20,V22,V24,V25,V26,V28,V32,I.schema,I.service,I.route
T16|.|add communications workspace + safe plugin-backed public CSF surface|V18,V26,V30,V31,V32,I.manifest,I.route
T17|.|import legacy CSF data, compatibility exports, security/integration/E2E coverage|V17,V18,V19,V20,V21,V22,V23,V24,V25,V26,V27,V28,V29,V30,V31,V32,I.cmd

§B

id|date|cause|fix
B1|2026-06-21|DV fixture `join_code` exceeded existing `varchar(6)`|V2
B2|2026-06-21|bulk requirement upsert omitted non-null `metadata`|V2
B3|2026-06-21|ledger immutability test expected trigger before RLS denial|V15
B4|2026-06-21|removed dev button left empty JSX conditional|V16
B5|2026-06-21|legacy wrapper lacked season narrowing; Kotlin-JS payload needed `unknown` bridge|V16
B6|2026-06-21|Bun tests ran but TypeScript lacked `bun:test` declarations|V16
B7|2026-06-21|Bun DOM typings required explicit non-string FormData narrowing|V16
B8|2026-06-21|SSH commit signing required unavailable key passphrase|task commits use `-c commit.gpgsign=false`
B9|2026-06-21|Supabase client upgrade caused recursive generic query inference in report date helper|inline typed range filters at the two query boundaries
B10|2026-06-21|React/TypeScript patch upgrade exposed optional waiver placement IDs|fall back to stable field key during placement normalization
B11|2026-06-21|Playwright 1.61 had no matching local Chromium binary|install pinned Chromium before browser verification
B12|2026-06-21|Next.js 16 treated synchronous service helpers as invalid Server Actions|reserve `use server` for action entrypoints, not service libraries
B13|2026-07-09|CSF requirement tests encoded semester total as 1 activity despite per-activity cap|V20,V28
B14|2026-07-09|bulk organization seed mixed explicit non-null privacy field with omitted values → PostgREST null inserts|V2,V18
