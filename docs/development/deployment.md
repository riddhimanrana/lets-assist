# Deployment boundaries

Feature branches target `development`. Each pull request must pass hosted CI.
Only the merged integration candidate receives the hosted Development deployment
and acceptance run described below. `development` is not Production, and a
ready deployment is not proof that the intended alias, environment variables,
database history, or authenticated journeys are correct.

Promotion from `development` to `main` is a separate release operation. It requires explicit authorization and Production-specific migration, provider, and browser checks. Repository cleanup does not authorize Production database mutation, alias reassignment, or release claims.

Supabase changes follow [the deployment workflow](supabase-deployment.md). Private-plugin changes follow [the two-repository workflow](private-plugins.md).

## App-only Production release

Use `Deploy accepted Production app` when Production already has the exact
schema required by a hosted-accepted application. This path does not require an
external drive, logical export, restore, or a `PRODUCTION_READONLY_URL` secret.
It does not run migrations, change database write controls, approve imports, or
enable CSF workers. The database-cutover workflow remains separate.

The dispatch takes full `release_sha` and `hosted_development_sha` values and
`deploy-app-only:<release SHA>` confirmation. The controller runs from reviewed
`main`; the application checkout uses the explicit release SHA. That SHA must
be reachable from `main`, contain the accepted SHA, and have the identical Git
tree. A workflow-only update does not require another application build in
Development when these application bytes have already passed acceptance.

Before building, the controller verifies the trusted hosted run, successful
quality and database checks, exact private gitlink, and Vercel project. The
existing Supabase management token calls only the read-only query endpoint.
Checks compare every migration version and verify the CSF tables, functions,
grants, indexes, constraints, triggers, staff preference RPC, and absence of an
unresolved application write block. A refused query stops the release without
falling back to a writable query endpoint.

The job builds once with Production settings, stages the prebuilt output with
all four CSF workers disabled, and checks the application SHA, environment,
database, deep table reads, login, and protected route authentication. It saves
only deployment IDs and commit identities before moving the public alias. A
failed promotion or public check restores the prior app deployment. No schema
rollback runs. If cancellation prevents verification, inspect the retained
`app-only-release-<run ID>` receipt and verify the alias before another dispatch.
Staged and public-domain machine checks use the existing automation bypass
header. They do not disable the firewall or prove ordinary browser access;
signed-in browser acceptance remains a separate check.

This app-only path supersedes the schema-first requirement below only when its
exact live schema checks pass. Database changes still use the separately
reviewed schema workflow. A successful app release does not prove officer
imports or provider delivery.

## Cost-controlled release path

Build and test feature work locally. Keep related fixes on worktrees or local
branches until one release candidate is ready. The root repository uses one
integration pull request into `development`, followed by one Production pull
request from `development` into `main`. Merge that Production pull request with
a merge commit so the hosted-accepted Development SHA remains an ancestor of
`main` and the resulting tree stays identical. Squash and rebase promotion are
not supported by the Production schema gate. If the private plugin changes,
merge one private integration pull request first and update its exact gitlink
in the root integration pull request.

Vercel Git deployment is enabled only for `development`. It is disabled for
feature branches and `main`. The repository-owned ignored-build command applies
a second check:

- `main` never builds from a Git push. The protected Production workflow owns
  the one schema-first application release.
- `development` builds when the final commit subject contains
  `[deploy-development]`, or when GitHub merge-commits a branch named
  `codex/csf-integration-*`.
- Ordinary `development` commits and feature branches skip dependency install
  and application build.

Put `[deploy-development]` in the final commit subject for either a squash or
rebase merge. A marker in the body or pull request title alone is not
sufficient. A merge commit from `codex/csf-integration-*` needs no extra marker. The hosted
CSF acceptance workflow uses the same rule, so one
Development build and one acceptance run cover the exact release SHA. Manual
acceptance dispatches may check a SHA that already has a successful Vercel
status. They do not create another deployment.

The Production pull request must still use a merge commit. Its merge creates no
Vercel deployment. The protected workflow verifies the accepted Development
ancestry and tree, confirms the Vercel project and Production Branch, pulls
Production settings, and builds the exact application bytes on the GitHub
runner. Before it pushes the schema, the workflow stages the exact prebuilt
application without moving domains, proves its embedded SHA, blocks application
writes, promotes the verified maintenance deployment, and verifies the
Production alias. It then applies and verifies the database migrations and
checks the staged application's environment, database, and deep table reads.
The workflow promotes that application,
verifies that `lets-assist.com` points to its deployment id, and only then
reopens application writes.

Do not re-run a failed or cancelled Production workflow. Recovery receipts bind
to one run attempt, so later attempts stop before provider access. The separate
failed-release workflow requires Production Environment approval, keeps writes
blocked, and restores the verified maintenance deployment. Start a fresh
Production dispatch only after that reconciliation succeeds.

Do not open a new pull request or push a release marker for each fix. Amend the
same local candidate, run focused checks as it changes, then run the full local
gate once before the integration pull request. Production still requires its
separate migration, provider, and browser gates.

Speed Insights Plus is a Vercel account subscription, not a repository flag.
The application keeps the Vercel-only Speed Insights client so the free project
telemetry boundary remains intact. Turning Plus on or off must not require a
source commit or deployment.
