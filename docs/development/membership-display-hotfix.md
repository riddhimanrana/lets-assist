# Isolated membership display hotfix

This one-time path releases PR879's recorded-membership display correction on
Production schema688. It does not deploy v4, run migrations, alter the private
fix, create members or award points. The ordinary app-only and security-only
workflows and verifier remain unchanged.

The release is restricted to Main baseline `415b8060`, private gitlink
`7ded413a`, the four original private display/test files, and the explicit
root acceptance/controller path list. Dependency repairs are restricted to the
exact SHA-256-bound package/lockfile: `sanitize-html@2.18.1`,
`follow-redirects@1.16.1`, `next@16.4.1` with its matching Next tooling,
`dompurify@3.4.17` and `nodemailer@10.0.10`, including their required transitive
updates. The latter three updates address the production audit failure in
PR881; Next16.4.1 is the earliest patched16.x release for the reported advisories.
Three additional byte-bound files give the historical security-only and
schema-only tests their original reviewed Git snapshots and make those snapshots
available in CI. Both runtime verifiers and their accepted bytes remain unchanged.
Any migration, other dependency change, application
route, additional private change, changed Development baseline or changed
Production baseline refuses the operation. Full CI must pass on the exact new
Main SHA before any Preview is created.

Both protected jobs validate the dispatch identity and exact controller SHA in
trusted workflow shell before checkout or private/provider credential use. All
checkouts use `github.sha`; an input cannot select different executable code.
Provider credentials are scoped to their individual steps.

`Deploy verified membership display fix` has two separately protected jobs.
The Development job creates exactly one immutable Preview with custom-domain
assignment disabled. It inherits existing Preview credentials; no database or
OAuth credential is copied into deployment configuration. Public context binds
the backend to fixed Development `ocbuygudvarsuxijxhau`. Both shared aliases
remain unchanged. Missing or incompatible existing Preview configuration stops
the run; do not add credentials or relax isolation to continue.

The exact application has688 migration files. Its full CI tests schema688;
the hosted Preview uses Development's independently pinned729 ledger and full
1441-object catalog. These evidence boundaries are recorded separately: this
does not claim hosted schema688 or that the shared Development branch contains
the hotfix. Unknown backend drift, access failures or incompatible APIs fail
acceptance rather than changing the database.

The existing full hosted suite is retained:90 member and10 officer Auth sign-ins,
fifteen-minute load, browser navigation,35 synthetic staff-view preference saves
(five warmups and30 measured), a possible restoration save, and all
latency/error/Web Vitals/heap thresholds. The100 successful sign-ins create
Auth/session state; rate-limited attempts use the suite's existing bounded retry
policy. This is not read-only acceptance. It uses only the pre-existing
`csf-load-fixture` organization/accounts with their verified fixture metadata.
There is no fixture provisioning or install/entitlement update. If that fixture
is absent or incompatible, stop. The explicit fixture confirmation authorizes
only those existing synthetic preference/session operations in Development;
it never authorizes real member, point, decision, import or provider writes.
Google Sheets writeback and all nine workers reported by deep status remain
disabled, including organization Sheets and Calendar sync. The actual worker
flags are overridden. Acceptance requires healthy environment/database/deep
table checks and the exact all-disabled worker warning; it refuses any enabled,
unknown or missing worker state rather than demanding an operational status
that would require an enabled worker.

The catalog read uses the existing protected `SUPABASE_ACCESS_TOKEN` when
available. When it is absent, the same pinned read-only query can use the
existing `DEVELOPMENT_DATABASE_URL`. This is an owner-authority connection in
an explicit read-only transaction, not a new read-only role. Direct and session
pooler connections are restricted to the fixed Development project, database
`postgres`, port5432 and hostname-verified TLS (`verify-full`). The public
Development CA is an explicit reviewed repository file; an absent or untrusted
CA refuses the connection. Existing URI `require`/`verify-ca` modes are upgraded,
never passed through. Credentials stay out of command arguments
and Vercel configuration. A denied Management API read does not fall through to
another transport. Missing credentials, a failed query or unknown output remain
fatal before Preview creation. The sanitized failure phase distinguishes initial
configuration refusal from a potentially attempted create; never retry an
uncertain create without provider inventory reconciliation.

The public CA was supplied by the release owner from Development's database
settings, whose SSL Certificate link points to
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`.
Its exact supplied PEM is retained in
`scripts/hosted-development/membership-display-development-ca.pem`.
It is a self-signed RSA-2048 CA named `Supabase Root 2021 CA`, valid from
April28,2021 through April26,2031. Its DER SHA-256 fingerprint is
`807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`;
its PEM SHA-256 is
`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
Certificate parsing and self-signature checks establish the supplied file's
integrity, not a successful live database connection. The protected hosted job
must still prove the server chain and hostname with `verify-full`.

The Production job requires that same workflow run's successful hosted job
and mandatory completion steps. CI, a Vercel check or a forged commit status
cannot replace it. It repeats exact Main/source/full-CI checks, verifies the
live Production688 catalog read-only, then retains the existing immutable
staging, deep smoke, unchanged-alias guard, terminal-operation verification and
scoped previous-deployment rollback sequence. Production workers stay off on
the new SHA until their existing separately reviewed activation process; do
not claim worker restoration or live account acceptance from deployment alone.

The Production job downloads the immutable Preview receipt from this same run.
After its protected review wait, before staging, and immediately before promotion,
it proves the pinned live Production commit and exact deployment ID still match
that receipt. A replacement deployment with even the same commit is refused.
Successful source/hosted verification is written to a private JSON file and its
artifact upload is mandatory. Production catalog reads and application deployment
do not write Production database records; the separately scoped synthetic
preference/Auth operations occur only in Development.

After review and exact-head CI, merge the controller repair normally without a
deployment marker. Run full CI on the resulting exact Main SHA. Only then request one new
dispatch from Main of `.github/workflows/deploy-membership-display.yml` with:

```json
{
  "release_sha": "<actual reviewed Main SHA>",
  "fixture_confirmation": "test-existing-development-fixture:<same SHA>",
  "production_confirmation": "deploy-membership-display:<same SHA>"
}
```

Retain both existing Development and Production environment reviews. No new
permissions, credentials, reviewer settings, waiver or security-only exception
is introduced. Workflow dispatch is not exposed by the current cloud connector;
the previously denied CLI route must not be retried without new evidence.
Dispatch and protected reviews require an independently authorized GitHub
browser session. Publishing source does not grant dispatch or approval.

Retain `membership-display-preview-<run>` and the ordinary staged/recovery
artifacts. Attempt1 only: a lost create response, cancellation or uncertain
promotion requires inspection of that run's recorded deployment and actual
aliases before a fresh dispatch. Never use rerun or create a replacement build
to conceal an unknown outcome. No domain restore is needed for the acceptance
Preview because it never owns either shared alias.

Rendered-label/default-term regressions and original full CI support the fix;
verification on the affected member's live account still needs an authorized
session after release. This repair does not establish semester completion or
resolve historical point-credit uncertainty.
