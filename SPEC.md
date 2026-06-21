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

§T

id|status|task|cites
T1|x|fix local Supabase replay, fixtures, credentials, CI commands|V1,V2,V12,I.cmd
T2|~|add consolidated seasonal household/membership/judge schema + RLS + migration|V3,V4,V5,V6,V7,V8,V9,V13,V14,V15,I.schema
T3|.|add typed domain contracts + repositories/services|V3,V4,V5,V6,V7,V8,V9,V10,V13,V15,I.service
T4|.|add Tabroom provider, fixture snapshots, sync runs, fallback|V11,V12,I.provider
T5|.|add deterministic eligibility + AI draft review/approval flow|V9,V10,V13,I.service
T6|.|complete student/staff vertical-slice UI + guardian token flow|V4,V5,V6,V7,V8,V9,V13,V14
T7|.|replace simulated communications with preview/queue/log adapter|V12,V13,I.service
T8|.|upgrade compatible stack + shadcn diff review|V16
T9|.|add unit, DB/RLS, integration, Playwright coverage|V1,V2,V3,V4,V5,V6,V7,V8,V9,V10,V11,V12,V13,V14,V15,I.cmd
T10|.|rewrite DV architecture/status/plugin development docs|V1,V3,V4,V5,V8,V9,V10,V11,V12

§B

id|date|cause|fix
B1|2026-06-21|DV fixture `join_code` exceeded existing `varchar(6)`|V2
B2|2026-06-21|bulk requirement upsert omitted non-null `metadata`|V2
