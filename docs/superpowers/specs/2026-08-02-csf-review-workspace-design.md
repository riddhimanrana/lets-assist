# CSF officer review workspace — design

Date: 2026-08-02
Branch: `development`
Status: implemented and merged. See "What implementation changed" and "Not built" below.

## Problem

`plugin_data.csf_review_*` — four tables, five RPCs, and a submission-freeze trigger — was
committed in `f51620aa` and is applied to both the local Supabase stack and the Supabase
`development` branch. None of it is reachable from the application.

Verified state at time of writing:

- Zero TypeScript references to any review table or RPC across the repository.
- The `verification` route is declared in `navigation.ts:20` but appears in neither
  `CsfWorkspaceShell.tsx` (nav registry) nor `plugin.tsx` (tab registry), so
  `canAccessCsfStaffRoute("verification")` returns `true` for an officer and nothing renders.
- No SQL test, no unit test, no Playwright spec.
- `select count(*) from plugin_data.csf_review_periods` returns 0 — never exercised.
- The only UI was an untracked mock at `app/csf-review-prototype/`, deleted once this
  document captured its interaction contract.

What already works and is not being replaced: per-item point review
(`csf_review_point_submission_v2`, called from `actions.ts:3645`) and per-item application
review (`decideCsfApplicationAction`, `csf_assign_application`, checks, dues, private notes,
corrections). The gap is the campaign layer above them — a bounded period, the roster split
into contiguous ranges across officers, a frozen reviewed set, and a queue walker.

## Scope

Phase 1 delivers member point verification (`kind = 'member_points'`). Phase 2 extends the
same machinery to membership applications. Partner-club audit (`kind = 'club_audit'`) already
exists in the enum and is out of scope for both phases.

## Approach

Share what the schema already shares. All four tables are subject-agnostic — they carry
`subject_kind` and `subject_id` and nothing else specific to what is being reviewed. The
period lifecycle, range-split dialog, queue chrome, and notes thread are therefore shared
across kinds. The detail panel — what an officer reads in order to decide — is separate per
kind, because a service-point ledger and an application form with eligibility checks and dues
share no structure.

Rejected alternatives: a generic subject-adapter interface designed before the second case is
known; and building points concretely then refactoring, which would rework a surface that by
then has SQL, unit, and e2e tests pinned to it.

## Architecture

New files under `lib/plugins/private/plugins/dvhs-csf/`:

```
review-actions.ts                        five server actions
services/review-workspace.ts             loadCsfReviewWorkspace()
components/csf-review/
  CsfReviewWorkspace.tsx                 shell; roster vs. queue
  ReviewPeriodBar.tsx                    draft -> open -> closed lifecycle
  ReviewRosterView.tsx                   cohort picker, assignment bands, roster table
  SplitAssignmentsDialog.tsx             contiguous range split
  ReviewQueue.tsx                        cursor, progress, next/prev, keyboard
  ReviewNotesThread.tsx                  notes, shared across kinds
  panels/PointsReviewPanel.tsx           phase 1
  panels/ApplicationReviewPanel.tsx      phase 2
```

`CsfDashboard.tsx` is ~3,400 lines and `actions.ts` ~10,900. Neither grows here beyond
wiring: a `topRoute === "verification"` branch in the former delegating to
`CsfReviewWorkspace`, and nothing in the latter.

Wiring edits: nav item in `CsfWorkspaceShell.tsx`, the dashboard branch, a tab case in
`plugin.tsx`. The existing `verification` entry in `navigation.ts:20` stops being dead.

Data loading follows the established pattern — `CsfDashboard.tsx` is an async server
component that delegates per-route loading to named service loaders such as
`loadCsfCommunicationsWorkspace`. `loadCsfReviewWorkspace()` matches that shape and reads
through `createPluginAdminClient()`, since the review tables grant row privileges to
`service_role` only.

## Server actions

All five follow the `getAuthorizedStaffContext -> zod -> createPluginAdminClient().rpc ->
revalidatePath` shape used by `reviewCsfPointSubmissionAction` at `actions.ts:3600`, and
return `CsfActionResult`.

| Action | RPC | Permission |
| --- | --- | --- |
| `setCsfReviewPeriodAction` | `csf_set_review_period` | `manage_review_periods` |
| `assignCsfReviewRangesAction` | `csf_assign_review_ranges` | `manage_review_periods` |
| `recordCsfReviewDecisionAction` | `csf_record_review_decision` | `verify_submissions` |
| `setCsfReviewSubmissionOverrideAction` | `csf_set_review_submission_override` | `verify_submissions` |
| `addCsfReviewNoteAction` | `csf_add_review_note` | `verify_submissions` |

The permission split is already encoded in `navigation.ts:20`: reviewing officers enter with
`verify_submissions`; only `manage_review_periods` opens or closes a campaign. Inline
per-line ruling reuses `reviewCsfPointSubmissionAction` unchanged, including its existing
guards — the term policy must be published before approval, and an awarded total differing
from the member's claim requires a note.

## Two distinct freezes

These are deliberately not conflated.

**Database freeze.** The existing `csf_point_submissions_verification_freeze` trigger. While
a `member_points` period is open for a term, rows with `source = 'student'` cannot be
inserted, updated, or deleted. Non-student rows pass, because staff correction is the work
the campaign exists to do. `csf_set_review_submission_override` lifts it for one member at a
time, with a required reason.

**Queue freeze.** Client-side. The subject id list is snapshotted when an officer enters the
queue, so recording a decision does not reshuffle the list underneath them. This is a UX
property, not a data guarantee.

## Interaction contract

Carried over from the prototype, which is otherwise deleted.

Roster view: cohort selector; search by name; a filter for subjects still pending a decision;
assignment bands showing each officer's contiguous range; roster table ordered alphabetically
by last name with a 1-based index; per-row entry into review.

Search and filter narrow the *roster view* only. They must not narrow the queue snapshot —
an officer who filters to pending, then enters review from a row, still walks the full scope
described above. Otherwise the range an officer is accountable for would silently change
based on a filter they left set.

Review scope: entering review from an officer's own assigned band walks only that band.
Entering from a single roster row walks the whole cohort, because the officer went looking
for that specific person.

Queue: `ArrowRight` / `ArrowDown` / `j` advance, `ArrowLeft` / `ArrowUp` / `k` retreat, `a`
approves, `r` rejects, `Escape` exits. All suppressed while focus is inside an `INPUT`,
`TEXTAREA`, or `SELECT`. Recording a decision auto-advances to the next subject. Progress
reads "N of M".

Notes: `Cmd`/`Ctrl` + `Enter` posts. The draft clears when the cursor moves to a different
subject, so a half-written note never lands on the wrong person.

Range split: officers are chosen from the chapter roster; the cohort divides alphabetically
into equal, back-to-back ranges. The arithmetic — `base = floor(n / k)`, with the first
`n mod k` reviewers taking one extra — is extracted as a pure function and unit tested
independently of the database. `csf_assign_review_ranges` rewrites the complete set on every
call, which is what keeps ranges non-overlapping; partial hand edits are not a supported
write path.

**Correction to the prototype.** Its reject button took no reason. The database requires one
— `csf_review_decisions_rejection_reason_check` on the table, and `'A rejection needs a
reason.'` raised by the RPC. The real panel must prompt for it, and the action must surface
the constraint violation rather than letting it surface as an opaque error.

## Panels

`PointsReviewPanel.tsx` renders three stacked blocks:

1. Standing header — running awarded total against the term policy requirement, meetings
   attended against required, current decision state.
2. Service lines — every `csf_point_submissions` row for `(profile_id, term_id)`, showing
   `activity_date`, `description`, `point_type`, `claimed_points`, `source`, `status`, and
   the linked `opportunity_id` or `partner_club_term_id`. Lines needing a ruling are
   separated from settled ones. Each carries inline approve/reject.
3. Verdict footer — member-level approve/reject, reason required on reject, plus the
   per-member freeze override.

`ApplicationReviewPanel.tsx` follows the same rhythm with application content: eligibility,
submission, and dues status from `csf_term_applications`; then `csf_application_checks` and
`csf_application_course_entries` with the existing `updateCsfApplicationCheckAction`; then the
same verdict footer. `decideCsfApplicationAction` remains the authority on application
*status* — the review decision is a separate campaign-level verdict, not a replacement.

`ReviewNotesThread.tsx` is shared verbatim. It takes `subject_kind` and `subject_id` only,
and its redaction contract already mirrors `csf_application_private_notes`.

## Phase 2 migration

Two files. Postgres 17.6 permits `ALTER TYPE ... ADD VALUE` inside a transaction but forbids
using the new value in that same transaction, so the extension and its first use cannot share
a migration.

**File A — enum extension only.**

```sql
ALTER TYPE plugin_data.csf_review_period_kind ADD VALUE 'membership_applications';
ALTER TYPE plugin_data.csf_review_subject_kind ADD VALUE 'application';
```

**File B — everything that uses them.**

A defense-in-depth freeze trigger on `csf_term_applications`, keyed on `auth.uid()`. It
returns early when `auth.uid()` is null, which is every current write path — all six
functions that write that table (`csf_assign_application`,
`csf_decide_term_application_policy_base`, `csf_import_application_response_row`,
`csf_merge_profiles`, `csf_sync_application_check_state`, `csf_upsert_profile`) run as
`service_role` through `SECURITY DEFINER` RPCs. It blocks only when the acting user is the
application's own linked applicant, a `membership_applications` period is open, and no
override is set.

This trigger is inert today and is understood to be so. Applicants have no direct write path
to `csf_term_applications`: `csf_submit_application_correction` inserts only into
`csf_application_correction_requests`, `csf_application_status_events`, and
`csf_admin_audit_events`, and `csf_review_application_correction` updates only the correction
request row. Staff apply corrections; applicants propose them. The trigger guards against a
future direct write path being added carelessly, at the cost of one function and one test.
A session-flag approach was rejected because it would have required editing all six writers,
including core profile paths.

Also in File B: a `subject_kind` / `period.kind` consistency check added to
`csf_record_review_decision` and `csf_add_review_note`. Both currently cast
`p_subject_kind::plugin_data.csf_review_subject_kind` with no allowlist, so nothing stops a
`partner_club` decision being filed inside a `member_points` period. The mapping is
`member_points -> profile`, `club_audit -> partner_club`,
`membership_applications -> application`. This is a fix to code phase 2 already extends.

No new tables and no new RPCs. `csf_assign_review_ranges` already accepts `p_cohort_id`, and
`csf_term_applications.cohort_id` exists, so range splitting transfers unchanged.

## Testing

**SQL** — `supabase/tests/database/csf_review_periods.test.sql`, matching the 61 existing
files:

- one period per `(organization_id, term_id, kind)`; a competing open is rejected
- `draft` -> `open` -> `closed`; decisions rejected when the period is not open
- rejection without a reason raises; override without a reason raises
- freeze trigger blocks `source = 'student'` insert, update, and delete while open
- freeze trigger passes non-student rows, and passes when no period is open
- override lifts the freeze for exactly one member and not their neighbour
- `csf_assign_review_ranges` rewrites the complete set, leaving no overlap and no gap

Phase 2 adds `csf_review_application_periods.test.sql`: proof the new trigger is inert under
`service_role`, that it blocks an applicant-authenticated write, and the subject-kind
consistency check.

**Unit** (`bun test --preload ./scripts/local-dev/server-only-test-preload.ts lib/plugins`):

- `review-actions` permission gating, extending the `plugin-action-security-boundaries.test.ts`
  pattern, which already asserts against action source text
- `navigation.test.ts` gains `verification` coverage, which it currently lacks
- range-split arithmetic as a pure function, no database

**E2E** — `tests/csf/verification.spec.ts` under `playwright.csf.config.ts`: an admin opens a
period; an officer sees only their assigned range; walks the queue; records a decision; is
required to give a reason on reject; and finds a closed period read-only.

## What implementation changed

Recorded after the build, so the document matches what shipped.

**Both campaigns share one route.** Phase 2 did not get its own nav entry. The period bar,
roster, range split, queue, and notes are identical for points and applications, so a second
nav entry would have duplicated all of it to vary one panel. `verification` now carries a
kind switch backed by `?csf_review_kind=`.

**A roster entry has both a subject and a person.** `subjectId` is the application in an
application campaign and the profile in a point one; `profileId` stays the person either way
so names and notes read the same. Decisions, notes, and the override all key off `subjectId`.

**Two defects surfaced that the design had not anticipated:**

- `csf_set_review_submission_override` hardcoded `kind = 'member_points'` and
  `subject_kind = 'profile'`. The override row the new application freeze looks for could
  never have been written. It now derives the subject from the period, like everything else.
- `csf_add_review_note` never loaded the period at all, so it could not have checked anything
  about it. It does now, which is what let the subject-kind rule apply to notes as well as
  decisions.

**The freeze trigger was kept** as defense in depth rather than dropped. Applicants still have
no direct write path to `csf_term_applications`, so it is inert against every caller that
exists; the test proves both that inertness and that it bites an applicant session when one
appears. It only treats a `verified`, non-revoked account link as ownership, so a pending or
rejected profile claim cannot freeze anyone.

## Not built

**The Playwright spec.** `tests/csf/verification.spec.ts` was scoped in the testing section
above and was not written. Coverage today is 58 SQL assertions across two files, plus unit
tests for range arithmetic, action authorization, and route wiring — but nothing drives the
workspace through a browser. That is the largest remaining gap.

## Constraints on execution

- Work happens in a separate git worktree, not the `development` checkout. A second agent
  session works in parallel in its own worktree.
- Migrations are tested against a local Supabase via the CLI in Docker (`supabase start`,
  `supabase db reset`), never against the Supabase `development` branch. Promotion happens
  only after local green.
- Merge back into `development` and say so explicitly, so the two branches can be
  coordinated.
