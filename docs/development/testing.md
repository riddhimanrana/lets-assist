# Testing and acceptance

Use the narrowest focused regression first, then expand to the appropriate gate. Mock-sensitive Bun suites run in separate processes because `mock.module` state is global to a process.

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

## Database and plugin gates

- `bun run db:validate`
- `bun run db:test:redesign`
- `bun run dv:test:db`
- `bun run csf:test:workflows`
- `bun run csf:test:scale`
- `bun run plugin:submodules:check:strict`

## Browser gates

- `bun run dv:test:e2e`
- `bun run csf:test:e2e`
- `bun run dev:test:cron`

Generated Playwright HTML, traces, screenshots, video, storage state, payloads, and logs belong under ignored `.artifacts/`. Promote only a sanitized, fictional, reviewed gallery to `docs/csf/evidence/`, replacing the previous gallery rather than accumulating copies.

The DV suite requires its explicitly optional fictional DV seed and password marker. Create those fixtures through the documented isolated seed command; never fall back to a real account or print the generated password into logs.

See [CSF testing and release](../csf/testing-and-release.md) for current residual gaps. Hosted CI and Development preview are separate gates from local success.
