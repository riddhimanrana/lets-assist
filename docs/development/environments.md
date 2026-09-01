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
- `RESEND_API_KEY` is a send-only key scoped to this environment. The deployed
  application does not load a Resend management key.
- `RESEND_WEBHOOK_SECRET_KEYRING` is versioned JSON with `activeKeyId` and
  `keys`. Keep the old `RESEND_WEBHOOK_SECRET` for one cutover release, then
  remove it only after the replacement endpoint records verified events.
- `CSF_RESEND_TOPIC_CONFIGURATION` contains versioned, non-secret topic IDs by
  organization and audience. Create topics in an operator-only process, then
  place only their IDs in the application environment.
- `ENCRYPTION_KEYRING` is versioned JSON with `activeKeyId` and `keys`. Keep
  `ENCRYPTION_KEY` while legacy OAuth ciphertext remains. Successful Google
  credential reads rewrite legacy or retained-key values under the active key.
  The key ID `legacy` is reserved and cannot appear in the keyring.
- `CSF_OPERATIONAL_ALERTS_ENABLED=true` lets the worker emit count-only alerts
  for communication backlog and unresolved import batches. No tenant, student,
  message, or workbook content enters those alerts.
- `PROJECT_FEEDBACK_WORKER_ENABLED` and
  `PAPER_SIGNUP_NOTIFICATION_WORKER_ENABLED` remain unset until their own
  Development acceptance is complete.

No Production credential is a valid generic Preview fallback.

Before retiring an encryption key, replace `<active-key-id>` below with the
`ENCRYPTION_KEYRING.activeKeyId` value and run this count-only database check.
It counts both legacy ciphertext and `v2:` ciphertext written under a retained
key. Both counts must be zero. Do not select or log ciphertext values.

```sql
WITH active_key AS (
  SELECT '<active-key-id>'::text AS key_id
)
SELECT
  count(*) FILTER (
    WHERE access_token IS NOT NULL
      AND (
        split_part(access_token, ':', 1) <> 'v2'
        OR split_part(access_token, ':', 2) <> active_key.key_id
      )
  ) AS access_tokens_needing_rotation,
  count(*) FILTER (
    WHERE refresh_token IS NOT NULL
      AND (
        split_part(refresh_token, ':', 1) <> 'v2'
        OR split_part(refresh_token, ':', 2) <> active_key.key_id
      )
  ) AS refresh_tokens_needing_rotation
FROM public.user_calendar_connections
CROSS JOIN active_key;
```

After both counts reach zero, wait at least ten minutes after the release that
starts issuing `v4` Google OAuth state. This lets every `v3` authorization
attempt expire before removing `ENCRYPTION_KEY`. New attempt digests use the
active key ID, and callbacks select that ID from the returned state shape, so
later key rotations retain only the named key for the attempt TTL.

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
