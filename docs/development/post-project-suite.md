# Post-project suite: paper signups, feedback, follow-up email

Three features that run after a project completes. Each is independently
shippable and independently revertable; the feedback email depends on the
feedback table, everything else stands alone.

## Paper signup sheet scanning

Organizers photograph paper sign-in sheets; AI transcribes them into a
staging table; the organizer reviews and edits every row against the source
photo; confirmed rows become real `project_signups` with `status='attended'`
and `source='paper_scan'`, and flow into the normal hours/certificates
pipeline. Human review is mandatory — AI output never commits directly.

- Route: `/projects/[id]/paper-signups` (entry points on the creator
  dashboard, hours page, and signups page).
- Extraction: `app/api/ai/scan-signup-sheet` — tiered
  `google/gemini-3.5-flash-lite` → `google/gemini-3.6-flash` per-image
  escalation with per-field confidence. The route reads photos server-side
  from Storage; it never accepts image bytes.
- Commit: `public.commit_paper_signup_batch` (service-role RPC). Takes the
  same per-slot advisory lock as `insert_project_signup_with_waiver`,
  clamps times to the slot window, reuses/creates `anonymous_signups` by
  `(lower(email), project_id)`, and replays idempotently by commit key.
  Capacity can only be exceeded with an explicit organizer opt-in.
- Waiver invariant: the commit refuses an unpublished project outright, and
  on a waiver-required project it fails any row that would create a _new_
  signup with `detail = 'waiver_required'`. A scanned sheet is not evidence
  of digital waiver consent and the commit will not fabricate one. Marking an
  already-signed signup attended and recording a roster-only headcount stay
  available. The paper-waiver evidence path is deferred; see CLEAN-021 in
  [the cleanup register](cleanup-register.md) and
  `supabase/tests/database/waiver_paper_signup_boundary.test.sql`.
- Committing onto a session whose hours are already published issues
  certificates immediately via `issueCertificatesForSignups`
  (`app/projects/[id]/hours/certificate-issuance.ts`), pre-filtered against
  existing `certificates.signup_id` because that column has no unique
  constraint.
- Storage: private bucket `paper-signup-scans` (8 MiB, jpeg/png/webp), path
  `paper_signups/{projectId}/{batchDir}/{seq}_{slug}.{ext}`, policies keyed
  on `app_private.can_manage_project`.
- Retention: committed batches purge 7 days after commit; drafts/failures at
  30 days. `purge_expired_paper_scan_batches` enqueues photos into
  `paper_scan_storage_deletion_queue` (transactional outbox) and the
  `paper-scan-cleanup` cron (GitHub Actions, daily) drains it — the
  waiver-cleanup pattern.

## Private volunteer feedback

Attendees of a completed project leave a 1–5 star rating plus an optional
comment. Fully private: visible to the author, the project creator, org
admins, staff on staff-managed projects, and platform admins — never public.

- Table `public.project_feedback`, one rating per attendee per project.
  RLS enforces attended-only INSERT inside the completed window; there is no
  DELETE policy (admins act through the service role). An invoker-rights
  guard trigger pins identity columns; client comment edits re-enter
  moderation review, and only privileged writers settle verdicts.
- Comments run through `moderateText` after insert (fail-open); blocked text
  is suppressed from the organizer view.
- Volunteer UI: a card on the project page once completed
  (`components/projects/ProjectFeedbackForm.tsx`). Organizer UI:
  `/projects/[id]/feedback` with distribution and response rate.

## Follow-up email

One "How did volunteering at X go?" email per attendee per completed
project, sent through a service-only dispatch ledger
(`public.project_feedback_requests`) with partial-unique enqueue,
`FOR UPDATE SKIP LOCKED` leasing, worker-owned settlement, and a reaper
that settles expired leases as `unknown_outcome` — never re-sent, matching
the email layer's invariant.

- Timing (`lib/projects/feedback-eligibility.ts`): finish instant + 24h,
  held until hours publish (96h backstop), and a hard 30-day backfill guard
  so first-enable cannot mail historic projects.
- Worker: `services/project-feedback-worker.ts`. It re-checks consent with
  the admin client immediately before each send — `sendEmail`'s own
  preference gate is cookie-bound and silently inert from cron.
- Route: `app/api/cron/project-feedback-followups` (hardened bearer
  grammar + `cronAuthShapeProbe`), scheduled by
  `.github/workflows/project-feedback-followups.yml` at `17 * * * *`.
- Links carry an HMAC token (`services/project-feedback-token.ts`, 30-day
  TTL) that authorizes exactly one request row — deliberately not
  `anonymous_signups.token`. Landing page `/feedback/[requestId]` works
  logged out; `?rating=N` only pre-selects. Unsubscribe (GET + RFC 8058
  one-click POST) sets `anonymous_signups.email_opt_out_at` for anonymous
  recipients or `notification_settings.project_updates=false` for accounts.

## Environment

| Variable                                        | Purpose                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_FEEDBACK_WORKER_ENABLED`               | Exact-`"true"` opt-in for the follow-up worker. Deploy unset first; verify the enqueue backfill guard against production data before enabling. |
| `PROJECT_FEEDBACK_WORKER_SECRET_TOKEN`          | Dedicated cron bearer token (falls back to `CRON_TOKEN`/`CRON_SECRET`).                                                                        |
| `PROJECT_FEEDBACK_WORKER_BATCH_SIZE`            | Optional, default 25, max 50.                                                                                                                  |
| `PROJECT_FEEDBACK_TOKEN_SECRET`                 | HMAC secret for feedback links (falls back to `ENCRYPTION_KEY`, min 32 chars).                                                                 |
| `PAPER_SIGNUP_NOTIFICATION_WORKER_ENABLED`      | Exact-`"true"` opt-in for durable paper-attendance notifications. Keep unset until Development Resend acceptance.                              |
| `PAPER_SIGNUP_NOTIFICATION_WORKER_SECRET_TOKEN` | Dedicated cron bearer token (falls back to `CRON_TOKEN`/`CRON_SECRET`).                                                                        |
| `RESEND_DEV_FROM_DOMAIN`                        | Required sender-domain fence whenever a Preview explicitly uses Resend.                                                                        |
| `RESEND_DEV_RECIPIENT_ALLOWLIST`                | Comma-separated synthetic/authorized Development recipients; Resend test addresses remain allowed.                                             |

GitHub Actions secrets follow the shared cron template; optional dedicated
heartbeats: `BETTERSTACK_PAPER_SCAN_CLEANUP_HEARTBEAT_URL`,
`BETTERSTACK_PROJECT_FEEDBACK_HEARTBEAT_URL`.

The DVHS CSF isolated harness forces both post-project email workers off via
`DISABLED_WORKER_ENV_KEYS`.
