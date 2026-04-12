"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Columns3Cog,
  Loader2,
  Shield,
  Puzzle,
  Search,
  Settings2,
  Store,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OrganizationPluginAdminSetting } from "@/types";
import {
  getOrganizationPluginSettings,
  setOrganizationPluginInstallState,
  updateOrganizationPluginConfiguration,
  updateOrganizationPluginToLatest,
  type OrganizationPluginSettingsResult,
} from "./actions";

type OrganizationPluginSettingsProps = {
  organizationId: string;
};

type MarketplaceFilter = "all" | "installed" | "available" | "updates";
type SettingsEditorMode = "guided" | "json";
type ConfigSchemaProperty = NonNullable<
  OrganizationPluginAdminSetting["configSchema"]
>["properties"][string];
type ConfigFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "enum"
  | "unsupported";

type ConfigFieldDescriptor = {
  key: string;
  label: string;
  required: boolean;
  kind: ConfigFieldKind;
  property: ConfigSchemaProperty;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase())
    .trim();
}

function stringifyConfig(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2);
}

function resolveConfigFieldKind(property: ConfigSchemaProperty): ConfigFieldKind {
  if (Array.isArray(property.enum) && property.enum.length > 0) {
    return "enum";
  }

  if (property.type === "boolean") {
    return "boolean";
  }

  if (property.type === "number" || property.type === "integer") {
    return "number";
  }

  if (property.type === "string") {
    if (property.format === "textarea" || (property.maxLength ?? 0) > 180) {
      return "textarea";
    }

    return "text";
  }

  return "unsupported";
}

function encodeEnumValue(value: unknown): string {
  return JSON.stringify(value);
}

function decodeEnumValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function formatLastUpdated(lastUpdatedAt: string | null): string {
  if (!lastUpdatedAt) {
    return "Unknown";
  }

  const parsedDate = new Date(lastUpdatedAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown";
  }

  return `${formatDistanceToNowStrict(parsedDate, { addSuffix: true })}`;
}

export default function OrganizationPluginSettings({
  organizationId,
}: OrganizationPluginSettingsProps) {
  const [result, setResult] = useState<OrganizationPluginSettingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] =
    useState<MarketplaceFilter>("all");
  const [settingsPluginKey, setSettingsPluginKey] = useState<string | null>(null);
  const [settingsEditorMode, setSettingsEditorMode] =
    useState<SettingsEditorMode>("json");
  const [settingsValues, setSettingsValues] = useState<Record<string, unknown>>({});
  const [settingsJson, setSettingsJson] = useState("{}");
  const [settingsSaving, setSettingsSaving] = useState(false);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const settingsResult = await getOrganizationPluginSettings(organizationId);
      setResult(settingsResult);
    } catch {
      setResult({
        plugins: [],
        error: "Failed to load plugin settings. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, [organizationId]);

  const plugins = useMemo(() => result?.plugins ?? [], [result]);
  const enabledCount = useMemo(
    () => plugins.filter((plugin) => plugin.enabled).length,
    [plugins],
  );
  const installedCount = useMemo(
    () => plugins.filter((plugin) => plugin.installed).length,
    [plugins],
  );
  const updateCount = useMemo(
    () =>
      plugins.filter(
        (plugin) => plugin.installed && (plugin.updateAvailable || plugin.forceUpdateRequired),
      ).length,
    [plugins],
  );
  const activeSettingsPlugin = useMemo(
    () => plugins.find((plugin) => plugin.key === settingsPluginKey) ?? null,
    [plugins, settingsPluginKey],
  );

  const configFields = useMemo<ConfigFieldDescriptor[]>(() => {
    if (!activeSettingsPlugin?.configSchema) {
      return [];
    }

    const schema = activeSettingsPlugin.configSchema;
    const required = new Set(schema.required ?? []);

    return Object.entries(schema.properties).map(([key, property]) => ({
      key,
      label: property.title ?? formatFieldLabel(key),
      required: required.has(key),
      kind: resolveConfigFieldKind(property),
      property,
    }));
  }, [activeSettingsPlugin]);

  const guidedFields = useMemo(
    () => configFields.filter((field) => field.kind !== "unsupported"),
    [configFields],
  );
  const unsupportedFieldCount = useMemo(
    () => configFields.filter((field) => field.kind === "unsupported").length,
    [configFields],
  );

  const searchedPlugins = useMemo(() => {
    const term = marketplaceSearch.trim().toLowerCase();

    return plugins.filter((plugin) => {
      if (!term) {
        return true;
      }

      return [plugin.name, plugin.key, plugin.navLabel, plugin.description]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [marketplaceSearch, plugins]);

  const availablePlugins = useMemo(
    () => searchedPlugins.filter((plugin) => !plugin.installed),
    [searchedPlugins],
  );

  const installedPlugins = useMemo(() => {
    const base = searchedPlugins.filter((plugin) => plugin.installed);
    if (marketplaceFilter === "updates") {
      return base.filter(
        (plugin) => plugin.updateAvailable || plugin.forceUpdateRequired,
      );
    }

    return base;
  }, [marketplaceFilter, searchedPlugins]);

  const showAvailableSection =
    marketplaceFilter === "all" || marketplaceFilter === "available";
  const showInstalledSection =
    marketplaceFilter === "all" ||
    marketplaceFilter === "installed" ||
    marketplaceFilter === "updates";

  useEffect(() => {
    if (settingsPluginKey && settingsEditorMode === "guided") {
      setSettingsJson(stringifyConfig(settingsValues));
    }
  }, [settingsEditorMode, settingsPluginKey, settingsValues]);

  const handleTogglePlugin = async (
    plugin: OrganizationPluginAdminSetting,
    enabled: boolean,
  ) => {
    const pluginKey = plugin.key;
    setUpdatingActionId(`${pluginKey}:toggle`);
    const response = await setOrganizationPluginInstallState({
      organizationId,
      pluginKey,
      enabled,
    });

    if (!response.success) {
      toast.error(response.error || "Failed to update plugin state");
    } else {
      if (enabled && !plugin.installed) {
        toast.success("Plugin installed");
      } else if (enabled) {
        toast.success("Plugin enabled");
      } else {
        toast.success("Plugin disabled");
      }

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

  const handleOpenSettingsEditor = (plugin: OrganizationPluginAdminSetting) => {
    if (!plugin.installed) {
      toast.error("Install the plugin before editing its settings");
      return;
    }

    const initialValues = isPlainRecord(plugin.configuration) ? plugin.configuration : {};

    setSettingsPluginKey(plugin.key);
    setSettingsValues(initialValues);
    setSettingsJson(stringifyConfig(initialValues));
    setSettingsEditorMode(plugin.configSchema ? "guided" : "json");
  };

  const handleCloseSettingsEditor = () => {
    setSettingsPluginKey(null);
    setSettingsValues({});
    setSettingsJson("{}");
    setSettingsEditorMode("json");
  };

  const handleSettingsValueChange = (key: string, value: unknown) => {
    setSettingsValues((previous) => {
      const next = { ...previous };

      if (value === undefined || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }

      return next;
    });
  };

  const handleSaveSettings = async () => {
    if (!activeSettingsPlugin) {
      return;
    }

    let nextConfiguration: Record<string, unknown>;

    if (settingsEditorMode === "json") {
      const trimmed = settingsJson.trim();

      if (!trimmed) {
        nextConfiguration = {};
      } else {
        try {
          const parsed = JSON.parse(trimmed) as unknown;

          if (!isPlainRecord(parsed)) {
            toast.error("Plugin settings must be a JSON object");
            return;
          }

          nextConfiguration = parsed;
        } catch {
          toast.error("Plugin settings JSON is invalid");
          return;
        }
      }
    } else {
      nextConfiguration = settingsValues;
    }

    setSettingsSaving(true);

    const response = await updateOrganizationPluginConfiguration({
      organizationId,
      pluginKey: activeSettingsPlugin.key,
      configurationJson: JSON.stringify(nextConfiguration),
    });

    if (!response.success) {
      toast.error(response.error || "Failed to save plugin settings");
      setSettingsSaving(false);
      return;
    }

    toast.success(response.message || "Plugin settings saved");
    setSettingsSaving(false);
    handleCloseSettingsEditor();
    await loadSettings();
  };

  return (
    <>
      <Card id="organization-plugins">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="h-5 w-5" />
            Organization Plugins
          </CardTitle>
          <CardDescription>
            Browse public plugins, install what you need, and manage per-plugin settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading plugin settings...
            </div>
          ) : null}

          {!loading && result?.error ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to load plugins</AlertTitle>
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          ) : null}

          {!loading && result?.warning ? (
            <Alert>
              <AlertTitle>Plugin platform notice</AlertTitle>
              <AlertDescription>{result.warning}</AlertDescription>
            </Alert>
          ) : null}

          {!loading && !result?.error ? (
            <>
              <div className="flex flex-col gap-3 rounded-xl border bg-muted/25 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Plugin marketplace</p>
                  <p className="text-sm text-muted-foreground">
                    Discover public plugins and configure each one for your organization.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{plugins.length} available</Badge>
                    <Badge variant="secondary">{installedCount} installed</Badge>
                    <Badge variant="secondary">{enabledCount} enabled</Badge>
                    <Badge variant="secondary">{updateCount} updates pending</Badge>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() => setMarketplaceOpen(true)}
                  disabled={plugins.length === 0}
                >
                  <Store data-icon="inline-start" />
                  Open plugin marketplace
                </Button>
              </div>

              {plugins.length === 0 ? (
                <Empty className="py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Puzzle />
                    </EmptyMedia>
                    <EmptyTitle>No public plugins yet</EmptyTitle>
                    <EmptyDescription>
                      As new public plugins are released, they&apos;ll appear here automatically.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}

              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-md border bg-muted p-1.5">
                    <Columns3Cog className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Want something custom?</p>
                    <p className="text-sm text-muted-foreground">
                      Email <a href="mailto:contact@lets-assist.com">contact@lets-assist.com</a> and
                      we can build a custom plugin for your organization.
                    </p>
                    <ul className="ml-5 list-disc space-y-1 text-sm text-muted-foreground">
                      <li>Describe the workflow you want to automate.</li>
                      <li>Share required integrations and data sources.</li>
                      <li>Include your timeline, team size, and desired outcomes.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Store className="h-5 w-5" />
              Plugin marketplace
            </DialogTitle>
            <DialogDescription>
              Search and manage plugins for this organization.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <Field className="w-full lg:flex-1">
                <FieldLabel htmlFor="organization-plugin-search">Search plugins</FieldLabel>
                <FieldContent>
                  <InputGroup>
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="organization-plugin-search"
                      placeholder="Search by name, key, or description"
                      value={marketplaceSearch}
                      onChange={(event) => setMarketplaceSearch(event.target.value)}
                    />
                  </InputGroup>
                </FieldContent>
              </Field>

              <div className="flex flex-col gap-2 lg:min-w-80">
                <FieldTitle>Filter</FieldTitle>
              <ToggleGroup
                value={[marketplaceFilter]}
                onValueChange={(value) => {
                  const nextValue = value[0];
                  if (
                    nextValue === "all" ||
                    nextValue === "installed" ||
                    nextValue === "available" ||
                    nextValue === "updates"
                  ) {
                    setMarketplaceFilter(nextValue);
                  }
                }}
                spacing={2}
              >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="installed">Installed</ToggleGroupItem>
                <ToggleGroupItem value="available">Available</ToggleGroupItem>
                <ToggleGroupItem value="updates">Needs update</ToggleGroupItem>
              </ToggleGroup>
              </div>
            </div>

            <ScrollArea className="max-h-120 rounded-2xl border">
              <div className="flex flex-col gap-6 p-4">
                {showAvailableSection ? (
                  <section className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">Available to install</p>
                        <p className="text-xs text-muted-foreground">
                          New plugins your organization can activate.
                        </p>
                      </div>
                      <Badge variant="secondary">{availablePlugins.length}</Badge>
                    </div>

                    {availablePlugins.length === 0 ? (
                      <Empty className="rounded-xl border bg-muted/20 py-8">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Store />
                          </EmptyMedia>
                          <EmptyTitle>No available plugins in this view</EmptyTitle>
                          <EmptyDescription>
                            Try switching filters or clearing the search query.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <div className="grid gap-3">
                        {availablePlugins.map((plugin) => {
                          const isToggleUpdating = updatingActionId === `${plugin.key}:toggle`;
                          const isPrivatePlugin = plugin.visibility === "private";
                          const canInstall =
                            plugin.entitled && plugin.availableInRuntime && !isPrivatePlugin;

                          return (
                            <div
                              key={plugin.key}
                              className="rounded-xl border bg-card p-4"
                            >
                              <div className="min-w-0 flex-1 flex flex-col gap-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold">{plugin.name}</p>
                                    <Badge variant="outline">{plugin.navLabel}</Badge>
                                    <Badge variant={isPrivatePlugin ? "destructive" : "secondary"}>
                                      {isPrivatePlugin ? "Private" : "New"}
                                    </Badge>
                                  </div>

                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => handleTogglePlugin(plugin, true)}
                                    disabled={isToggleUpdating || !canInstall}
                                  >
                                    {isToggleUpdating ? (
                                      <>
                                        <Loader2 data-icon="inline-start" className="animate-spin" />
                                        Installing...
                                      </>
                                    ) : isPrivatePlugin ? (
                                      <>
                                        <Shield data-icon="inline-start" />
                                        Managed
                                      </>
                                    ) : (
                                      <>
                                        <Store data-icon="inline-start" />
                                        Install
                                      </>
                                    )}
                                  </Button>
                                </div>

                                {plugin.description ? (
                                  <p className="text-xs text-muted-foreground">{plugin.description}</p>
                                ) : null}

                                <p className="text-xs text-muted-foreground">
                                  <span className="font-mono">{plugin.key}</span> · Version{" "}
                                  {plugin.latestVersion} · Updated {formatLastUpdated(plugin.lastUpdatedAt)}
                                </p>

                                {plugin.requiredScopes.length > 0 ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {plugin.requiredScopes.slice(0, 3).map((scope) => (
                                      <Badge key={`${plugin.key}-${scope}`} variant="outline">
                                        {scope}
                                      </Badge>
                                    ))}
                                    {plugin.requiredScopes.length > 3 ? (
                                      <Badge variant="outline">
                                        +{plugin.requiredScopes.length - 3} more
                                      </Badge>
                                    ) : null}
                                  </div>
                                ) : null}

                                {!plugin.availableInRuntime ? (
                                  <p className="text-xs text-amber-700">
                                    Package is still syncing with this deployment.
                                  </p>
                                ) : null}

                                {isPrivatePlugin ? (
                                  <p className="text-xs text-muted-foreground">
                                    Private plugins are managed by the Let&apos;s Assist team.
                                  </p>
                                ) : null}

                                {!plugin.entitled && plugin.blockedReason ? (
                                  <p className="text-xs text-destructive">{plugin.blockedReason}</p>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : null}

                {showInstalledSection ? (
                  <section className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">Installed plugins</p>
                        <p className="text-xs text-muted-foreground">
                          Manage active plugins and update settings.
                        </p>
                      </div>
                      <Badge variant="secondary">{installedPlugins.length}</Badge>
                    </div>

                    {installedPlugins.length === 0 ? (
                      <Empty className="rounded-xl border bg-muted/20 py-8">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Puzzle />
                          </EmptyMedia>
                          <EmptyTitle>No installed plugins in this view</EmptyTitle>
                          <EmptyDescription>
                            Install a plugin to configure and manage it here.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <div className="grid gap-3">
                        {installedPlugins.map((plugin) => {
                          const isToggleUpdating = updatingActionId === `${plugin.key}:toggle`;
                          const isVersionUpdating = updatingActionId === `${plugin.key}:update`;
                          const isPrivatePlugin = plugin.visibility === "private";
                          const canToggle =
                            plugin.entitled && plugin.availableInRuntime && !isPrivatePlugin;
                          const canUpdate =
                            plugin.availableInRuntime &&
                            plugin.entitled &&
                            !isPrivatePlugin &&
                            (plugin.updateAvailable || plugin.forceUpdateRequired);

                          return (
                            <div
                              key={plugin.key}
                              className="rounded-xl border bg-card p-4"
                            >
                              <div className="min-w-0 flex-1 flex flex-col gap-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold">{plugin.name}</p>
                                    <Badge variant={plugin.enabled ? "default" : "secondary"}>
                                      {plugin.enabled ? "Active" : "Paused"}
                                    </Badge>
                                    <Badge variant={isPrivatePlugin ? "destructive" : "outline"}>
                                      {isPrivatePlugin ? "Private" : "Public"}
                                    </Badge>
                                    {plugin.updateAvailable ? (
                                      <Badge variant="outline">Update available</Badge>
                                    ) : null}
                                    {plugin.forceUpdateRequired ? (
                                      <Badge variant="destructive">Update required</Badge>
                                    ) : null}
                                  </div>
                                </div>

                                {plugin.description ? (
                                  <p className="text-xs text-muted-foreground">{plugin.description}</p>
                                ) : null}

                                <p className="text-xs text-muted-foreground">
                                  <span className="font-mono">{plugin.key}</span> · Installed{" "}
                                  {plugin.installedVersion || plugin.latestVersion}
                                  {plugin.updateAvailable ? ` · Latest ${plugin.latestVersion}` : ""} · Updated{" "}
                                  {formatLastUpdated(plugin.lastUpdatedAt)}
                                </p>

                                {!plugin.availableInRuntime ? (
                                  <p className="text-xs text-amber-700">
                                    Package is not loaded in this deployment yet.
                                  </p>
                                ) : null}

                                {isPrivatePlugin ? (
                                  <p className="text-xs text-muted-foreground">
                                    Private plugins are managed by the Let&apos;s Assist team.
                                  </p>
                                ) : null}

                                {plugin.blockedReason && !plugin.availableInRuntime ? null :
                                plugin.blockedReason ? (
                                  <p className="text-xs text-destructive">{plugin.blockedReason}</p>
                                ) : null}

                                <div className="flex flex-wrap justify-end gap-2 pt-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenSettingsEditor(plugin)}
                                    disabled={!plugin.availableInRuntime || isPrivatePlugin}
                                  >
                                    <Settings2 data-icon="inline-start" />
                                    Settings
                                  </Button>

                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleUpdatePlugin(plugin.key)}
                                    disabled={isVersionUpdating || !canUpdate}
                                  >
                                    {isVersionUpdating ? (
                                      <>
                                        <Loader2 data-icon="inline-start" className="animate-spin" />
                                        Updating...
                                      </>
                                    ) : (
                                      <>
                                        <Wrench data-icon="inline-start" />
                                        Update
                                      </>
                                    )}
                                  </Button>

                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={plugin.enabled ? "outline" : "default"}
                                    onClick={() => handleTogglePlugin(plugin, !plugin.enabled)}
                                    disabled={isToggleUpdating || !canToggle}
                                  >
                                    {isToggleUpdating ? (
                                      <>
                                        <Loader2 data-icon="inline-start" className="animate-spin" />
                                        Saving...
                                      </>
                                    ) : plugin.enabled ? (
                                      "Disable"
                                    ) : (
                                      "Enable"
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : null}

                {!showAvailableSection && !showInstalledSection ? (
                  <Empty className="py-8">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Search />
                      </EmptyMedia>
                      <EmptyTitle>No matching plugins</EmptyTitle>
                      <EmptyDescription>
                        Try a different search term or filter.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activeSettingsPlugin)}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseSettingsEditor();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {activeSettingsPlugin ? `${activeSettingsPlugin.name} settings` : "Plugin settings"}
            </DialogTitle>
            <DialogDescription>
              Configure this plugin for your organization. Changes apply only to your organization.
            </DialogDescription>
          </DialogHeader>

          {activeSettingsPlugin ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border bg-muted/25 p-3 text-xs text-muted-foreground">
                Plugin key <span className="font-mono">{activeSettingsPlugin.key}</span>
              </div>

              {activeSettingsPlugin.configSchema ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <FieldTitle>Editor mode</FieldTitle>
                    <ToggleGroup
                      value={[settingsEditorMode]}
                      onValueChange={(value) => {
                        const nextValue = value[0];
                        if (nextValue === "guided" || nextValue === "json") {
                          setSettingsEditorMode(nextValue);
                        }
                      }}
                      spacing={2}
                    >
                      <ToggleGroupItem value="guided">Guided</ToggleGroupItem>
                      <ToggleGroupItem value="json">JSON</ToggleGroupItem>
                    </ToggleGroup>
                  </div>

                  {settingsEditorMode === "guided" ? (
                    <>
                      <FieldGroup>
                        {guidedFields.map((field) => {
                          const rawValue = settingsValues[field.key] ?? field.property.default;

                          if (field.kind === "boolean") {
                            return (
                              <Field key={field.key} orientation="horizontal">
                                <Switch
                                  id={`plugin-setting-${field.key}`}
                                  checked={Boolean(rawValue)}
                                  onCheckedChange={(checked) =>
                                    handleSettingsValueChange(field.key, checked)
                                  }
                                />
                                <FieldContent>
                                  <FieldLabel htmlFor={`plugin-setting-${field.key}`}>
                                    {field.label}
                                  </FieldLabel>
                                  {field.property.description ? (
                                    <FieldDescription>{field.property.description}</FieldDescription>
                                  ) : null}
                                </FieldContent>
                              </Field>
                            );
                          }

                          if (field.kind === "enum") {
                            const enumValues = field.property.enum ?? [];
                            const encodedValues = enumValues.map((value) =>
                              encodeEnumValue(value),
                            );
                            const encodedCurrent =
                              rawValue === undefined
                                ? "__default__"
                                : encodeEnumValue(rawValue);
                            const selectedValue = encodedValues.includes(encodedCurrent)
                              ? encodedCurrent
                              : "__default__";

                            return (
                              <Field key={field.key}>
                                <FieldLabel htmlFor={`plugin-setting-${field.key}`}>
                                  {field.label}
                                  {field.required ? " *" : ""}
                                </FieldLabel>
                                <FieldContent>
                                  <NativeSelect
                                    id={`plugin-setting-${field.key}`}
                                    value={selectedValue}
                                    onChange={(event) => {
                                      const selected = event.target.value;
                                      if (selected === "__default__") {
                                        handleSettingsValueChange(field.key, undefined);
                                        return;
                                      }

                                      handleSettingsValueChange(
                                        field.key,
                                        decodeEnumValue(selected),
                                      );
                                    }}
                                  >
                                    <NativeSelectOption value="__default__">
                                      Use plugin default
                                    </NativeSelectOption>
                                    {enumValues.map((option, index) => {
                                      const encoded = encodeEnumValue(option);
                                      return (
                                        <NativeSelectOption
                                          key={`${field.key}-${index}`}
                                          value={encoded}
                                        >
                                          {String(option)}
                                        </NativeSelectOption>
                                      );
                                    })}
                                  </NativeSelect>
                                  {field.property.description ? (
                                    <FieldDescription>{field.property.description}</FieldDescription>
                                  ) : null}
                                </FieldContent>
                              </Field>
                            );
                          }

                          if (field.kind === "number") {
                            return (
                              <Field key={field.key}>
                                <FieldLabel htmlFor={`plugin-setting-${field.key}`}>
                                  {field.label}
                                  {field.required ? " *" : ""}
                                </FieldLabel>
                                <FieldContent>
                                  <Input
                                    id={`plugin-setting-${field.key}`}
                                    type="number"
                                    value={
                                      rawValue === undefined || rawValue === null
                                        ? ""
                                        : String(rawValue)
                                    }
                                    onChange={(event) => {
                                      const nextValue = event.target.value.trim();
                                      if (!nextValue) {
                                        handleSettingsValueChange(field.key, undefined);
                                        return;
                                      }

                                      const parsedNumber =
                                        field.property.type === "integer"
                                          ? Number.parseInt(nextValue, 10)
                                          : Number.parseFloat(nextValue);

                                      if (!Number.isNaN(parsedNumber)) {
                                        handleSettingsValueChange(field.key, parsedNumber);
                                      }
                                    }}
                                  />
                                  {field.property.description ? (
                                    <FieldDescription>{field.property.description}</FieldDescription>
                                  ) : null}
                                </FieldContent>
                              </Field>
                            );
                          }

                          if (field.kind === "textarea") {
                            return (
                              <Field key={field.key}>
                                <FieldLabel htmlFor={`plugin-setting-${field.key}`}>
                                  {field.label}
                                  {field.required ? " *" : ""}
                                </FieldLabel>
                                <FieldContent>
                                  <Textarea
                                    id={`plugin-setting-${field.key}`}
                                    value={typeof rawValue === "string" ? rawValue : ""}
                                    onChange={(event) =>
                                      handleSettingsValueChange(field.key, event.target.value)
                                    }
                                    className="min-h-28"
                                  />
                                  {field.property.description ? (
                                    <FieldDescription>{field.property.description}</FieldDescription>
                                  ) : null}
                                </FieldContent>
                              </Field>
                            );
                          }

                          return (
                            <Field key={field.key}>
                              <FieldLabel htmlFor={`plugin-setting-${field.key}`}>
                                {field.label}
                                {field.required ? " *" : ""}
                              </FieldLabel>
                              <FieldContent>
                                <Input
                                  id={`plugin-setting-${field.key}`}
                                  value={typeof rawValue === "string" ? rawValue : ""}
                                  onChange={(event) =>
                                    handleSettingsValueChange(field.key, event.target.value)
                                  }
                                />
                                {field.property.description ? (
                                  <FieldDescription>{field.property.description}</FieldDescription>
                                ) : null}
                              </FieldContent>
                            </Field>
                          );
                        })}
                      </FieldGroup>

                      {guidedFields.length === 0 ? (
                        <Alert>
                          <AlertTitle>No guided fields detected</AlertTitle>
                          <AlertDescription>
                            This plugin currently needs JSON mode for configuration.
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      {unsupportedFieldCount > 0 ? (
                        <Alert>
                          <AlertTitle>Some fields require JSON mode</AlertTitle>
                          <AlertDescription>
                            {unsupportedFieldCount} advanced field
                            {unsupportedFieldCount === 1 ? "" : "s"} can only be edited in
                            JSON mode.
                          </AlertDescription>
                        </Alert>
                      ) : null}
                    </>
                  ) : (
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="plugin-settings-json">Settings JSON</FieldLabel>
                        <FieldContent>
                          <Textarea
                            id="plugin-settings-json"
                            className="min-h-56 font-mono text-xs"
                            value={settingsJson}
                            onChange={(event) => setSettingsJson(event.target.value)}
                          />
                          <FieldDescription>
                            Use JSON mode for advanced fields and nested objects.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldGroup>
                  )}
                </div>
              ) : (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="plugin-settings-json">Settings JSON</FieldLabel>
                    <FieldContent>
                      <Textarea
                        id="plugin-settings-json"
                        className="min-h-56 font-mono text-xs"
                        value={settingsJson}
                        onChange={(event) => setSettingsJson(event.target.value)}
                      />
                      <FieldDescription>
                        This plugin does not expose a guided schema yet, so JSON mode is used.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldGroup>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCloseSettingsEditor}
                  disabled={settingsSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                >
                  {settingsSaving ? (
                    <>
                      <Loader2 data-icon="inline-start" className="animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Settings2 data-icon="inline-start" />
                      Save settings
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

    </>
  );
}