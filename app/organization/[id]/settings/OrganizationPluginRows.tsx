"use client";

import {
  Loader2,
  MoreHorizontal,
  Settings2,
  ShieldAlert,
  Store,
  Trash2,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import type { OrganizationPluginAdminSetting } from "@/types";

import {
  formatLastUpdated,
  formatOwnerTypeLabel,
  type PluginRowActions,
} from "./organization-plugin-helpers";

/** A plugin the organization can install. */
export function AvailablePluginRow({
  plugin,
  actions,
}: {
  plugin: OrganizationPluginAdminSetting;
  actions: PluginRowActions;
}) {
  const isInstallUpdating =
    actions.updatingActionId === `${plugin.key}:install`;
  const isPrivatePlugin =
    plugin.visibility === "private" || plugin.privateCodebase;
  const canInstall = plugin.entitled && plugin.availableInRuntime;

  return (
    <Item variant="outline" className="items-start">
      <ItemContent className="min-w-48">
        <ItemTitle className="line-clamp-none flex-wrap">
          {plugin.name}
          <Badge variant="outline">{plugin.navLabel}</Badge>
          {isPrivatePlugin && <Badge variant="secondary">Private</Badge>}
          {plugin.isForced && <Badge variant="warning">Forced</Badge>}
        </ItemTitle>
        <ItemDescription>
          {plugin.detailedDescription ||
            plugin.description ||
            "No description available."}
        </ItemDescription>
        <p className="text-muted-foreground text-sm">
          {plugin.ownerName} · {formatOwnerTypeLabel(plugin.ownerType)} · v
          {plugin.latestVersion}
          {plugin.requiredScopes.length > 0
            ? ` · ${plugin.requiredScopes.length} permission${plugin.requiredScopes.length === 1 ? "" : "s"}`
            : ""}
        </p>
        {!plugin.entitled && plugin.blockedReason ? (
          <p className="text-destructive text-sm">{plugin.blockedReason}</p>
        ) : null}
        {!plugin.availableInRuntime ? (
          <p className="text-warning text-sm">
            Package is still syncing with this deployment.
          </p>
        ) : null}
      </ItemContent>

      <ItemActions className="flex-wrap">
        {plugin.dataDeletionAvailable ? (
          <Button
            type="button"
            variant="destructive-ghost"
            onClick={() => actions.onRequestDataDeletion(plugin)}
          >
            <ShieldAlert data-icon="inline-start" />
            Delete retained data
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => actions.onRequestAction(plugin, "install")}
          disabled={isInstallUpdating || !canInstall}
        >
          {isInstallUpdating ? (
            <>
              <Loader2 data-icon="inline-start" className="animate-spin" />
              Installing…
            </>
          ) : (
            <>
              <Store data-icon="inline-start" />
              Install
            </>
          )}
        </Button>
      </ItemActions>
    </Item>
  );
}

/**
 * An installed plugin: what it is, an enable switch, Configure, and the less
 * common actions (runtime switch, uninstall) in an overflow menu.
 */
export function InstalledPluginRow({
  plugin,
  actions,
}: {
  plugin: OrganizationPluginAdminSetting;
  actions: PluginRowActions;
}) {
  const { updatingActionId } = actions;
  const isToggleUpdating = updatingActionId === `${plugin.key}:toggle`;
  const isVersionUpdating = updatingActionId === `${plugin.key}:update`;
  const isRuntimeUpdating =
    updatingActionId === `${plugin.key}:application-runtime`;
  const isUninstalling = updatingActionId === `${plugin.key}:uninstall`;
  const isPrivatePlugin =
    plugin.visibility === "private" || plugin.privateCodebase;
  const canToggle =
    plugin.entitled && plugin.availableInRuntime && !plugin.isForced;
  const canUninstall = plugin.installed && !plugin.isForced;
  const canUpdate =
    plugin.availableInRuntime &&
    plugin.updateDeployedInRuntime &&
    plugin.entitled &&
    (plugin.updateAvailable || plugin.forceUpdateRequired);
  const applicationUpdateAvailable =
    plugin.applicationRuntime?.enabled === true &&
    plugin.applicationRuntime.selectedVersion !== null &&
    plugin.applicationRuntime.selectedVersion !==
      plugin.applicationRuntime.availableVersion;

  return (
    <Item variant="outline" className="items-start">
      <ItemContent className="min-w-48">
        <ItemTitle className="line-clamp-none flex-wrap">
          {plugin.name}
          {plugin.isForced && <Badge variant="warning">Forced</Badge>}
          {plugin.updateAvailable ? <Badge variant="info">Update</Badge> : null}
          {plugin.forceUpdateRequired ? (
            <Badge variant="destructive">Required</Badge>
          ) : null}
        </ItemTitle>
        <ItemDescription>
          {plugin.detailedDescription ||
            plugin.description ||
            "No description available."}
        </ItemDescription>
        <p className="text-muted-foreground text-sm">
          {plugin.ownerName} · {formatOwnerTypeLabel(plugin.ownerType)} ·
          Installed {plugin.installedVersion || plugin.latestVersion} · Updated{" "}
          {formatLastUpdated(plugin.lastUpdatedAt)}
        </p>

        {!plugin.availableInRuntime ? (
          <p className="text-warning text-sm">
            Package is not loaded in this deployment yet.
          </p>
        ) : null}

        {(plugin.updateAvailable || plugin.forceUpdateRequired) &&
        !plugin.updateDeployedInRuntime ? (
          <p className="text-warning text-sm">
            Update pending deployment. This version becomes installable after
            the platform deployment includes its code.
          </p>
        ) : null}

        {plugin.applicationRuntime ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                plugin.applicationRuntime.enabled ? "success" : "secondary"
              }
            >
              {plugin.applicationRuntime.enabled
                ? "Application active"
                : "Embedded active"}
            </Badge>
            {applicationUpdateAvailable ? (
              <Badge variant="info">
                {plugin.applicationRuntime.availableVersion} available
              </Badge>
            ) : null}
            <span className="text-muted-foreground text-sm">
              Application {plugin.applicationRuntime.version} ·{" "}
              {plugin.applicationRuntime.deploymentHealthy
                ? `Healthy on ${plugin.applicationRuntime.environment}`
                : `Waiting for a healthy ${plugin.applicationRuntime.environment} deployment`}
            </span>
          </div>
        ) : null}

        {plugin.blockedReason &&
        !plugin.availableInRuntime ? null : plugin.blockedReason ? (
          <p className="text-destructive text-sm">{plugin.blockedReason}</p>
        ) : null}
      </ItemContent>

      <ItemActions className="flex-wrap">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <Switch
            checked={plugin.enabled}
            aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`}
            onCheckedChange={(checked) => {
              actions.onToggle(plugin, checked);
            }}
            disabled={isToggleUpdating || !canToggle}
          />
          <span className="text-muted-foreground">
            {isToggleUpdating
              ? "Saving…"
              : plugin.enabled
                ? "Enabled"
                : "Disabled"}
          </span>
        </label>

        {plugin.applicationRuntime && applicationUpdateAvailable ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              actions.handleApplicationRuntime(plugin, true);
            }}
            disabled={isRuntimeUpdating || !plugin.applicationRuntime.canEnable}
          >
            {isRuntimeUpdating ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Updating application…
              </>
            ) : (
              `Update application ${plugin.applicationRuntime.availableVersion}`
            )}
          </Button>
        ) : null}

        {plugin.updateAvailable || plugin.forceUpdateRequired ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              actions.onUpdate(plugin.key);
            }}
            disabled={isVersionUpdating || !canUpdate}
          >
            {isVersionUpdating ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Updating…
              </>
            ) : (
              <>
                <Wrench data-icon="inline-start" />
                {plugin.updateDeployedInRuntime
                  ? "Update"
                  : "Update pending deployment"}
              </>
            )}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          onClick={() => actions.onConfigure(plugin)}
          disabled={!plugin.availableInRuntime || isPrivatePlugin}
        >
          <Settings2 data-icon="inline-start" />
          Configure
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`More actions for ${plugin.name}`}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {plugin.applicationRuntime ? (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    actions.handleApplicationRuntime(
                      plugin,
                      !plugin.applicationRuntime?.enabled,
                    );
                  }}
                  disabled={
                    isRuntimeUpdating ||
                    (!plugin.applicationRuntime.enabled &&
                      !plugin.applicationRuntime.canEnable)
                  }
                >
                  {isRuntimeUpdating
                    ? "Switching…"
                    : plugin.applicationRuntime.enabled
                      ? `Use embedded ${plugin.installedVersion || plugin.latestVersion}`
                      : `Use application ${plugin.applicationRuntime.availableVersion}`}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => actions.onRequestAction(plugin, "uninstall")}
              disabled={isUninstalling || !canUninstall}
            >
              <Trash2 />
              {isUninstalling
                ? "Uninstalling…"
                : plugin.isForced
                  ? "Uninstall (forced plugin)"
                  : "Uninstall"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}
