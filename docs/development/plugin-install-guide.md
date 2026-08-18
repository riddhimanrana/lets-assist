# Plugin install and entitlement guide

How a plugin gets from the catalog into an organization, who can do each step, and what the platform actually enforces. This is the operator guide; [private plugins](private-plugins.md) is the developer guide for building one.

Read the [inert surfaces](#surfaces-that-do-not-do-anything-yet) section before planning a rollout around a feature — several controls exist in the schema and the admin UI but are not consulted by any code path.

## The two sides

Installing a plugin takes two different people in two different places.

|                          | Who                    | Where                         | What it does                                                                       |
| ------------------------ | ---------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| **Platform control**     | Super admin            | `/admin/plugins`              | Publishes the plugin to the catalog and grants an organization the right to use it |
| **Organization install** | Organization **admin** | `/organization/[id]/settings` | Turns it on for that organization and configures it                                |

Neither side can do the other's job. A super admin granting an entitlement does not install anything; an org admin cannot install a private plugin they have no entitlement for. Organization **staff** cannot manage plugins at all — `isOrganizationAdminForSettings()` requires role `admin`.

## Step 1 — Catalog control (super admin)

`/admin/plugins` → the catalog table. Backed by `upsertPluginCatalogControl` in `app/admin/plugins/server/catalog-entitlements.ts`, writing `public.plugins`.

- **`is_active`** — the master switch. Inactive means the plugin is unavailable everywhere, regardless of entitlements or installs.
- **`visibility`** — `global` makes the plugin installable by any organization. Anything else requires a per-organization entitlement.
- **`latest_version`** — the authoritative install target. An active catalog row may reference only a complete published `plugin_versions` release, and the loaded private manifest must match it exactly at runtime.
- **`force_update_version`** — the floor. Any organization whose `installed_version` is below this loses the plugin **entirely** at runtime until an admin updates. The value must reference a published release.

## Step 2 — Grant an entitlement (super admin)

Required for every non-`global` plugin. `upsertOrganizationPluginEntitlement` writes `public.organization_plugin_entitlements`, unique per (organization, plugin).

- **`status`**, plus **`starts_at`** / **`ends_at`** — the window. Outside it the plugin is not accessible even if installed.
- **`is_forced`** — the organization cannot disable or uninstall it, and it counts as enabled even without an install row.

`bulkUpsertOrganizationPluginEntitlements` grants to several organizations at once.

There is **no self-serve request flow**. An organization cannot ask for a plugin from inside the product; entitlement is granted out of band.

## Step 3 — Install (organization admin)

`/organization/[id]/settings` → Plugins. The card lists the plugin's declared permissions — its `dataAccess` relations, `storageAccess` buckets, and `requiredScopes`, read from the manifest — behind a consent checkbox. Confirming calls `setOrganizationPluginInstallState`.

What happens then, in `transitionOrganizationPluginInstall`:

1. Acquire a distributed lease (`acquire_plugin_control_plane_transition_lock`, 900 s TTL, service-role only).
2. Re-check the catalog, the entitlement window, and the caller's admin role — the client's view is never trusted.
3. Run the plugin's `onInstall` lifecycle hook **before** persisting. If it throws, previously-run steps are compensated in reverse and nothing is written.
4. Write `organization_plugin_installs` with an optimistic guard on `updated_at`.
5. Write `plugin_audit_logs`.

For DVHS CSF specifically, `onInstall` seeds the chapter's roles and point categories, so a fresh install lands ready to configure rather than empty.

## Step 4 — Configure

`updateOrganizationPluginConfiguration` validates the submitted JSON against the plugin's config schema (Ajv) and applies defaults before writing.

> **Configuration is readable by every member of the organization.** The RLS policy on `organization_plugin_installs` admits `member`, and two private plugins deliberately read `configuration` with the member's own client. Put settings there. **Never put secrets, tokens, or authorization allowlists there** — a member can read the whole blob directly through PostgREST. If a plugin needs privileged configuration, it needs its own server-only table.

## Updating

1. Bump `manifest.version` in the private plugin repository, test it, and merge it there first.
2. Hash the exact manifest and publish a forward migration that inserts an immutable `plugin_versions` certificate containing the semantic version, private commit SHA, manifest SHA-256, compatibility contract, and rollout posture.
3. Update the root gitlink and code-owned `publishedPluginReleases` entry to the same private commit and manifest digest.
4. Advance `plugins.latest_version` and each intended `organization_plugin_installs.installed_version` in the same reviewed release migration, recording an `install.version_updated` audit row.

Raising `force_update_version` is the blunt instrument: every organization below that floor loses the plugin at runtime — `hasOrganizationPluginRuntimeAccess` returns false and the plugin disappears from their navigation — until an admin clicks update. Use it for a security fix, not for a routine release.

### Version integrity

Enabled installs must reference a complete published release. The server runtime additionally requires the install version to equal the code-owned release version, while CI verifies the manifest hash and confirms that the attested private commit is contained by the pinned gitlink. A mismatched catalog, install, manifest, digest, or source commit fails closed instead of silently drifting.

## Uninstalling and data deletion

`uninstallOrganizationPlugin` is mechanically control-plane-only. The `"uninstall"` branch in `lib/plugins/control-plane-transition-core.ts` never invokes `onUninstall`, `onDataDelete`, or any other plugin code; it removes only the exact `organization_plugin_installs` row (including its configuration) under the existing organization/plugin transition lease. It never references `plugin_data`. The `install.removed` audit row therefore records `platformInstallRowRemoved: true`, `pluginDataDeletionNotRequested: true`, `pluginDataRetained: true`, and only the non-content `configurationRemoved` boolean. `onUninstall` remains available solely as install compensation when an `onInstall` hook succeeded but persistence then failed; it is not part of the organization uninstall action.

`describePluginUninstallImpact` (`lib/plugins/plugin-uninstall-impact.ts`) is the single function both the confirmation dialog (`OrganizationPluginSettings.tsx`) and the success-toast message (`uninstallOrganizationPlugin`) call for this copy — it takes plain `{ pluginName, dataAccessPurposes }` data rather than a full plugin definition specifically so both the client dialog (working from the admin-settings DTO) and the server action (working from the registered definition) share one bounded, length-capped summary instead of drifting into two independently-interpolated strings. It makes no database change itself and never interpolates internal `schema.relation` identifiers, only a plugin's own declared `dataAccess[].purpose` text, deduplicated and capped. The plugin name is bounded to 80 chars and each purpose label to 100 chars. The returned type does not carry tautological literal fields (`workflowsStop`, `settingsRemoved`, `dataRetained`) or `totalDataCategoryCount`; total count is derivable as `dataCategories.length + additionalDataCategoryCount`.

A repeat uninstall call that observes no install row (a retried request, a lost first response, a double click) is an idempotent success with `changed: false` and no audit row, not a refusal and not a false `install.removed`/`execution.error`. `disable`, `config_update`, and `version_update` are unchanged: they still refuse when there is no install row, since there is nothing sensible to disable or reconfigure.

Permanent erasure is a distinct irreversible organization-admin action and dialog. It requires a fresh server-authenticated session with MFA enforcement, current active admin membership, loaded registry definition, active catalog entry, valid private entitlement, no active forced entitlement, no remaining install row, and the exact typed phrase `<organization name>/<organization UUID>/<plugin key>`. The stable UUID prevents same-named organizations from sharing a confirmation. The destructive service repeats the mutable database checks under the same organization/plugin transition lease immediately before calling `onDataDelete`.

The action is offered only when `manifest.dataDeletion` exactly and uniquely covers every `dataAccess` and `storageAccess` target, each stored relation has a tenant column, every target has a reviewed `delete` disposition, `externalSystemsNotCovered` is explicitly present, the review date is valid, execution semantics are declared, retry safety is `idempotent`, and `onDataDelete` exists. Missing, partial, retained, manually reconciled, or hook-only declarations fail closed. No private-plugin manifest declares this complete root contract yet, so the root remains compatible while permanent deletion is unavailable for those plugins. A separate private-repository change must review each target and external provider limitation before enabling it; do not infer readiness merely because DVHS CSF already has an `onDvhsCsfDataDelete` implementation.

`private.plugin_data_deletion_requests` is a service-role-only, RLS-enabled durable receipt. A request UUID is globally bound to actor, organization, plugin, confirmation fingerprint, and one current claim token. One partial unique index prevents concurrent processing for the same organization/plugin. Reported failures from an idempotent hook become `retryable_failed`; only the same request may claim a fresh attempt. A receipt left `processing` after a crash has an ambiguous outcome and is never automatically reclaimed or rerun. Successful hook completion is finalized first, then audit is attempted and attached independently, so audit failure produces a warning without turning deleted data into a false failed/replayable result. Raw hook/provider errors and confirmation text are not stored.

## What the platform enforces

Worth knowing which guarantees are real:

- **Entitlement, role, and catalog state are re-checked server-side** on every mutation. The client's view is never trusted, and direct client writes to the control-plane tables were revoked in `20260712014700`.
- **Plugin data is server-only.** The `plugin_data` schema has no `USAGE` for `anon` or `authenticated`, every table has RLS with no policies, and the only route in is a service-role client behind `hasOrganizationPluginRuntimeAccess`.
- **Every organization-scoped plugin relation carries `organization_id`**, declared per relation in the manifest as `tenantColumn`.
- **Lifecycle transitions are leased, compensated, and audited.**

## Surfaces that do not do anything yet

These exist in the schema, and several appear in the admin UI, but **no code path reads them**. Do not plan a rollout around them:

| Surface                                                                       | Reality                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization_plugin_feature_flags`, `rollout_percentage`                     | Feature gating and percentage rollout are **unimplemented**.                                                                                                                                                                                                                                                      |
| Automatic-update worker                                                       | `auto_update=true` is accepted only for an explicitly compatible published release with a non-zero rollout, but no worker currently advances installs automatically. Releases remain migration/admin driven.                                                                                                      |
| `organization_plugin_data_boundaries`, `organization_data_isolation_profiles` | Editable in the admin UI, consulted by no enforcement path. The `shared / dedicated_schema / dedicated_project / external` model is planning metadata only.                                                                                                                                                       |
| `onDataDelete` / `runPluginDataDelete`                                        | Wired only through the separate permanent-deletion action and complete manifest readiness gate. Processing receipts are not automatically rerun after ambiguous outcomes. No private manifest declares the complete contract yet, so those plugins remain deletion-unavailable pending private-repository review. |
| `plugin_runtime_contracts`                                                    | Only refreshed when a super admin loads `/admin/plugins`, so it is stale by default, and it silently skips any registered plugin with no catalog row.                                                                                                                                                             |

Plugin releases use a source attestation rather than a package-signing key: immutable `plugin_versions` rows pin the private commit and manifest SHA-256, `publishedPluginReleases` mirrors that evidence in code, CI verifies the digest and gitlink ancestry, and the catalog `code_reference` is advanced to the same commit. This proves exactly which reviewed private source is loaded; it is not a third-party code-signing certificate.

## Troubleshooting

| Symptom                                          | Cause to check first                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin missing for everyone in the org           | `plugins.is_active`; entitlement window; `force_update_version` above the org's `installed_version`                                                                                   |
| Plugin missing for members but visible to admins | The manifest's `minimumRole`, or a surface's `surfaceAccess` entry                                                                                                                    |
| "You have no plugins" for everyone, suddenly     | `loadAccessibleOrganizationPluginAccess` defaults to `failureMode: "empty"` — a database outage is indistinguishable from no entitlement. Check the database before the entitlements. |
| Install fails with a concurrency error           | A lease is held, or a lifecycle hook bumped `updated_at` mid-transition. Retry once, then check `plugin_audit_logs`.                                                                  |
| No audit row for a config or version change      | Fixed on `development`; before that the action CHECK rejected six lifecycle values and the error was swallowed.                                                                       |

## Related

- [Private plugin development](private-plugins.md)
- [Plugin boundaries](../architecture/plugins.md)
- [Data and authorization boundaries](../architecture/data.md)
- [Onboarding a new CSF chapter](../csf/new-chapter-onboarding.md)
