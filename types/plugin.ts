import type { ReactNode } from "react";

export type OrganizationPluginVisibility = "global" | "private";

export type OrganizationPluginAccessRole = "admin" | "staff" | "member";

/**
 * Plugin permission scopes for granular access control
 */
export type OrganizationPluginScope =
  | "org:read"           // Read organization data
  | "org:write"          // Modify organization settings
  | "members:read"       // Read member list
  | "members:write"      // Modify member roles
  | "projects:read"      // Read projects
  | "projects:write"     // Create/modify projects
  | "signups:read"       // Read anonymous signups
  | "signups:write"      // Modify signups
  | "notifications:send" // Send notifications
  | "storage:read"       // Read files
  | "storage:write"      // Upload files
  | "api:expose";        // Expose custom API endpoints

/**
 * Available surfaces where plugins can inject UI components
 */
export type OrganizationPluginSurface =
  | "organization.overview.cards"      // Cards on organization dashboard
  | "organization.settings.cards"      // Cards in organization settings
  | "anonymous.profile.cards"          // Cards on anonymous signup pages
  | "project.detail.cards"             // Cards on project detail pages
  | "project.detail.actions"           // Action buttons on project pages
  | "user.profile.cards"               // Cards on user profile pages
  | "dashboard.sidebar.items"          // Items in sidebar navigation
  | "dashboard.header.actions";        // Actions in header area

/**
 * Available behavior hooks for modifying application behavior
 */
export type OrganizationPluginBehaviorHook =
  | "anonymous.profile.experience"     // Modify anonymous signup experience
  | "organization.tabs"                // Add custom tabs to org dashboard
  | "project.create.validation"        // Validate project creation
  | "project.update.validation"        // Validate project updates
  | "signup.form.fields"               // Add custom fields to signup forms
  | "signup.submit.validation"         // Validate signup submissions
  | "notification.send.intercept"      // Intercept outgoing notifications
  | "organization.member.join"         // React to member joining
  | "organization.member.leave";       // React to member leaving

export type OrganizationPluginSurfaceAccessLevel =
  | OrganizationPluginAccessRole
  | "public";

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
  projectId?: string | null;
  anonymousEmail?: string | null;
}

export interface OrganizationPluginSurfaceRenderContext {
  organizationId: string;
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
  type: "text" | "email" | "tel" | "select" | "checkbox" | "textarea" | "number";
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;  // For select type
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
  suppress?: boolean;      // Don't send the notification
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
  handled?: boolean;  // Acknowledge processing
}

export interface OrganizationPluginBehaviorHookResultMap {
  "anonymous.profile.experience": AnonymousProfileExperienceBehavior;
  "organization.tabs": OrganizationTabBehavior[];
  "project.create.validation": ProjectValidationResult;
  "project.update.validation": ProjectValidationResult;
  "signup.form.fields": SignupFormField[];
  "signup.submit.validation": SignupValidationResult;
  "notification.send.intercept": NotificationInterceptResult;
  "organization.member.join": MemberEventResult;
  "organization.member.leave": MemberEventResult;
}

export interface OrganizationPluginBehaviorHookContext
  extends OrganizationPluginSurfaceRenderContext {
  hookInput?: Record<string, unknown>;
}

export interface OrganizationPluginManifest {
  key: string;
  name: string;
  description?: string;
  version: string;
  visibility: OrganizationPluginVisibility;
  minimumRole?: OrganizationPluginAccessRole;
  navLabel?: string;
  surfaceAccess?: OrganizationPluginSurfaceAccessPolicy;
  behaviorAccess?: OrganizationPluginBehaviorAccessPolicy;
}

export interface OrganizationPluginPageProps {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  userRole: OrganizationPluginAccessRole;
  configuration: Record<string, unknown> | null;
}

export interface OrganizationPluginDefinition {
  manifest: OrganizationPluginManifest;
  renderOrganizationPage?: (
    props: OrganizationPluginPageProps,
  ) => ReactNode | Promise<ReactNode>;
  renderSurface?: (
    surface: OrganizationPluginSurface,
    context: OrganizationPluginSurfaceRenderContext,
  ) => ReactNode | null | Promise<ReactNode | null>;
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
  visibility: OrganizationPluginVisibility;
  navLabel: string;
  version: string;
  minimumRole: OrganizationPluginAccessRole;
  availableInRuntime: boolean;
  entitled: boolean;
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
}