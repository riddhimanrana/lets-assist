import type { ReactNode } from "react";
import type { Organization } from "./organization";

export type OrganizationPluginVisibility = "global" | "private";

export type OrganizationPluginAccessRole = "admin" | "staff" | "member";
export type OrganizationPluginPageRole =
  OrganizationPluginAccessRole | "public";

/**
 * Organization with the viewer's role
 */
export interface OrganizationWithRole extends Organization {
  role: OrganizationPluginAccessRole;
}

export interface OrganizationPluginLifecycleOrganization {
  id: string;
  role: OrganizationPluginAccessRole;
}

/**
 * Plugin permission scopes for granular access control
 */
export type OrganizationPluginScope =
  | "org:read" // Read organization data
  | "org:write" // Modify organization settings
  | "members:read" // Read member list
  | "members:write" // Modify member roles
  | "projects:read" // Read projects
  | "projects:write" // Create/modify projects
  | "signups:read" // Read anonymous signups
  | "signups:write" // Modify signups
  | "notifications:send" // Send notifications
  | "storage:read" // Read files
  | "storage:write" // Upload files
  | "api:expose"; // Expose custom API endpoints

export type OrganizationPluginOwnerType =
  "platform-official" | "partner" | "community";

export interface OrganizationPluginOwner {
  name: string;
  type?: OrganizationPluginOwnerType;
}

/**
 * Available surfaces where plugins can inject UI components
 */
export type OrganizationPluginSurface =
  | "organization.overview.cards" // Cards on organization dashboard
  | "organization.settings.cards" // Cards in organization settings
  | "anonymous.profile.cards" // Cards on anonymous signup pages
  | "project.detail.cards" // Cards on project detail pages
  | "project.detail.actions" // Action buttons on project pages
  | "user.profile.cards" // Cards on user profile pages
  | "dashboard.sidebar.items" // Items in sidebar navigation
  | "dashboard.header.actions"; // Actions in header area

/**
 * Available behavior hooks for modifying application behavior
 */
export type OrganizationPluginBehaviorHook =
  | "anonymous.profile.experience" // Modify anonymous signup experience
  | "organization.tabs" // Add custom tabs to org dashboard
  | "organization.navigation.overrides" // Override core org navigation tabs
  | "project.create.validation" // Validate project creation
  | "project.update.validation" // Validate project updates
  | "project.create.additional_steps" // Add custom steps to project creation wizard
  | "signup.form.fields" // Add custom fields to signup forms
  | "signup.submit.validation" // Validate signup submissions
  | "notification.send.intercept" // Intercept outgoing notifications
  | "organization.member.join" // React to member joining
  | "organization.member.leave"; // React to member leaving

/**
 * Platform-level surfaces where plugins contribute sanitized data DTOs.
 * The platform owns rendering; plugins never return ReactNodes here.
 */
export type PlatformPluginSurface =
  | "platform.home.feed" // Feed items on the signed-in /home page
  | "platform.dashboard.card"; // Summary card on the volunteer /dashboard

export type OrganizationPluginSurfaceAccessLevel =
  OrganizationPluginAccessRole | "public";

export type PlatformPluginSurfaceAccessPolicy = Partial<
  Record<PlatformPluginSurface, OrganizationPluginSurfaceAccessLevel>
>;

export interface PlatformSurfaceContext {
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  userId: string;
  viewerRole: OrganizationPluginAccessRole;
  pluginConfiguration: Record<string, unknown> | null;
  /** Maximum contributions the platform will keep from this plugin. */
  limit: number;
}

export interface PlatformFeedItem {
  id: string;
  kind: "post" | "event";
  title: string;
  /** Plain text only; the platform resolver drops or truncates anything else. */
  summary: string | null;
  /** App-relative link; must start with "/". */
  href: string;
  /** ISO timestamp used for feed ordering. */
  publishedAt: string;
  pinned: boolean;
  badgeLabel: string;
  /**
   * App-relative link to the organization the item came from, used by the
   * host feed for its "View all" affordance. Stamped by the platform resolver
   * from the viewer's membership — never read from plugin output.
   */
  sourceHref: string | null;
}

/**
 * What a plugin returns for the host feed. `sourceHref` is deliberately absent:
 * the platform stamps it so an organization link can never be plugin-supplied.
 */
export type PlatformFeedItemInput = Omit<PlatformFeedItem, "sourceHref">;

/**
 * A plugin the signed-in person could see platform content from, as offered by
 * the account setting that controls it. Derived from their memberships,
 * installed plugins and declared `platformSurfaces` — never a fixed list.
 */
export interface PlatformPluginSource {
  pluginKey: string;
  name: string;
  description: string | null;
  /** Organizations of theirs that supply this plugin, alphabetical. */
  organizationNames: string[];
}

export interface PlatformDashboardCardStat {
  label: string;
  value: string;
  hint?: string;
}

export interface PlatformDashboardCardStatus {
  label: string;
  tone: "positive" | "warning" | "neutral";
}

export interface PlatformDashboardCard {
  title: string;
  href: string;
  /** Capped at 3 by the platform resolver. */
  stats: PlatformDashboardCardStat[];
  status: PlatformDashboardCardStatus | null;
}

export type OrganizationPluginSurfaceAccessPolicy = Partial<
  Record<OrganizationPluginSurface, OrganizationPluginSurfaceAccessLevel>
>;

export type OrganizationPluginBehaviorAccessPolicy = Partial<
  Record<OrganizationPluginBehaviorHook, OrganizationPluginSurfaceAccessLevel>
>;

export interface OrganizationPluginTargetingConfig {
  mode?: "all" | "any";
  anonymousSignupIds?: string[];
  userProfileIds?: string[];
  userIds?: string[];
  projectIds?: string[];
  anonymousEmails?: string[];
}

export interface OrganizationPluginSurfaceRenderTargetContext {
  anonymousSignupId?: string | null;
  userProfileId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  projectId?: string | null;
  anonymousEmail?: string | null;
}

export interface OrganizationPluginSurfaceRenderContext {
  organizationId: string;
  organizationSlug?: string;
  organizationName?: string;
  pluginConfiguration: Record<string, unknown> | null;
  viewerRole?: OrganizationPluginAccessRole | null;
  target?: OrganizationPluginSurfaceRenderTargetContext;
}

export interface OrganizationPluginActionButton {
  label: string;
  href: string;
  variant?: "default" | "secondary" | "outline" | "destructive";
  external?: boolean;
}

export interface OrganizationPluginRouteDefinition {
  /**
   * Relative plugin route, for example `members`, `tournaments/import`,
   * or `admin/data`. The host renders it below
   * `/organization/[id]/plugins/[pluginKey]/...`.
   */
  path: string;
  label: string;
  title?: string;
  description?: string;
  minimumRole?: OrganizationPluginSurfaceAccessLevel;
  navSection?: "plugin" | "organization" | "hidden";
}

export interface OrganizationPluginBackendCapability {
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
  minimumRole?: OrganizationPluginSurfaceAccessLevel;
  idempotencyRequired?: boolean;
}

export interface OrganizationPluginDataAccessDeclaration {
  schema: "public" | "plugin_data" | "private" | string;
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
  tenantColumn?: string;
}

export interface OrganizationPluginStorageAccessDeclaration {
  bucket: string;
  pathPattern: string;
  access: "public-read" | "authenticated-read" | "staff-only" | "server-only";
  purpose: string;
}

/**
 * A plugin author's reviewed, mechanically-gated claim about what permanent
 * deletion (`onDataDelete`) actually does. This is distinct from ordinary
 * uninstall, which the platform now guarantees never runs plugin code and
 * never touches `plugin_data` at all — this declaration exists solely to
 * gate the separate, explicit permanent-deletion action.
 *
 * `reviewed` only accepts `true`: there is no honest way to under-declare
 * this and still offer permanent deletion through the platform. A plugin
 * with no `dataDeletion` declaration (or no `onDataDelete` hook) is treated
 * as not supporting permanent deletion, and the platform refuses the
 * request rather than guessing — see
 * `lib/plugins/plugin-data-deletion-readiness.ts`.
 */
export type OrganizationPluginDataDeletionDisposition = "delete" | "retain";

export interface OrganizationPluginDataDeletionDataTarget {
  schema: string;
  relation: string;
  tenantColumn: string | null;
  disposition: OrganizationPluginDataDeletionDisposition;
  reason?: string;
}

export interface OrganizationPluginDataDeletionStorageTarget {
  bucket: string;
  pathPattern: string;
  disposition: OrganizationPluginDataDeletionDisposition;
  reason?: string;
}

export interface OrganizationPluginDataDeletionDeclaration {
  /** Explicit reviewer assertion; never inferred from hook presence. */
  reviewed: true;
  /** ISO calendar date when this contract was checked against the hook. */
  reviewedAt: string;
  execution: {
    atomicity: "transactional" | "non-transactional";
    retrySafety: "idempotent" | "manual-reconciliation";
  };
  /** Exact one-to-one disposition for every manifest `dataAccess` target. */
  dataTargets: OrganizationPluginDataDeletionDataTarget[];
  /** Exact one-to-one disposition for every manifest `storageAccess` target. */
  storageTargets: OrganizationPluginDataDeletionStorageTarget[];
  /**
   * External systems whose retained copies the hook cannot reach. The array
   * must be present even when empty so reviewers cannot omit this decision.
   */
  externalSystemsNotCovered: string[];
}

export interface AnonymousProfileExperienceBehavior {
  bannerMessage?: string;
  hideLinkingSection?: boolean;
  disableSlotCancellation?: boolean;
  cancellationDisabledReason?: string;
  primaryActions?: OrganizationPluginActionButton[];
}

export interface OrganizationTabBehavior {
  value: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
  navigationSection?: "primary" | "more" | "hidden";
  parentValue?: string;
}

export interface ResolvedOrganizationPluginSurface {
  pluginKey: string;
  node: ReactNode;
}

export type OrganizationCoreTabKey =
  "overview" | "members" | "projects" | "reports";

export interface OrganizationCoreTabReplacement {
  pluginKey: string;
  routePath?: string;
  label: string;
  minimumRole?: OrganizationPluginSurfaceAccessLevel;
}

/**
 * Validation result for project create/update hooks
 */
export interface ProjectValidationResult {
  valid: boolean;
  errors?: Array<{ field?: string; message: string }>;
}

/**
 * Custom form field definition for signup forms
 */
export interface SignupFormField {
  key: string;
  type:
    "text" | "email" | "tel" | "select" | "checkbox" | "textarea" | "number";
  label: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>; // For select type
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
}

/**
 * Signup submission validation result
 */
export interface SignupValidationResult {
  valid: boolean;
  errors?: Array<{ field?: string; message: string }>;
}

/**
 * Notification interception result
 */
export interface NotificationInterceptResult {
  suppress?: boolean; // Don't send the notification
  modify?: {
    subject?: string;
    body?: string;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Member event reaction (no return needed, side-effect only)
 */
export interface MemberEventResult {
  handled?: boolean; // Acknowledge processing
}

export interface OrganizationNavigationBehavior {
  defaultTab?: OrganizationCoreTabKey | string;
  coreTabReplacements?: Partial<
    Record<OrganizationCoreTabKey, OrganizationCoreTabReplacement>
  >;
  hideMembersTab?: boolean;
  hideProjectsTab?: boolean;
  hideOverviewTab?: boolean;
  hideReportsTab?: boolean;
  pluginSurfaceAllowlist?: string[];
  projectsTabLabel?: string;
  membersTabLabel?: string;
  hideMemberCount?: boolean;
  hideInviteAction?: boolean;
  hideProjectAction?: boolean;
  /**
   * Opts the organization into the compact workspace chrome. On phones this
   * also replaces the horizontal category strip with a single full-section
   * switcher that lists every permitted top-level destination. Organizations
   * that do not set this keep the horizontal strip at every width.
   */
  compactHeader?: boolean;
  /** Label for the desktop utility/overflow menu trigger. */
  utilityMenuLabel?: string;
  /**
   * Group label for workspace destinations inside the phone section switcher.
   * Defaults to `Workspace`.
   */
  sectionMenuLabel?: string;
  /**
   * Group label for administration/utility destinations inside the phone
   * section switcher. Defaults to `Administration`.
   */
  utilityMenuGroupLabel?: string;
  /** Legacy organization tab values mapped to their canonical replacement. */
  tabAliases?: Record<string, string>;
  /** Query parameters that should be cleared when the host navigation changes tabs. */
  transientQueryParams?: string[];
}

export interface ProjectCreateAdditionalStep {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  validate?: () => Promise<{
    valid: boolean;
    errors?: Array<{ field?: string; message: string }>;
  }>;
  onComplete?: () => Promise<void>;
}

export interface OrganizationPluginBehaviorHookResultMap {
  "anonymous.profile.experience": AnonymousProfileExperienceBehavior;
  "organization.tabs": OrganizationTabBehavior[];
  "organization.navigation.overrides": OrganizationNavigationBehavior;
  "project.create.validation": ProjectValidationResult;
  "project.update.validation": ProjectValidationResult;
  "project.create.additional_steps": ProjectCreateAdditionalStep[];
  "signup.form.fields": SignupFormField[];
  "signup.submit.validation": SignupValidationResult;
  "notification.send.intercept": NotificationInterceptResult;
  "organization.member.join": MemberEventResult;
  "organization.member.leave": MemberEventResult;
}

export interface OrganizationPluginBehaviorHookContext extends OrganizationPluginSurfaceRenderContext {
  hookInput?: Record<string, unknown>;
}

/**
 * JSON Schema for plugin configuration validation
 */
export interface OrganizationPluginConfigSchema {
  type: "object";
  properties: Record<string, OrganizationPluginConfigProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface OrganizationPluginConfigProperty {
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
  items?: OrganizationPluginConfigProperty;
  properties?: Record<string, OrganizationPluginConfigProperty>;
}

export interface OrganizationPluginExperience {
  publicPage: "core" | "plugin" | "private";
  publicRoute?: string;
  members: "public" | "hidden";
  projects: "public" | "hidden";
  profileMembership: "public" | "hidden";
  joinMode: "open" | "request" | "plugin" | "disabled";
}

export interface OrganizationPluginManifest {
  key: string;
  name: string;
  description?: string;
  detailedDescription?: string;
  owner?: OrganizationPluginOwner;
  capabilityHighlights?: string[];
  version: string;
  visibility: OrganizationPluginVisibility;
  minimumRole?: OrganizationPluginAccessRole;
  navLabel?: string;
  organizationPageChrome?: "default" | "workspace";
  organizationExperience?: OrganizationPluginExperience;
  surfaceAccess?: OrganizationPluginSurfaceAccessPolicy;
  behaviorAccess?: OrganizationPluginBehaviorAccessPolicy;
  /**
   * Platform surfaces (home feed, volunteer dashboard) this plugin
   * contributes data DTOs to, with the minimum org role per surface.
   */
  platformSurfaces?: PlatformPluginSurfaceAccessPolicy;
  /**
   * JSON Schema for configuration validation
   */
  configSchema?: OrganizationPluginConfigSchema;
  /**
   * Required permission scopes
   */
  requiredScopes?: OrganizationPluginScope[];
  /**
   * Custom routes owned by this plugin under
   * /organization/[id]/plugins/[pluginKey]/...
   */
  routes?: OrganizationPluginRouteDefinition[];
  /**
   * Server-side capabilities this plugin depends on or exposes.
   */
  backendCapabilities?: OrganizationPluginBackendCapability[];
  /**
   * Structured data access contract used for privacy review and API exposure
   * reduction. This supersedes string-only dataScope documentation.
   */
  dataAccess?: OrganizationPluginDataAccessDeclaration[];
  /**
   * Storage buckets/path patterns used by this plugin.
   */
  storageAccess?: OrganizationPluginStorageAccessDeclaration[];
  /**
   * Tables/data this plugin manages (for documentation/cleanup)
   */
  dataScope?: string[];
  /**
   * Reviewed retention/deletion contract gating the separate permanent
   * plugin-data-deletion action. Absent = permanent deletion is disabled
   * for this plugin (fails safe); see
   * `lib/plugins/plugin-data-deletion-readiness.ts`.
   */
  dataDeletion?: OrganizationPluginDataDeletionDeclaration;
}

export interface OrganizationPluginPageProps<
  TRole extends OrganizationPluginPageRole = OrganizationPluginAccessRole,
> {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  userRole: TRole;
  configuration: Record<string, unknown> | null;
}

export type OrganizationPluginPageRenderer = {
  bivarianceHack(
    props: OrganizationPluginPageProps<OrganizationPluginPageRole>,
  ): ReactNode | Promise<ReactNode>;
}["bivarianceHack"];

export type OrganizationPluginRouteRenderer = {
  bivarianceHack(
    routePath: string,
    props: OrganizationPluginPageProps<OrganizationPluginPageRole>,
  ): ReactNode | null | Promise<ReactNode | null>;
}["bivarianceHack"];

/**
 * Context passed to lifecycle hooks
 */
export interface OrganizationPluginLifecycleContext {
  organization: OrganizationPluginLifecycleOrganization;
  pluginKey: string;
  config?: Record<string, unknown>;
  previousConfig?: Record<string, unknown>;
  actor?: {
    id: string;
    type: "user" | "admin";
  };
}

/**
 * Lifecycle hooks for plugin events
 */
export interface OrganizationPluginLifecycleHooks {
  /**
   * Called when a plugin is first installed for an organization
   */
  onInstall?: (context: OrganizationPluginLifecycleContext) => Promise<void>;

  /**
   * No longer invoked by the platform's organization-initiated uninstall
   * transition (see `applyPluginControlPlaneTransition`'s `"uninstall"`
   * branch) — uninstall now only removes the install row and configuration,
   * running no plugin code, so data retention is a platform guarantee
   * rather than a claim about arbitrary plugin behavior. This hook is
   * retained solely as the compensating action the control plane runs to
   * roll back a plugin's `onInstall` side effects when a new install fails
   * after the hook succeeds but before persistence commits. Do not rely on
   * it running when an organization removes an already-installed plugin —
   * use `onDataDelete` for actual data erasure.
   */
  onUninstall?: (context: OrganizationPluginLifecycleContext) => Promise<void>;

  /**
   * Called when a plugin is enabled after being disabled
   */
  onEnable?: (context: OrganizationPluginLifecycleContext) => Promise<void>;

  /**
   * Called when a plugin is disabled
   */
  onDisable?: (context: OrganizationPluginLifecycleContext) => Promise<void>;

  /**
   * Called when plugin configuration is updated
   */
  onConfigUpdate?: (
    context: OrganizationPluginLifecycleContext,
  ) => Promise<void>;

  /**
   * Called when the plugin version is updated
   */
  onVersionUpdate?: (
    context: OrganizationPluginLifecycleContext & {
      previousVersion: string;
      newVersion: string;
    },
  ) => Promise<void>;

  /**
   * Called when an org requests permanent deletion of all plugin data.
   * Must delete ALL data in plugin_data schema for this org + plugin.
   * Used for GDPR compliance and clean org offboarding.
   */
  onDataDelete?: (context: OrganizationPluginLifecycleContext) => Promise<void>;

  /**
   * Called when a project is created.
   * Allows plugins to store custom project-scoped data.
   */
  onProjectCreate?: (
    context: OrganizationPluginLifecycleContext & {
      projectId: string;
      pluginData?: Record<string, unknown>;
    },
  ) => Promise<void>;

  /**
   * Called when a project is cloned.
   * Allows plugins to duplicate their own project-scoped data.
   */
  onProjectClone?: (
    context: OrganizationPluginLifecycleContext & {
      sourceProjectId: string;
      newProjectId: string;
    },
  ) => Promise<void>;

  /**
   * Called when a user or anonymous user signs up for a project.
   * Allows plugins to process signup data and custom form responses.
   */
  onSignup?: (
    context: OrganizationPluginLifecycleContext & {
      projectId: string;
      signupId: string;
      userId?: string | null;
      anonymousId?: string | null;
      formData?: Record<string, unknown> | null;
    },
  ) => Promise<void>;
}

export interface OrganizationPluginDefinition {
  manifest: OrganizationPluginManifest;
  /**
   * Lifecycle hooks for install/uninstall/enable/disable events
   */
  lifecycle?: OrganizationPluginLifecycleHooks;
  renderOrganizationPage?: (
    props: OrganizationPluginPageProps,
  ) => ReactNode | Promise<ReactNode>;
  renderOrganizationRoute?: (
    routePath: string,
    props: OrganizationPluginPageProps,
  ) => ReactNode | null | Promise<ReactNode | null>;
  renderSurface?: (
    surface: OrganizationPluginSurface,
    context: OrganizationPluginSurfaceRenderContext,
  ) => ReactNode | null | Promise<ReactNode | null>;
  /**
   * Sanitized data contributions for the platform /home feed. The platform
   * renders the items; plugins only return `PlatformFeedItemInput` DTOs.
   */
  resolvePlatformFeedItems?: (
    context: PlatformSurfaceContext,
  ) => Promise<PlatformFeedItemInput[]>;
  /**
   * Sanitized summary card for the platform /dashboard, or null when the
   * viewer has nothing to show.
   */
  resolvePlatformDashboardCard?: (
    context: PlatformSurfaceContext,
  ) => Promise<PlatformDashboardCard | null>;
  resolveBehaviorHook?: (
    hook: OrganizationPluginBehaviorHook,
    context: OrganizationPluginBehaviorHookContext,
  ) =>
    | OrganizationPluginBehaviorHookResultMap[OrganizationPluginBehaviorHook]
    | null
    | Promise<
        | OrganizationPluginBehaviorHookResultMap[OrganizationPluginBehaviorHook]
        | null
      >;
}

export interface ResolvedOrganizationPlugin {
  key: string;
  name: string;
  description?: string;
  navLabel: string;
  version: string;
  visibility: OrganizationPluginVisibility;
  minimumRole: OrganizationPluginAccessRole;
  installedAt: string | null;
  enabled: boolean;
  configuration: Record<string, unknown> | null;
  latestVersion: string;
  installedVersion: string;
  forceUpdateVersion: string | null;
  forceUpdateRequired: boolean;
}

export interface OrganizationPluginAdminSetting {
  key: string;
  name: string;
  description?: string;
  detailedDescription: string;
  ownerName: string;
  ownerType: OrganizationPluginOwnerType;
  capabilityHighlights: string[];
  dataAccess: string[];
  /**
   * Human-readable `dataAccess[].purpose` values only, deduplicated
   * server-side — never schema/relation identifiers. Feeds
   * `describePluginUninstallImpact` so the uninstall confirmation dialog
   * never has to interpolate internal relation names.
   */
  dataAccessPurposes: string[];
  visibility: OrganizationPluginVisibility;
  navLabel: string;
  version: string;
  minimumRole: OrganizationPluginAccessRole;
  availableInRuntime: boolean;
  entitled: boolean;
  isForced: boolean;
  installed: boolean;
  enabled: boolean;
  blockedReason: string | null;
  latestVersion: string;
  installedVersion: string | null;
  forceUpdateVersion: string | null;
  updateAvailable: boolean;
  forceUpdateRequired: boolean;
  codeRepository: string | null;
  codeReference: string | null;
  privateCodebase: boolean;
  lastUpdatedAt: string | null;
  configuration: Record<string, unknown> | null;
  configSchema: OrganizationPluginConfigSchema | null;
  requiredScopes: OrganizationPluginScope[];
  /**
   * Whether this plugin's manifest and lifecycle hooks satisfy
   * `getPluginDataDeletionReadiness` — the platform refuses permanent data
   * deletion for any plugin where this is false, regardless of admin
   * confirmation, so the settings UI uses it to decide whether to offer
   * the permanent-deletion action at all.
   */
  dataDeletionAvailable: boolean;
  /**
   * External systems `onDataDelete` cannot reach, from the manifest's
   * `dataDeletion.externalSystemsNotCovered`. Shown to the admin before
   * they confirm permanent deletion. Empty when deletion is unavailable or
   * the plugin declared no uncovered systems.
   */
  dataDeletionExternalSystemsNotCovered: string[];
}
