# Developer onboarding

The ordered path from a fresh clone to a running environment and a green gate. This is a spine: it sequences and links the detailed guides rather than repeating them.

## 1. Toolchain

| Tool | Version | Pinned by |
|---|---|---|
| Node.js | `22.23.2` | `.node-version` (`package.json` accepts the Node 22 line, `>=22.22.0 <23`) |
| Bun | `1.3.14` | `packageManager` in `package.json`, and CI |
| Supabase CLI | `2.111.0` | `scripts/local-dev/require-supabase-cli-version.sh` |
| Docker | any current release | Required for every local database |

**Use Bun.** Not npm, not pnpm, not Yarn. CI installs Node explicitly before Bun so every `node`-backed script runs on the same runtime as hosted application code.

## 2. Clone with the submodule

The DVHS CSF and DV Speech & Debate implementations live in a **private** submodule, `lib/plugins/private`. The public registry statically imports it, so a missing submodule is a build failure by design — not something to work around.

```bash
git clone --recurse-submodules https://github.com/riddhimanrana/lets-assist.git
```

Already cloned without it:

```bash
bun run plugin:submodules:init
```

Access to `riddhimanrana/lets-assist-plugins` is required. Without it you can read the platform but cannot build.

```bash
bun install
```

## 3. Pick an environment before you run anything

Four environments, deliberately distinct. Choosing wrong wastes an afternoon.

| You are working on | Use | Start |
|---|---|---|
| Platform, DV, anything non-CSF | Shared local | `bun run supabase`, then `bun run dev:next` |
| DVHS CSF | Isolated CSF local | `bun run dev` |
| Proving hosted behaviour | Development preview | CI / Vercel / the Supabase `development` branch |
| — | Production | Not for development work. Ever. |

The two local stacks are **different databases** and must not be mixed. The isolated launcher owns its own project name, ports, containers, volume, network, secrets, and teardown marker; never point shared-stack reset commands at it.

Full detail: [environments](environments.md). Launcher safety rules: [`scripts/local-dev/README.md`](../../scripts/local-dev/README.md). Fictional accounts to log in with: [local accounts](local-accounts.md).

## 4. Know which gate to run

Run the narrowest thing that covers your change, then the gate that owns it.

| Change | Run |
|---|---|
| A single function or component | The focused test file: `bun test path/to/file.test.ts` |
| Any source change | `bun run lint && bun run typecheck && bun run test` |
| A migration, RLS policy, or anything schema-shaped | `bun run db:test:redesign` — **this is the real gate** |
| CSF behaviour | `bun run csf:test:workflows`, then `bun run csf:test:e2e` |
| DV behaviour | `bun run dv:test:db`, then `bun run dv:test:e2e` |
| Before opening a PR | `bun run build` as well |

`bun run db:validate` is **not** the schema gate despite the name — it checks migration filenames, duplicate timestamps, and a replay, and it prompts interactively. `db:test:redesign` is the one that spins a fresh isolated stack, replays every migration, and runs the whole pgTAP suite plus the architecture, isolation, registry, contract, and browser checks.

More: [testing](testing.md).

## 5. Working rules that will bite you

Read [`AGENTS.md`](../../AGENTS.md) in full before changing anything. The four that catch people first:

**Migrations are append-only.** Never edit, squash, or delete a historical migration. Fix forward and add pgTAP coverage. A migration that may have run remotely can never be removed.

**Push the submodule before moving the gitlink.** Change the plugin repository, push it, merge it there, *then* update the root gitlink. Reversing the order means CI cannot check out the tree — every job dies at submodule checkout with `upload-pack: not our ref`, before running a single gate, and every result you see afterwards is vacuous.

**Base work on `development`.** Not `main`. `main` is Production's branch and is far behind.

**Plugin data is server-only.** The `plugin_data` schema is unreachable from the browser by construction. Reaching it means a server-side path that authorizes first — see [data boundaries](../architecture/data.md).

## 6. Common failure modes

| Symptom | Cause |
|---|---|
| `bun run build` fails before `next build` | The strict submodule check: dirty submodule tree, wrong branch, or unpushed commits |
| A red build that the code does not explain | A stale `.next-csf-isolated/`. Clear it before believing the error |
| The shared Supabase stack will not start | Orphaned isolated CSF stacks holding ports. `docker ps --filter name=supabase_`, then tear them down with `scripts/local-dev/stop-dvhs-csf-isolated-stack.sh` (dry-run first) |
| Local passes, CI fails | Check that CI got past submodule checkout at all before debugging the code |
| CSF e2e cannot find its stack | The Playwright config refuses ambient stacks by design and reads its secret from the launcher's work dir. Let the config start the stack |

## 7. Where things live

| Path | Contains |
|---|---|
| `app/` | Routes, route handlers, Server Actions |
| `components/` | Shared UI |
| `lib/supabase/` | Browser, server, and admin clients |
| `lib/plugins/` | Public plugin control plane and contracts |
| `lib/plugins/private/` | The private submodule — never replace it with copied source |
| `services/` | Framework-independent integrations and domain services |
| `supabase/migrations/` | The immutable forward migration ledger |
| `supabase/tests/` | pgTAP database tests |
| `scripts/` | CI, local environment, seed, and audit tooling |
| `tests/e2e/` | Browser acceptance suites |
| `.artifacts/` | Generated evidence. Git-ignored, never committed |

## 8. Read next

- [AGENTS.md](../../AGENTS.md) — the operating rules, in full
- [Platform architecture](../architecture/platform.md), [plugin boundaries](../architecture/plugins.md), [data boundaries](../architecture/data.md)
- [Testing](testing.md) and [deployment boundaries](deployment.md)
- [Private plugin development](private-plugins.md) and the [plugin install guide](plugin-install-guide.md)
- Working on CSF: [CSF overview](../csf/README.md), then [invariants](../csf/invariants.md)
- [Cleanup register](cleanup-register.md) and the [current audit register](audit-register-20260810.md) — known open defects

## Known-stale documentation

Corrected where possible; noted here so you do not act on them:

- **`docs/development/supabase-deployment.md`** claims that merging to `main` automatically deploys the schema to Production. **It does not.** The production job in `.github/workflows/deploy-schema.yml` requires a manual `workflow_dispatch` *and* an exact confirmation string. The same file claims CI validates SQL syntax; the step only greps for `SELECT *`, `WHERE 1=1`, and `-- UNSAFE`. It also recommends `supabase db pull`, which [the redesign audit](../architecture/supabase-redesign-audit.md) explicitly forbids.
- **`tests/e2e/csf/README.md`** documents `CSF_E2E_PORT` and `CSF_E2E_BASE_URL` overrides and a fixed port that `playwright.csf.config.ts` no longer supports, plus a stale scenario count.
