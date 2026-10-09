# Signed plugin release integration

Plugin source, release publication, host integration, deployment, and organization installation are separate changes. A private release does not update the platform by itself, and a root integration does not update an organization's installed version.

## Release sequence

1. Change one plugin on a private branch based on private `development`.
2. Update that plugin's runtime manifest version, `release.json`, and changelog. The automatic lane accepts stable `major.minor.patch` versions. The supported install range must still include the version currently served by the root registry.
3. Merge the private pull request into private `development` and validate it there.
4. Promote the reviewed private commit to private `main`, then merge the same ancestry back to private `development`. This is a release action, not ordinary feature work.
5. Create the plugin-scoped tag, such as `dvhs-csf/v1.2.0`, on that exact commit.
6. The private release workflow reconstructs the plugin inputs from Git, generates a CycloneDX SBOM, signs the release manifest with GitHub OIDC and Cosign, publishes immutable GitHub Release assets, and dispatches the root integration.
7. The root workflow downloads assets from the fixed private repository, verifies the signature issuer and tag-bound workflow identity, checks the release tag and private `main` plus `development` ancestry, then independently reconstructs every signed digest.
8. The root workflow validates the exact signed private commit and updates the code-owned release registry. Embedded releases advance the serving gitlink to that commit. Application releases record the signed source separately and preserve the existing root serving gitlink. The workflow generates one forward publication migration plus its exact pgTAP contract and opens a pull request against root `development`. The workflow serializes jobs and refuses a new release while an earlier `codex/plugin-release-*` pull request is open because the migration ledger is global.
9. Root CI, Supabase Preview, and Vercel Preview validate that integration. Merging the root pull request publishes the release contract to Development. It does not deploy or activate an application profile.
10. Run `Deploy signed plugin application` from root `development` with the exact plugin key, application release tag, and `development` environment. Embedded release tags have no child build and are refused with the current application tag from the registry. The workflow verifies the signed release and host allowlist, deploys the recorded prebuilt bytes, checks `/api/health`, and records the deployment in Development Supabase.
11. Enable the organization's application runtime only after the Development deployment is healthy. The embedded version remains the rollback path.
12. Promote root `development` to `main` through the normal production release. Run the same deployment workflow from `main` with `production`. It deploys the same signed build digest and records Production health.
13. In Production organization settings, update the install and enable the application runtime only after the Production deployment is healthy. The control plane resolves that organization to the exact immutable deployment; it does not move every tenant to the newest child deployment.

Production promotion remains a separate root `development` to `main` release. Do not create a private release tag or merge a root integration to `main` as part of routine plugin development.

When a signed plugin requires unpublished host migrations, manually dispatch
`plugin-release-integration.yml` from the root candidate with `candidate_sha`
set to that same full commit SHA. The workflow checks that the commit descends
from current Development, verifies the signed release as usual, and opens one
integration PR containing the host changes and publication. Automatic dispatches
continue to use Development. A candidate from another repository, an older
Development lineage, or a different workflow revision is refused.

## Paired embedded releases

The single-release lane refuses a private commit that changes another published
embedded plugin. When one reviewed commit changes multiple embedded plugins,
prepare and sign a separate release for each changed plugin at that same exact
private commit. Do not publish an intermediate registry record or relax the
single-release tree check to make the first release pass.

Dispatch the existing `plugin-release-integration.yml` workflow from the reviewed
root feature branch. Leave `release_tag` empty and supply `release_tags` as a JSON
array of two through sixteen exact tags, the full `candidate_sha` and the
`existing_pr_number`. The registered entry calls the reusable batch workflow at
that same revision; the new batch file is not a standalone dispatch entry.
The candidate must equal the workflow commit, descend from current Development
and be the current head of that same-repository PR. The workflow updates that
review branch; it does not open another integration PR or merge either branch.

The batch controller verifies each tag-bound Cosign signature, its source and
SBOM digests, exact tag resolution and private main plus Development ancestry.
All releases must be embedded, name one private commit, advance distinct known
plugins and retain the published install contracts. Every changed published
embedded tree must be covered by a verified release. Independent applications
continue through their separate single-release and deployment workflows.

All validation and serving-test planning complete before the first host write.
The controller generates one publication transaction immediately after the
current migration head, with a guarded immutable publication for each plugin,
both registry entries and per-release pgTAP contracts. It updates shared serving
expectations together and moves the gitlink once. No organization install moves.
It does not add the new migration to any accepted catalog or digest allowlist.
Review and prove that generated migration before accepting the new ledger.

Before pushing, the workflow rechecks PR identity and the exact original remote
head. It proves the immutable result commit descends from that candidate and uses
an exact expected-head lease. A forward update, rewind or missing remote branch
refuses the push; the workflow never refreshes the lease to overwrite drift.
Final strict registry, generated host surface, database/browser and hosted
Development checks still apply to the complete pair. After reviewing and accepting
the generated ledger, explicitly dispatch `Code quality` through `ci.yml` for the
resulting branch and verify the run uses the exact reviewed result SHA. A push
authenticated with `GITHUB_TOKEN` does not guarantee ordinary push-triggered CI.
Inspect PR checks too, and approve any pending run only for that exact reviewed
SHA. A workflow push or successful integration job is not final acceptance.

## Application database preflight

The signed application deployment workflow verifies the database before extracting
or deploying the prebuilt artifact. Production must use the committed Production
project ref and `main`. Development must use `development` and the exact repository
variable `CSF_DEVELOPMENT_SUPABASE_PROJECT_REF`. The selected environment's
`SUPABASE_PROJECT_ID` and API origin must match that target. Production accepts
its canonical Supabase origin or the approved `api.lets-assist.com` alias;
Development requires its canonical Supabase origin.

Each GitHub environment must provide its own reviewed `SUPABASE_ACCESS_TOKEN`
with access to that project's management query endpoints. The workflow exposes
this credential only to the trusted database-preflight step. The object catalog
uses the owner-query endpoint inside `BEGIN READ ONLY`, following the existing
Production verifier. That endpoint carries broader authority than the dedicated
read-only endpoint, so review and scope the credential to the selected project.
The controller sends only fixed read queries. It does not pass
it to artifact extraction, Vercel deployment, the child build or the application.
A missing credential blocks deployment. Development credential setup remains
unperformed; the controller does not borrow the protected Production credential.
Configure and review that environment separately before attempting deployment.

The preflight binds the signed `requiredPlatformSchemaVersion` to the published
registry and requires that migration in the accepted host ledger. It reads the
entire applied migration sequence and evaluates the existing exact object catalog
inside a read-only transaction. Missing migrations, unexpected tails and catalog
drift all refuse deployment. Production retains its existing preference-RPC and
application-write-posture checks. A version number alone is insufficient evidence.

A bounded GET of the immutable `plugin_versions` identity then uses the same
API origin and observation credential as the later deployment-recording calls.
It must return one matching published application version, source commit, build
digest and required schema version. This proves that credential can read the
publication on the selected target; it does not simulate or perform the later
write. Provider denials, redirects, timeouts and inconsistent records fail before
Vercel mutation. Logs contain only the verification outcome and public release
coordinates, not provider responses or credentials.

This gate verifies the database at preflight time. It does not replace signed
artifact verification, child runtime health, hosted browser acceptance, or the
separate leased organization activation action.

An automatic run that fails with "required platform schema migration ... is
not present in the root ledger" is this case, not a workflow defect. The
signed release depends on a host migration that has not merged into
Development. Merge the host change first and rerun, or use the `candidate_sha`
dispatch above.

## Operator workflow

For a normal release, the platform owner handles catalog publication and child
deployment. The organization admin sees only the choices that matter to the
organization: consent and install, **Update** when a compatible release exists,
and **Use application** after a healthy deployment exists. Switching back to
the embedded runtime is the first rollback action. Uninstall removes the
control-plane install but retains plugin data. Permanent deletion is a separate
MFA-aware operation and appears only when the manifest declares a complete,
reviewed deletion contract.

If a deployment fails health checks, do not change the install or runtime flag.
If activation fails with an ambiguous response, inspect the durable operation
and audit records before retrying with a new request. Never repair an
organization version with a direct table update or a migration.

The code-owned registry retains only the current application release for each
plugin. After a newer release is integrated, the deploy workflow intentionally
refuses to redeploy an older application release from that branch. The supported
rollback is the organization-level switch to the compatible embedded runtime.
If an old application must be redeployed, restore it through a reviewed release
integration instead of bypassing the registry.

## Vercel topology and plan

The intended topology has two projects in one microfrontend group: the Let's
Assist host and the CSF application. The group claims only the child health and
generated asset paths. Organization application pages remain host-owned so the
control plane can choose an exact deployment per organization and version.

This topology fits Vercel Hobby's two-project microfrontend allowance while
usage stays below its included routed-request quota. Pro is not a code
requirement. It is the recommended operating plan for Production because it
raises deployment and concurrent-build limits, retains runtime logs longer,
and supports paid routed-request overage. Do not create one Vercel project per
ordinary plugin. Use an embedded profile unless independent deployment is
needed; extra microfrontend projects are a separate paid resource.

## Repository credentials

The workflows intentionally fail closed until their scoped secrets exist:

- Private repository `PLUGIN_ROOT_INTEGRATION_TOKEN`: may call `POST /repos/riddhimanrana/lets-assist/dispatches` and nothing else beyond what GitHub requires for that endpoint.
- Root repository `PLUGIN_ROOT_INTEGRATION_TOKEN`: may open pull requests in `riddhimanrana/lets-assist` (Pull requests: write). The root integration workflow uses it only for `gh pr create`. Repository settings do not let `GITHUB_TOKEN` open pull requests, and a pull request opened by `GITHUB_TOKEN` would not start root CI. The branch itself is still pushed with `GITHUB_TOKEN`. One fine-grained token scoped to `riddhimanrana/lets-assist` with Contents: write and Pull requests: write can serve as both secrets. Until the root secret exists, the workflow pushes the integration branch, prints a compare link for opening the pull request by hand, and fails.
- Root repository `PRIVATE_PLUGIN_RELEASE_TOKEN`: read-only access to `riddhimanrana/lets-assist-plugins` contents, commits, tags, and release assets.
- Private and root repository `VERCEL_TOKEN`: may build or deploy the approved child project. It is never exposed to plugin code or release assets.
- Root GitHub `development` environment `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: may record Development deployment evidence only.
- Root GitHub `production` environment `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: may record Production deployment evidence only.

The child Vercel project receives only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, separately scoped to Development/Preview and Production. It must not receive a Supabase secret key, service-role key, Resend key, or host cron credential.

Prefer a GitHub App installation credential when this pipeline is made long-lived. If a personal access token is used during bootstrap, restrict it to the named repository and the minimum repository permission shown by GitHub when the token is created. Do not reuse a personal owner token, the private submodule SSH key, or a Production provider credential.

Creating or transmitting either secret is a credential handoff. A human owner must approve that action at the time it occurs.

## Provider boundaries

- Vercel builds an embedded plugin as part of the host preview. An `application` profile uses its approved child project so its signed bytes can be deployed without rebuilding the host. The child requires direct-access protection and server-side authorization. A separate project is not required for embedded releases.
- Supabase migrations publish release identity and schema contracts. They do not change organization installations. The preview branch must replay the generated migration before merge.
- Resend remains a host-owned server integration. Preview and local environments keep the Mailpit fail-closed default unless an explicit Development-only transport override is approved. Plugin manifests and child browser code never receive a Resend key.
- Vercel AI SDK and AI Gateway calls stay in server code. A plugin declares an `ai` capability, while the host or an independently deployed plugin server owns model credentials, usage policy, audit data, and redaction. No AI key belongs in a release manifest or client bundle.

## Rehearsal gate

Before the first real tag, use a fictional plugin fixture or a deliberately reviewed next patch version. A successful rehearsal requires:

- private release workflow success;
- Cosign verification with the exact workflow identity and GitHub OIDC issuer;
- a root Development pull request containing only the expected gitlink, registry entry, and one migration;
- root CI success;
- healthy Supabase Preview with the new migration head;
- a READY Vercel Preview at the integration commit;
- a healthy child Development deployment whose recorded digest equals the signed release;
- proof that an organization on the preceding install contract can still load the plugin before choosing Update.
