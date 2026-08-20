# Plugin boundaries

The public repository owns plugin contracts, installation state, entitlement checks, rollout controls, and extension surfaces. The private `lib/plugins/private` submodule owns organization-specific implementations.

Plugin availability is resolved per request from persisted install and entitlement state. Environment-variable allowlists are not a rollout system. Browser code must not query `plugin_data` directly, and a missing private registry must fail closed rather than silently producing an empty registry.

## Private CSF tenant boundary

The CSF implementation is a server-only adapter behind the public plugin contract. It must not enter a browser bundle, expose `plugin_data`, or accept tenant scope inferred only from submitted identifiers. Each request authenticates the actor, resolves current install and entitlement state, proves the organization capability and target-resource relationship, and passes explicit organization scope into the private implementation. The service and transaction then revalidate that scope; elevated database credentials do not replace either check.

CSF validation, consequential-transition approval, idempotency, durable receipts/outbox writes, and redacted audit events follow the platform responsibilities in [platform architecture](platform.md). Plugin caches must be private to every authorization dimension or disabled. Retries use the same organization-bound request identity, and ambiguous provider outcomes are reconciled rather than blindly replayed.

Private changes follow a two-PR sequence:

1. Branch and merge the implementation in `lets-assist-plugins`.
2. Update the exact root gitlink and open the root integration PR.

The private repository commit must be accessible to CI through its least-privilege submodule credential. See [the submodule workflow](../development/private-plugins.md).

## SDK and runtime profiles

The serializable SDK contract under `lib/plugins/sdk/v1` separates a plugin's
identity from its host adapter. A manifest declares its runtime profile,
compatibility ranges, routes, capabilities, permissions, data and Storage
scope, lifecycle messages, release inputs, and host build surface. It cannot
contain React nodes, callbacks, Supabase clients, or other host objects.

`embedded` plugins compile into the platform deployment. Their current private
implementations pass through the embedded adapter, and their existing host
imports are frozen in a generated CI allowlist. New host-internal imports fail
`bun run plugin:check:boundary`. An `application` plugin must have an empty host
import surface and consume a published version of the SDK rather than copied
host source.

An adapter or lazy import is not a package or security boundary. A plugin only
becomes independently deployable after its application profile has its own
build, deployment identity, session revalidation, and server authorization
boundary.

## Releases, deployments, and installs

These are separate records:

- `plugin_versions` is the immutable publication ledger. New publications
  record the exact source tree, declared release inputs, content digest,
  compatibility ranges, runtime profile, and schema requirements. Application
  and service releases also require build and SBOM digests. Legacy rows retain
  NULL provenance where it was never captured.
- `private.plugin_deployments` records one provider deployment observation.
  Process boot can create or refresh a `pending` observation, but cannot claim
  health. A separate service-only workflow records accepted health evidence.
- `organization_plugin_installs` records an organization's installed version,
  desired version, and manual or security-only update policy. A catalog version
  is not installable until its code exists in the serving deployment.
- `private.plugin_update_operations` records idempotent, lease-bound update
  attempts and redacted outcomes. The deployment-health activation gate remains
  disabled until hosted Development proves the reporter and creates real
  deployment evidence.

Database migrations advance schema contracts, not organization installations.
Do not use a migration to silently change installed versions. Production
migrations are forward-only; code rollback means deploying a schema-compatible
release or adding a corrective migration.

The current release certificate is source and digest metadata. It is not a
cryptographic signature. Signing and verification tooling must verify the
declared release inputs and constrain both signer identity and issuer before
the certificate can be described as signed.

The signed private-to-root release path and its credential boundary are
documented in [signed plugin release integration](../development/plugin-release-integration.md).

## Storage contracts

The server-only `plugins` bucket uses
`{organizationId}/{pluginKey}/...`. Browser-assisted form uploads use the
separate `plugin_form_uploads` grammar
`{organizationId}/{pluginKey}/{userId}/{file}`. Its RLS binds all three scope
segments and requires the plugin to be enabled for the organization. It does
not require membership because DV applications upload before membership
exists. The `plugins` bucket has no browser policies.

## Uninstall and permanent deletion

Ordinary organization uninstall is a non-extensible control-plane operation: it deletes only the exact `organization_plugin_installs` row and runs no plugin lifecycle code. `onUninstall` is reserved for compensating a failed new-install persistence step. Consequently, uninstall retains plugin-owned data by construction.

Permanent organization plugin-data deletion is a separate consequential transition. The public repository owns fresh/MFA-aware authentication, current organization-admin/catalog/entitlement/install revalidation, organization/plugin-bound confirmation, transition leasing, and the durable redacted receipt. A plugin owns only its idempotent `onDataDelete` implementation and a mechanically complete `manifest.dataDeletion` declaration covering every declared database and storage target. Missing or incomplete declarations and hooks fail closed.

The receipt is finalized after the hook reports its outcome and before audit attachment. Audit failure is recorded independently and cannot rewrite successful deletion into a retryable state. A request left processing after a runtime crash is ambiguous and cannot be automatically replayed; only an explicitly reported retryable failure may receive a new claim token.
