# Local Dev Setup

This folder contains the deterministic fixtures and health checks for the local Supabase + Next.js workflow.

## What to run

From the repository root:

1. Create a run-scoped fixture password: `export CSF_LOCAL_TEST_PASSWORD="$(openssl rand -base64 24)"`
2. Reuse it for the optional DV fixtures: `export DV_LOCAL_TEST_PASSWORD="$CSF_LOCAL_TEST_PASSWORD"`
3. `bun run supabase`
4. `bun run dev`

`bun run supabase` does the full **shared local, non-CSF only** backend bootstrap:

- starts local Supabase
- resets the database through the current migrations
- seeds deterministic non-DV, non-CSF platform test accounts, organizations,
  plugin installs, and projects
- verifies the local Supabase environment is reachable

It seeds **no** DVHS CSF data. `PLATFORM_SEED_MODE=shared-local-v1` creates,
replaces, and deletes no DVHS CSF organization, plugin, profile, membership,
import, or synthetic fixture record. The deterministic synthetic DVHS CSF
fixtures live only in `PLATFORM_SEED_MODE=csf-isolated-v1`
(`bun run csf:seed:platform:isolated`), on a generated isolated stack.

The reset step uses `scripts/local-dev/reset-supabase.mjs`. It behaves like
`supabase db reset --local --yes`, except it can recover from the Supabase CLI
post-reset Storage `502` race after verifying the latest migration was recorded
and restarting the local stack.

## DVHS CSF recovery — isolated only

> **This whole section is isolated-only.** The shared-local instructions above
> remain correct for non-CSF work; they are not a fallback for DVHS CSF
> recovery. The isolated topology is app `3000` and Supabase base `55320`
> (API `55321`, DB `55322`, Studio `55323`, Mailpit UI `55324`, SMTP `55325`,
> edge inspector `55326`, analytics `55327`, pooler config `55329`).

For normal day-to-day CSF development, use the one-command bootstrap:

```bash
bun run dev
# Equivalent explicit aliases:
bun run dev:csf
bun run csf:dev:isolated
```

It creates or safely reuses the isolated Docker stack, seeds fictional CSF data
on first use, prints the generated local password and useful accounts, and
starts the normal Let’s Assist application on port `3000`. A running stack is
reusable only when its copied migration files and applied migration history
exactly match the current repository tree; stop a reported stale stack before
starting the current tree. Re-running a current stack keeps changes made while
testing. Use `CSF_LOCAL_RESEED=1 bun run dev` only when you intentionally want
to restore the deterministic fixture corpus. Ordinary `bun run dev:next`
remains the raw, non-bootstrapping Next.js command.

### Prohibited for DVHS CSF recovery

Never use these on the CSF recovery path. Each one either selects or destroys a
stack this path does not own:

| Command                                        | Why it is prohibited                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run supabase`                             | Shared bootstrap: starts, resets, and reseeds the shared local `54321` stack.                                                                             |
| `bun run supabase:reset` / `supabase db reset` | Destroys the shared local database. Recovery replays through a _new volume_, never a reset.                                                               |
| `supabase ... --linked` / `supabase link`      | Reaches a hosted project. Production and the preview project are out of scope.                                                                            |
| `bun run csf:test:db:isolated`                 | Superseded second-stack replay script; it is not part of this recovery path.                                                                              |
| `bun run supabase:seed:local-dev`              | Shared local, non-CSF only. It refuses an isolated work directory by design and seeds no DVHS CSF data at all — use `bun run csf:seed:platform:isolated`. |
| `bun run dev:next`                             | Ambient Next launch: it runs in the operator's own environment and does not bootstrap or seed Supabase. Use `bun run dev` for normal local work.          |

The one-command bootstrap delegates to
`scripts/local-dev/start-dvhs-csf-isolated-stack.sh` and the low-level isolated
app runner; those remain the only permitted live stack and app launchers.

### The recovery sequence

1. Export the two run-scoped fixture-password variables shown above.
2. Run `scripts/local-dev/start-dvhs-csf-isolated-stack.sh` and copy the exact
   work directory it prints. It allocates one bounded run ID, atomically claims
   that project ID and its whole port bundle, proves Docker holds no container,
   volume, or network for the project, starts once, and records the exact
   `supabase_db_<project-id>` volume in its ownership marker.
   If Docker repeatedly kills only the optional local Logflare analytics
   container during startup, set `CSF_ISOLATED_ANALYTICS_MODE=disabled` for that
   run. The launcher still reserves the analytics port and validates every
   required database/auth/storage service; this switch never changes app or
   provider behavior. Any value other than `enabled` or `disabled` is refused.
3. Export that work directory and load the app environment through the
   **exact-byte validated loader**, one `KEY=VALUE` line at a time. Never
   `source` or `eval` the generated file on this path:

   ```bash
   export CSF_ISOLATED_WORK_DIR=/tmp/lets-assist-csf-browser-<run-id>
   while IFS= read -r assignment; do
     case "${assignment%%=*}" in
       API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL|SUPABASE_URL|SUPABASE_ANON_KEY|\
       SUPABASE_DB_URL|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|\
       NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|\
       CSF_PROFILE_CLAIM_SECRET|NEXT_PUBLIC_SITE_URL|SITE_URL|NEXT_PUBLIC_VERCEL_URL|\
       CSF_ISOLATED_WORK_DIR) ;;
       *) echo "Refusing an unexpected key: ${assignment%%=*}" >&2; return 1 ;;
     esac
     export "${assignment%%=*}=${assignment#*=}"
   done < <(node scripts/local-dev/dv-local-env.mjs --print-app-env)
   ```

   That loader re-reads its own held descriptor and rechecks inode, size, and
   digest before emitting anything, and the allowlist above is exactly the 17
   keys it may emit. `supabase-browser.env` is only the raw `supabase status`
   snapshot; it is not sufficient for app or seed validation.

4. Run `bun run csf:seed:platform:isolated` and, if needed, `bun run dv:fixtures`
   to create the fictional JavaScript-managed platform and DV records. The
   isolated seed script carries `PLATFORM_SEED_MODE=csf-isolated-v1` and refuses
   to run without a validated `CSF_ISOLATED_WORK_DIR`, so it can never
   reset-upsert the shared local stack's CSF tables.
5. Run `node scripts/local-dev/run-dvhs-csf-isolated-app.mjs` in that same
   manually exported environment. The day-to-day `bun run dev` command
   performs steps 2–5 automatically. The low-level runner validates the same 17
   isolated values, builds the child environment from a positive allowlist
   (`process.env` is never spread), shadows every key the repository's `.env*`
   files declare unless it is validated local-safe, forces every worker flag —
   including `CSF_COMMUNICATIONS_WORKER_ENABLED` — false, selects Mailpit
   explicitly for local mail, permits only loopback Supabase, database, SMTP,
   and local-app traffic, atomically claims the fixed port `3000` for the
   child's lifetime, and starts Next directly through Node. Never launch the app
   here with `bun run dev`.
6. Tear down in two steps. **Dry run first**, then the real stop:

   ```bash
   scripts/local-dev/stop-dvhs-csf-isolated-stack.sh --dry-run <work-directory>
   scripts/local-dev/stop-dvhs-csf-isolated-stack.sh <work-directory>
   ```

   The stop path requires Docker and a successful read-only enumeration of the
   exact-name and exact-label container, volume, and network sets **before** it
   issues any `supabase stop`. If Docker is missing or that enumeration fails, it
   makes zero stop calls and retains the marker, config, logs, work directory,
   and allocator recovery evidence.

   `--delete-workdir` is unreachable unless the post-stop **residual proof**
   completed successfully: exact-name and exact-label container, volume, and
   network sets all empty, and the recorded database volume gone. Any unexpected
   residual fails nonzero and keeps every piece of recovery evidence.

What each command actually bootstraps:

- The launcher's new database volume is what makes the Supabase CLI apply the
  current timestamped migrations and then the configured `db.seed.sql_paths`.
  Starting an existing volume replays neither, so a stopped-and-restarted stack
  is never clean-replay evidence.
- `bun run supabase:seed:local-dev` and `bun run dv:fixtures` create fictional
  **shared local, non-CSF only** platform/DV records through JavaScript; they do
  not replay migrations and they seed no DVHS CSF data.
- `bun run csf:test:workflows` asserts against a prepared seeded stack. It
  replays no migrations, creates no fixtures, and only checks the public route
  when an explicit `CSF_APP_URL` is supplied.

The launcher never starts, stops, or resets the shared Let’s Assist local
Supabase stack.

If startup or its post-start volume check fails, the launcher attempts its own
marker-bounded stop exactly once and reports both the primary and cleanup
failures. It then either releases its claims, when that cleanup proved the
project namespace clean, or retains the exact remaining claims plus a recovery
marker listing them, when it could not. Claims are retained only in that second
case, so a proven-clean failure never leaves a stale claim behind.

## Useful follow-up checks

- `bun run db:test:redesign` to run the full sequential Supabase/plugin redesign merge gate
- `bun run dv:test:db` to verify local RLS and schema behavior
- `bun run dv:test:e2e` to run the Playwright DV browser checks
- `bun run dev:test:cron` to prove the five selected worker routes:
  auto-publish-hours, project-cancellations, organization-calendar-sync,
  organization-sheet-sync, and data-exports authenticate and return without
  dispatching. It requires a validated `CSF_ISOLATED_WORK_DIR`, starts and owns
  its own loopback server (refusing an occupied port rather than adopting one),
  forces every worker flag false, and rejects and records every non-loopback
  HTTP(S) request and every SMTP connection — loopback Mailpit included. It
  proves auth and shape only; it proves nothing about queue behavior or provider
  delivery.
  - Six other current cron routes are **outside** this harness and are neither
    probed nor changed by it: `ai-moderation`, `anonymous-cleanup`,
    `csf-communications-dispatch`, `csf-proof-cleanup`,
    `generate-recurring-projects`, and `waiver-cleanup`.
- `bun run db:advisors` to verify local Supabase advisor output stays clean after migrations
- `bun run db:audit:architecture` to verify tenant indexes/FKs, RLS policy hygiene, and read-model view safety
  - Also hard-fails unexpected client-executable public `SECURITY DEFINER` functions while printing the reviewed allowlist.
  - Also verifies expected Storage buckets, public/private bucket posture, and absence of public/anon object-listing policies.
- `bun run db:audit:remote-readiness` to check the stricter final production posture where `plugin_data` is removed from exposed Data API schemas and authenticated direct grants are gone
  - This is a **separate, currently blocked release gate**. It is deterministically red while `plugin_data` remains in `supabase/config.toml` `api.schemas`, and removing that schema now would break the server-side service-role PostgREST reads the app still depends on.
  - `bun run db:test:redesign` therefore does **not** run it by default; it prints `Remote readiness: NOT EVALUATED — separate blocked release gate.` instead. Set `CSF_REQUIRE_REMOTE_READINESS=1` to opt in and let its failure propagate. Any other nonempty value is refused before anything starts.
- `bun run plugin:audit:data-access` to verify browser/client code cannot directly construct `plugin_data` queries
- `bun run plugin:test:registry` to verify every private plugin registry gate, including the server-only DV workspace
- `bun run plugin:test:contracts` to sync registered plugin runtime contracts and verify no plugin declares raw `plugin_data` client access
- `bun run typecheck` to verify generated read-model usage still matches the app

## Fixture files

- `README-fixtures.md` documents seeded accounts and the required run-scoped
  credential environment variables
- `member-import-mock.csv` is a sample import file for org member CSV testing
- `seed-platform.mjs` contains the default local platform seed logic
- `seed-dvsd.mjs` provisions the optional DV workspace through a service-role-only backend client; browser roles have no `plugin_data` grants

## Supabase redesign gate

Before merging Supabase schema changes:

1. Export fresh `CSF_LOCAL_TEST_PASSWORD` and `DV_LOCAL_TEST_PASSWORD` values
2. Run `bun run db:test:redesign`

That single command is the gate. It starts one generated isolated stack — it
never touches the shared local stack, never resets a database, and never issues a
linked or remote command — and then runs the advisors, the architecture,
plugin-isolation, and plugin-data-access audits, the plugin registry and runtime
contract gates, the strict submodule check, typecheck, lint, the plugin
login/API isolation browser smoke, and the five-route cron auth/shape smoke on
that one stack.

Do not run `bun run supabase` as the schema gate's bootstrap: it is the shared
local, non-CSF bootstrap, and it neither replays the isolated stack nor covers
DVHS CSF.

Remote readiness is **not** part of this gate. By default it prints
`Remote readiness: NOT EVALUATED — separate blocked release gate.` Opt in with
exactly `CSF_REQUIRE_REMOTE_READINESS=1` to run
`bun run db:audit:remote-readiness` and let its failure propagate; any other
nonempty value is refused before anything starts.

Browser/dev-server checks inside the gate run sequentially. Next.js allows only one dev server per project directory, and the isolated app runner holds an exclusive claim on port `3000`, so `bun run plugin:test:isolation`, `bun run dev:test:cron`, and `bun run csf:dev:isolated` must not run in parallel.

Remote Supabase writes should wait until the local gate passes and the generated migration has been reviewed.

`bun run db:test:redesign` is the **DVHS CSF local isolated replay gate**. It
names itself and its final result that way on purpose: it replays migrations and
SQL seeds on one local isolated stack and checks the local surfaces listed above.
It is not a Supabase, Production, or preview readiness result, and it never
prints a global PASS. Remote readiness is a separate, currently blocked gate (see
above). DV Speech & Debate is registered again after its browser-facing data
access was replaced with authenticated Server Actions and service-role-only
backend reads.

The gate explicitly does **not** cover: `next build` or any production build
output, the full private-plugin corpus, scale (`bun run csf:test:scale`), the
full CSF E2E suite / action matrix / screenshots (`bun run csf:test:e2e`), public
route proof unless `CSF_APP_URL` is supplied to `csf:test:workflows`, or
Production, the preview project, and any provider.

### How `db:test:redesign` uses the isolated launcher

- With no `CSF_ISOLATED_WORK_DIR`, it generates one bounded run ID and an absent
  work directory, starts the isolated launcher exactly once, and treats that new
  volume as the clean migration + configured SQL seed replay. There is no
  `supabase db reset`, no linked command, no shared stack, and no nested replay
  script anywhere in the gate.
- With `CSF_ISOLATED_WORK_DIR` supplied, it verifies that caller-owned prepared
  stack instead. It never starts, stops, resets, or deletes it, and every label
  says prepared-stack/database verification rather than clean replay.
- Either way it validates the marker, generated config, and
  `lets-assist-browser.sh` without executing or sourcing that file, then loads
  only the exact bytes that passed validation through
  `node scripts/local-dev/dv-local-env.mjs --print-app-env`, which re-reads its
  own held descriptor and rechecks inode/size/digest before handing anything off.
  Live status/credential validation and seeding run only after that.
- pgTAP runs directly against the same already-running work directory, then the
  fictional platform and DV fixtures are seeded, then `csf:test:workflows` runs
  against them as a database-only check.
- Teardown failure is never swallowed. A gate failure keeps its own status while
  cleanup evidence is still printed; a clean gate with a failing marker-bounded
  stop exits nonzero.
