# Development environments

Choose the environment before running commands. The shared local and isolated CSF stacks are different databases and must not be mixed.

## Runtime prerequisites

- Node.js `22.23.2`, pinned in `.node-version`; `package.json` accepts the supported Node 22 line only.
- Bun `1.3.14`, pinned in `packageManager` and CI.
- Supabase CLI `2.111.0`, pinned by the isolated-stack scripts and workflows.

CI installs the declared Node runtime explicitly before Bun so every `node`-backed script uses the same supported runtime as hosted application code.

| Environment         | Purpose                                    | Start                                       | Data                                         | Production impact                       |
| ------------------- | ------------------------------------------ | ------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| Shared local        | Platform and non-CSF work                  | `bun run supabase`, then `bun run dev:next` | Deterministic fictional platform/DV fixtures | None                                    |
| Isolated CSF local  | CSF development and acceptance             | `bun run dev`                               | Namespaced fictional CSF fixture             | None                                    |
| Development preview | Hosted integration proof for `development` | CI/Vercel/Supabase workflow                 | Development-only resources                   | None when correctly scoped              |
| Production          | Live product                               | Release from `main`                         | Live data                                    | Explicit release authorization required |

## Shared local

Run `bun run supabase`, wait for migration/seed/health verification, then start `bun run dev:next` in another terminal. This stack does not seed CSF. See [`scripts/local-dev/README.md`](../../scripts/local-dev/README.md).

## Isolated CSF local

Run `bun run dev`. The launcher owns a dedicated project name, ports, containers, volume, network, secrets, and teardown marker. Do not run shared-stack reset commands against it. One launcher-owned Next.js server must serve both `localhost` and `127.0.0.1` acceptance origins.

## Development preview

Hosted proof requires the actual `development` deployment, branch-scoped environment variables, a Development database/migration history, and authenticated browser acceptance. Local tests do not establish those facts.

The deployment build runs `scripts/verify-deployment-environment.mjs`. Every
non-Production Vercel environment must name the exact expected non-Production
Supabase host or project ref; a missing value, an unexpected host, HTTP, or either
known Production endpoint fails the build. The supported matrix is:

| Vercel scope                 | Database                                                                  | Email/provider posture                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `development` branch Preview | Persistent Development Supabase only                                      | Mailpit by default; Resend only with an explicit transport override, `RESEND_DEV_FROM_DOMAIN`, and test/allowlisted recipients |
| Other PR Preview             | Ephemeral branch with an exact expected ref, or no database/build failure | No provider access by default                                                                                                  |
| Production                   | Production Supabase, bound to `main` only                                 | Production credentials; promotion is separately authorized                                                                     |

Development Resend variables are deliberately additive rather than fallbacks:

- `EMAIL_TRANSPORT=resend` opts a Development Preview into provider delivery.
- `RESEND_DEV_FROM_DOMAIN` must exactly match the sender domain.
- `RESEND_DEV_RECIPIENT_ALLOWLIST` is a comma-separated synthetic/authorized
  allowlist; `@resend.dev` test addresses are always accepted.
- `PROJECT_FEEDBACK_WORKER_ENABLED` and
  `PAPER_SIGNUP_NOTIFICATION_WORKER_ENABLED` remain unset until their own
  Development acceptance is complete.

No Production credential is a valid generic Preview fallback.

Seed only a confirmed non-Production Supabase branch with the supported synthetic
fixture wrapper:

```sh
CSF_LOCAL_TEST_PASSWORD='<run-scoped synthetic password>' \
EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF='<target branch project ref>' \
SUPABASE_BRANCH_ID='<target branch UUID>' \
SUPABASE_PARENT_PROJECT_REF='fotdmeakexgrkronxlof' \
bun run csf:seed:hosted-development
```

`SUPABASE_PARENT_PROJECT_REF` names the Supabase parent solely for the read-only
branch metadata lookup; it is expected to be `fotdmeakexgrkronxlof`. The wrapper
still refuses that Production ref as the seed target, verifies both returned API
and database hosts against the separate target branch ref, and removes its
temporary fixture seam in `finally`.

## Production

`main`, Production Supabase, Production Vercel aliases, live OAuth configuration, and live provider credentials are outside routine cleanup/refactor work.
