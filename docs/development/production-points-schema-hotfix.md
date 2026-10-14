# One-time Production points schema hotfix

For the isolated `20261013071100` points hotfix only, the `Apply accepted
forward migrations` workflow has a schema-only acceptance mode. Enter the exact
current Production application SHA as `production_app_sha`, leave
`hosted_development_sha` and all waiver fields empty, and enter
`schema-only:<Production app SHA>:<release SHA>` as
`schema_only_confirmation`. Keep the ordinary
`apply-forward-migrations:<release SHA>` confirmation. The release SHA must be
the reviewed `main` workflow commit. This mode is unavailable for an
application or dependency release.

The verifier compares the release commit to the app SHA currently served by the
Production alias. It reads the bound Vercel project, confirms the alias points
to one ready Production deployment produced by the app-only release controller,
and checks its `gitSource` repository and commit against the exact app SHA. The
workflow pins the verifier's Git blob before execution; the verifier pins the
complete reviewed hotfix contents. It rejects changed application code, the
private gitlink, dependency files, and migrations other than the reviewed hotfix.

The exact release SHA also needs a successful full CI workflow with paired
quality and database replay checks, including isolated migration replay and
browser journeys. The workflow repeats the live app identity check after the
database transaction. The exact migration digest, Production ledger, worker
shutdown, publication lease, postmigration catalog and no-retry guards remain
in force. A failed dependency audit blocks full CI and this mode; no waiver can
stand in for it. This path does not deploy an app, run a real student donation,
or alter the Development branch.
