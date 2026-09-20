# Post-project suite: paper signups, feedback, follow-up email

Attendance, hours, private feedback, and follow-up email share project access
controls. Attendance entry and printing also work before a project completes.

## Paper attendance and hours

Project Signups and Hours pages link to printing, scanning, and manual entry.
The existing `/projects/[id]/paper-signups` route remains the review workspace.
`?mode=manual` starts a draft without AI; `?batch=<id>` resumes saved work.

- `/projects/[id]/attendance-sheet` prints selected sessions in US Letter or A4.
  It includes names, blank contact and attendance fields, two visit pairs,
  continuation rows, and ten adjustable walk-in rows. Browser printing supports
  Save as PDF. Opaque sheet and row references map to a private roster manifest;
  they grant no access and are checked against the current project and session.
  Scanning resolves printed references in batches and reads all candidate pages.
  Projects above the supported candidate limit fail explicitly rather than
  silently losing roster matches.
- Scanning stages the original extraction and source-photo reference. It proposes
  roster matches and visit times, but coordinators must confirm identity and
  attendance. Missing times, ambiguous clock times, overlaps, and reversed dates
  remain unresolved. Actual times outside the session require a reason. Times
  are never replaced with scheduled times or clamped to the session.
- Reviewers can add missed rows, combine related rows explicitly, correct
  transcription, and save valid rows while keeping unresolved rows editable.
  Draft revisions reject stale edits. Request IDs make retries safe.
  Each review batch supports up to 300 rows, including manually added rows.
- Coordinator-entered guests use project-scoped anonymous identities even when
  online signup requires an account. A known roster match does not require
  changing its email. A person without a match or email remains an uncredited
  roster entry, which can be resolved later.
- Waiver requirements still apply. A scanned signature does not fabricate
  digital consent. New signups requiring a waiver are refused until the normal
  waiver process completes. Capacity overrides require explicit coordinator
  selection. See CLEAN-021 in [the cleanup register](cleanup-register.md).
- `project_attendance_intervals` stores reviewed visits. Signup check-in/out
  fields remain compatibility summaries. Credit sums non-overlapping visits,
  rounds the final duration to whole minutes, and retains the 24-hour limit.
  Conflicting intervals across a participant's project sessions are rejected.
  Actual visits cannot end in the future. Coordinators can save completed visits
  during an ongoing session, but publication waits until the session ends.
- Publication uses the existing transaction and durable email ledger. Attendance
  saved, hours published, and email delivery are separate states. Late attendance
  in an already published session can receive its certificate without a second
  award. Guest certificate access and later account linking remain supported.
- Corrections require a reason and expected attendance revision. They save prior
  values, update the existing certificate, and preserve its URL. Corrections do
  not automatically send email. New or corrected certificates have authoritative
  `credited_minutes`; historical certificates retain their previous calculation.
  Historical certificates with no type remain platform awards. Corrections update
  the same certificate, and corrected totals remain in CSV and JSON exports.
- Private scan photos expire after the existing retention window. Structured
  review rows and provenance remain available so unresolved people are not lost
  when their source photos expire. Photos are deleted through the cleanup outbox.

### Exports

Project Hours pages provide CSV and versioned JSON downloads. Active organization
admins can export all organization-owned projects from the Projects area, including
nonmember volunteers and guests. The existing member-summary report stays separate.

Exports default to published awards. The explicit unpublished option includes
recorded attendance and unresolved roster/review entries with distinct publication
states. Project/session filters and inclusive service-date filters use each
project's timezone. JSON includes scope, filters, generation time, participant
identifiers, visits, credited minutes, certificate ID, and revision. CSV uses one
row per participant/session and serializes visits, with spreadsheet-formula escaping.

Downloads use bounded server-side pagination and current authorization checks.
They return private, non-cacheable responses and exclude guest tokens and scan
photos. Oversized exports fail explicitly instead of returning a partial report.

### Acceptance

`tests/e2e/attendance/paper-attendance.spec.ts` exercises printing, mobile manual
review, partial completion, publication, matching CSV/JSON totals, correction,
guest certificate access, and later account linking with one award. It uses
unique fictional data and removes its fixtures. The CSF release browser suite
imports this platform journey through `platform-attendance.spec.ts`.

For a focused run against an already-owned isolated application, set
`CSF_ISOLATED_WORK_DIR`, its `CSF_ISOLATED_APP_PORT`, and
`ATTENDANCE_EXISTING_SERVER=1`, then run
`bunx playwright test --config=playwright.attendance.config.ts`. The configuration
validates the isolated stack marker. It disables traces, video, and automatic
failure screenshots so authentication details are not retained. Successful
screenshots contain only fictional attendance.

The hosted Development workflow runs the same guest journey after verifying the
exact Development SHA, alias, and database preview. Its separate
`playwright.attendance-hosted.config.ts` refuses Production and any application
origin other than `https://dev.lets-assist.com`. It requires a matching
Development project reference and confirmation. The service key stays in the
fixture process; browser sessions use the publishable key and scoped cookies.
The hosted journey verifies logged-out certificate access before linking through
an authenticated fictional account. It does not test the hosted CAPTCHA flow.

Hosted reporting emits fixed outcomes without traces, screenshots, error
payloads, or guest tokens. Cleanup deletes the synthetic certificates before the
project, verifies that project-scoped rows are gone, and removes both fictional
accounts. The attendance journey and the existing CSF acceptance must both pass
before the workflow publishes success.

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
