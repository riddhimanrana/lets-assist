# Deployment boundaries

Feature branches target `development`. Each pull request must pass hosted CI.
Only the merged integration candidate receives the hosted Development deployment
and acceptance run described below. `development` is not Production, and a
ready deployment is not proof that the intended alias, environment variables,
database history, or authenticated journeys are correct.

Promotion from `development` to `main` is a separate release operation. It requires explicit authorization and Production-specific migration, provider, and browser checks. Repository cleanup does not authorize Production database mutation, alias reassignment, or release claims.

Supabase changes follow [the deployment workflow](supabase-deployment.md). Private-plugin changes follow [the two-repository workflow](private-plugins.md).

## Cost-controlled release path

Build and test feature work locally. Keep related fixes on worktrees or local
branches until one release candidate is ready. The root repository uses one
integration pull request into `development`, followed by one Production pull
request from `development` into `main`. If the private plugin changes, merge one
private integration pull request first and update its exact gitlink in the root
integration pull request.

Vercel Git deployment is disabled for every branch except `development` and
`main`. The repository-owned ignored-build command applies a second check:

- `main` always builds after the Production pull request merges.
- `development` builds when the final commit contains
  `[deploy-development]`, or when GitHub merge-commits a branch named
  `codex/csf-integration-*`.
- Ordinary `development` commits and feature branches skip dependency install
  and application build.

Put `[deploy-development]` in the integration pull request title when using a
squash or rebase merge. A merge commit from `codex/csf-integration-*` needs no
extra marker. The hosted CSF acceptance workflow uses the same rule, so one
Development build and one acceptance run cover the exact release SHA. Manual
acceptance dispatches may check a SHA that already has a successful Vercel
status. They do not create another deployment.

Do not open a new pull request or push a release marker for each fix. Amend the
same local candidate, run focused checks as it changes, then run the full local
gate once before the integration pull request. Production still requires its
separate migration, provider, and browser gates.

Speed Insights Plus is a Vercel account subscription, not a repository flag.
The application keeps the Vercel-only Speed Insights client so the free project
telemetry boundary remains intact. Turning Plus on or off must not require a
source commit or deployment.
