# CI pipeline

`.github/workflows/ci.yml` is the `Code quality` workflow. It produces the one
required status check, `ci-gate`. This page describes its jobs, when each one
runs, how the test suites are split across runners, and the two local commands
that mirror it.

## Job graph

```text
static-checks        \
unit-tests (n/N)      +--> pr-quality or full-quality --+
production-build     /     (the build is full path only) |
                                                         +--> ci-gate
database-validation  \                                   |
csf-browser (n/4)     +--> db-replay-validation ---------+
                           (full path only)
```

| Job id                 | Check name                     | Runs                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static`               | `static-checks`                | Agent and tool audit, dependency audit, formatting, seed safety, lint, plugin and host boundary, plugin application contracts, type check, CI tooling tests. On the full path it also runs the plugin application gates, the plugin SDK tests, and the signed release integration tests. |
| `unit`                 | `unit-tests (n/N)`             | One share of the unit tests. Two runners on the short path, three on the full path.                                                                                                                                                                                                      |
| `build`                | `production-build`             | `bun run build`. Full path only.                                                                                                                                                                                                                                                         |
| `quality`              | `pr-quality` or `full-quality` | No repository code. Fails unless `static`, `unit`, and (on the full path) `build` succeeded.                                                                                                                                                                                             |
| `database`             | `database-validation`          | One isolated Supabase stack: release catalog check, pgTAP, decision release timeout, join-code backfill, hours lock concurrency, seed, CSF workflows, scale and cleanup, cron auth and shape. Full path only.                                                                            |
| `browser`              | `csf-browser (n/4)`            | One isolated Supabase stack per runner, seeded the same way, then one quarter of the CSF Playwright suite. Full path only.                                                                                                                                                               |
| `db-replay-validation` | `db-replay-validation`         | No repository code. Fails unless `database` and every `browser` shard succeeded. Full path only.                                                                                                                                                                                         |
| `ci-gate`              | `ci-gate`                      | No repository code. Needs every job above and checks each result.                                                                                                                                                                                                                        |

Every job that checks out code repeats the same opening steps: require the
private submodule key, check out the root, check out the exact private gitlink
with `persist-credentials: false`, and run `plugin:submodules:check:strict`
before any other repository command.

`full-quality` and `db-replay-validation` are the two check names that release
verification reads (`scripts/production/app-release-checks.mjs`). Each used to
be one job. Each is now a summary that succeeds only when every job behind it
succeeded, so a release still requires the same work.

`ci-gate` accepts two results and nothing else. A job that applies to the event
must be `success`. A job that does not apply must be `skipped`. A failed job, a
cancelled job, or a full-path job that was skipped on the full path fails the
gate. `scripts/ci/pipeline-mode.test.mjs` fails if a job is added to the
workflow without being added to the gate.

## What runs when

| Event                                  | Path  | Jobs                                                                    |
| -------------------------------------- | ----- | ----------------------------------------------------------------------- |
| Pull request (not a draft)             | Short | `static`, `unit` (2 shards), `quality` as `pr-quality`, `ci-gate`       |
| Draft pull request                     | None  | Every job is skipped, as before                                         |
| Queued merge (`merge_group`)           | Short | The same jobs as a pull request                                         |
| `workflow_dispatch`                    | Full  | Every job. `unit` uses 3 shards and `quality` reports as `full-quality` |
| `workflow_call` (Production preflight) | Full  | The same as a manual dispatch                                           |

The workflow has no `push` trigger. A merge to `development` or `main` does not
start it. The full path runs when someone dispatches `Code quality` for the
integrated candidate, or when `deploy-schema.yml` calls it.

A queued merge takes the short path on purpose. The queue tests the commit that
would land, so the short gate proves the merged result still passes what the
pull request passed. The full path is a release decision that runs once on the
integrated candidate. Its check is named `pr-quality` so release verification
cannot read a queued short run as a full one. On a queued merge the affected
unit tests compare against `github.event.merge_group.base_sha`, and the private
plugin branch is taken from the queue ref because a queued merge has no
`base_ref`.

The `merge_group` trigger does nothing until the merge queue is enabled in the
repository settings. That setting is not part of this change.

## How sharding works

### Unit tests

`scripts/run-tests.mjs` accepts `--shard=<index>/<total>`. It builds the full
inventory for the invocation, removes duplicates, sorts it by code unit (never
by locale), and gives each shard the files whose position is congruent to its
index. The shards are disjoint and together cover the inventory, whatever order
discovery returned the files in. Shard sizes differ by at most one file.

A shard changes which files run and nothing else. A file in a named group still
runs with that group's arguments. An ordinary file still runs in the shared
batch with the `server-only` preload. A file that calls `mock.module` still gets
its own Bun process.

- `bun run test --shard=2/3` runs the second third of the full suite.
- `bun run test:affected <base-sha> --shard=1/2` runs half of the affected set.
- Add `--list` to `node scripts/run-tests.mjs` to print the files instead of
  running them.

An invalid value such as `0/2`, `3/2`, or `--shard 1/2` is rejected. A run that
discovers no test files still fails, sharded or not. A shard with nothing to run
because there are fewer files than shards logs that and passes.

The workflow passes `${{ matrix.shard }}/${{ strategy.job-total }}`, so the
total can never disagree with the number of runners.

### Browser tests

The `browser` job runs `bun run csf:test:e2e --shard=<n>/4`, which reaches
Playwright's own `--shard`. Each runner allocates its own run identity, starts
its own isolated stack, and loads the same fixtures. No two shards share a
database. Inside a runner the suite still uses one worker and
`fullyParallel: false`. Those settings were not raised, because the specs share
one seeded dataset and nothing shows they are safe to run side by side on it.

Each shard writes evidence under its own `CSF_E2E_RUN_ID` and uploads it as
`csf-browser-<run>-<attempt>-shard-<n>`. Each runner always stops its own stack.

The two fixture checks that need only Chromium (account ownership review and
attendance match options) run on shard 1.

Splitting the suite across fresh stacks assumes no spec depends on rows left by
a spec in another file. The specs create and clean up their own prefixed
records, and several are written to tolerate other specs' leftovers, but this
was read from the source and not proven by a run. The first full run after this
change is the proof. If a spec fails only when sharded, move it next to the spec
it depends on or make it create what it needs.

## Local commands

### `bun run ci:preflight`

Runs the pull request gate on your machine. It reads the step list from
`ci.yml`, so it cannot drift from the workflow. It evaluates the workflow's own
conditions for a pull request, expands the shard matrix, and prints which steps
it skipped because they need a runner: checkouts, tool setup, the secret check,
the `apt` install, and the result summaries.

Commands that several jobs share (the strict gitlink check and the dependency
install) run once, first. After that each job is a lane. Lanes run side by side
as they do in CI. Steps inside a lane run in workflow order. The unit shards
share your working tree, so they run one after another.

It prints one line per step with the result and the time, prints the last 40
lines of any step that failed, writes full logs under `.artifacts/ci-preflight/`,
and exits non-zero if any step failed.

- `--base <sha-or-ref>` sets the base for the affected-test step. The default is
  the merge base with `origin/development`. Nothing is fetched.
- `--serial` runs the lanes one after another.
- `--list` prints the plan without running it.

Three differences from CI remain. The affected-test step selects its scope from
committed changes, as the gate does, so uncommitted edits do not widen it. The
dependency audit contacts the package registry. `ripgrep` must already be
installed, because the step that installs it is runner-only.

### `bun run ci:pins`

Reports every hand-maintained pin that is out of date, so one run shows
everything that would fail a push.

It treats two kinds of pin differently.

Derived pins are a function of the tree. `bun run ci:pins --write` regenerates
them:

- the host build surface, `lib/plugins/host-build-surface.generated.json`;
- the migration digest list, `scripts/production/migration-digests.mjs`. This
  file has no generator and is append-only. `--write` appends the missing
  entries and leaves every existing byte in place. A migration whose bytes no
  longer match its recorded digest is reported as an error and never rewritten.

Review pins record that a person looked at something. The command never writes
them. For each stale one it prints the file, the value recorded now, the value
the tree calls for, and the document that says what the review must cover:

- the advisory exception hashes in `scripts/security/braces-exception.mjs`
  ([dependency security](dependency-security.md));
- the accepted release catalog in `scripts/production/app-release-catalog.mjs`
  (`scripts/production/final-schema-manifest.md`);
- the source maintainability baseline in
  `scripts/source-maintainability-baseline.json`
  ([source maintenance](source-maintenance.md)).

The command exits non-zero while anything is stale.

`scripts/run-tests.mjs` is one of the files the advisory exception pins, because
it passes glob patterns to a package that depends on `braces`. Any edit to it,
including the shard option, changes its hash and needs that review.

## Caching

No cache step is in the workflow yet. Caching needs `actions/cache`, which no
workflow in this repository uses, so there is no reviewed commit to pin it to.
The inputs are ready for it:

- `bun run typecheck` writes its incremental state to
  `.artifacts/typescript/tsconfig.tsbuildinfo`. It reports the same diagnostics
  as a non-incremental run, including an error caused by a change in a file the
  failing file imports.
- `bun run format:check` already keeps its cache in `.artifacts/prettier/.cache`.
- Playwright downloads Chromium to `~/.cache/ms-playwright`. Key that cache on
  the `@playwright/test` version in `bun.lock`.

ESLint's cache was left off. Its results are stored per file, and one enabled
rule (`@next/next/no-html-link-for-pages`) reads other files, so a cached pass
could outlive the change that should fail it.

`node_modules` is not cached because the frozen install takes a few seconds.
Test results are never cached.

## Not done here

### Maintenance cutover only for permission-contracting migrations

Today a root change that contracts database permissions goes through the
four-phase [Development maintenance cutover](development-cutover.md), and the
choice to use it is made by hand. The proposal is to detect that case
automatically. A check would inspect the migrations a pull request adds and flag
any that revoke a privilege, drop or narrow a policy, or remove a grant that the
deployed application still uses. Only a flagged pull request would require the
cutover. Every other merge would deploy on merge. The detection has to fail
closed: a migration it cannot classify counts as contracting.

### Validating a root and plugin pull request as a pair

A root pull request must point at a commit that is already merged in the plugin
repository, and the plugin repository type checks against the root's
`development`. A change that spans both therefore blocks itself. The proposal is
to let a root pull request whose plugin pointer names a commit on an open plugin
pull request run its checks against that commit, so the two can be validated
together. The merge rule would not change. The root pull request still could not
merge until the pointer names a commit merged in the plugin repository, so the
strict gitlink check stays the last word.
