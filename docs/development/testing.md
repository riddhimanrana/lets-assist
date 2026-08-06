# Testing and acceptance

Use the narrowest focused regression first, then expand to the appropriate gate. Mock-sensitive Bun suites run in separate processes because `mock.module` state is global to a process.

## Static gates

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

See [CSF testing and release](../csf/testing-and-release.md) for current residual gaps. Hosted CI and Development preview are separate gates from local success.
