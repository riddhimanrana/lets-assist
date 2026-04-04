import type { ReactNode } from "react";

export type OrganizationPluginVisibility = "global" | "private";

export type OrganizationPluginAccessRole = "admin" | "staff" | "member";

export type OrganizationPluginSurface =
  | "organization.overview.cards"
  | "anonymous.profile.cards";

export type OrganizationPluginBehaviorHook =
  | "anonymous.profile.experience"
  | "organization.tabs";

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

export interface OrganizationPluginBehaviorHookResultMap {
  "anonymous.profile.experience": AnonymousProfileExperienceBehavior;
  "organization.tabs": OrganizationTabBehavior[];
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