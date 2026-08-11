# Repository guide for coding agents

This is the canonical operating guide for AI coding agents working in Let's Assist. Start with [the documentation index](docs/README.md), then read the area-specific documents linked below before changing behavior.

## Repository purpose

Let's Assist is a Next.js App Router volunteering platform backed by Supabase and deployed on Vercel. The public repository owns the platform, database migration ledger, local/CI tooling, and private-plugin integration boundary. Organization-specific DVHS CSF and DV Speech & Debate implementations live in the `lib/plugins/private` Git submodule.

Use Bun, not npm, pnpm, or Yarn. The package manager version is pinned in `package.json`.

## Non-negotiable boundaries

- Base work and pull requests on `development`. Do not mutate `main` or Production unless the user explicitly authorizes a separate release.
- Treat Supabase migrations as an append-only ledger. Never edit or squash historical migrations; create a forward migration and add pgTAP coverage.
- Keep the private submodule at its exact gitlink. Make private-plugin changes in its own repository first, merge them there, then update the root gitlink.
- Do not expose CSF roster, membership, evidence, attendance, or credentials through public or browser-direct data access.
- Google services are import/export/broadcast channels, not a second source of truth. Persist immutable source snapshots and revalidate authorization before commit.
- AI may draft or classify, but consequential CSF state changes require staff approval and server-side revalidation.
- Never commit secrets, real student data, raw browser traces, cookies, storage state, or generated reports.

## Environment model

The four supported environments are deliberately distinct:

1. **Shared local:** `bun run supabase`, then `bun run dev:next`. This is for platform work and does not seed CSF.
2. **Isolated CSF local:** `bun run dev` (aliases: `dev:csf`, `csf:dev:isolated`). This creates the namespaced CSF Docker/Supabase stack, fictional fixtures, and the Next.js server.
3. **Development preview:** hosted CI/Vercel/Supabase resources scoped to `development`. A green local run does not prove this environment.
4. **Production:** `main` and Production services. Cleanup/refactor work must not touch it.

Read [local environments](docs/development/environments.md) before running database or browser workflows.

## Primary commands

- `bun run dev` — isolated CSF local environment.
- `bun run dev:next` — Next.js only, using an already configured backend.
- `bun run lint` — source-organization guard plus zero-warning ESLint.
- `bun run typecheck` — TypeScript without emit.
- `bun run build` — production build and deployment-safety checks.
- `bun run db:validate` — migration naming and replay validation.
- `bun run db:test:redesign` — full isolated schema/plugin gate.
- `bun run dv:test:db` / `bun run dv:test:e2e` — DV database and browser gates.
- `bun run csf:test:workflows` / `bun run csf:test:e2e` — CSF database workflows and browser journeys.
- `bun run plugin:submodules:init` / `bun run plugin:submodules:check:strict` — initialize and validate the private gitlink.

The cleanup program is standardizing additional interfaces. Use `package.json` as the executable source of truth and [testing](docs/development/testing.md) for grouped test requirements.

## Architecture map

- `app/` — routes, route handlers, and Server Actions.
- `components/` — shared UI.
- `lib/supabase/` — browser/server/admin clients and runtime environment checks.
- `lib/plugins/` — public control plane and extension contracts.
- `lib/plugins/private/` — private submodule; never replace it with copied source.
- `services/` — framework-independent integrations and domain services.
- `supabase/migrations/` — immutable forward migration ledger.
- `supabase/tests/` — pgTAP database tests.
- `scripts/` — CI, local environment, seed, audit, and acceptance tooling.
- `tests/e2e/` — browser acceptance suites as they are consolidated.
- `.artifacts/` — ignored generated evidence and browser output.
- `docs/csf/evidence/` — the one curated, sanitized evidence set.

Read [platform architecture](docs/architecture/platform.md), [plugin boundaries](docs/architecture/plugins.md), and [data boundaries](docs/architecture/data.md) for details.

## CSF changes

Before non-trivial CSF work, read:

- [CSF overview](docs/csf/README.md)
- [formal invariants](docs/csf/invariants.md)
- [product contract](docs/csf/product-contract.md)
- [officer runbook](docs/csf/officer-runbook.md)
- [testing and release evidence](docs/csf/testing-and-release.md)

Real chapter spreadsheets live git-ignored in `docs/csf/source-data/`; their layout and semantics are documented in [source data](docs/csf/source-data.md). Read them locally for context, but never copy real values into code, fixtures, tests, docs, or migrations.

Consequential transitions must be organization-scoped, atomic, audited, retry-safe, and covered at both the Server Action/service boundary and the database boundary. Extend existing CSF models instead of creating parallel concepts.

## Change discipline

- Preserve product routes and public action signatures during refactors. Use temporary barrel exports only while consumers migrate.
- Add focused regression coverage for every defect or behavior extraction.
- Keep handwritten React route/component modules at or below 600 lines, service/action modules at or below 800 lines, and test modules at or below 1,200 lines. Generated artifacts and historical migrations are exempt.
- Keep generated output out of the source tree. Curated evidence must be synthetic, sanitized, and documented.
- Report local, hosted Development, and Production evidence separately. Never describe a push or local green gate as a deployment.
- Record repository-owned P0–P2 findings in [the cleanup register](docs/development/cleanup-register.md) until fixed or disproved. Track provider/account blockers separately.

## Current documentation

`docs/README.md` is the only documentation index. `CLAUDE.md` exists solely as a compatibility pointer to this file.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
