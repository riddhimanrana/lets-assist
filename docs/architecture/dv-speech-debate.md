# DV Speech & Debate System

This is the authoritative domain and architecture specification for the DV Speech & Debate private plugin.

## Domain rules

- Students are authenticated platform users with durable DV student identities.
- Membership is a new application for each season.
- Membership state is separate from payment, forms, agreements, good standing, and staff review requirements.
- Guardians are normalized email contacts. A guardian account is optional.
- Students, guardians, and households are many-to-many to support siblings and shared custody.
- Family service obligations are configured per household and season and recorded as an immutable ledger.
- `public.projects` is the canonical public tournament record. Every DV tournament has exactly one project extension.
- A tournament registration is not a judge assignment. Student entries and judges have separate lifecycles.
- Consequential transitions require staff/admin authority and produce immutable audit events.
- Tabroom is read-only, failure-tolerant, and never the only copy of operational data.
- AI can propose assignments but cannot approve or persist them.

## Membership lifecycle

Allowed states are:

`draft`, `submitted`, `needs_action`, `approved`, `rejected`, `suspended`, `expired`

Students can save drafts and submit. Staff can request corrections and make approval decisions. Historical season records remain immutable except for authorized correction or administrative maintenance.

Requirements are independent records, including receipt, code of conduct, permission form, staff review, and good standing. Approval logic must evaluate requirements rather than duplicating them into profile booleans.

## Data ownership

The `plugin_data` schema is retained in the PostgREST schema list only for the
server-side adapter. `PUBLIC`, `anon`, and `authenticated` have no schema or
object access. DV domain operations reach it through checked server boundaries;
RLS remains defense in depth rather than a browser API.

- Authenticated clients are used for ordinary student and staff workflows.
- Organization membership and role checks constrain every operation.
- Students can access their own seasonal records and linked household obligations.
- Staff and admins can operate only inside their organization.
- Service-role access is limited to fixture tooling, controlled maintenance, public guardian-token consumption, and external job execution.
- Audit and service-ledger rows are append-only.

Core hardened tables are grouped as follows:

- Identity: `dv_sd_students`, `dv_sd_households`, `dv_sd_guardians`, household links.
- Membership: `dv_sd_seasonal_memberships`, `dv_sd_membership_requirements`.
- Service: `dv_sd_family_service_accounts`, `dv_sd_family_service_ledger`.
- Tournaments: `dv_sd_tournaments`, registrations, registration entries.
- Judging: judges, availability, conflicts, allocation drafts, assignments.
- Integrations: guardian action tokens, Tabroom sync runs/snapshots, communication jobs/deliveries.
- Governance: `dv_sd_audit_events`.

## Service boundaries

UI and lifecycle handlers call typed services rather than mutating tables directly:

- `MembershipService`
- `HouseholdService`
- `TournamentService`
- `JudgeService`
- `AllocationService`
- `TabroomProvider`
- `CommunicationService`
- `GuardianTokenService`

Public inputs are validated with Zod. Domain status values and identifiers are explicit; free-form event names and `"judge"` tournament entries are not identifiers.

## Tournament and judging workflow

1. Staff creates a platform project and its DV extension for the current season.
2. An approved member submits a registration and event entry, including partner/team members.
3. Eligibility, permission, payment, deadlines, waitlist, and drop state are evaluated independently.
4. Guardians confirm judging availability through a single-purpose email link.
5. Allocation considers clearance, training, availability, conflicts, event qualification, round limits, service obligation, and coverage ratio.
6. A rules engine or AI provider creates a draft.
7. The server reloads current candidates and revalidates every proposal.
8. Staff reviews warnings and explicitly approves.
9. Assignments track confirmation, attendance, completion, no-show, and substitution.
10. Completion can create a balanced family-service ledger entry.

## Tabroom integration

`@gmitch215/tabroom-api` is isolated behind `TabroomProvider`; it is an unofficial scraper and must not leak into domain or UI code.

Local and CI runs use captured fixtures. Live access requires `DV_TABROOM_LIVE=1` through the explicit smoke-test command. Each import records:

- source tournament identity;
- start/completion timestamps and status;
- normalized events, entries, schools, judges, and pairings when available;
- immutable raw snapshot and content hash;
- errors, retry state, diff summary, and stale warning;
- manual overrides, which imports never silently replace.

If Tabroom is unavailable, staff can continue registration, judging, communication, and attendance operations from local records.

## Communications

Communications are queued, not simulated. The service resolves recipients, renders a preview, applies an idempotency key, creates recipient delivery rows, invokes the platform email adapter, and records delivery/audit state.

Local delivery uses the Supabase mail sink. Production uses the configured Resend transport. Suppressed recipients and provider failures remain visible; retries must not duplicate successful deliveries.

## UI information architecture

Staff workspace:

- Overview
- Membership
- Households & Judges
- Tournaments
- Communications
- Forms
- Attendance
- Settings

Student workspace:

- current membership status and requested corrections;
- missing requirements and deadlines;
- tournament registrations and entries;
- family judging/service obligation.

Every screen must define loading, empty, error, permission-denied, and stale-integration states and use accessible labels and validation feedback.

## Testing and operational invariants

- Empty-database migration replay must pass.
- Fixtures must be deterministic and local-only.
- RLS tests cover anonymous, student, staff, admin, outsider, organization, and season boundaries.
- Unit tests cover transitions, allocation, conflicts, coverage, credits, Tabroom normalization, recipients, and validation.
- Browser tests exercise authenticated student and guardian-link boundaries; remaining end-to-end journeys are expanded as their UI lands.
- No live integration is required in CI.
- No committed credential may unlock a deployed environment.
