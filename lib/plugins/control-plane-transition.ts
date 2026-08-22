import "server-only";

import { logPluginAudit } from "@/lib/plugins/audit";
import {
  applyPluginControlPlaneTransition,
  pluginControlPlaneAuditDetails,
  PluginControlPlaneConcurrencyError,
  type PluginControlPlaneTransition,
  type PluginInstallMutation,
  type PluginInstallSnapshot,
  type PluginLifecycleInvocation,
} from "@/lib/plugins/control-plane-transition-core";
import {
  runPluginConfigUpdate,
  runPluginDisable,
  runPluginEnable,
  runPluginInstall,
  runPluginUninstall,
  runPluginVersionUpdate,
} from "@/lib/plugins/lifecycle";
import { getRegisteredPlugin } from "@/lib/plugins/registry";
import { getAdminClient } from "@/lib/supabase/admin";
import { hasActiveOrganizationAdminMembership } from "@/lib/organization/active-membership";
import type {
  OrganizationPluginAccessRole,
  OrganizationPluginLifecycleContext,
  OrganizationWithRole,
} from "@/types/plugin";

type OrganizationRow = {
  id: string;
  name: string;
  username: string | null;
  description: string | null;
  logo_url: string | null;
  type: string;
  verified: boolean | null;
  allowed_email_domains: string[] | null;
  show_members_publicly: boolean | null;
};

type InstallRow = {
  id: string;
  enabled: boolean;
  installed_version: string | null;
  configuration: Record<string, unknown> | null;
  updated_at: string;
};

export type PluginControlPlaneActor = {
  id: string;
  type: "user" | "admin";
};

type PluginControlPlaneInput = {
  organizationId: string;
  pluginKey: string;
  actor: PluginControlPlaneActor;
  organizationRole?: OrganizationPluginAccessRole;
  transition: PluginControlPlaneTransition;
};

type RegisteredPlugin = NonNullable<ReturnType<typeof getRegisteredPlugin>>;
type PluginAdminClient = ReturnType<typeof getAdminClient>;

const CONTROL_PLANE_LOCK_TTL_SECONDS = 900;

async function hasCurrentTransitionAuthority(
  service: PluginAdminClient,
  input: PluginControlPlaneInput,
): Promise<boolean> {
  if (input.actor.type === "admin") return true;
  return hasActiveOrganizationAdminMembership(
    service,
    input.organizationId,
    input.actor.id,
  );
}

async function requireCurrentTransitionAuthority(
  service: PluginAdminClient,
  input: PluginControlPlaneInput,
): Promise<void> {
  if (!(await hasCurrentTransitionAuthority(service, input))) {
    throw new Error(
      "A current active organization admin is required for plugin transitions.",
    );
  }
}

function organizationContext(
  organization: OrganizationRow,
  role: OrganizationPluginAccessRole,
): OrganizationWithRole {
  return {
    id: organization.id,
    name: organization.name,
    username: organization.username || organization.id,
    description: organization.description ?? undefined,
    logo_url: organization.logo_url ?? undefined,
    type: organization.type,
    verified: Boolean(organization.verified),
    allowed_email_domains: organization.allowed_email_domains,
    show_members_publicly: organization.show_members_publicly,
    role,
  };
}

function normalizedConfiguration(value: Record<string, unknown> | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function mutationRow(
  mutation: PluginInstallMutation,
  actorId: string,
  now: string,
) {
  return {
    ...(mutation.enabled === undefined ? {} : { enabled: mutation.enabled }),
    ...(mutation.installedVersion === undefined
      ? {}
      : { installed_version: mutation.installedVersion }),
    ...(mutation.configuration === undefined
      ? {}
      : { configuration: mutation.configuration }),
    ...(mutation.versionUpdated ? { last_version_update_at: now } : {}),
    updated_by: actorId,
    updated_at: now,
  };
}

async function transitionOrganizationPluginInstallWithLease(
  input: PluginControlPlaneInput,
  definition: RegisteredPlugin,
  service: PluginAdminClient,
  lockToken: string,
) {
  if (!(await hasCurrentTransitionAuthority(service, input))) {
    return {
      success: false,
      changed: false,
      actions: [],
      error:
        "A current active organization admin is required for plugin transitions.",
    };
  }

  async function refreshLease() {
    const { data, error } = await service.rpc(
      "refresh_plugin_control_plane_transition_lock",
      {
        p_organization_id: input.organizationId,
        p_plugin_key: input.pluginKey,
        p_lock_token: lockToken,
        p_ttl_seconds: CONTROL_PLANE_LOCK_TTL_SECONDS,
      },
    );
    if (error) {
      throw new Error(
        `Failed to refresh plugin transition lock: ${error.message}`,
      );
    }
    if (data !== true) {
      throw new PluginControlPlaneConcurrencyError(
        "Plugin transition lock expired; retry the operation.",
      );
    }
  }

  const [organizationResult, installResult] = await Promise.all([
    service
      .from("organizations")
      .select(
        "id, name, username, description, logo_url, type, verified, allowed_email_domains, show_members_publicly",
      )
      .eq("id", input.organizationId)
      .maybeSingle(),
    service
      .from("organization_plugin_installs")
      .select("id, enabled, installed_version, configuration, updated_at")
      .eq("organization_id", input.organizationId)
      .eq("plugin_key", input.pluginKey)
      .maybeSingle(),
  ]);

  if (organizationResult.error) {
    return {
      success: false,
      changed: false,
      actions: [],
      error: `Failed to load lifecycle organization context: ${organizationResult.error.message}`,
    };
  }
  if (!organizationResult.data) {
    return {
      success: false,
      changed: false,
      actions: [],
      error: "Organization was not found.",
    };
  }
  if (installResult.error) {
    return {
      success: false,
      changed: false,
      actions: [],
      error: `Failed to load plugin install state: ${installResult.error.message}`,
    };
  }

  const organization = organizationContext(
    organizationResult.data as OrganizationRow,
    input.organizationRole ?? "admin",
  );
  const install = installResult.data as InstallRow | null;
  let installLifecycleComplete = !definition.lifecycle?.onInstall;
  if (install && !installLifecycleComplete) {
    const { data: installAudits, error: installAuditError } = await service
      .from("plugin_audit_logs")
      .select("details")
      .eq("organization_id", input.organizationId)
      .eq("plugin_key", input.pluginKey)
      .eq("action", "lifecycle.install")
      .order("created_at", { ascending: false })
      .limit(20);
    if (installAuditError) {
      return {
        success: false,
        changed: false,
        actions: [],
        error: `Failed to verify plugin install lifecycle state: ${installAuditError.message}`,
      };
    }
    installLifecycleComplete = (installAudits ?? []).some((row) => {
      const details = row.details;
      return Boolean(
        details &&
        typeof details === "object" &&
        !Array.isArray(details) &&
        details.success === true,
      );
    });
  }
  const current: PluginInstallSnapshot | null = install
    ? {
        id: install.id,
        enabled: install.enabled,
        installedVersion:
          install.installed_version ?? definition.manifest.version,
        configuration: normalizedConfiguration(install.configuration),
        updatedAt: install.updated_at,
        installLifecycleComplete,
      }
    : null;

  const baseContext: Omit<OrganizationPluginLifecycleContext, "pluginKey"> = {
    organization,
    actor: input.actor,
  };

  async function runLifecycle(invocation: PluginLifecycleInvocation) {
    await refreshLease();
    await requireCurrentTransitionAuthority(service, input);
    switch (invocation.hook) {
      case "install":
        return runPluginInstall(definition, {
          ...baseContext,
          config: invocation.config,
        });
      case "enable":
        return runPluginEnable(definition, {
          ...baseContext,
          config: invocation.config,
        });
      case "disable":
        return runPluginDisable(definition, {
          ...baseContext,
          config: invocation.config,
        });
      case "uninstall":
        return runPluginUninstall(definition, {
          ...baseContext,
          config: invocation.config,
        });
      case "config_update":
        return runPluginConfigUpdate(definition, {
          ...baseContext,
          config: invocation.config,
          previousConfig: invocation.previousConfig,
        });
      case "version_update":
        return runPluginVersionUpdate(definition, {
          ...baseContext,
          config: invocation.config,
          previousVersion: invocation.previousVersion,
          newVersion: invocation.newVersion,
        });
    }
  }

  const result = await applyPluginControlPlaneTransition({
    current,
    transition: input.transition,
    callbacks: {
      runLifecycle,
      createInstall: async ({ enabled, installedVersion, configuration }) => {
        await refreshLease();
        await requireCurrentTransitionAuthority(service, input);
        const now = new Date().toISOString();
        const { error } = await service
          .from("organization_plugin_installs")
          .insert({
            organization_id: input.organizationId,
            plugin_key: input.pluginKey,
            enabled,
            configuration,
            installed_version: installedVersion,
            installed_by: input.actor.id,
            installed_at: now,
            updated_by: input.actor.id,
            last_version_update_at: now,
            updated_at: now,
          });
        if (error?.code === "23505")
          throw new PluginControlPlaneConcurrencyError();
        if (error) throw new Error(error.message);
      },
      updateInstall: async (mutation) => {
        if (!current)
          throw new Error("Plugin install state disappeared before update.");
        await refreshLease();
        await requireCurrentTransitionAuthority(service, input);
        const now = new Date().toISOString();
        const { data, error } = await service
          .from("organization_plugin_installs")
          .update(mutationRow(mutation, input.actor.id, now))
          .eq("id", current.id)
          .eq("organization_id", input.organizationId)
          .eq("plugin_key", input.pluginKey)
          .eq("updated_at", current.updatedAt)
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new PluginControlPlaneConcurrencyError();
      },
      removeInstall: async () => {
        if (!current)
          throw new Error("Plugin install state disappeared before uninstall.");
        await refreshLease();
        await requireCurrentTransitionAuthority(service, input);
        const { data, error } = await service
          .from("organization_plugin_installs")
          .delete()
          .eq("id", current.id)
          .eq("organization_id", input.organizationId)
          .eq("plugin_key", input.pluginKey)
          .eq("updated_at", current.updatedAt)
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new PluginControlPlaneConcurrencyError();
      },
    },
  });

  if (!result.success) {
    await logPluginAudit({
      organization_id: input.organizationId,
      plugin_key: input.pluginKey,
      action: "execution.error",
      actor_id: input.actor.id,
      actor_type: input.actor.type,
      details: {
        controlPlaneTransition: input.transition.kind,
        error: result.error,
      },
    });
    return result;
  }

  for (const action of result.actions) {
    await logPluginAudit({
      organization_id: input.organizationId,
      plugin_key: input.pluginKey,
      action,
      actor_id: input.actor.id,
      actor_type: input.actor.type,
      details: {
        controlPlaneTransition: input.transition.kind,
        ...pluginControlPlaneAuditDetails(action, {
          configuration: current?.configuration,
        }),
      },
    });
  }

  return result;
}

export async function transitionOrganizationPluginInstall(
  input: PluginControlPlaneInput,
) {
  const definition = getRegisteredPlugin(input.pluginKey);
  if (!definition) {
    return {
      success: false,
      changed: false,
      actions: [],
      error: "This plugin package is not loaded in the current deployment.",
    };
  }

  const targetVersion =
    input.transition.kind === "install_or_enable" ||
    input.transition.kind === "version_update"
      ? input.transition.targetVersion
      : null;
  if (targetVersion && targetVersion !== definition.manifest.version) {
    return {
      success: false,
      changed: false,
      actions: [],
      error:
        "The requested embedded plugin version is not loaded in this deployment.",
    };
  }

  const service = getAdminClient();
  if (!(await hasCurrentTransitionAuthority(service, input))) {
    return {
      success: false,
      changed: false,
      actions: [],
      error:
        "A current active organization admin is required for plugin transitions.",
    };
  }
  const lockToken = crypto.randomUUID();
  const { data: acquired, error: acquireError } = await service.rpc(
    "acquire_plugin_control_plane_transition_lock",
    {
      p_organization_id: input.organizationId,
      p_plugin_key: input.pluginKey,
      p_lock_token: lockToken,
      p_ttl_seconds: CONTROL_PLANE_LOCK_TTL_SECONDS,
    },
  );

  if (acquireError) {
    return {
      success: false,
      changed: false,
      actions: [],
      error: `Failed to acquire plugin transition lock: ${acquireError.message}`,
    };
  }
  if (acquired !== true) {
    return {
      success: false,
      changed: false,
      actions: [],
      error:
        "Another plugin transition is already running. Retry after it finishes.",
    };
  }

  try {
    return await transitionOrganizationPluginInstallWithLease(
      input,
      definition,
      service,
      lockToken,
    );
  } finally {
    try {
      const { error: releaseError } = await service.rpc(
        "release_plugin_control_plane_transition_lock",
        {
          p_organization_id: input.organizationId,
          p_plugin_key: input.pluginKey,
          p_lock_token: lockToken,
        },
      );
      if (releaseError) {
        await logPluginAudit({
          organization_id: input.organizationId,
          plugin_key: input.pluginKey,
          action: "execution.error",
          actor_id: input.actor.id,
          actor_type: input.actor.type,
          details: {
            controlPlaneTransition: input.transition.kind,
            error: `Failed to release plugin transition lock: ${releaseError.message}`,
          },
        });
      }
    } catch {
      // The lease expires automatically; release failures must not turn a
      // successfully persisted transition into a misleading client error.
    }
  }
}
