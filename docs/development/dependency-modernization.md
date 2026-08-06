# Dependency modernization ledger

This ledger records compatibility decisions and validation evidence for the sequential dependency PRs. It is not a substitute for `bun.lock`; it explains why a package was upgraded, retained, or deferred.

## Rules

- Consult current official documentation through Context7 before each ecosystem change.
- Use stable releases only unless the application already has a reviewed prerelease dependency with no stable replacement.
- Keep `bun.lock` as the only generated dependency lockfile.
- Validate frozen installation, formatting, lint, typecheck, separated tests, production build, dependency ancestry, and the production-tree audit after every group.
- Treat an advisory as open until the affected installed version is removed, upgraded, explicitly isolated from production, or documented with evidence showing it is not reachable.

## Platform group — 2026-08-05

| Package family   | Previous                                       | Selected                                       | Decision                                                                                                                                            |
| ---------------- | ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun              | 1.3.14                                         | 1.3.14                                         | Already the latest stable registry release; CI and `packageManager` remain aligned.                                                                 |
| Next.js          | 16.2.12                                        | 16.3.0                                         | Latest stable; requires Node 20.9 or newer and supports React 19.                                                                                   |
| React            | 19.2.8                                         | 19.2.8                                         | Already latest stable.                                                                                                                              |
| TypeScript       | 5.9.3                                          | 6.0.3                                          | Latest stable version compatible with the current `typescript-eslint` range. Bun ambient types are now explicit in `tsconfig.json`.                 |
| ESLint           | 9.39.4                                         | 9.39.5                                         | Latest compatible 9.x. ESLint 10 is deferred because multiple plugins shipped with the current Next.js config do not yet declare ESLint 10 support. |
| Tailwind CSS     | 4.3.1                                          | 4.3.3                                          | Latest stable; the existing CSS-first configuration and dedicated PostCSS plugin match the v4 contract.                                             |
| shadcn CLI       | 4.11.0                                         | 4.16.1                                         | Latest stable CLI only; no application components were regenerated or overwritten.                                                                  |
| Node/React types | Node 20.19.39, React 19.2.17, React DOM 19.2.3 | Node 20.19.43, React 19.2.18, React DOM 19.2.4 | Latest patches on the runtime-compatible major lines.                                                                                               |

Next.js 16.3 enabled `@next/next/no-location-assign-relative-destination`. Ordinary internal transitions now use the Next router. OAuth, logout, account deletion, and the existing project-creation hard reload retain document navigation with narrow inline rationale because they cross a redirect or client-session boundary.

The direct Next.js installation now resolves `next@16.3.0` and `sharp@0.35.3`. The audit still sees `next@16.1.7` and `sharp@0.34.5` exclusively through development-only `@react-email/preview-server@5.2.10`; that duplicate is assigned to the email/provider dependency group rather than hidden with an override.

Validation completed for this group:

- frozen Bun install
- `bun run quality:static`
- `bun run test`, including 2,426 private-plugin tests
- preview-isolated `bun run build` with 80 generated routes
- `bun why next` and `bun why sharp`
- production dependency audit re-run; remaining findings stay open under `CLEAN-003`

## Supabase group — 2026-08-05

| Package family        | Previous | Selected | Decision                                                                                                                                                                                                   |
| --------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase JS/PostgREST | 2.108.2  | 2.112.1  | Latest stable, pinned exactly with one resolved family.                                                                                                                                                    |
| Supabase SSR          | 0.12.0   | 0.12.4   | Latest stable; existing `getAll`/`setAll` adapters are retained, and proxy cookie writes preserve the SDK's private no-cache headers.                                                                      |
| Supabase CLI          | 2.111.0  | 2.111.0  | Already the latest stable registry release; the isolated Docker identity oracle remains unchanged.                                                                                                         |
| Node.js runtime       | implicit | 22.23.2  | Supabase client libraries now require Node 22 or newer. The application pins the current Node 22 LTS patch in `.node-version`, declares the supported 22.x engine range, and installs it explicitly in CI. |
| Node types            | 20.19.43 | 22.20.1  | Latest stable typings for the selected Node 22 runtime line.                                                                                                                                               |

Supabase JS now retries transient GET/HEAD requests automatically. This application already classifies and bounds idempotent read retries through `withRetryableSupabaseQuery`, so all four application client factories set `db.retry` to `false`. A source-boundary regression test prevents a future client factory from multiplying one logical attempt into nested SDK retries.

Validation completed for this group:

- current Supabase changelog review, including Node 20 support removal and automatic PostgREST retries
- frozen Bun install and explicit Supabase dependency ancestry
- `bun run quality:static`
- `bun run test`, including the retry-policy regression and 2,426 private-plugin tests
- preview-isolated production build under Node `22.23.2`, with 80 generated routes
- pinned Supabase CLI `--help`, version, and existing exact-version contract tests
- production dependency audit re-run; unrelated findings remain open under `CLEAN-003`

## Playwright and test-tooling group — 2026-08-05

| Package family           | Previous | Selected | Decision                                                                                                                      |
| ------------------------ | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Playwright               | 1.61.0   | 1.62.1   | Latest stable runner and library, pinned to the same version; Chromium 151 browser binaries installed outside the repository. |
| Faker                    | 10.4.0   | 10.5.0   | Latest stable patch compatible with the selected Node 22 runtime.                                                             |
| Baseline browser mapping | 2.10.18  | 2.11.12  | Latest stable browser-support dataset.                                                                                        |

Playwright 1.62 no longer supports Debian 11; CI uses `ubuntu-latest`, so no retained runner depends on the removed platform. The new config loader transformed the imported `.mjs` isolation validator through CommonJS until the repository declared its actual ESM package boundary. `package.json` now sets `type: module`, the sole CommonJS `.js` file (`next-sitemap.config.js`) now uses ESM, and `@next/env` is loaded through its CommonJS-compatible default export. Both browser configs now load the real isolated validator and fail closed at the expected missing-stack check when no generated stack is selected.

Validation completed for this group:

- frozen Bun install and Playwright `1.62.1` CLI version
- current Chromium and headless-shell installation outside tracked source
- `bun run quality:static`
- `bun run test`, including the ESM config-loader regression and 2,426 private-plugin tests
- both Playwright configs loaded through their real CLI path and reached the intended isolated-stack refusal
- preview-isolated production build under Node `22.23.2`, including ESM sitemap generation and 80 routes
- production dependency audit re-run; unrelated findings remain open under `CLEAN-003`

## Remaining groups

1. PostHog, OpenTelemetry, and AI packages.
2. Resend, Stripe, Google integrations, and general utilities.

The completion condition remains no critical/high advisory, no unreviewed lower-severity advisory, no stale compatible direct dependency, and no unexplained duplicate family.
