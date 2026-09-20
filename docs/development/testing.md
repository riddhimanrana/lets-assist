# Testing and acceptance

Use the narrowest focused regression first, then expand to the appropriate gate. Mock-sensitive Bun suites run in separate processes because `mock.module` state is global to a process.

## Delivery stages

1. While coding, run the focused regression for the behavior you changed. Add the relevant static check when the change affects types, lint rules, formatting, dependencies, migrations, or agent configuration.
2. Before updating the integration pull request, run all focused checks for that deliverable locally. The hosted pull-request `ci-gate` remains short and deterministic.
3. After the coherent candidate is integrated, dispatch `Code quality` once. That manual run owns the full tests, production build, isolated database replay, scale checks, and browser suites used by release verification.

Do not use a new pull request as a retry mechanism. Fix a failed local or hosted check on the same branch and update the same pull request.

## Evidence classes

Keep evidence environment- and revision-specific. Record exact counts, SHAs, and run links in the cleanup register or release report produced by that run. Do not copy a dated assertion count into this operating guide because it becomes stale whenever a migration or test lands.

- **Locally verified:** checks run against the exact local worktree and an owned local environment.
- **Hosted Development verified:** checks run against the hosted Development database and exact deployed application SHA.
- **Production verified:** checks run against the served Production revision and Production provider state through the approved read-only or release workflow.

A local pass is not a deployment, a static inventory is not a runtime gate, and hosted database parity does not prove that the matching application SHA is deployed.
For Hosted Development evidence, only checks run against the hosted Development database and exact deployed application SHA belong in this class.
Unless the release report says otherwise, no Production database, application, browser, worker, or provider gate was run.

## Standard commands

- `bun run test:unit` discovers and runs every root `*.test.*` and `*.spec.*` file outside private plugins and browser suites.
- `bun run test:plugins` runs the private plugin unit and security suite.
- `bun run test` runs both of the above through the shared process orchestrator used by CI.
- `bun run test:db:isolated` replays the isolated CSF database gate.
- `bun run test:e2e:csf` and `bun run test:e2e:dv` run their respective browser suites against the same compiled runtime used by CI. Interactive `bun run dev:csf` remains a separate development-mode launcher.

The orchestrator keeps safety-sensitive groups explicit, discovers all remaining root tests, and gives every file containing `mock.module(...)` its own Bun process. Adding a test file therefore adds it to `test:unit` automatically; do not maintain a second hand-curated catch-all list.

## Static gates

- `bun run format:check`
- `bun run lint`
- `bun run typecheck`
- `bun run build`
- `bun run source:check:organization`
- `bun run agent:check`

The pull-request gate runs these static checks, seed safety, dependency audit, plugin contract validation, and the CI tooling tests. Full root/plugin tests and the production build run in the manual or reusable release gate.

## Database and plugin gates

- `bun run db:validate` checks migration filenames, duplicate versions, and description comments without accessing a database.
- `bun run db:test:redesign`
- `bun run dv:test:db`
- `bun run csf:test:workflows`
- `bun run csf:test:scale`
- `bun run csf:test:import:scale`
- `bun run plugin:submodules:check:strict`

`db:validate` does not prove migration replay or database security. Run
`db:test:redesign` for those checks on an owned isolated stack. Validation must
never reset a developer's shared-local database.

## Browser gates

- `bun run dv:test:e2e`
- `bun run csf:test:e2e`
- `bun run dev:test:cron`

Generated Playwright HTML, traces, screenshots, video, storage state, payloads, and logs belong under ignored `.artifacts/`. Promote only a sanitized, fictional, reviewed gallery to `docs/csf/evidence/`, replacing the previous gallery rather than accumulating copies.

The DV suite requires its explicitly optional fictional DV seed and password marker. Create those fixtures through the documented isolated seed command; never fall back to a real account or print the generated password into logs.

## Synthetic-scale release criteria

These are acceptance targets for a release that claims the corresponding scale, not completed evidence. The `csf:test:scale` command is a 1,000-profile/600-application smoke test with timings but no thresholds. The `csf:test:import:scale` command exercises the real 1,000-row import receipt path in one hundred 10-row batches, replays every request, requires zero duplicate writes and unknown outcomes, and enforces the ten-minute import target. Neither command satisfies any larger tier below.

Measure at least 30 samples after five warmups on documented local or hosted Development hardware, using fictional tenant-isolated data and the production query/route shape.

| Synthetic tenant size | Bounded work                                                                                    | Database query p95 | Route p95 | Concurrency and replay                                            |
| --------------------: | ----------------------------------------------------------------------------------------------- | -----------------: | --------: | ----------------------------------------------------------------- |
|        10,000 records | Keyset pages at most 100 rows; mutation/import batches at most 500; dispatch claims at most 100 |            ≤150 ms |   ≤500 ms | 25 parallel operations; replay every idempotency key three times  |
|       100,000 records | Same bounds; no growing in-memory aggregation or offset walk                                    |            ≤250 ms |   ≤750 ms | 50 parallel operations; replay every idempotency key three times  |
|     1,000,000 records | Same bounds; resumable jobs and backpressure required                                           |            ≤500 ms | ≤1,500 ms | 100 parallel operations; replay every idempotency key three times |

Every tier must also provide:

- `EXPLAIN (ANALYZE, BUFFERS)` for each hot query, with bounded estimates and an organization-leading/index-supported plan. Any sequential scan, disk spill, or sort over unbounded tenant rows requires measured justification.
- Exact pagination completeness with stable tie-breakers; bounded request memory and payload size; no cross-tenant rows.
- Zero duplicate domain transitions, audit events, outbox entries, or effect receipts under concurrency and replay. Lock waits, deadlocks, timeouts, partial failures, and ambiguous provider outcomes must follow the documented retry/error contract.
- Redacted metrics and traces for route/query p50, p95, and p99; rows scanned/returned; page and batch size; queue age; claim/attempt count; lock wait; retry class; bounded error code; and correlation identifiers. No source row, credential, provider payload, or member/student identity may enter logs.

A forward migration plus pgTAP coverage is required before release when a tier exposes a missing tenant-leading index, an unsafe plan, an unenforced tenant/idempotency invariant, or lock/concurrency behavior that the schema must guarantee. A route/service change is required for unbounded pagination, payloads, batching, caches, or retry behavior. Exceeding a latency target blocks the claimed tier until new `EXPLAIN` and runtime evidence demonstrate the fix; changing a target to match a regression is not acceptance.

See [CSF testing and release](../csf/testing-and-release.md) for current residual gaps. Hosted CI and Development preview are separate gates from local success.
