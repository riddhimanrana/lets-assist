"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { AlertTriangle, ExternalLink, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  GOOGLE_OAUTH_CALLBACK_PARAMS,
  readGoogleOAuthCallbackNotice,
} from "@/lib/auth/google-oauth-connection-messages";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getSheetSyncStatus,
  disconnectOrganizationSheetConnection,
  syncSheetNow,
  unlinkSheetSync,
  updateSheetSyncSettings,
  updateSheetOwner,
  getAvailableSheetOwners,
  type SheetSyncStatus,
} from "../reports/sheets-actions";
import { SheetDisconnectDialogs } from "../reports/sheets/SheetDisconnectDialogs";
import { SheetSetupPanel } from "../reports/sheets/SheetSetupPanel";
import { SheetSyncAttention } from "../reports/sheets/SheetSyncAttention";
import { SheetSyncConfig } from "../reports/sheets/SheetSyncConfig";
import {
  getSyncIntervalLabel,
  type SheetOwnerOption,
} from "../reports/sheets/sheet-sync-options";
import { useSheetSyncSetup } from "../reports/sheets/useSheetSyncSetup";
import {
  IntegrationCard,
  IntegrationOption,
  type IntegrationDetail,
  type IntegrationState,
} from "./IntegrationCard";

type OrganizationSheetsSettingsProps = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  /** Read from the environment on the server. Only this boolean reaches here. */
  autoSyncWorkerEnabled: boolean;
};

export default function OrganizationSheetsSettings({
  organizationId,
  organizationSlug,
  autoSyncWorkerEnabled,
}: OrganizationSheetsSettingsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<SheetSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingNow, setSyncingNow] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [disconnectingAccount, setDisconnectingAccount] = useState(false);
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);
  const [unlinkIntent, setUnlinkIntent] = useState<"unlink" | "switch">(
    "unlink",
  );
  const [showAccountDisconnectDialog, setShowAccountDisconnectDialog] =
    useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [availableOwners, setAvailableOwners] = useState<SheetOwnerOption[]>(
    [],
  );
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [configSections, setConfigSections] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const connectUrl = useMemo(
    () =>
      `/api/google/oauth/connect?purpose=organization_sheets&scopes=sheets&sheets_sync=1&force=1&org_id=${organizationId}&return_to=${encodeURIComponent(
        `/organization/${organizationSlug}/settings?section=sheets`,
      )}`,
    [organizationId, organizationSlug],
  );
  const startGoogleConnection = () => {
    // OAuth begins with a redirect response, so this must be a document navigation.
    window.location.href = connectUrl;
  };

  const loadStatus = async () => {
    setLoading(true);
    const result = await getSheetSyncStatus(organizationId);
    setStatus(result);
    setLoading(false);

    if (result.connected && result.syncConfig) {
      loadOwners();
    }
  };

  const loadOwners = async () => {
    setLoadingOwners(true);
    const result = await getAvailableSheetOwners(organizationId);
    if (result.success) {
      setAvailableOwners(result.owners);
    }
    setLoadingOwners(false);
  };

  useEffect(() => {
    loadStatus();
  }, [organizationId]);

  const setup = useSheetSyncSetup({
    organizationId,
    sheetStatus: status,
    handleLoadSheetStatus: loadStatus,
  });

  // Handle success/error messages from URL
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    const section = searchParams.get("section");

    if (section === "sheets") {
      // Scroll to this component if specifically targeted
      if (!success && !error) {
        containerRef.current?.scrollIntoView({ behavior: "smooth" });
      }

      if (success === "connected") {
        toast.success("Google account connected successfully!");
        // Clean up URL
        const newParams = new URLSearchParams(searchParams.toString());
        for (const param of GOOGLE_OAUTH_CALLBACK_PARAMS) {
          newParams.delete(param);
        }
        router.replace(`?${newParams.toString()}`, { scroll: false });
        loadStatus();
      } else if (error) {
        // Render from the shared catalogue rather than echoing the code, so an
        // outcome this build does not recognize can never become screen text.
        const notice = readGoogleOAuthCallbackNotice(searchParams.toString());
        if (notice) {
          const detail = notice.correlationId
            ? `${notice.message} Reference: ${notice.correlationId}.`
            : notice.message;
          if (notice.tone === "warning") {
            toast.warning(detail);
          } else {
            toast.error(detail);
          }
        }
        // Clean up URL
        const newParams = new URLSearchParams(searchParams.toString());
        for (const param of GOOGLE_OAUTH_CALLBACK_PARAMS) {
          newParams.delete(param);
        }
        router.replace(`?${newParams.toString()}`, { scroll: false });
      }
    }
  }, [searchParams, router]);

  const handleToggleAutoSync = async (enabled: boolean) => {
    setUpdatingSettings(true);
    const result = await updateSheetSyncSettings(organizationId, {
      autoSync: enabled,
    });
    if (!result.success) {
      toast.error(result.error || "Failed to update auto-sync");
    } else {
      toast.success(enabled ? "Auto-sync enabled" : "Auto-sync disabled");
      await loadStatus();
    }
    setUpdatingSettings(false);
  };

  const handleIntervalChange = async (interval: string | null) => {
    if (!interval) return;
    setUpdatingSettings(true);
    const result = await updateSheetSyncSettings(organizationId, {
      syncIntervalMinutes: parseInt(interval, 10),
    });
    if (!result.success) {
      toast.error(result.error || "Failed to update interval");
    } else {
      toast.success("Sync interval updated");
      await loadStatus();
    }
    setUpdatingSettings(false);
  };

  const handleSyncNow = async () => {
    setSyncingNow(true);
    const result = await syncSheetNow(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to sync sheet");
    } else {
      toast.success("Sheet synced successfully");
    }
    // A failed sync can change what the card should offer, such as choosing
    // the file again.
    await loadStatus();
    setSyncingNow(false);
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    const result = await unlinkSheetSync(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to unlink sheet");
    } else {
      toast.success(
        unlinkIntent === "switch"
          ? "Current sheet unlinked. Set up a new destination below."
          : "Google Sheet unlinked",
      );
      setup.resetSetup();
      await loadStatus();
    }
    setUnlinking(false);
    setShowUnlinkDialog(false);
  };

  const handleDisconnectAccount = async () => {
    setDisconnectingAccount(true);
    const result = await disconnectOrganizationSheetConnection(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to remove Google account");
    } else {
      toast.success("Google account removed from this organization");
      await loadStatus();
    }
    setDisconnectingAccount(false);
    setShowAccountDisconnectDialog(false);
  };

  const handleOwnerChange = async (ownerId: string | null) => {
    if (!ownerId) return;
    const result = await updateSheetOwner(organizationId, ownerId);
    if (result.success) {
      if (result.needsReselect) {
        toast.warning(
          "Owner updated. The new owner has to choose the spreadsheet again before it can sync.",
        );
      } else {
        toast.success("Sheet owner updated");
      }
      loadStatus();
    } else {
      toast.error(result.error || "Failed to update owner");
    }
  };

  const requestUnlink = (intent: "unlink" | "switch") => {
    setUnlinkIntent(intent);
    setShowUnlinkDialog(true);
  };

  const connectedByLabel =
    status?.connectedBy?.name || status?.connectedBy?.email || null;
  const lastSynced = status?.syncConfig?.lastSyncedAt
    ? format(new Date(status.syncConfig.lastSyncedAt), "MMM d, yyyy h:mm a")
    : null;
  const syncConfig = status?.syncConfig ?? null;
  const viewerConnected = status?.viewerConnected ?? false;
  const viewerScopesOk = status?.viewerScopesOk ?? false;
  const viewerNeedsSheets = viewerConnected && !viewerScopesOk;
  const viewerMissingConnection = !viewerConnected;
  const ownerNeedsSheets = Boolean(
    status?.connected && status.scopesOk === false,
  );
  const managedByAnotherAdmin = Boolean(
    syncConfig && status?.connectedBy && !status.viewerIsOwner,
  );
  const setupBlockedReason = viewerMissingConnection
    ? "Connect your Google account to set up Sheets sync."
    : viewerNeedsSheets
      ? "Sheets permissions are missing. Reconnect with Sheets access to continue."
      : null;
  const takeOverLabel =
    viewerConnected && viewerScopesOk
      ? "Take over with my Google account"
      : viewerMissingConnection
        ? "Connect and take over sync"
        : "Reconnect and take over sync";

  const state: IntegrationState =
    loading && !status
      ? "loading"
      : !status?.connected
        ? syncConfig
          ? "needs-reconnect"
          : "not-connected"
        : ownerNeedsSheets
          ? "needs-reconnect"
          : "connected";

  const details: IntegrationDetail[] = !status?.connected
    ? []
    : [
        ...(syncConfig
          ? [
              {
                label: "Spreadsheet",
                value: syncConfig.sheetTitle || "Let's Assist Reports",
                helper: `Tab: ${syncConfig.tabName}`,
              },
            ]
          : []),
        {
          label: "Connected account",
          value: status.connectedEmail || "Unknown",
          helper: connectedByLabel ? `Authorized by ${connectedByLabel}` : null,
        },
        ...(syncConfig
          ? [
              {
                label: "Credential owner",
                value: connectedByLabel || status.connectedEmail || "Unknown",
                helper: status.viewerIsOwner
                  ? "You own this Google connection"
                  : "Managed by another organization admin",
              },
              {
                label: "Last sync",
                value: lastSynced || "Never",
                helper: syncConfig.autoSync
                  ? `Auto-sync on, ${getSyncIntervalLabel(syncConfig.syncIntervalMinutes).toLowerCase()}`
                  : "Manual syncs only until auto-sync is enabled",
              },
            ]
          : []),
      ];

  const notice = !status ? null : !status.connected && syncConfig ? (
    <Alert variant="warning">
      <AlertTriangle />
      <AlertTitle>Sheets connection needed</AlertTitle>
      <AlertDescription>
        This organization already has a linked Google Sheet.
        {connectedByLabel ? ` Connected by ${connectedByLabel}.` : ""}{" "}
        {status.viewerIsOwner
          ? "Reconnect your Google account to resume syncing."
          : "You can take over the sync responsibility for this organization."}
      </AlertDescription>
    </Alert>
  ) : status.connected ? (
    <>
      {status.destinationProblem && (
        <SheetSyncAttention
          organizationId={organizationId}
          problem={status.destinationProblem}
          isAdmin
          canPick={viewerConnected && viewerScopesOk}
          onChanged={loadStatus}
        />
      )}
      {ownerNeedsSheets && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Reconnect required</AlertTitle>
          <AlertDescription>
            The owner account ({status.connectedEmail}) needs to reconnect with
            Sheets permissions.
          </AlertDescription>
        </Alert>
      )}
      {managedByAnotherAdmin && (
        <Alert variant="info">
          <Info />
          <AlertTitle>Managed by another admin</AlertTitle>
          <AlertDescription>
            <p>
              Only the connected owner can disconnect this sync directly. Ask
              them to disconnect it, or connect your Google account with Sheets
              access to take over.
            </p>
            <Button variant="outline" onClick={startGoogleConnection}>
              {takeOverLabel}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </>
  ) : null;

  const footer = !status?.connected ? (
    <Button variant="outline" onClick={startGoogleConnection}>
      {syncConfig
        ? status?.viewerIsOwner
          ? "Reconnect Google Sheets"
          : "Connect and take over sync"
        : "Connect Google Sheets"}
    </Button>
  ) : syncConfig ? (
    <>
      <Button variant="outline" asChild>
        <a href={syncConfig.sheetUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink data-icon="inline-start" />
          Open sheet
        </a>
      </Button>
      <Button
        variant="outline"
        onClick={handleSyncNow}
        disabled={
          syncingNow || ownerNeedsSheets || Boolean(status.destinationProblem)
        }
      >
        <RefreshCw
          data-icon="inline-start"
          className={syncingNow ? "animate-spin" : undefined}
        />
        {syncingNow ? "Syncing..." : "Sync now"}
      </Button>
    </>
  ) : null;

  return (
    <>
      <IntegrationCard
        ref={containerRef}
        id="organization-sheets"
        name="Google Sheets"
        description="Automatically sync organization reports to a Google spreadsheet."
        logo={{
          src: "/resources/google-sheets-logo-2026.png",
          width: 33,
          height: 24,
        }}
        state={state}
        details={details}
        notice={notice}
        footer={footer}
        footerHint={
          status?.connected
            ? null
            : syncConfig
              ? null
              : "Connect a Google account to export and sync your organization reports to a spreadsheet automatically."
        }
      >
        {status?.error && (
          <p className="text-muted-foreground text-sm">{status.error}</p>
        )}

        {status?.connected && syncConfig ? (
          <>
            <div id="sheet-config">
              <SheetSyncConfig
                syncConfig={syncConfig}
                setup={setup}
                sections={configSections}
                onSectionsChange={setConfigSections}
                connectedBy={status.connectedBy ?? null}
                connectedByLabel={connectedByLabel}
                availableOwners={availableOwners}
                loadingOwners={loadingOwners}
                onOwnerChange={handleOwnerChange}
                settingsDisabled={updatingSettings || ownerNeedsSheets}
                onToggleAutoSync={handleToggleAutoSync}
                onIntervalChange={handleIntervalChange}
                autoSyncWorkerEnabled={autoSyncWorkerEnabled}
              />
            </div>

            <IntegrationOption
              label="Disconnect"
              description={
                status.viewerIsOwner
                  ? "Switch to a different spreadsheet, stop syncing, or remove your Google account from this organization."
                  : "Only the connected owner can switch or unlink this spreadsheet."
              }
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={unlinking || !status.viewerIsOwner}
                  onClick={() => requestUnlink("switch")}
                >
                  Switch sheet
                </Button>
                <Button
                  variant="outline"
                  disabled={unlinking || !status.viewerIsOwner}
                  onClick={() => requestUnlink("unlink")}
                >
                  Unlink sheet
                </Button>
                {status.viewerIsOwner && (
                  <Button
                    variant="outline"
                    onClick={() => setShowAccountDisconnectDialog(true)}
                    disabled={disconnectingAccount}
                  >
                    Remove Google account
                  </Button>
                )}
              </div>
            </IntegrationOption>
          </>
        ) : status?.connected ? (
          <>
            <SheetSetupPanel
              setup={setup}
              setupBlockedReason={setupBlockedReason}
              reconnectLabel={
                viewerMissingConnection
                  ? "Connect Google Sheets"
                  : "Reconnect with Sheets access"
              }
              onReconnect={startGoogleConnection}
            />
            <IntegrationOption
              label="Google account"
              description="Use a different Google account, or remove this one from the organization."
            >
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={startGoogleConnection}>
                  Switch account
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowAccountDisconnectDialog(true)}
                  disabled={disconnectingAccount}
                >
                  Remove Google account
                </Button>
              </div>
            </IntegrationOption>
          </>
        ) : null}
      </IntegrationCard>

      <SheetDisconnectDialogs
        unlinkOpen={showUnlinkDialog}
        onUnlinkOpenChange={setShowUnlinkDialog}
        unlinkIntent={unlinkIntent}
        unlinking={unlinking}
        onUnlink={handleUnlink}
        accountOpen={showAccountDisconnectDialog}
        onAccountOpenChange={setShowAccountDisconnectDialog}
        disconnectingAccount={disconnectingAccount}
        onDisconnectAccount={handleDisconnectAccount}
      />
    </>
  );
}
