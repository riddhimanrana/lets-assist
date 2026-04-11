import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { hasSurfaceAccess, matchesPluginTargeting } from "@/lib/plugins/resolve-plugin-surfaces";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  AnonymousProfileExperienceBehavior,
  OrganizationPluginAccessRole,
  OrganizationPluginBehaviorHook,
  OrganizationPluginBehaviorHookResultMap,
  OrganizationPluginSurfaceRenderTargetContext,
  OrganizationPluginTargetingConfig,
} from "@/types";

export interface ResolveOrganizationPluginBehaviorHookOptions {
  organizationId: string;
  hook: OrganizationPluginBehaviorHook;
  viewerRole?: OrganizationPluginAccessRole | null;
  target?: OrganizationPluginSurfaceRenderTargetContext;
  hookInput?: Record<string, unknown>;
  useAdminClient?: boolean;
}

export interface ResolvedOrganizationPluginBehaviorContribution<
  THook extends OrganizationPluginBehaviorHook,
> {
  pluginKey: string;
  behavior: OrganizationPluginBehaviorHookResultMap[THook];
}

type PluginInstallRow = {
  plugin_key: string;
  enabled: boolean;
  configuration: Record<string, unknown> | null;
};

type PluginAccessRow = {
  plugin_key: string;
  enabled: boolean;
  is_accessible: boolean;
  configuration: Record<string, unknown> | null;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
};

function isMissingPluginTableError(error: SupabaseLikeError | null): boolean {
  if (!error) return false;

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    (typeof error.message === "string" && error.message.includes("does not exist"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTargetingConfig(value: unknown): OrganizationPluginTargetingConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const targeting = value as OrganizationPluginTargetingConfig;
  if (
    targeting.mode ||
    targeting.anonymousEmails ||
    targeting.anonymousSignupIds ||
    targeting.projectIds ||
    targeting.userIds ||
    targeting.userProfileIds
  ) {
    return targeting;
  }

  return undefined;
}

export async function resolveOrganizationPluginBehaviorHook<
  THook extends OrganizationPluginBehaviorHook,
>(
  options: ResolveOrganizationPluginBehaviorHookOptions & { hook: THook },
): Promise<Array<ResolvedOrganizationPluginBehaviorContribution<THook>>> {
  const supabase = options.useAdminClient ? getAdminClient() : await createClient();


  const pluginAccessResult = await supabase
    .from("organization_plugin_access")
    .select("plugin_key, enabled, is_accessible, configuration")
    .eq("organization_id", options.organizationId)
    .eq("enabled", true);

  let installRows: PluginInstallRow[] = [];

  if (!isMissingPluginTableError(pluginAccessResult.error)) {
    if (pluginAccessResult.error) {
      throw new Error(
        `Failed to load consolidated plugin access: ${pluginAccessResult.error.message}`,
      );
    }

    installRows = ((pluginAccessResult.data ?? []) as PluginAccessRow[])
      .filter((row) => row.is_accessible)
      .map((row) => ({
        plugin_key: row.plugin_key,
        enabled: row.enabled,
        configuration: row.configuration,
      }));
  } else {
    const { data: installs, error } = await supabase
      .from("organization_plugin_installs")
      .select("plugin_key, enabled, configuration")
      .eq("organization_id", options.organizationId)
      .eq("enabled", true);

    if (isMissingPluginTableError(error)) {
      return [];
    }

    if (error) {
      throw new Error(`Failed to load plugin installs: ${error.message}`);
    }

    installRows = (installs ?? []) as PluginInstallRow[];
  }

  const results: Array<ResolvedOrganizationPluginBehaviorContribution<THook>> = [];

  for (const install of installRows) {
    const plugin = getRegisteredPlugin(install.plugin_key);
    if (!plugin?.resolveBehaviorHook) {
      continue;
    }

    const requiredAccess =
      plugin.manifest.behaviorAccess?.[options.hook] ??
      plugin.manifest.minimumRole ??
      "member";

    if (!hasSurfaceAccess(requiredAccess, options.viewerRole)) {
      continue;
    }

    const configuration = isRecord(install.configuration)
      ? (install.configuration as Record<string, unknown>)
      : null;

    const targeting = toTargetingConfig(configuration?.targeting);
    if (!matchesPluginTargeting(targeting, options.target)) {
      continue;
    }

    const behavior = await plugin.resolveBehaviorHook(options.hook, {
      organizationId: options.organizationId,
      pluginConfiguration: configuration,
      viewerRole: options.viewerRole,
      target: options.target,
      hookInput: options.hookInput,
    });

    if (!behavior) {
      continue;
    }

    results.push({
      pluginKey: install.plugin_key,
      behavior: behavior as OrganizationPluginBehaviorHookResultMap[THook],
    });
  }

  return results;
}

export function mergeAnonymousProfileExperienceBehaviors(
  behaviors: AnonymousProfileExperienceBehavior[],
): AnonymousProfileExperienceBehavior | null {
  if (behaviors.length === 0) {
    return null;
  }

  return behaviors.reduce<AnonymousProfileExperienceBehavior>((acc, behavior) => {
    return {
      bannerMessage: behavior.bannerMessage ?? acc.bannerMessage,
      hideLinkingSection:
        behavior.hideLinkingSection === true
          ? true
          : (acc.hideLinkingSection ?? false),
      disableSlotCancellation:
        behavior.disableSlotCancellation === true
          ? true
          : (acc.disableSlotCancellation ?? false),
      cancellationDisabledReason:
        behavior.cancellationDisabledReason ?? acc.cancellationDisabledReason,
      primaryActions: [
        ...(acc.primaryActions ?? []),
        ...(behavior.primaryActions ?? []),
      ],
    };
  }, {});
}
