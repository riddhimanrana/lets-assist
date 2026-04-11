"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PluginControlPlaneData } from "./actions";
import {
  bulkUpsertOrganizationPluginEntitlements,
  forceInstallOrganizationPlugin,
  forceUpdateOrganizationPluginInstall,
  setOrganizationPluginInstallStateByAdmin,
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

type PluginBrowserFilter = "all" | "global" | "private";

function getPluginHighlights(plugin: PluginControlPlaneData["plugins"][number]) {
  const items: string[] = [];

  if (plugin.key === "dv-speech-debate") {
    items.push("Org overview card", "Custom org tab", "Anonymous profile flow");
  }

  if (plugin.private_codebase) {
    items.push("Private repo source");
  }

  if (plugin.force_update_version) {
    items.push(`Force ≥ ${plugin.force_update_version}`);
  }

  return items.length > 0 ? items : ["No extra surfaces defined yet"];
}

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

function formatEntitlementWindowLabel(startsAt: string | null, endsAt: string | null): string {
  const startLabel = startsAt || "—";
  const endLabel = endsAt || "—";
  return `${startLabel} → ${endLabel}`;
}

export default function PluginControlPlane({ data }: PluginControlPlaneProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pluginForm, setPluginForm] = useState<PluginFormState>(emptyPluginForm());
  const [pluginBrowserOpen, setPluginBrowserOpen] = useState(false);
  const [pluginSearch, setPluginSearch] = useState("");
  const [pluginBrowserFilter, setPluginBrowserFilter] =
    useState<PluginBrowserFilter>("all");

  const [entitlementOrgId, setEntitlementOrgId] = useState(data.organizations[0]?.id ?? "");
  const [entitlementPluginKey, setEntitlementPluginKey] = useState(
    data.plugins.find((plugin) => plugin.visibility === "private")?.key ??
      data.plugins[0]?.key ??
      "",
  );
  const [entitlementStatus, setEntitlementStatus] = useState<"active" | "inactive">("active");
  const [entitlementStartsAt, setEntitlementStartsAt] = useState("");
  const [entitlementEndsAt, setEntitlementEndsAt] = useState("");
  const [entitlementSearch, setEntitlementSearch] = useState("");

  const [bulkEntitlementPluginKey, setBulkEntitlementPluginKey] = useState(
    data.plugins.find((plugin) => plugin.visibility === "private")?.key ?? "",
  );
  const [bulkEntitlementStatus, setBulkEntitlementStatus] =
    useState<"active" | "inactive">("active");
  const [bulkEntitlementStartsAt, setBulkEntitlementStartsAt] = useState("");
  const [bulkEntitlementEndsAt, setBulkEntitlementEndsAt] = useState("");
  const [bulkEntitlementIdentifiers, setBulkEntitlementIdentifiers] = useState("");

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

  const privatePluginOptions = useMemo(
    () =>
      data.plugins
        .filter((plugin) => plugin.visibility === "private")
        .map((plugin) => ({ key: plugin.key, name: plugin.name })),
    [data.plugins],
  );

  const pluginMetrics = useMemo(() => {
    const total = data.plugins.length;
    const globalCount = data.plugins.filter((plugin) => plugin.visibility === "global").length;
    const privateCount = total - globalCount;
    const activeCatalogCount = data.plugins.filter((plugin) => plugin.is_active).length;
    const totalInstalls = data.plugins.reduce(
      (count, plugin) => count + plugin.installed_count,
      0,
    );
    const forcePending = data.plugins.reduce(
      (count, plugin) => count + plugin.force_pending_count,
      0,
    );

    return {
      total,
      globalCount,
      privateCount,
      activeCatalogCount,
      totalInstalls,
      forcePending,
    };
  }, [data.plugins]);

  const filteredPlugins = useMemo(() => {
    const term = pluginSearch.trim().toLowerCase();
    return data.plugins.filter((plugin) => {
      const visibilityMatch =
        pluginBrowserFilter === "all" || plugin.visibility === pluginBrowserFilter;
      if (!visibilityMatch) return false;

      if (!term) return true;
      return [plugin.name, plugin.key, plugin.description]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [data.plugins, pluginBrowserFilter, pluginSearch]);

  const filteredEntitlements = useMemo(() => {
    const term = entitlementSearch.trim().toLowerCase();
    if (!term) {
      return data.entitlements;
    }

    return data.entitlements.filter((entitlement) =>
      [
        entitlement.organization_name,
        entitlement.organization_slug,
        entitlement.plugin_key,
        entitlement.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [data.entitlements, entitlementSearch]);

  useEffect(() => {
    if (!configOrganizationId && data.organizations.length > 0) {
      setConfigOrganizationId(data.organizations[0].id);
    }
  }, [configOrganizationId, data.organizations]);

  useEffect(() => {
    if (!entitlementOrgId && data.organizations.length > 0) {
      setEntitlementOrgId(data.organizations[0].id);
    }
  }, [data.organizations, entitlementOrgId]);

  useEffect(() => {
    if (!configPluginKey && data.plugins.length > 0) {
      setConfigPluginKey(data.plugins[0].key);
    }
  }, [configPluginKey, data.plugins]);

  useEffect(() => {
    if (!forceUpdatePluginKey && data.plugins.length > 0) {
      setForceUpdatePluginKey(data.plugins[0].key);
    }
  }, [data.plugins, forceUpdatePluginKey]);

  useEffect(() => {
    if (!forceUpdateOrgId && data.organizations.length > 0) {
      setForceUpdateOrgId(data.organizations[0].id);
    }
  }, [data.organizations, forceUpdateOrgId]);

  useEffect(() => {
    if (!bulkEntitlementPluginKey && privatePluginOptions.length > 0) {
      setBulkEntitlementPluginKey(privatePluginOptions[0].key);
    }
  }, [bulkEntitlementPluginKey, privatePluginOptions]);

  useEffect(() => {
    if (!entitlementPluginKey) {
      if (privatePluginOptions.length > 0) {
        setEntitlementPluginKey(privatePluginOptions[0].key);
      } else if (pluginOptions.length > 0) {
        setEntitlementPluginKey(pluginOptions[0].key);
      }
    }
  }, [entitlementPluginKey, pluginOptions, privatePluginOptions]);

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

  useEffect(() => {
    if (pluginForm.key || data.plugins.length === 0) return;
    handleEditPlugin(data.plugins[0].key);
  }, [data.plugins, pluginForm.key]);

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

  const handleLoadEntitlementForEdit = (
    entitlement: PluginControlPlaneData["entitlements"][number],
  ) => {
    setEntitlementOrgId(entitlement.organization_id);
    setEntitlementPluginKey(entitlement.plugin_key);
    setEntitlementStatus(entitlement.status);
    setEntitlementStartsAt(entitlement.starts_at ? entitlement.starts_at.slice(0, 16) : "");
    setEntitlementEndsAt(entitlement.ends_at ? entitlement.ends_at.slice(0, 16) : "");
    toast.success("Loaded entitlement into form");
  };

  const handleBulkSaveEntitlements = () => {
    if (!bulkEntitlementPluginKey) {
      toast.error("Pick a private plugin first");
      return;
    }

    if (!bulkEntitlementIdentifiers.trim()) {
      toast.error("Add organization IDs or usernames first");
      return;
    }

    startTransition(async () => {
      const result = await bulkUpsertOrganizationPluginEntitlements({
        pluginKey: bulkEntitlementPluginKey,
        organizationIdentifiers: bulkEntitlementIdentifiers,
        status: bulkEntitlementStatus,
        startsAt: bulkEntitlementStartsAt || null,
        endsAt: bulkEntitlementEndsAt || null,
      });

      if (!result.success) {
        toast.error(result.error || "Bulk entitlement update failed");
        return;
      }

      toast.success(result.message || "Bulk entitlement update applied");
      if (result.unmatchedIdentifiers && result.unmatchedIdentifiers.length > 0) {
        toast.info(`Unmatched: ${result.unmatchedIdentifiers.join(", ")}`);
      }
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

  const handleForceDisableInstall = () => {
    startTransition(async () => {
      const result = await setOrganizationPluginInstallStateByAdmin({
        organizationId: forceUpdateOrgId,
        pluginKey: forceUpdatePluginKey,
        enabled: false,
      });

      if (!result.success) {
        toast.error(result.error || "Force disable failed");
        return;
      }

      toast.success("Install forcibly disabled for organization");
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
    <Tabs defaultValue="catalog" className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/60">
          <CardContent className="pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Catalog</p>
            <p className="text-xl font-semibold">{pluginMetrics.total}</p>
            <p className="text-xs text-muted-foreground">
              {pluginMetrics.activeCatalogCount} active entries
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Visibility split</p>
            <p className="text-xl font-semibold">
              {pluginMetrics.globalCount} global / {pluginMetrics.privateCount} private
            </p>
            <p className="text-xs text-muted-foreground">Tier health at a glance</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Installs</p>
            <p className="text-xl font-semibold">{pluginMetrics.totalInstalls}</p>
            <p className="text-xs text-muted-foreground">Enabled org installations</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Rollout backlog</p>
            <p className="text-xl font-semibold">{pluginMetrics.forcePending}</p>
            <p className="text-xs text-muted-foreground">Pending force-upgrade installs</p>
          </CardContent>
        </Card>
      </div>

      <TabsList className="flex h-auto w-full gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1 md:grid md:grid-cols-4 md:overflow-visible">
        <TabsTrigger value="catalog" className="whitespace-nowrap px-4">Catalog</TabsTrigger>
        <TabsTrigger value="entitlements" className="whitespace-nowrap px-4">Access</TabsTrigger>
        <TabsTrigger value="deployments" className="whitespace-nowrap px-4">Rollouts</TabsTrigger>
        <TabsTrigger value="configuration" className="whitespace-nowrap px-4">Config</TabsTrigger>
      </TabsList>

      <TabsContent value="catalog" className="mt-6 space-y-4">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-2 border-b bg-muted/20">
          <CardTitle>Catalog source of truth</CardTitle>
          <CardDescription>
            Each row represents one plugin in the private repo-backed catalog. Version, visibility, and rollout floor should be edited here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <Label className="text-sm font-medium">Plugin browser</Label>
              <p className="text-xs text-muted-foreground">
                Pick a plugin to edit. Use search to quickly jump to the plugin you need.
              </p>
            </div>

              <div className="rounded-xl border bg-muted/20 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Currently editing</p>
                    <p className="text-xs text-muted-foreground">
                      {pluginForm.name || pluginForm.key} ({pluginForm.key})
                    </p>
                  </div>

                  <Dialog open={pluginBrowserOpen} onOpenChange={setPluginBrowserOpen}>
                    <DialogTrigger className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium shadow-xs transition-colors hover:bg-muted">
                      Choose plugin
                    </DialogTrigger>
                    <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>Choose plugin</DialogTitle>
                        <DialogDescription>
                          Search or scroll to pick the plugin you want to edit.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor="plugin-browser-filter" className="text-xs">
                              Visibility filter
                            </Label>
                            <select
                              id="plugin-browser-filter"
                              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                              value={pluginBrowserFilter}
                              onChange={(event) =>
                                setPluginBrowserFilter(
                                  event.target.value as PluginBrowserFilter,
                                )
                              }
                            >
                              <option value="all">all</option>
                              <option value="global">global</option>
                              <option value="private">private</option>
                            </select>
                          </div>
                        </div>

                        <Input
                          placeholder="Search by name, key, or description..."
                          value={pluginSearch}
                          onChange={(event) => setPluginSearch(event.target.value)}
                        />

                        <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                          {filteredPlugins.length === 0 ? (
                            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                              No plugins matched your search.
                            </p>
                          ) : (
                            filteredPlugins.map((plugin) => {
                              const sourceLabel = plugin.private_codebase ? "Private repo" : "Platform managed";
                              const rolloutLabel = plugin.force_update_version
                                ? `Force ≥ ${plugin.force_update_version}`
                                : "No forced rollout";

                              return (
                                <button
                                  key={plugin.key}
                                  type="button"
                                  onClick={() => {
                                    handleEditPlugin(plugin.key);
                                    setPluginBrowserOpen(false);
                                  }}
                                  className={cn(
                                    "w-full rounded-xl border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40",
                                    pluginForm.key === plugin.key && "border-primary bg-primary/5",
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-1">
                                      <p className="text-sm font-semibold">{plugin.name}</p>
                                      <p className="line-clamp-2 text-xs text-muted-foreground">
                                        {plugin.description || "No description available yet."}
                                      </p>
                                    </div>
                                    <Badge variant={plugin.is_active ? "default" : "secondary"} className="text-[10px] uppercase">
                                      {plugin.is_active ? "Active" : "Paused"}
                                    </Badge>
                                  </div>

                                  <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
                                    <div className="rounded-md bg-muted/40 px-2.5 py-1.5">{sourceLabel}</div>
                                    <div className="rounded-md bg-muted/40 px-2.5 py-1.5">v{plugin.latest_version}</div>
                                    <div className="rounded-md bg-muted/40 px-2.5 py-1.5">{rolloutLabel}</div>
                                  </div>

                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {getPluginHighlights(plugin).map((item) => (
                                      <Badge key={item} variant="secondary" className="text-[10px] font-normal">
                                        {item}
                                      </Badge>
                                    ))}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
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
            <>
              <div className="grid gap-3 md:hidden">
                {data.plugins.map((plugin) => (
                  <div key={plugin.key} className="rounded-xl border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{plugin.name}</p>
                        <p className="text-xs text-muted-foreground">{plugin.key}</p>
                      </div>
                      <Badge variant={plugin.visibility === "global" ? "info" : "outline"}>
                        {plugin.visibility}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-muted/40 px-2 py-1.5">Latest: {plugin.latest_version}</div>
                      <div className="rounded-md bg-muted/40 px-2 py-1.5">Installs: {plugin.installed_count}</div>
                      <div className="rounded-md bg-muted/40 px-2 py-1.5">
                        Force floor: {plugin.force_update_version || "—"}
                      </div>
                      <div className="rounded-md bg-muted/40 px-2 py-1.5">
                        Pending: {plugin.force_pending_count}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-hidden rounded-xl border md:block">
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
            </>
          ) : null}
        </CardContent>
      </Card>
      </TabsContent>
      
      <TabsContent value="entitlements" className="mt-6 space-y-4">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-2 border-b bg-muted/20">
          <CardTitle>Organization access</CardTitle>
          <CardDescription>
            Grant or revoke plugin access for one organization with optional activation windows.
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

          <div className="space-y-2">
            <Label htmlFor="entitlement-search">Search configured entitlements</Label>
            <Input
              id="entitlement-search"
              placeholder="Search by organization, slug, plugin key, or status"
              value={entitlementSearch}
              onChange={(event) => setEntitlementSearch(event.target.value)}
            />
          </div>

          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Organization</th>
                  <th className="px-3 py-2 text-left font-medium">Plugin</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Window</th>
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntitlements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No entitlements matched your current filter.
                    </td>
                  </tr>
                ) : (
                  filteredEntitlements.map((entitlement) => (
                    <tr key={entitlement.id} className="border-t">
                      <td className="px-3 py-2">{entitlement.organization_name}</td>
                      <td className="px-3 py-2">{entitlement.plugin_key}</td>
                      <td className="px-3 py-2">
                        <Badge variant={entitlement.status === "active" ? "default" : "secondary"}>
                          {entitlement.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatEntitlementWindowLabel(
                          entitlement.starts_at,
                          entitlement.ends_at,
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleLoadEntitlementForEdit(entitlement)}
                          disabled={isPending}
                        >
                          Edit in form
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-2 border-b bg-muted/20">
          <CardTitle>Bulk private plugin assignment</CardTitle>
          <CardDescription>
            Assign one private plugin to many organizations in one operation.
            Use organization IDs or usernames separated by comma/newline/space.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bulk-entitlement-plugin">Private plugin</Label>
              <select
                id="bulk-entitlement-plugin"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={bulkEntitlementPluginKey}
                onChange={(event) => setBulkEntitlementPluginKey(event.target.value)}
              >
                {privatePluginOptions.map((plugin) => (
                  <option key={plugin.key} value={plugin.key}>
                    {plugin.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulk-entitlement-status">Status</Label>
              <select
                id="bulk-entitlement-status"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={bulkEntitlementStatus}
                onChange={(event) =>
                  setBulkEntitlementStatus(event.target.value as "active" | "inactive")
                }
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulk-entitlement-start">Starts at (optional)</Label>
              <Input
                id="bulk-entitlement-start"
                type="datetime-local"
                value={bulkEntitlementStartsAt}
                onChange={(event) => setBulkEntitlementStartsAt(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulk-entitlement-end">Ends at (optional)</Label>
              <Input
                id="bulk-entitlement-end"
                type="datetime-local"
                value={bulkEntitlementEndsAt}
                onChange={(event) => setBulkEntitlementEndsAt(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-entitlement-identifiers">Organization IDs / usernames</Label>
            <Textarea
              id="bulk-entitlement-identifiers"
              className="min-h-32 font-mono text-xs"
              value={bulkEntitlementIdentifiers}
              onChange={(event) => setBulkEntitlementIdentifiers(event.target.value)}
              placeholder={"kofc6043\norganization-slug\ncb728d0e-1234-4ab7-8fde-ec18f04b1e12"}
            />
          </div>

          <Button type="button" onClick={handleBulkSaveEntitlements} disabled={isPending}>
            Apply bulk entitlement update
          </Button>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="deployments" className="mt-6 space-y-4">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="space-y-2 border-b bg-muted/20">
            <CardTitle>Rollout execution</CardTitle>
            <CardDescription>
              Override installs and force updates when a catalog change needs immediate rollout.
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
              <Button
                type="button"
                variant="destructive"
                onClick={handleForceInstall}
                disabled={isPending}
              >
                Force install + update
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleForceUpdate}
                disabled={isPending}
              >
                Force update existing install
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleForceDisableInstall}
                disabled={isPending}
              >
                Force disable install
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="configuration" className="mt-6 space-y-4">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="space-y-2 border-b bg-muted/20">
            <CardTitle>Install targeting</CardTitle>
            <CardDescription>
              Save per-organization plugin JSON, including targeting rules for signups, users,
              and projects.
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
                className="min-h-56 font-mono text-xs"
                value={installConfigurationJson}
                onChange={(event) => setInstallConfigurationJson(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Example: {`{"targeting":{"mode":"any","anonymousSignupIds":[],"userProfileIds":[],"userIds":[],"projectIds":[],"anonymousEmails":[]}}`}
              </p>
            </div>

            <Button
              type="button"
              onClick={handleSaveInstallConfiguration}
              disabled={isPending}
            >
              Save install configuration
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}