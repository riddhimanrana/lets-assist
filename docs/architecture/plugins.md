# Plugin boundaries

The public repository owns plugin contracts, installation state, entitlement checks, rollout controls, and extension surfaces. The private `lib/plugins/private` submodule owns organization-specific implementations.

Plugin availability is resolved per request from persisted install and entitlement state. Environment-variable allowlists are not a rollout system. Browser code must not query `plugin_data` directly, and a missing private registry must fail closed rather than silently producing an empty registry.

Private changes follow a two-PR sequence:

1. Branch and merge the implementation in `lets-assist-plugins`.
2. Update the exact root gitlink and open the root integration PR.

The private repository commit must be accessible to CI through its least-privilege submodule credential. See [the submodule workflow](../development/private-plugins.md).
