# Platform architecture

Let's Assist has three layers: the public Next.js platform, Supabase as the authoritative data and authorization layer, and organization-specific plugins loaded through a strict private boundary.

## Request and UI layer

`app/` uses the Next.js App Router. Server Actions and route handlers are externally reachable code and must establish the user, organization, capability, and resource scope before invoking a service or transaction. `proxy.ts` refreshes Supabase sessions; it is not an authorization substitute.

Shared presentation belongs in `components/`. Route modules should assemble a page from bounded components and services rather than becoming domain implementations.

## Service layer

`services/` and focused `lib/` modules own reusable domain behavior, provider integrations, validation, and error mapping. Services accept explicit authorization context and avoid importing browser-only code.

## Persistence layer

Supabase/Postgres is authoritative. RLS protects ordinary public-schema access. Plugin-owned records live in `plugin_data`, which is server-only and organization-scoped. Consequential multi-record changes use reviewed database transactions/RPCs and immutable audit events.

## Scheduled work

GitHub Actions schedules authenticated `app/api/cron/**` routes. Each route validates its dedicated token, honors its worker-enabled flag, and must be safe to retry. Local and CI acceptance force dispatch off unless a test explicitly supplies a fake dispatcher.

## Related documents

- [Plugin boundaries](plugins.md)
- [Data boundaries](data.md)
- [Environment model](../development/environments.md)
