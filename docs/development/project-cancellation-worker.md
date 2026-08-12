# Project cancellation worker

Cancelling an upcoming project atomically freezes what the platform owes each
approved recipient. A registered user is owed one deduplicated in-app
notification; any recipient with an eligible frozen address is also owed one
email dispatch attempt.

This is a conditional at-most-once automatic dispatch design. It does not
guarantee receipt. Provider acceptance is not delivery, and an ambiguous
provider outcome is deliberately never sent again automatically.

## Transaction boundary

`public.cancel_project_transactional(uuid, text)` is the only cancellation
authority. As the authenticated caller, it locks the project, rechecks project
management permission, permits only `upcoming -> cancelled`, records the
cancellation, deduplicates the then-approved audience, and inserts the job and
delivery ledger in one transaction. A repeat call returns the existing state
without resetting an in-flight or terminal job.

Approval transitions take the same project-row lock. If approval and
cancellation race, the winner commits first; a losing approval observes the
cancelled project and is denied. There is no project-update/enqueue/snapshot
split transaction.

The replacement is an append-only hardening migration after
`20260811235900_project_cancellation_durable_worker.sql`:

- `20260812001000_project_cancellation_hostile_review_hardening.sql` first
  removes execution from the predecessor RPCs and parks every legacy
  `pending` or `processing` job, including cursor zero. It never revives or
  resets those jobs.
- Job claims use a bounded, organization-aware round-robin candidate CTE and
  `FOR UPDATE SKIP LOCKED`.
- Each job drains only a per-job quantum before the worker advances to the next
  claimed job, under one global delivery budget.
- All service state changes go through reviewed security-definer RPCs. The
  service role may inspect the ledgers but cannot mutate either table directly.

## Frozen delivery truth

The cancellation transaction stores immutable project and recipient evidence:
project title, cancellation instant and reason, signup snapshot ID,
pseudonymous identity hash, exact trimmed destination and destination hash,
and which channels were owed. Duplicate approved signups for one registered
user produce one delivery row.

The live signup, account, or anonymous-signup foreign keys are nullable and use
safe `SET NULL` behavior. Deleting one of those records does not delete the
delivery ledger or its frozen evidence. The live signup uses ordinary-column
project and organization keys: together they prove its derived tenant while it
exists, then clear only `signup_id` on deletion. The generated tenant coordinate
is deliberately excluded from that `SET NULL` foreign key because PostgreSQL 17
rejects that action for a constraint containing a generated column. Composite
project/job tenant keys remain restricted.

The exact address is service-only retention data. Once both owed channels are
terminal, a bounded skip-locked retention RPC removes it after 90 days while
retaining its hash and immutable identity evidence.

## Channel outcomes

Email and notification truth are independent:

- notification inserts use `(user_id, dedupe_key)` replay protection. A
  transient or ambiguous insert result is safe to retry; ordinary notification
  preferences cannot suppress this required cancellation notice;
- only a failure proved to occur before a provider request may retry email,
  with the same logical idempotency key and a maximum of three attempts;
- provider acceptance is recorded as `accepted`, a definitive rejection or
  missing transport as `failed`, and an unknown result as `unknown_outcome`;
- `accepted` and `unknown_outcome` email states are never sent again merely to
  retry the other channel;
- a job can be `completed` only when its non-null audience snapshot count
  exactly matches the ledger and every owed channel has successful terminal
  truth. Failed or ambiguous owed work goes to bounded failure/review.

The scheduled route returns aggregate counts only. It never returns a project,
job, recipient, destination, or provider identifier.

## Lease recovery

Every run invokes bounded deterministic reapers before claims. Their candidate
CTEs order rows, apply a limit, and use `FOR UPDATE SKIP LOCKED`.

- A job lease can return to `pending` because claiming a job performs no
  external side effect. Exhausted jobs become `failed` without resetting their
  attempts.
- An expired delivery lease that had entered `sending` becomes terminal
  `unknown_outcome`; it is not re-sent. A lease that provably remained before
  send may return to idle, but its third channel attempt terminalizes instead
  of spinning.

All paths that touch both ledgers lock the job before deliveries. Delivery-only
settlement and reaping never acquire a later job lock.

## Operating and coverage

Configuration uses `PROJECT_CANCELLATION_WORKER_ENABLED`,
`PROJECT_CANCELLATION_WORKER_SECRET_TOKEN` (or `CRON_TOKEN`),
`PROJECT_CANCELLATION_WORKER_BATCH_SIZE`, and
`PROJECT_CANCELLATION_WORKER_MAX_JOBS`. Caller values are clamped to worker
maxima.

Coverage lives in:

- `project_cancellation_durable_worker.test.sql` for transactional cancellation,
  ACLs, frozen/deletion-safe evidence, channel truth, constraints, indexes, and
  finalization denial;
- `project_cancellation_worker_concurrency.test.sql` for two-session
  cancellation-versus-approval and concurrent reapers;
- `project_cancellation_worker_lock_order.test.sql` for bounded candidate CTEs,
  canonical lock order, round-robin claims, and exhausted-state invariants;
- `project_lifecycle_integration_concurrency.test.sql` for atomic unreject versus
  cancellation in both commit orders and inactive-manager denial;
- the stateful Bun worker tests for checked RPC results, notification replay,
  safe pre-send exhaustion, unknown outcomes, fairness, and aggregate privacy.

The SQL migration and pgTAP suites still require isolated CI replay. They were
authored but not executed in this worktree because this task forbids every
database command.
