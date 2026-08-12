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
- **`latest_version`** — what an org receives when it installs or clicks update. This is the value written to `installed_version`; the plugin's own `manifest.version` is _not_ consulted (see [version drift](#version-drift)).
- **`force_update_version`** — the floor. Any organization whose `installed_version` is below this loses the plugin **entirely** at runtime until an admin updates. Validated only as "force ≤ latest".

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

1. Bump `manifest.version` in the plugin repository and land it.
2. Super admin raises `plugins.latest_version`.
3. The organization admin sees an update affordance and calls `updateOrganizationPluginToLatest`, or a super admin forces it with `forceUpdateOrganizationPluginInstall`.

Raising `force_update_version` is the blunt instrument: every organization below that floor loses the plugin at runtime — `hasOrganizationPluginRuntimeAccess` returns false and the plugin disappears from their navigation — until an admin clicks update. Use it for a security fix, not for a routine release.

### Version drift

Installing writes `installed_version = plugins.latest_version`. It never reads the plugin's `manifest.version`. Nothing reconciles the two, so the catalog can say `1.0.0` while the manifest says `0.1.0`, and at the time of writing several plugins are in exactly that state. Treat `plugins.latest_version` as the operational number and keep it in step with the manifest by hand when you release.

## Uninstalling and data deletion

`uninstallOrganizationPlugin` runs the plugin's `onUninstall` hook and then removes the `organization_plugin_installs` row — the platform's own write removes only that row and its `configuration`. The platform's own delete never references `plugin_data`. `onUninstall` is an arbitrary plugin hook that runs first, with the service role, before that deletion, and nothing in the control plane constrains what it does to `plugin_data` — the platform cannot certify what a hook it does not control chose to do. The `install.removed` audit row (`pluginControlPlaneAuditDetails` in `lib/plugins/control-plane-transition-core.ts`) reflects that: it records `platformInstallRowRemoved: true` and `pluginDataDeletionNotRequested: true` — facts about the platform's own code path — plus a non-content `configurationRemoved` boolean, never `pluginDataRetained`, which would be a claim about hook behavior the platform cannot make.

`describePluginUninstallImpact` (`lib/plugins/plugin-uninstall-impact.ts`) is the single function both the confirmation dialog (`OrganizationPluginSettings.tsx`) and the success-toast message (`uninstallOrganizationPlugin`) call for this copy — it takes plain `{ pluginName, dataAccessPurposes }` data rather than a full plugin definition specifically so both the client dialog (working from the admin-settings DTO) and the server action (working from the registered definition) share one bounded, length-capped summary instead of drifting into two independently-interpolated strings. It makes no database change itself and never interpolates internal `schema.relation` identifiers, only a plugin's own declared `dataAccess[].purpose` text, deduplicated and capped. The plugin name is bounded to 80 chars and each purpose label to 100 chars. The returned type does not carry tautological literal fields (`workflowsStop`, `settingsRemoved`, `dataRetained`) or `totalDataCategoryCount`; total count is derivable as `dataCategories.length + additionalDataCategoryCount`.

A repeat uninstall call that observes no install row (a retried request, a lost first response, a double click) is an idempotent success with `changed: false` and no audit row, not a refusal and not a false `install.removed`/`execution.error`. `disable`, `config_update`, and `version_update` are unchanged: they still refuse when there is no install row, since there is nothing sensible to disable or reconfigure.

Permanent erasure of `plugin_data` is a separate, unwired lifecycle hook: `onDataDelete` / `runPluginDataDelete` (`lib/plugins/lifecycle.ts`). **No route, Server Action, or admin surface currently calls it anywhere in the product.** There is no self-service or admin-triggered way to request permanent plugin-data erasure — treat that as an open contract gap, not a documented capability, until a caller exists. Tracked as [AUD-020](cleanup-register.md).

For DVHS CSF specifically, the private submodule implements `onDvhsCsfDataDelete`, which purges chapter storage, calls `csf_purge_recovery_foundations`, and clears roughly fifty tables — but nothing in this repository invokes it outside of that plugin's own hook definition. It also explicitly does **not** tear down anything held by Google Calendar, Gmail, Drive, or Resend — those remain and must be handled by hand.

## What the platform enforces

Worth knowing which guarantees are real:

- **Entitlement, role, and catalog state are re-checked server-side** on every mutation. The client's view is never trusted, and direct client writes to the control-plane tables were revoked in `20260712014700`.
- **Plugin data is server-only.** The `plugin_data` schema has no `USAGE` for `anon` or `authenticated`, every table has RLS with no policies, and the only route in is a service-role client behind `hasOrganizationPluginRuntimeAccess`.
- **Every organization-scoped plugin relation carries `organization_id`**, declared per relation in the manifest as `tenantColumn`.
- **Lifecycle transitions are leased, compensated, and audited.**

## Surfaces that do not do anything yet

These exist in the schema, and several appear in the admin UI, but **no code path reads them**. Do not plan a rollout around them:

| Surface                                                                       | Reality                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugin_versions` review workflow                                             | `draft → review → published/rejected`, `commit_sha`, `review_notes` — all inert. Nothing reads the table.                                                                                                                |
| `organization_plugin_feature_flags`, `rollout_percentage`                     | Feature gating and percentage rollout are **unimplemented**.                                                                                                                                                             |
| `organization_plugin_installs.auto_update`                                    | Never read. Updates are always manual or forced.                                                                                                                                                                         |
| `organization_plugin_data_boundaries`, `organization_data_isolation_profiles` | Editable in the admin UI, consulted by no enforcement path. The `shared / dedicated_schema / dedicated_project / external` model is planning metadata only.                                                              |
| `onDataDelete` / `runPluginDataDelete`                                        | Defined and audited (`lifecycle.data_delete`), but no route, Server Action, or admin surface calls it. Permanent plugin-data erasure is not requestable from the product yet. Tracked as [AUD-020](cleanup-register.md). |
| `plugin_runtime_contracts`                                                    | Only refreshed when a super admin loads `/admin/plugins`, so it is stale by default, and it silently skips any registered plugin with no catalog row.                                                                    |

There is also **no plugin signing or attestation**. The trust root is the private submodule's pinned commit, verified at build time by `scripts/check-private-submodules.mjs`. The catalog's `code_repository` and `code_reference` fields are display-only and are never checked against anything.

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
