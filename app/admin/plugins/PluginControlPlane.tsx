"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PluginControlPlaneData } from "./actions";
import {
  forceInstallOrganizationPlugin,
  forceUpdateOrganizationPluginInstall,
  upsertOrganizationPluginInstallConfiguration,
  upsertOrganizationPluginEntitlement,
  upsertPluginCatalogControl,
} from "./actions";

type PluginControlPlaneProps = {
  data: PluginControlPlaneData;
};

type PluginFormState = {
  key: string;
  name: string;
  description: string;
  visibility: "global" | "private";
  isActive: boolean;
  latestVersion: string;
  forceUpdateVersion: string;
  privateCodebase: boolean;
  codeRepository: string;
  codeReference: string;
};

function emptyPluginForm(): PluginFormState {
  return {
    key: "",
    name: "",
    description: "",
    visibility: "private",
    isActive: true,
    latestVersion: "1.0.0",
    forceUpdateVersion: "",
    privateCodebase: true,
    codeRepository: "",
    codeReference: "main",
  };
}

export default function PluginControlPlane({ data }: PluginControlPlaneProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pluginForm, setPluginForm] = useState<PluginFormState>(emptyPluginForm());

  const [entitlementOrgId, setEntitlementOrgId] = useState(data.organizations[0]?.id ?? "");
  const [entitlementPluginKey, setEntitlementPluginKey] = useState(data.plugins[0]?.key ?? "");
  const [entitlementStatus, setEntitlementStatus] = useState<"active" | "inactive">("active");
  const [entitlementStartsAt, setEntitlementStartsAt] = useState("");
  const [entitlementEndsAt, setEntitlementEndsAt] = useState("");

  const [forceUpdateOrgId, setForceUpdateOrgId] = useState(data.organizations[0]?.id ?? "");
  const [forceUpdatePluginKey, setForceUpdatePluginKey] = useState(data.plugins[0]?.key ?? "");
  const [forceInstallActivatesEntitlement, setForceInstallActivatesEntitlement] = useState(true);

  const [configOrganizationId, setConfigOrganizationId] = useState(
    data.organizations[0]?.id ?? "",
  );
  const [configPluginKey, setConfigPluginKey] = useState(
    data.plugins[0]?.key ?? "",
  );
  const [installConfigurationJson, setInstallConfigurationJson] = useState(`{
  "targeting": {
    "mode": "any",
    "anonymousSignupIds": [],
    "userProfileIds": [],
    "userIds": [],
    "projectIds": [],
    "anonymousEmails": []
  }
}`);
  const pluginOptions = useMemo(
    () => data.plugins.map((plugin) => ({ key: plugin.key, name: plugin.name })),
    [data.plugins],
  );

  useEffect(() => {
    if (!configOrganizationId && data.organizations.length > 0) {
      setConfigOrganizationId(data.organizations[0].id);
    }
  }, [configOrganizationId, data.organizations]);

  useEffect(() => {
    if (!configPluginKey && data.plugins.length > 0) {
      setConfigPluginKey(data.plugins[0].key);
    }
  }, [configPluginKey, data.plugins]);

  const handleEditPlugin = (pluginKey: string) => {
    const plugin = data.plugins.find((row) => row.key === pluginKey);
    if (!plugin) return;

    setPluginForm({
      key: plugin.key,
      name: plugin.name,
      description: plugin.description ?? "",
      visibility: plugin.visibility,
      isActive: plugin.is_active,
      latestVersion: plugin.latest_version,
      forceUpdateVersion: plugin.force_update_version ?? "",
      privateCodebase: plugin.private_codebase,
      codeRepository: plugin.code_repository ?? "",
      codeReference: plugin.code_reference ?? "",
    });
  };

  const handleSavePlugin = () => {
    startTransition(async () => {
      const result = await upsertPluginCatalogControl({
        key: pluginForm.key,
        name: pluginForm.name,
        description: pluginForm.description,
        visibility: pluginForm.visibility,
        isActive: pluginForm.isActive,
        latestVersion: pluginForm.latestVersion,
        forceUpdateVersion: pluginForm.forceUpdateVersion || null,
        privateCodebase: pluginForm.privateCodebase,
        codeRepository: pluginForm.codeRepository || null,
        codeReference: pluginForm.codeReference || null,
      });

      if (!result.success) {
        toast.error(result.error || "Failed to save plugin controls");
        return;
      }

      toast.success("Plugin controls saved");
      router.refresh();
    });
  };

  const handleSaveEntitlement = () => {
    startTransition(async () => {
      const result = await upsertOrganizationPluginEntitlement({
        organizationId: entitlementOrgId,
        pluginKey: entitlementPluginKey,
        status: entitlementStatus,
        startsAt: entitlementStartsAt || null,
        endsAt: entitlementEndsAt || null,
      });

      if (!result.success) {
        toast.error(result.error || "Failed to save entitlement");
        return;
      }

      toast.success("Entitlement updated");
      router.refresh();
    });
  };

  const handleForceUpdate = () => {
    startTransition(async () => {
      const result = await forceUpdateOrganizationPluginInstall({
        organizationId: forceUpdateOrgId,
        pluginKey: forceUpdatePluginKey,
      });

      if (!result.success) {
        toast.error(result.error || "Force update failed");
        return;
      }

      toast.success("Force update applied to organization install");
      router.refresh();
    });
  };

  const handleForceInstall = () => {
    startTransition(async () => {
      const result = await forceInstallOrganizationPlugin({
        organizationId: forceUpdateOrgId,
        pluginKey: forceUpdatePluginKey,
        activateEntitlementForPrivate: forceInstallActivatesEntitlement,
      });

      if (!result.success) {
        toast.error(result.error || "Force install failed");
        return;
      }

      toast.success("Force install applied to organization");
      router.refresh();
    });
  };

  const handleSaveInstallConfiguration = () => {
    if (!configOrganizationId || !configPluginKey) {
      toast.error("Select both organization and plugin first");
      return;
    }

    startTransition(async () => {
      const result = await upsertOrganizationPluginInstallConfiguration({
        organizationId: configOrganizationId,
        pluginKey: configPluginKey,
        configurationJson: installConfigurationJson,
      });

      if (!result.success) {
        toast.error(result.error || "Failed to save install configuration");
        return;
      }

      toast.success(result.message || "Install configuration saved");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Plugin Catalog Control</CardTitle>
          <CardDescription>
            Manage private/global plugin metadata, source location, release versioning, and forced rollout floor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2">
            <Label>Existing plugins</Label>
            <div className="flex flex-wrap gap-2">
              {data.plugins.map((plugin) => (
                <Button
                  key={plugin.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditPlugin(plugin.key)}
                >
                  {plugin.name}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plugin-key">Plugin key</Label>
              <Input
                id="plugin-key"
                value={pluginForm.key}
                onChange={(event) => setPluginForm((prev) => ({ ...prev, key: event.target.value }))}
                placeholder="dv-members"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-name">Plugin name</Label>
              <Input
                id="plugin-name"
                value={pluginForm.name}
                onChange={(event) => setPluginForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="DV Members"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="plugin-description">Description</Label>
              <Input
                id="plugin-description"
                value={pluginForm.description}
                onChange={(event) =>
                  setPluginForm((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Private workflow automation for DV Speech & Debate"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-visibility">Visibility</Label>
              <select
                id="plugin-visibility"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={pluginForm.visibility}
                onChange={(event) =>
                  setPluginForm((prev) => ({
                    ...prev,
                    visibility: event.target.value as "global" | "private",
                  }))
                }
              >
                <option value="private">private</option>
                <option value="global">global</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-latest-version">Latest version</Label>
              <Input
                id="plugin-latest-version"
                value={pluginForm.latestVersion}
                onChange={(event) =>
                  setPluginForm((prev) => ({ ...prev, latestVersion: event.target.value }))
                }
                placeholder="1.4.0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-force-version">Force-update version (optional)</Label>
              <Input
                id="plugin-force-version"
                value={pluginForm.forceUpdateVersion}
                onChange={(event) =>
                  setPluginForm((prev) => ({ ...prev, forceUpdateVersion: event.target.value }))
                }
                placeholder="1.3.0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-repository">Code repository</Label>
              <Input
                id="plugin-repository"
                value={pluginForm.codeRepository}
                onChange={(event) =>
                  setPluginForm((prev) => ({ ...prev, codeRepository: event.target.value }))
                }
                placeholder="github.com/your-org/private-plugin-repo"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-reference">Code reference</Label>
              <Input
                id="plugin-reference"
                value={pluginForm.codeReference}
                onChange={(event) =>
                  setPluginForm((prev) => ({ ...prev, codeReference: event.target.value }))
                }
                placeholder="main"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="plugin-private-codebase"
                checked={pluginForm.privateCodebase}
                onCheckedChange={(checked) =>
                  setPluginForm((prev) => ({ ...prev, privateCodebase: checked }))
                }
              />
              <Label htmlFor="plugin-private-codebase">Private (not open-source) codebase</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="plugin-is-active"
                checked={pluginForm.isActive}
                onCheckedChange={(checked) =>
                  setPluginForm((prev) => ({ ...prev, isActive: checked }))
                }
              />
              <Label htmlFor="plugin-is-active">Plugin active in catalog</Label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSavePlugin} disabled={isPending}>
              Save plugin controls
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPluginForm(emptyPluginForm())}
              disabled={isPending}
            >
              New plugin draft
            </Button>
          </div>

          {data.plugins.length > 0 ? (
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Plugin</th>
                    <th className="px-3 py-2 text-left font-medium">Latest</th>
                    <th className="px-3 py-2 text-left font-medium">Force floor</th>
                    <th className="px-3 py-2 text-left font-medium">Installs</th>
                    <th className="px-3 py-2 text-left font-medium">Pending force</th>
                  </tr>
                </thead>
                <tbody>
                  {data.plugins.map((plugin) => (
                    <tr key={plugin.key} className="border-t">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{plugin.name}</span>
                          <Badge variant={plugin.visibility === "global" ? "info" : "outline"}>
                            {plugin.visibility}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">{plugin.key}</p>
                      </td>
                      <td className="px-3 py-2">{plugin.latest_version}</td>
                      <td className="px-3 py-2">{plugin.force_update_version || "—"}</td>
                      <td className="px-3 py-2">{plugin.installed_count}</td>
                      <td className="px-3 py-2">{plugin.force_pending_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organization Entitlements</CardTitle>
          <CardDescription>
            Grant or revoke access to private plugins for specific organizations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="entitlement-org">Organization</Label>
              <select
                id="entitlement-org"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={entitlementOrgId}
                onChange={(event) => setEntitlementOrgId(event.target.value)}
              >
                {data.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entitlement-plugin">Plugin</Label>
              <select
                id="entitlement-plugin"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={entitlementPluginKey}
                onChange={(event) => setEntitlementPluginKey(event.target.value)}
              >
                {pluginOptions.map((plugin) => (
                  <option key={plugin.key} value={plugin.key}>
                    {plugin.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entitlement-status">Status</Label>
              <select
                id="entitlement-status"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={entitlementStatus}
                onChange={(event) =>
                  setEntitlementStatus(event.target.value as "active" | "inactive")
                }
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="entitlement-start">Starts at (optional)</Label>
              <Input
                id="entitlement-start"
                type="datetime-local"
                value={entitlementStartsAt}
                onChange={(event) => setEntitlementStartsAt(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entitlement-end">Ends at (optional)</Label>
              <Input
                id="entitlement-end"
                type="datetime-local"
                value={entitlementEndsAt}
                onChange={(event) => setEntitlementEndsAt(event.target.value)}
              />
            </div>
          </div>

          <Button type="button" onClick={handleSaveEntitlement} disabled={isPending}>
            Save entitlement
          </Button>

          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Organization</th>
                  <th className="px-3 py-2 text-left font-medium">Plugin</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Window</th>
                </tr>
              </thead>
              <tbody>
                {data.entitlements.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      No entitlements configured yet.
                    </td>
                  </tr>
                ) : (
                  data.entitlements.map((entitlement) => (
                    <tr key={entitlement.id} className="border-t">
                      <td className="px-3 py-2">{entitlement.organization_name}</td>
                      <td className="px-3 py-2">{entitlement.plugin_key}</td>
                      <td className="px-3 py-2">
                        <Badge variant={entitlement.status === "active" ? "default" : "secondary"}>
                          {entitlement.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {entitlement.starts_at || "—"} → {entitlement.ends_at || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Force Install / Update Execution</CardTitle>
          <CardDescription>
            Platform override controls for organization-level plugin rollout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="force-update-org">Organization</Label>
              <select
                id="force-update-org"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={forceUpdateOrgId}
                onChange={(event) => setForceUpdateOrgId(event.target.value)}
              >
                {data.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="force-update-plugin">Plugin</Label>
              <select
                id="force-update-plugin"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={forceUpdatePluginKey}
                onChange={(event) => setForceUpdatePluginKey(event.target.value)}
              >
                {pluginOptions.map((plugin) => (
                  <option key={plugin.key} value={plugin.key}>
                    {plugin.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="force-install-entitlement"
              checked={forceInstallActivatesEntitlement}
              onCheckedChange={setForceInstallActivatesEntitlement}
            />
            <Label htmlFor="force-install-entitlement">
              Auto-activate entitlement for private plugins during force install
            </Label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={handleForceInstall} disabled={isPending}>
              Force install + update
            </Button>
            <Button type="button" variant="outline" onClick={handleForceUpdate} disabled={isPending}>
              Force update existing install
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Install Configuration (Targeting)</CardTitle>
          <CardDescription>
            Save per-organization plugin configuration JSON. Use <code>targeting</code> to scope
            features to specific signups/profiles/users/projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="config-org">Organization</Label>
              <select
                id="config-org"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={configOrganizationId}
                onChange={(event) => setConfigOrganizationId(event.target.value)}
              >
                {data.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="config-plugin">Plugin</Label>
              <select
                id="config-plugin"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={configPluginKey}
                onChange={(event) => setConfigPluginKey(event.target.value)}
              >
                {pluginOptions.map((plugin) => (
                  <option key={plugin.key} value={plugin.key}>
                    {plugin.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="install-config-json">Configuration JSON</Label>
            <Textarea
              id="install-config-json"
              className="min-h-55 font-mono text-xs"
              value={installConfigurationJson}
              onChange={(event) => setInstallConfigurationJson(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Example: {`{"targeting":{"mode":"any","anonymousSignupIds":[],"userProfileIds":[],"userIds":[],"projectIds":[],"anonymousEmails":[]}}`}
            </p>
          </div>

          <Button type="button" onClick={handleSaveInstallConfiguration} disabled={isPending}>
            Save install configuration
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}