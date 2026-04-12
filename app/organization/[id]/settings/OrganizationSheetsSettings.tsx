"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { 
  ExternalLink, 
  RefreshCw, 
  AlertTriangle, 
  Settings2,
  UserCircle,
  Unlink,
  FileSpreadsheet
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getSheetSyncStatus,
  disconnectOrganizationSheetConnection,
  syncSheetNow,
  unlinkSheetSync,
  updateSheetSyncSettings,
  updateSheetOwner,
  getAvailableSheetOwners,
  type SheetSyncStatus
} from "../reports/sheets-actions";

type OrganizationSheetsSettingsProps = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
};

const syncIntervalOptions = [
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Daily" },
  { value: "4320", label: "Every 3 days" },
] as const;

const getSyncIntervalLabel = (value: string | number | null | undefined) => {
  const normalized = String(value ?? "");
  return (
    syncIntervalOptions.find((option) => option.value === normalized)?.label ||
    (normalized ? `Every ${normalized} minutes` : "Interval")
  );
};

export default function OrganizationSheetsSettings({
  organizationId,
  organizationSlug,
  organizationName,
}: OrganizationSheetsSettingsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<SheetSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingNow, setSyncingNow] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [disconnectingAccount, setDisconnectingAccount] = useState(false);
  const [showUnlinkDialog, setShowUnlinkDialog] = useState(false);
  const [showAccountDisconnectDialog, setShowAccountDisconnectDialog] = useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [availableOwners, setAvailableOwners] = useState<Array<{
    id: string;
    name: string | null;
    email: string | null;
    role: string | null;
    connectedEmail: string | null;
    hasSheetsAccess: boolean;
  }>>([]);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const connectUrl = useMemo(
    () =>
      `/api/calendar/google/connect?scopes=sheets&sheets_sync=1&force=1&org_id=${organizationId}&return_to=${encodeURIComponent(
        `/organization/${organizationSlug}/settings?section=sheets`
      )}`,
    [organizationId, organizationSlug]
  );

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

  // Handle success/error messages from URL
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    const section = searchParams.get("section");

    if (section === "sheets") {
      // Scroll to this component if specifically targeted
      if (!success && !error) {
         containerRef.current?.scrollIntoView({ behavior: 'smooth' });
      }

      if (success === "connected") {
        toast.success("Google account connected successfully!");
        // Clean up URL
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.delete("success");
        router.replace(`?${newParams.toString()}`, { scroll: false });
        loadStatus();
      } else if (error) {
        if (error === "access_denied") {
          toast.error("Access denied. Please grant the required permissions.");
        } else if (error === "no_refresh_token") {
          toast.error("Google did not return a refresh token. Please reconnect and approve offline access.");
        } else {
          toast.error(`Connection failed: ${error}`);
        }
        // Clean up URL
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.delete("error");
        router.replace(`?${newParams.toString()}`, { scroll: false });
      }
    }
  }, [searchParams, router]);

  const handleToggleAutoSync = async (enabled: boolean) => {
    setUpdatingSettings(true);
    const result = await updateSheetSyncSettings(organizationId, { autoSync: enabled });
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
      syncIntervalMinutes: parseInt(interval, 10) 
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
      await loadStatus();
    }
    setSyncingNow(false);
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    const result = await unlinkSheetSync(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to unlink sheet");
    } else {
      toast.success("Google Sheet unlinked");
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
      toast.success("Sheet owner updated");
      loadStatus();
    } else {
      toast.error(result.error || "Failed to update owner");
    }
  };

  const connectedByLabel = status?.connectedBy?.name || status?.connectedBy?.email || null;
  const lastSynced = status?.syncConfig?.lastSyncedAt
    ? format(new Date(status.syncConfig.lastSyncedAt), "MMM d, yyyy h:mm a")
    : null;

  return (
    <Card ref={containerRef} id="organization-sheets">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Google Sheets Sync for {organizationName}
        </CardTitle>
        <CardDescription>
          Automatically sync organization reports to a Google Spreadsheet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading sheets status...</p>
        ) : status?.connected && status.syncConfig ? (
          <div className="space-y-6">
            {/* Connection Status */}
            <div className="space-y-4 rounded-2xl border border-border/60 bg-linear-to-br from-muted/50 via-card to-muted/20 p-4 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background shadow-sm">
                      <Image
                        src="/resources/google-sheets-logo.svg"
                        alt="Google Sheets"
                        width={24}
                        height={24}
                        className="size-6"
                      />
                    </span>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">Linked to Google Sheet</p>
                        <Badge variant={status.syncConfig.autoSync ? "secondary" : "outline"}>
                          {status.syncConfig.autoSync ? "Auto-sync on" : "Auto-sync off"}
                        </Badge>
                        {!status.scopesOk && (
                          <Badge variant="destructive">Reconnect required</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {status.syncConfig.sheetTitle || "Let's Assist Reports"}
                      </p>
                      <p className="text-[10px] text-muted-foreground opacity-70">
                        ID: {status.syncConfig.sheetId}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/60 bg-background/80 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Connected account
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <UserCircle className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium break-all">{status.connectedEmail || "Unknown"}</span>
                      </div>
                      {connectedByLabel && (
                        <span className="mt-1 block text-[10px] text-muted-foreground">
                          Authorized by {connectedByLabel}
                        </span>
                      )}
                    </div>

                    <div className="rounded-xl border border-border/60 bg-background/80 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Last sync
                      </p>
                      <p className="mt-1 text-sm font-medium">{lastSynced || "Never"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {status.syncConfig.autoSync
                          ? "Updates run automatically in the background"
                          : "Manual syncs only until auto-sync is enabled"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <a
                      href={status.syncConfig.sheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Sheet
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncNow}
                    disabled={syncingNow || (status.connected && !status.scopesOk)}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-2 ${syncingNow ? "animate-spin" : ""}`} />
                    Sync Now
                  </Button>
                  {status.viewerIsOwner && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowAccountDisconnectDialog(true)}
                      disabled={disconnectingAccount}
                    >
                      Remove Google account
                    </Button>
                  )}
                </div>
              </div>

              {!status.scopesOk && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex gap-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Reconnect required</p>
                    <p>The owner account ({status.connectedEmail}) needs to reconnect with Sheets permissions.</p>
                  </div>
                </div>
              )}

              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Sync interval
                  </span>
                  <span className="text-sm font-medium">{getSyncIntervalLabel(status.syncConfig.syncIntervalMinutes)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    How frequently reports are pushed to Google Sheets
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Credential owner
                  </span>
                  <span className="text-sm font-medium">{connectedByLabel || status.connectedEmail || "Unknown"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {status.viewerIsOwner ? "You own this Google connection" : "Managed by another organization admin"}
                  </span>
                </div>
              </div>
            </div>

            {/* Sync Settings */}
            <div className="space-y-4 rounded-xl border border-muted bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Automatic Sync</p>
                  <p className="text-xs text-muted-foreground">
                    Update the spreadsheet in the background
                  </p>
                </div>
                <Switch
                  checked={status.syncConfig.autoSync}
                  onCheckedChange={handleToggleAutoSync}
                  disabled={updatingSettings || (status.connected && !status.scopesOk)}
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-muted/50">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Sync Interval</p>
                  <p className="text-xs text-muted-foreground">
                    How frequently to push updates
                  </p>
                </div>
                <Select
                  value={String(status.syncConfig.syncIntervalMinutes)}
                  onValueChange={handleIntervalChange}
                  disabled={updatingSettings || (status.connected && !status.scopesOk)}
                >
                  <SelectTrigger className="w-35 h-8 text-xs">
                    <SelectValue placeholder="Interval">
                      {getSyncIntervalLabel(status.syncConfig.syncIntervalMinutes)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {syncIntervalOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              {/* Ownership Transfer */}
              <div className="pt-2 border-t border-muted/50">
                <div className="space-y-0.5 mb-3">
                  <p className="text-sm font-medium">Credential Owner</p>
                  <p className="text-xs text-muted-foreground">
                    Switch which admin account provides the Sheets API access
                  </p>
                </div>
                <Select
                  value={status.connectedBy?.id || ""}
                  onValueChange={handleOwnerChange}
                  disabled={loadingOwners || availableOwners.length <= 1}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder={loadingOwners ? "Loading admins..." : "Select credentials owner"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOwners.map((owner) => (
                      <SelectItem key={owner.id} value={owner.id}>
                        <div className="flex flex-col py-0.5">
                          <span className="font-medium">{owner.name || owner.email}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {owner.connectedEmail ? `Linked: ${owner.connectedEmail}` : "Not linked to Google"}
                            {!owner.hasSheetsAccess && owner.connectedEmail && " (Missing Sheets permissions)"}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableOwners.length > 0 && !availableOwners.some(o => o.id === status.connectedBy?.id) && (
                  <p className="mt-2 text-[10px] text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Current owner is not in the organization member list.
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setShowUnlinkDialog(true)}
                disabled={unlinking}
              >
                <Unlink className="h-3.5 w-3.5 mr-2" />
                Unlink Spreadsheet
              </Button>
            </div>
          </div>
        ) : status?.connected ? (
          <div className="space-y-4 rounded-2xl border border-dashed border-border/60 bg-muted/30 p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-border/60 bg-background shadow-sm">
              <Image
                src="/resources/google-sheets-logo.svg"
                alt="Google Sheets"
                width={24}
                height={24}
                className="size-6"
              />
            </div>
            <div>
              <p className="text-sm font-medium">Google Account Connected</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-70 mx-auto">
                Your account ({status.connectedEmail}) is connected, but no spreadsheet has been set up for this organization yet.
              </p>
            </div>
            
            <div className="pt-2 flex flex-col gap-2 items-center">
              <Button
                onClick={() => {
                  window.location.href = `/organization/${organizationSlug}?tab=reports&setup=1`;
                }}
                className="gap-2"
              >
                <Settings2 className="h-4 w-4" />
                Set up Spreadsheet Sync
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  window.location.href = connectUrl;
                }}
                className="text-muted-foreground"
              >
                Switch Account
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowAccountDisconnectDialog(true)}
                disabled={disconnectingAccount}
              >
                Remove Google account
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl border border-dashed border-border/60 bg-muted/30 p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-border/60 bg-background shadow-sm">
              <Image
                src="/resources/google-sheets-logo.svg"
                alt="Google Sheets"
                width={24}
                height={24}
                className="size-6"
              />
            </div>
            <div>
              <p className="text-sm font-medium">No Google Account Connected</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-70 mx-auto">
                Connect a Google account to export and sync your organization reports to a spreadsheet automatically.
              </p>
            </div>
            
            <div className="pt-2 flex flex-col gap-2 items-center">
              <Button
                onClick={() => {
                  window.location.href = connectUrl;
                }}
                className="gap-2"
              >
                <UserCircle className="h-4 w-4" />
                Connect Google Account
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={showUnlinkDialog}
        onOpenChange={setShowUnlinkDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink Google Sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop all automatic sync jobs and disconnect the organization from this spreadsheet. 
              The spreadsheet itself will not be deleted from your Google Drive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                handleUnlink();
              }}
              disabled={unlinking}
            >
              {unlinking ? "Unlinking..." : "Unlink Sheet"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showAccountDisconnectDialog}
        onOpenChange={setShowAccountDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the connected Google account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect the Google account from this organization and remove the sheet sync configuration.
              You&apos;ll need to connect another Google account to resume automatic spreadsheet updates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectingAccount}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                handleDisconnectAccount();
              }}
              disabled={disconnectingAccount}
            >
              {disconnectingAccount ? "Removing..." : "Remove account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
