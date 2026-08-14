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

## Uninstall and permanent deletion

Ordinary organization uninstall is a non-extensible control-plane operation: it deletes only the exact `organization_plugin_installs` row and runs no plugin lifecycle code. `onUninstall` is reserved for compensating a failed new-install persistence step. Consequently, uninstall retains plugin-owned data by construction.

Permanent organization plugin-data deletion is a separate consequential transition. The public repository owns fresh/MFA-aware authentication, current organization-admin/catalog/entitlement/install revalidation, organization/plugin-bound confirmation, transition leasing, and the durable redacted receipt. A plugin owns only its idempotent `onDataDelete` implementation and a mechanically complete `manifest.dataDeletion` declaration covering every declared database and storage target. Missing or incomplete declarations and hooks fail closed.

The receipt is finalized after the hook reports its outcome and before audit attachment. Audit failure is recorded independently and cannot rewrite successful deletion into a retryable state. A request left processing after a runtime crash is ambiguous and cannot be automatically replayed; only an explicitly reported retryable failure may receive a new claim token.
