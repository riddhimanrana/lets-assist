"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Puzzle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getOrganizationPluginSettings,
  setOrganizationPluginInstallState,
  updateOrganizationPluginToLatest,
  type OrganizationPluginSettingsResult,
} from "./actions";

type OrganizationPluginSettingsProps = {
  organizationId: string;
};

export default function OrganizationPluginSettings({
  organizationId,
}: OrganizationPluginSettingsProps) {
  const [result, setResult] = useState<OrganizationPluginSettingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    const settingsResult = await getOrganizationPluginSettings(organizationId);
    setResult(settingsResult);
    setLoading(false);
  };

  useEffect(() => {
    loadSettings();
  }, [organizationId]);

  const plugins = useMemo(() => result?.plugins ?? [], [result]);

  const handleTogglePlugin = async (pluginKey: string, enabled: boolean) => {
    setUpdatingActionId(`${pluginKey}:toggle`);
    const response = await setOrganizationPluginInstallState({
      organizationId,
      pluginKey,
      enabled,
    });

    if (!response.success) {
      toast.error(response.error || "Failed to update plugin state");
    } else {
      toast.success(enabled ? "Plugin installed" : "Plugin disabled");
      await loadSettings();
    }

    setUpdatingActionId(null);
  };

  const handleUpdatePlugin = async (pluginKey: string) => {
    setUpdatingActionId(`${pluginKey}:update`);
    const response = await updateOrganizationPluginToLatest({
      organizationId,
      pluginKey,
    });

    if (!response.success) {
      toast.error(response.error || "Failed to update plugin");
    } else {
      toast.success("Plugin updated to latest version");
      await loadSettings();
    }

    setUpdatingActionId(null);
  };

  return (
    <Card id="organization-plugins">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Puzzle className="h-5 w-5" />
          Organization Plugins
        </CardTitle>
        <CardDescription>
          Install and manage plugins available for this organization.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading plugin settings...
          </div>
        ) : result?.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {result.error}
          </div>
        ) : result?.warning ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
            {result.warning}
          </div>
        ) : plugins.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            No plugins are available yet for this organization.
          </div>
        ) : (
          <div className="space-y-3">
            {plugins.map((plugin) => {
              const isToggleUpdating = updatingActionId === `${plugin.key}:toggle`;
              const isVersionUpdating = updatingActionId === `${plugin.key}:update`;
              const canInstallOrEnable = plugin.availableInRuntime && plugin.entitled;
              const canUpdate =
                plugin.installed &&
                plugin.availableInRuntime &&
                plugin.entitled &&
                (plugin.updateAvailable || plugin.forceUpdateRequired);
              const actionEnabled = !plugin.enabled;

              return (
                <div
                  key={plugin.key}
                  className="rounded-lg border border-border/60 bg-card p-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{plugin.name}</p>
                      <Badge variant={plugin.visibility === "global" ? "info" : "outline"}>
                        {plugin.visibility}
                      </Badge>
                      <Badge variant={plugin.enabled ? "default" : "secondary"}>
                        {plugin.enabled ? "enabled" : plugin.installed ? "installed" : "not installed"}
                      </Badge>
                      {plugin.forceUpdateRequired ? (
                        <Badge variant="destructive">force update required</Badge>
                      ) : null}
                    </div>
                    {plugin.description ? (
                      <p className="text-xs text-muted-foreground">{plugin.description}</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      Key: <span className="font-mono">{plugin.key}</span> • Runtime {plugin.version}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Installed {plugin.installedVersion || "—"} • Latest {plugin.latestVersion}
                      {plugin.forceUpdateVersion ? ` • Forced ${plugin.forceUpdateVersion}` : ""}
                    </p>
                    {plugin.codeRepository ? (
                      <p className="text-[11px] text-muted-foreground">
                        Source: {plugin.privateCodebase ? "private" : "shared"} • {plugin.codeRepository}
                        {plugin.codeReference ? `@${plugin.codeReference}` : ""}
                      </p>
                    ) : null}
                    {plugin.blockedReason ? (
                      <p className="text-xs text-amber-700">{plugin.blockedReason}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isVersionUpdating || !canUpdate}
                      onClick={() => handleUpdatePlugin(plugin.key)}
                    >
                      {isVersionUpdating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Updating...
                        </>
                      ) : (
                        "Update"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant={plugin.enabled ? "outline" : "default"}
                      disabled={isToggleUpdating || !canInstallOrEnable}
                      onClick={() => handleTogglePlugin(plugin.key, actionEnabled)}
                    >
                      {isToggleUpdating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : plugin.enabled ? (
                        "Disable"
                      ) : plugin.installed ? (
                        "Enable"
                      ) : (
                        "Install"
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}