"use client";

import { Puzzle, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrganizationPluginAdminSetting } from "@/types";

import {
  getOrganizationPluginSettings,
  setOrganizationPluginApplicationRuntime,
  setOrganizationPluginInstallState,
  uninstallOrganizationPlugin,
  updateOrganizationPluginToLatest,
  type OrganizationPluginSettingsResult,
} from "./actions";
import {
  type PluginActionConfirmation,
  type PluginActionIntent,
  type PluginRowActions,
} from "./organization-plugin-helpers";
import { OrganizationPluginActionDialog } from "./OrganizationPluginActionDialog";
import { OrganizationPluginConfigDialog } from "./OrganizationPluginConfigDialog";
import { OrganizationPluginMarketplaceDialog } from "./OrganizationPluginMarketplaceDialog";
import { InstalledPluginRow } from "./OrganizationPluginRows";
import { PluginPermanentDeletionDialog } from "./PluginPermanentDeletionDialog";
import { usePluginSettingsEditor } from "./usePluginSettingsEditor";

type OrganizationPluginSettingsProps = {
  organizationId: string;
  organizationName: string;
};

export default function OrganizationPluginSettings({
  organizationId,
  organizationName,
}: OrganizationPluginSettingsProps) {
  const applicationRuntimeRequestIds = useRef(new Map<string, string>());
  const [result, setResult] = useState<OrganizationPluginSettingsResult | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [pluginActionConfirmation, setPluginActionConfirmation] =
    useState<PluginActionConfirmation>(null);
  const [installConsentChecked, setInstallConsentChecked] = useState(false);
  const [pluginPendingDataDeletion, setPluginPendingDataDeletion] =
    useState<OrganizationPluginAdminSetting | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const settingsResult =
        await getOrganizationPluginSettings(organizationId);
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
        (plugin) =>
          plugin.installed &&
          (plugin.updateAvailable || plugin.forceUpdateRequired),
      ).length,
    [plugins],
  );

  const settingsEditor = usePluginSettingsEditor({
    organizationId,
    plugins,
    loadSettings,
  });
  const installedPluginList = useMemo(
    () => plugins.filter((plugin) => plugin.installed),
    [plugins],
  );

  const activePluginActionId = pluginActionConfirmation
    ? `${pluginActionConfirmation.plugin.key}:${pluginActionConfirmation.intent}`
    : null;
  const isPluginActionSubmitting =
    Boolean(activePluginActionId) && updatingActionId === activePluginActionId;

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

  const handleRequestDataDeletion = (
    plugin: OrganizationPluginAdminSetting,
  ) => {
    setPluginPendingDataDeletion(plugin);
  };

  const handleConfirmPluginAction = async () => {
    if (!pluginActionConfirmation) {
      return;
    }

    if (
      pluginActionConfirmation.intent === "install" &&
      !installConsentChecked
    ) {
      toast.error("Please confirm plugin data access before installing.");
      return;
    }

    const {
      intent,
      plugin: { key: pluginKey, name: pluginName },
    } = pluginActionConfirmation;
    const actionId = `${pluginKey}:${intent}`;
    setUpdatingActionId(actionId);

    try {
      const response: {
        success: boolean;
        error?: string;
        message?: string;
        changed?: boolean;
      } =
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
        toast.error(
          response.error || "Something went wrong — please try again.",
        );
        return;
      }

      if (intent === "install") {
        toast.success(`${pluginName} installed successfully`);
      } else if (response.changed === false) {
        toast.success(`${pluginName} was already uninstalled`, {
          description: response.message,
        });
      } else {
        toast.success(`${pluginName} uninstalled`, {
          description: response.message,
        });
      }

      setPluginActionConfirmation(null);
      setInstallConsentChecked(false);
      await loadSettings();
    } catch {
      toast.error("Connection error — please try again.");
    } finally {
      setUpdatingActionId(null);
    }
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

  const handleApplicationRuntime = async (
    plugin: OrganizationPluginAdminSetting,
    enabled: boolean,
  ) => {
    setUpdatingActionId(`${plugin.key}:application-runtime`);
    const targetVersion = enabled
      ? plugin.applicationRuntime?.availableVersion
      : undefined;
    const requestKey = [
      plugin.key,
      enabled ? "application" : "embedded",
      targetVersion ?? "none",
      plugin.applicationRuntime?.enabled ? "enabled" : "disabled",
      plugin.applicationRuntime?.selectedVersion ?? "none",
    ].join(":");
    const requestId =
      applicationRuntimeRequestIds.current.get(requestKey) ??
      crypto.randomUUID();
    applicationRuntimeRequestIds.current.set(requestKey, requestId);
    try {
      const response = await setOrganizationPluginApplicationRuntime({
        organizationId,
        pluginKey: plugin.key,
        enabled,
        targetVersion,
        expectedEnabled: plugin.applicationRuntime?.enabled === true,
        expectedVersion:
          plugin.applicationRuntime?.selectedVersion ?? undefined,
        requestId,
      });

      if (!response.success) {
        toast.error(response.error || "Failed to change the plugin runtime");
        return;
      }

      applicationRuntimeRequestIds.current.delete(requestKey);

      toast.success(
        enabled
          ? `Application ${targetVersion} enabled`
          : `Embedded ${plugin.installedVersion || plugin.latestVersion} restored`,
      );
      await loadSettings();
    } catch {
      toast.error("Connection error. Retry the same change safely.");
    } finally {
      setUpdatingActionId(null);
    }
  };

  const rowActions: PluginRowActions = {
    updatingActionId,
    onToggle: (plugin, enabled) => {
      void handleTogglePlugin(plugin, enabled);
    },
    onRequestAction: handleRequestPluginAction,
    onRequestDataDeletion: handleRequestDataDeletion,
    onUpdate: (pluginKey) => {
      void handleUpdatePlugin(pluginKey);
    },
    handleApplicationRuntime: (plugin, enabled) => {
      void handleApplicationRuntime(plugin, enabled);
    },
    onConfigure: settingsEditor.handleOpenSettingsEditor,
  };

  return (
    <>
      <SettingsSection
        id="organization-plugins"
        title="Organization plugins"
        description="Installed plugins and their settings. Embedded plugin code ships through a platform deployment before an update can be installed."
        footerHint={
          <>
            Want something custom? Email{" "}
            <a
              href="mailto:contact@lets-assist.com"
              className="hover:text-foreground underline underline-offset-4"
            >
              contact@lets-assist.com
            </a>{" "}
            and we can build a plugin for your organization.
          </>
        }
        footer={
          result && !result.error ? (
            <Button
              type="button"
              onClick={() => setMarketplaceOpen(true)}
              disabled={plugins.length === 0}
            >
              <Store data-icon="inline-start" />
              Open plugin marketplace
            </Button>
          ) : null
        }
      >
        {loading && !result ? (
          <div
            className="grid gap-2"
            role="status"
            aria-label="Loading plugin settings"
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}

        {result?.error ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to load plugins</AlertTitle>
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        ) : null}

        {result?.warning ? (
          <Alert variant="warning">
            <AlertTitle>Plugin platform notice</AlertTitle>
            <AlertDescription>{result.warning}</AlertDescription>
          </Alert>
        ) : null}

        {result && !result.error ? (
          plugins.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Puzzle />
                </EmptyMedia>
                <EmptyTitle>No plugins yet</EmptyTitle>
                <EmptyDescription>
                  As new plugins are released, they&apos;ll appear here
                  automatically.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : installedPluginList.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Puzzle />
                </EmptyMedia>
                <EmptyTitle>No plugins installed</EmptyTitle>
                <EmptyDescription>
                  {plugins.length} plugin{plugins.length === 1 ? "" : "s"}{" "}
                  available. Open the marketplace to install one.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                {installedCount} installed · {enabledCount} enabled ·{" "}
                {updateCount} update{updateCount === 1 ? "" : "s"} pending ·{" "}
                {plugins.length} in the marketplace
              </p>
              <ItemGroup className="gap-3">
                {installedPluginList.map((plugin) => (
                  <InstalledPluginRow
                    key={plugin.key}
                    plugin={plugin}
                    actions={rowActions}
                  />
                ))}
              </ItemGroup>
            </>
          )
        ) : null}
      </SettingsSection>

      <OrganizationPluginMarketplaceDialog
        open={marketplaceOpen}
        onOpenChange={setMarketplaceOpen}
        plugins={plugins}
        actions={rowActions}
      />

      <OrganizationPluginActionDialog
        confirmation={pluginActionConfirmation}
        installConsentChecked={installConsentChecked}
        onInstallConsentChange={setInstallConsentChecked}
        submitting={isPluginActionSubmitting}
        onClose={() => {
          setPluginActionConfirmation(null);
          setInstallConsentChecked(false);
        }}
        onConfirm={() => {
          void handleConfirmPluginAction();
        }}
      />

      <OrganizationPluginConfigDialog editor={settingsEditor} />

      <PluginPermanentDeletionDialog
        organizationId={organizationId}
        organizationName={organizationName}
        plugin={pluginPendingDataDeletion}
        onClose={() => setPluginPendingDataDeletion(null)}
        onDeleted={() => {
          setPluginPendingDataDeletion(null);
          void loadSettings();
        }}
      />
    </>
  );
}
