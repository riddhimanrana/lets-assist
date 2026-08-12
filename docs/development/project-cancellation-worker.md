# Project cancellation worker

When an organizer cancels a project, every approved volunteer is owed one
notice: a transactional email and, for registered users, one in-app
notification. "One" is the hard part. This worker is the durable, exactly-once
implementation of that promise.

## What replaced what

The previous worker read `status = 'pending'` jobs, then set them to
`processing` afterwards, best-effort. It paged recipients with
`.range(cursor, cursor + n)` over `project_signups` filtered on a mutable
`status`, and kept no per-recipient record. That gave three separate ways to
mail somebody twice or nobody at all:

- the inline kick fired by the cancelling Server Action and the scheduled cron
  run could read the same job in the same instant;
- an approval or withdrawal between two pages shifted every later row, so the
  window skipped a volunteer or repeated one;
- a crash between the provider call and the cursor write re-sent the whole
  batch on the next run.

## The model

`supabase/migrations/20260811235900_project_cancellation_durable_worker.sql`
moves the guarantee into the database:

- `public.project_cancellation_jobs` gains explicit states, a worker-owned
  lease, an attempt bound, and a fairness coordinate. Claims go through
  `claim_project_cancellation_jobs`, which is atomic and bounded via
  `FOR UPDATE SKIP LOCKED`.
- `public.project_cancellation_deliveries` is a per-recipient ledger. Its
  unique indexes — one row per `(job_id, signup_id)`, and at most one per
  identity per job — are the at-most-once guarantee. It stores a sha256 of the
  address, never the address.
- The audience is **snapshotted once**, under the job lock, by
  `initialize_project_cancellation_audience`. Recipients are then drained by
  keyset over `(created_at, id)`; no offset appears anywhere.
- Each recipient carries one deterministic notification dedupe key,
  `project-cancelled:<project id>`, which the notification service's unique
  index on `(user_id, dedupe_key)` turns into a no-op on any replay.

`services/project-cancellation-worker.ts` owns transport;
`services/project-cancellation-dispatch.ts` owns the pure result mapping. The
route at `app/api/cron/project-cancellations` returns aggregates only — no job,
delivery, or recipient identifier and no provider text ever leaves it.

## The asymmetry that matters

A job lease and a delivery lease expire into different states, deliberately.

- A **job** never reaches the provider; it only selects work. An expired job
  lease is released back to `pending` by `reap_project_cancellation_job_leases`
  and re-claimed on the next tick.
- A **delivery** lease is held across the provider call. An expired one is
  settled as terminal `unknown_outcome` by
  `reap_project_cancellation_delivery_leases` and is **never re-sent**, because
  the mail may already have arrived.

Only a failure that provably preceded the provider request —
`retryable_pre_send`, or the worker running out of its time budget — may return
a recipient to `queued`.

## Frozen audience semantics

Two consequences of snapshotting are intentional, and neither is silent:

- an approval recorded **after** the snapshot is not added. That volunteer
  signed up after the project was already cancelled.
- a withdrawal recorded after the snapshot does **not** remove the row. The
  person was approved when the organizer cancelled and is owed the notice.

Address, consent, project state, and project ownership are all revalidated at
send time; membership is not re-decided mid-run.

## Operating it

Every run reaps both lease kinds before it claims anything, so stuck work is
discoverable from an ordinary tick even when no job is pending.

A job that finishes with any ambiguous recipient becomes `needs_review` with
`last_error = 'ambiguous_provider_outcome'` rather than `completed`. That state
is a human's queue, not a retry queue: re-driving it would re-send. There is no
operator surface for it yet — see CLEAN-021 in
[the cleanup register](cleanup-register.md).

Jobs that predate this migration were parked as `needs_review` for the same
reason: their cursor left no record of who had already been mailed.

Environment: `PROJECT_CANCELLATION_WORKER_ENABLED`,
`PROJECT_CANCELLATION_WORKER_SECRET_TOKEN` (or the shared `CRON_TOKEN`),
`PROJECT_CANCELLATION_WORKER_BATCH_SIZE`, and
`PROJECT_CANCELLATION_WORKER_MAX_JOBS`. The last two are clamped to the
worker's own maxima; the route accepts no caller-supplied work coordinates.

## Coverage

- `supabase/tests/database/project_cancellation_durable_worker.test.sql` —
  the state machine, the frozen audience, keyset paging, crash recovery, and
  zero duplicates.
- `supabase/tests/database/project_cancellation_worker_concurrency.test.sql` —
  two real sessions racing through `dblink`.
- `supabase/tests/database/project_cancellation_worker_lock_order.test.sql` —
  canonical lock order, fairness, and the lease asymmetry, asserted against the
  function source.
- `services/project-cancellation-dispatch.test.ts`,
  `services/project-cancellation-worker.test.ts`, and
  `app/api/cron/project-cancellations/route.test.ts` — privacy, boundedness,
  and no real sends.
