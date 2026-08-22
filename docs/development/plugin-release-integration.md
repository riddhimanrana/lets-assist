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
8. The root workflow pins the exact private commit, updates the code-owned release registry, generates one forward publication migration plus its exact pgTAP contract, and opens a pull request against root `development`. The workflow serializes jobs and refuses a new release while an earlier `codex/plugin-release-*` pull request is open because the migration ledger is global.
9. Root CI, Supabase Preview, and Vercel Preview validate that integration. Merging the root pull request publishes the release contract to Development. It does not deploy or activate an application profile.
10. Run `Deploy signed plugin application` from root `development` with the exact plugin key, tag, and `development` environment. The workflow verifies the signed release and host allowlist, deploys the recorded prebuilt bytes, checks `/api/health`, and records the deployment in Development Supabase.
11. Enable the organization's application runtime only after the Development deployment is healthy. The embedded version remains the rollback path.
12. Promote root `development` to `main` through the normal production release. Run the same deployment workflow from `main` with `production`. It deploys the same signed build digest and records Production health.
13. In Production organization settings, update the install and enable the application runtime only after the Production deployment is healthy. The control plane resolves that organization to the exact immutable deployment; it does not move every tenant to the newest child deployment.

Production promotion remains a separate root `development` to `main` release. Do not create a private release tag or merge a root integration to `main` as part of routine plugin development.

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
