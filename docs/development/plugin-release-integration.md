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
8. The root workflow pins the exact private commit, updates the code-owned release registry, generates one forward publication migration plus its exact pgTAP contract, and opens a pull request against root `development`. Root integrations are serialized because the migration ledger is global.
9. Root CI, Supabase Preview, and Vercel Preview validate that integration. Merging the root pull request deploys code to Development only.
10. An organization administrator may then select Update. The update operation remains lease-bound, idempotent, audited, and manual by default.

Production promotion remains a separate root `development` to `main` release. Do not create a private release tag or merge a root integration to `main` as part of routine plugin development.

## Repository credentials

The workflows intentionally fail closed until both secrets exist:

- Private repository `PLUGIN_ROOT_INTEGRATION_TOKEN`: may call `POST /repos/riddhimanrana/lets-assist/dispatches` and nothing else beyond what GitHub requires for that endpoint.
- Root repository `PRIVATE_PLUGIN_RELEASE_TOKEN`: read-only access to `riddhimanrana/lets-assist-plugins` contents, commits, tags, and release assets.

Prefer a GitHub App installation credential when this pipeline is made long-lived. If a personal access token is used during bootstrap, restrict it to the named repository and the minimum repository permission shown by GitHub when the token is created. Do not reuse a personal owner token, the private submodule SSH key, or a Production provider credential.

Creating or transmitting either secret is a credential handoff. A human owner must approve that action at the time it occurs.

## Provider boundaries

- Vercel builds an embedded plugin as part of the host preview. The automatic root receiver rejects `application` and `service` profiles until their immutable build artifact is downloaded and independently hashed. A later `application` profile may have its own Vercel project, but it must also have direct-access protection and server-side authorization. A separate project is not required for embedded CSF releases.
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
- proof that an organization on the preceding install contract can still load the plugin before choosing Update.
