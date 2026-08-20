/**
 * Serializable declaration shapes shared by every runtime profile.
 *
 * These are the parts of a plugin manifest that were already plain data in
 * `types/plugin.ts`. They live here so a plugin deployed as a separate
 * application can state the same contract without importing host types, and
 * `types/plugin.ts` re-exports them so no existing import site changes.
 */

export type PluginAccessRole = "admin" | "staff" | "member";

export type PluginVisibility = "global" | "private";

export interface PluginRouteDeclaration {
  /**
   * Route relative to the plugin's mount point. The host renders it below
   * `/organization/[id]/plugins/[pluginKey]/...`.
   */
  path: string;
  label: string;
  title?: string;
  description?: string;
  minimumRole?: PluginAccessRole;
  navSection?: "plugin" | "organization" | "hidden";
}

export interface PluginCapabilityDeclaration {
  key: string;
  kind:
    | "server-action"
    | "route-handler"
    | "cron"
    | "webhook"
    | "external-api"
    | "ai"
    | "workflow";
  description: string;
  route?: string;
  minimumRole?: PluginAccessRole;
  idempotencyRequired?: boolean;
}

export interface PluginDataAccessDeclaration {
  schema: string;
  relation: string;
  access:
    | "server-only"
    | "rls-client"
    | "public-read-model"
    | "rpc"
    | "background-job";
  purpose: string;
  containsPersonalData?: boolean;
  containsSensitiveData?: boolean;
  /** Column carrying the owning organization. Absent only for shared reference data. */
  tenantColumn?: string;
}

export interface PluginStorageAccessDeclaration {
  bucket: string;
  pathPattern: string;
  access: "public-read" | "authenticated-read" | "staff-only" | "server-only";
  purpose: string;
}

export type PluginDataDeletionDisposition = "delete" | "retain";

export interface PluginDataDeletionDataTarget {
  schema: string;
  relation: string;
  tenantColumn: string | null;
  disposition: PluginDataDeletionDisposition;
  reason?: string;
}

export interface PluginDataDeletionStorageTarget {
  bucket: string;
  pathPattern: string;
  disposition: PluginDataDeletionDisposition;
  reason?: string;
}

/**
 * A reviewed claim about what permanent deletion actually does, distinct from
 * ordinary uninstall (which never runs plugin code and never touches plugin
 * data). `reviewed` accepts only `true`: there is no honest way to
 * under-declare this and still offer permanent deletion.
 */
export interface PluginDataDeletionDeclaration {
  reviewed: true;
  /** ISO calendar date the contract was checked against the hook. */
  reviewedAt: string;
  execution: {
    atomicity: "transactional" | "non-transactional";
    retrySafety: "idempotent" | "manual-reconciliation";
  };
  dataTargets: PluginDataDeletionDataTarget[];
  storageTargets: PluginDataDeletionStorageTarget[];
  /** Present even when empty, so reviewers cannot omit the decision. */
  externalSystemsNotCovered: string[];
}

export interface PluginConfigSchema {
  type: "object";
  properties: Record<string, PluginConfigProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface PluginConfigProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: PluginConfigProperty;
  properties?: Record<string, PluginConfigProperty>;
}

/**
 * Who may see a configuration key.
 *
 * This exists because organization plugin configuration is readable by every
 * organization member through row-level security, which is easy to forget when
 * adding a key. Marking a key `admin` or `hidden` is a declaration for review
 * tooling; it is not, by itself, an access control. Secrets belong in
 * environment configuration, never here.
 */
export type PluginConfigVisibility = Record<
  string,
  "admin" | "staff" | "hidden"
>;

/** Only `shared` has runtime enforcement today, so it is the only claimable mode. */
export type PluginDataIsolationMode = "shared";
