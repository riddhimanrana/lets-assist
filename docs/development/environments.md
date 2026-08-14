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
