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

Project and organization identifiers on both ledgers are immutable snapshots,
not live foreign keys. Separate nullable `live_project_id` and
`live_organization_id` references prove the parent relationship while it
exists, then use guarded `SET NULL` actions after project, creator-account, or
organization deletion. The live signup, account, and anonymous-signup
references follow the same evidence-preserving pattern on deliveries. Deleting
any live parent never deletes the ledger or changes its snapshot identifiers.

Delivery-to-job snapshot coordinates remain `RESTRICT`: a delivery can never
be orphaned or moved across a project/tenant boundary, and no parent cascade
can erase the job that owns it. The generated tenant coordinate is deliberately
excluded from every `SET NULL` foreign key because PostgreSQL 17 rejects that
action for a constraint containing a generated column.

The architecture audit has one self-validating tenant-FK catalog exception for
`public.project_cancellation_jobs`. It is valid only while the named immutable
snapshot check binds `organization_id_snapshot` to `organization_id`, the
original identifier has no live tenant FK, and the named
`live_organization_id` FK targets `public.organizations(id)` with
`ON DELETE SET NULL`. Any additional exception or drift in those safeguards is
a blocking audit result.

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
  ACLs, frozen/deletion-safe evidence across project/account/organization
  deletion, channel truth, no orphan/cross-tenant evidence, constraints,
  indexes, and finalization denial;
- `project_cancellation_worker_concurrency.test.sql` for two-session
  cancellation-versus-approval and concurrent reapers;
- `project_cancellation_worker_lock_order.test.sql` for bounded candidate CTEs,
  canonical lock order, round-robin claims, and exhausted-state invariants;
- `project_lifecycle_integration_concurrency.test.sql` for atomic unreject versus
  cancellation in both commit orders and inactive-manager denial;
- the stateful Bun worker tests for checked RPC results, notification replay,
  safe pre-send exhaustion, unknown outcomes, fairness, and aggregate privacy.

The focused cancellation/lifecycle database suites pass 146 pgTAP assertions.
The post-catalog migration replay and architecture hard checks pass. The full
`db:test:redesign` gate, including the complete pgTAP inventory, remains a
separate verification gate.
