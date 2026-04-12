"use client";

import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  Check,
  Columns3Cog,
  Info,
  Loader2,
  Puzzle,
  Search,
  Settings2,
  Shield,
  Store,
  Trash2,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OrganizationPluginAdminSetting, OrganizationPluginScope } from "@/types";
import {
  getOrganizationPluginSettings,
  setOrganizationPluginInstallState,
  uninstallOrganizationPlugin,
  updateOrganizationPluginConfiguration,
  updateOrganizationPluginToLatest,
  type OrganizationPluginSettingsResult,
} from "./actions";

type OrganizationPluginSettingsProps = {
  organizationId: string;
};

type MarketplaceFilter = "all" | "installed" | "available" | "updates";
type SettingsEditorMode = "guided" | "json";
type PluginActionIntent = "install" | "uninstall";

type PluginActionConfirmation = {
  plugin: OrganizationPluginAdminSetting;
  intent: PluginActionIntent;
} | null;

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

function formatOwnerTypeLabel(
  ownerType: OrganizationPluginAdminSetting["ownerType"],
): string {
  switch (ownerType) {
    case "partner":
      return "Partner";
    case "community":
      return "Community";
    case "platform-official":
    default:
      return "Platform official";
  }
}

function formatScopeLabel(scope: OrganizationPluginScope): string {
  switch (scope) {
    case "org:read":
      return "Read organization data";
    case "org:write":
      return "Modify organization settings";
    case "members:read":
      return "Read member list";
    case "members:write":
      return "Manage members and roles";
    case "projects:read":
      return "Read projects";
    case "projects:write":
      return "Create or modify projects";
    case "signups:read":
      return "Read anonymous signups";
    case "signups:write":
      return "Modify anonymous signups";
    case "notifications:send":
      return "Send notifications";
    case "storage:read":
      return "Read storage files";
    case "storage:write":
      return "Upload and modify storage files";
    case "api:expose":
      return "Expose custom API endpoints";
    default:
      return scope;
  }
}

function formatLastUpdated(lastUpdatedAt: string | null | undefined): string {
  if (!lastUpdatedAt) {
    return "Unknown";
  }

  const parsedDate = new Date(lastUpdatedAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown";
  }

  return formatDistanceToNowStrict(parsedDate, { addSuffix: true });
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
  const [pluginActionConfirmation, setPluginActionConfirmation] =
    useState<PluginActionConfirmation>(null);
  const [installConsentChecked, setInstallConsentChecked] = useState(false);
  const [settingsPluginKey, setSettingsPluginKey] = useState<string | null>(null);
  const [settingsEditorMode, setSettingsEditorMode] =
    useState<SettingsEditorMode>("json");
  const [settingsValues, setSettingsValues] = useState<Record<string, unknown>>({});
  const [settingsJson, setSettingsJson] = useState("{}");
  const [settingsSaving, setSettingsSaving] = useState(false);

  const loadSettings = useCallback(async () => {
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
  }, [organizationId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

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

  const activePluginActionId = pluginActionConfirmation
    ? `${pluginActionConfirmation.plugin.key}:${pluginActionConfirmation.intent}`
    : null;
  const activePluginAction = pluginActionConfirmation?.plugin ?? null;
  const isInstallAction = pluginActionConfirmation?.intent === "install";
  const isPluginActionSubmitting =
    Boolean(activePluginActionId) && updatingActionId === activePluginActionId;

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

      const searchableText = [
        plugin.name,
        plugin.key,
        plugin.navLabel,
        plugin.description ?? "",
        plugin.detailedDescription,
        plugin.ownerName,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(term);
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

  const visiblePluginCount =
    (showAvailableSection ? availablePlugins.length : 0) +
    (showInstalledSection ? installedPlugins.length : 0);
  const useMarketplaceScroll = visiblePluginCount > 1;

  useEffect(() => {
    if (settingsPluginKey && settingsEditorMode === "guided") {
      setSettingsJson(stringifyConfig(settingsValues));
    }
  }, [settingsEditorMode, settingsPluginKey, settingsValues]);

  const handleTogglePlugin = async (
    plugin: OrganizationPluginAdminSetting,
    enabled: boolean,
  ) => {
    setUpdatingActionId(`${plugin.key}:toggle`);

    const response = await setOrganizationPluginInstallState({
      organizationId,
      pluginKey: plugin.key,
      enabled,
    });

    if (!response.success) {
      toast.error(response.error || "Failed to update plugin state");
      setUpdatingActionId(null);
      return;
    }

    if (enabled && !plugin.installed) {
      toast.success("Plugin installed");
    } else if (enabled) {
      toast.success("Plugin enabled");
    } else {
      toast.success("Plugin disabled");
    }

    await loadSettings();
    setUpdatingActionId(null);
  };

  const handleRequestPluginAction = (
    plugin: OrganizationPluginAdminSetting,
    intent: PluginActionIntent,
  ) => {
    setInstallConsentChecked(false);
    setPluginActionConfirmation({ plugin, intent });
  };

  const handleConfirmPluginAction = async () => {
    if (!pluginActionConfirmation) {
      return;
    }

    if (pluginActionConfirmation.intent === "install" && !installConsentChecked) {
      toast.error("Please confirm plugin data access before installing.");
      return;
    }

    const {
      intent,
      plugin: { key: pluginKey, name: pluginName },
    } = pluginActionConfirmation;
    const actionId = `${pluginKey}:${intent}`;
    setUpdatingActionId(actionId);

    const response =
      intent === "install"
        ? await setOrganizationPluginInstallState({
            organizationId,
            pluginKey,
            enabled: true,
          })
        : await uninstallOrganizationPlugin({
            organizationId,
            pluginKey,
          });

    if (!response.success) {
      toast.error(response.error || "Failed to update plugin state");
      setUpdatingActionId(null);
      return;
    }

    toast.success(
      intent === "install"
        ? `${pluginName} installed successfully`
        : `${pluginName} uninstalled successfully`,
    );

    setPluginActionConfirmation(null);
    setInstallConsentChecked(false);
    await loadSettings();
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
      setUpdatingActionId(null);
      return;
    }

    toast.success("Plugin updated to latest version");
    await loadSettings();
    setUpdatingActionId(null);
  };

  const handleOpenSettingsEditor = (plugin: OrganizationPluginAdminSetting) => {
    if (!plugin.installed) {
      toast.error("Install the plugin before editing its settings");
      return;
    }

    const initialValues = isPlainRecord(plugin.configuration)
      ? plugin.configuration
      : {};

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
    setSettingsSaving(false);
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
    handleCloseSettingsEditor();
    await loadSettings();
  };

  const renderAvailablePluginCard = (plugin: OrganizationPluginAdminSetting) => {
    const isInstallUpdating = updatingActionId === `${plugin.key}:install`;
    const isPrivatePlugin = plugin.visibility === "private" || plugin.privateCodebase;
    const canInstall =
      plugin.entitled && plugin.availableInRuntime && !isPrivatePlugin;

    return (
      <div key={plugin.key} className="rounded-lg border border-border/70 bg-background px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{plugin.name}</p>
              <Badge variant="outline">{plugin.navLabel}</Badge>
              <Badge variant={isPrivatePlugin ? "destructive" : "secondary"}>
                {isPrivatePlugin ? "Private" : "Available"}
              </Badge>
            </div>

            <p className="line-clamp-2 text-xs text-muted-foreground">
              {plugin.detailedDescription || plugin.description || "No description available."}
            </p>

            <p className="text-xs text-muted-foreground">
              {plugin.ownerName} · {formatOwnerTypeLabel(plugin.ownerType)} · v{plugin.latestVersion}
              {plugin.requiredScopes.length > 0
                ? ` · ${plugin.requiredScopes.length} permission${plugin.requiredScopes.length === 1 ? "" : "s"}`
                : ""}
            </p>

            {!plugin.entitled && plugin.blockedReason ? (
              <p className="text-xs text-destructive">{plugin.blockedReason}</p>
            ) : null}

            {!plugin.availableInRuntime ? (
              <p className="text-xs text-amber-700">
                Package is still syncing with this deployment.
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => handleRequestPluginAction(plugin, "install")}
            disabled={isInstallUpdating || !canInstall}
          >
            {isInstallUpdating ? (
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
      </div>
    );
  };

  const renderInstalledPluginCard = (plugin: OrganizationPluginAdminSetting) => {
    const isToggleUpdating = updatingActionId === `${plugin.key}:toggle`;
    const isVersionUpdating = updatingActionId === `${plugin.key}:update`;
    const isUninstalling = updatingActionId === `${plugin.key}:uninstall`;
    const isPrivatePlugin = plugin.visibility === "private" || plugin.privateCodebase;
    const canToggle = plugin.entitled && plugin.availableInRuntime && !isPrivatePlugin;
    const canUninstall = plugin.installed && !isPrivatePlugin;
    const canUpdate =
      plugin.availableInRuntime &&
      plugin.entitled &&
      !isPrivatePlugin &&
      (plugin.updateAvailable || plugin.forceUpdateRequired);

    return (
      <div key={plugin.key} className="rounded-lg border border-border/70 bg-background px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{plugin.name}</p>
              <Badge variant={plugin.enabled ? "default" : "secondary"}>
                {plugin.enabled ? "Enabled" : "Disabled"}
              </Badge>
              {plugin.updateAvailable ? <Badge variant="outline">Update</Badge> : null}
              {plugin.forceUpdateRequired ? <Badge variant="destructive">Required</Badge> : null}
            </div>

            <p className="line-clamp-2 text-xs text-muted-foreground">
              {plugin.detailedDescription || plugin.description || "No description available."}
            </p>

            <p className="text-xs text-muted-foreground">
              {plugin.ownerName} · {formatOwnerTypeLabel(plugin.ownerType)} · Installed{" "}
              {plugin.installedVersion || plugin.latestVersion} · Updated {formatLastUpdated(plugin.lastUpdatedAt)}
            </p>

            {!plugin.availableInRuntime ? (
              <p className="text-xs text-amber-700">
                Package is not loaded in this deployment yet.
              </p>
            ) : null}

            {plugin.blockedReason && !plugin.availableInRuntime ? null : plugin.blockedReason ? (
              <p className="text-xs text-destructive">{plugin.blockedReason}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
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

            {plugin.updateAvailable || plugin.forceUpdateRequired ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void handleUpdatePlugin(plugin.key);
                }}
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
            ) : null}

            <Button
              type="button"
              size="sm"
              variant={plugin.enabled ? "outline" : "default"}
              onClick={() => {
                void handleTogglePlugin(plugin, !plugin.enabled);
              }}
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

            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => handleRequestPluginAction(plugin, "uninstall")}
              disabled={isUninstalling || !canUninstall}
            >
              {isUninstalling ? (
                <>
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                  Uninstalling...
                </>
              ) : (
                <>
                  <Trash2 data-icon="inline-start" />
                  Uninstall
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const marketplaceSections = (
    <>
      {showAvailableSection ? (
        <section className="flex flex-col gap-3 pt-2">
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
            <div className="grid gap-3">{availablePlugins.map(renderAvailablePluginCard)}</div>
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
            <div className="grid gap-3">{installedPlugins.map(renderInstalledPluginCard)}</div>
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
            <EmptyDescription>Try a different search term or filter.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </>
  );

  return (
    <>
      <Card id="organization-plugins">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="size-5" />
            Organization Plugins
          </CardTitle>
          <CardDescription>
            Browse available plugins, install what you need, and manage per-plugin settings.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
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
                    <EmptyTitle>No plugins yet</EmptyTitle>
                    <EmptyDescription>
                      As new plugins are released, they&apos;ll appear here automatically.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}

              <div className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-md border bg-muted p-1.5">
                    <Columns3Cog className="size-4 text-muted-foreground" />
                  </span>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold">Want something custom?</p>
                    <p className="text-sm text-muted-foreground">
                      Email <a href="mailto:contact@lets-assist.com">contact@lets-assist.com</a> and
                      we can build a custom plugin for your organization.
                    </p>
                    <div className="ml-5 flex list-disc flex-col gap-1 text-sm text-muted-foreground">
                      <li>Describe the workflow you want to automate.</li>
                      <li>Share required integrations and data sources.</li>
                      <li>Include your timeline, team size, and desired outcomes.</li>
                    </div>
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
              <Store className="size-5" />
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
                      placeholder="Search by name, key, owner, or description"
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

            {useMarketplaceScroll ? (
              <ScrollArea className="max-h-120 rounded-2xl border">
                <div className="flex flex-col gap-6 p-4">{marketplaceSections}</div>
              </ScrollArea>
            ) : (
              <div className="rounded-2xl border p-4">
                <div className="flex flex-col gap-6">{marketplaceSections}</div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pluginActionConfirmation)}
        onOpenChange={(open: boolean) => {
          if (!open && !isPluginActionSubmitting) {
            setPluginActionConfirmation(null);
            setInstallConsentChecked(false);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-md gap-0 p-0 overflow-hidden">
          {activePluginAction ? (
            <>
              <div className="flex flex-col items-center text-center px-6 pt-8 pb-6">
                <div className="relative mb-5 flex size-14 items-center justify-center rounded-2xl border bg-secondary/30 shadow-sm">
                  {isInstallAction ? (
                    <Store className="size-6 text-primary" />
                  ) : (
                    <Trash2 className="size-6 text-destructive" />
                  )}
                  {isInstallAction && (
                    <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary ring-2 ring-background">
                      <Check className="size-3 text-primary-foreground" />
                    </div>
                  )}
                </div>

                <AlertDialogTitle className="text-xl font-semibold">
                  {isInstallAction
                    ? `Install ${activePluginAction.name}?`
                    : `Uninstall ${activePluginAction.name}?`}
                </AlertDialogTitle>

                <AlertDialogDescription className="mt-2 text-center text-sm text-muted-foreground w-[90%]">
                  {isInstallAction
                    ? `Are you sure you want to add this plugin to your organization?`
                    : "This will remove the plugin and its settings from your organization immediately."}
                </AlertDialogDescription>
              </div>

              <div className="flex flex-col gap-4 border-y bg-muted/20 px-6 py-5">
                {isInstallAction ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {activePluginAction.name}
                        </span>
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">
                          {formatOwnerTypeLabel(activePluginAction.ownerType)}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        by {activePluginAction.ownerName} &middot; v{activePluginAction.version}
                      </span>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {activePluginAction.detailedDescription}
                      </p>
                    </div>

                    <div className="mt-2 flex flex-col gap-3 rounded-lg border bg-background/50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        This plugin requests access to:
                      </p>
                      <ul className="flex flex-col gap-2.5">
                        {activePluginAction.requiredScopes.length > 0 ||
                        activePluginAction.dataAccess.length > 0 ? (
                          <>
                            {activePluginAction.requiredScopes.map((scope) => (
                              <li
                                key={`${activePluginAction.key}-scope-${scope}`}
                                className="flex items-start gap-2.5 text-sm text-foreground"
                              >
                                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                                <span>{formatScopeLabel(scope)}</span>
                              </li>
                            ))}
                            {activePluginAction.dataAccess.map((entry) => (
                              <li
                                key={`${activePluginAction.key}-data-${entry}`}
                                className="flex items-start gap-2.5 text-sm text-foreground"
                              >
                                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                                <span>{entry}</span>
                              </li>
                            ))}
                          </>
                        ) : (
                          <li className="flex items-center gap-2.5 text-sm text-muted-foreground">
                            <Info className="size-4 shrink-0" />
                            <span>No additional data access required.</span>
                          </li>
                        )}
                      </ul>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <p className="text-sm text-destructive font-medium leading-relaxed">
                      All plugin workflows will stop, and your settings will be permanently lost. This cannot be undone.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 bg-background p-6">
                {isInstallAction && (
                  <label className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1 hover:bg-muted/50 group transition-colors">
                    <Checkbox
                      checked={installConsentChecked}
                      onCheckedChange={(checked) => setInstallConsentChecked(checked === true)}
                    />
                    <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      I approve installing this plugin and grant the requested access.
                    </span>
                  </label>
                )}

                <AlertDialogFooter className="sm:justify-between w-full">
                  <AlertDialogCancel
                    disabled={isPluginActionSubmitting}
                    className="w-full m-0 sm:w-auto sm:flex-1"
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant={isInstallAction ? "default" : "destructive"}
                    onClick={(e) => {
                      e.preventDefault();
                      void handleConfirmPluginAction();
                    }}
                    disabled={isPluginActionSubmitting || (isInstallAction && !installConsentChecked)}
                    className="w-full sm:w-auto sm:flex-1 mt-2 sm:mt-0 sm:ml-2"
                  >
                    {isPluginActionSubmitting ? (
                      <>
                        <Loader2 data-icon="inline-start" className="animate-spin" />
                        {isInstallAction ? "Installing..." : "Removing..."}
                      </>
                    ) : isInstallAction ? (
                      "Install Plugin"
                    ) : (
                      "Yes, Uninstall"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </div>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

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
                <p>
                  Plugin key <span className="font-mono">{activeSettingsPlugin.key}</span>
                </p>
                <p className="mt-1">
                  Owner: {activeSettingsPlugin.ownerName} ·{" "}
                  {formatOwnerTypeLabel(activeSettingsPlugin.ownerType)}
                </p>
                <p className="mt-1">
                  Last updated {formatLastUpdated(activeSettingsPlugin.lastUpdatedAt)}
                </p>
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
                            {unsupportedFieldCount === 1 ? "" : "s"} can only be edited in JSON mode.
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
                <Button type="button" onClick={handleSaveSettings} disabled={settingsSaving}>
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
