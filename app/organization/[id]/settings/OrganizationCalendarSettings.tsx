"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { AlertTriangle, Calendar, ExternalLink, RefreshCw, Unlink, UserCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
  disconnectOrganizationCalendar,
  disconnectOrganizationCalendarConnection,
  getOrganizationCalendarStatus,
  syncOrganizationCalendarNow,
  updateOrganizationCalendarSettings,
} from "../calendar/actions";

type OrganizationCalendarSettingsProps = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
};

export default function OrganizationCalendarSettings({
  organizationId,
  organizationSlug,
  organizationName,
}: OrganizationCalendarSettingsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getOrganizationCalendarStatus>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingNow, setSyncingNow] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectingAccount, setDisconnectingAccount] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [showAccountDisconnectDialog, setShowAccountDisconnectDialog] = useState(false);
  const [updatingAutoSync, setUpdatingAutoSync] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const connectUrl = useMemo(
    () =>
      `/api/calendar/google/connect?calendar_sync=1&org_id=${organizationId}&return_to=${encodeURIComponent(
        `/organization/${organizationSlug}/settings?section=calendar`
      )}`,
    [organizationId, organizationSlug]
  );

  const loadStatus = async () => {
    setLoading(true);
    const result = await getOrganizationCalendarStatus(organizationId);
    setStatus(result);
    setLoading(false);
  };

  useEffect(() => {
    loadStatus();
  }, [organizationId]);

  // Handle success/error messages from URL
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    const section = searchParams.get("section");

    if (section === "calendar") {
      if (!success && !error) {
        containerRef.current?.scrollIntoView({ behavior: "smooth" });
      }

      if (success === "connected") {
        toast.success("Google Calendar connected successfully!");
        // Clean up URL
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.delete("success");
        router.replace(`?${newParams.toString()}`, { scroll: false });
        loadStatus();
      } else if (error) {
        if (error === "access_denied") {
          toast.error("Access denied. Please grant calendar permissions.");
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
    setUpdatingAutoSync(true);
    const result = await updateOrganizationCalendarSettings(organizationId, { autoSync: enabled });
    if (!result.success) {
      toast.error(result.error || "Failed to update auto-sync");
    } else {
      toast.success(enabled ? "Auto-sync enabled" : "Auto-sync disabled");
      await loadStatus();
    }
    setUpdatingAutoSync(false);
  };

  const handleSyncNow = async () => {
    setSyncingNow(true);
    const result = await syncOrganizationCalendarNow(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to sync calendar");
    } else {
      toast.success("Calendar synced successfully");
      await loadStatus();
    }
    setSyncingNow(false);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    const result = await disconnectOrganizationCalendar(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to disconnect calendar");
    } else {
      toast.success("Organization calendar disconnected");
      await loadStatus();
    }
    setDisconnecting(false);
    setShowDisconnectDialog(false);
  };

  const handleDisconnectAccount = async () => {
    setDisconnectingAccount(true);
    const result = await disconnectOrganizationCalendarConnection(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to remove Google account");
    } else {
      toast.success("Google account removed from this organization");
      await loadStatus();
    }
    setDisconnectingAccount(false);
    setShowAccountDisconnectDialog(false);
  };

  const connectedByLabel = status?.connectedBy?.name || status?.connectedBy?.email || null;
  const lastSynced = status?.lastSyncedAt
    ? format(new Date(status.lastSyncedAt), "MMM d, yyyy h:mm a")
    : null;
  const calendarUrl = status?.calendarId
    ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(status.calendarId)}`
    : null;

  return (
    <Card ref={containerRef} id="organization-calendar">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Google Calendar for {organizationName}
        </CardTitle>
        <CardDescription>
          Sync organization projects to a shared Google Calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading calendar status...</p>
        ) : status?.connected ? (
          <div className="space-y-6">
            <div className="space-y-4 rounded-2xl border border-border/60 bg-linear-to-br from-muted/50 via-card to-muted/20 p-4 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background shadow-sm">
                      <Image
                        src="/resources/google-calendar-logo.svg"
                        alt="Google Calendar"
                        width={24}
                        height={24}
                        className="size-6"
                      />
                    </span>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">
                          {status.autoSync ? "Calendar connected and syncing" : "Calendar connected"}
                        </p>
                        <Badge variant={status.autoSync ? "secondary" : "outline"}>
                          {status.autoSync ? "Auto-sync on" : "Auto-sync off"}
                        </Badge>
                        {status.needsReconnect && (
                          <Badge variant="destructive">Reconnect required</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {status.connectedEmail || "Google account"}
                      </p>
                      {connectedByLabel && (
                        <p className="text-xs text-muted-foreground">Connected by {connectedByLabel}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground opacity-70">
                        Calendar ID: {status.calendarId || "Unknown"}
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
                        <span className="text-sm font-medium break-all">
                          {status.connectedEmail || "Google account"}
                        </span>
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
                        {status.autoSync
                          ? "Updates run automatically in the background"
                          : "Manual syncs only until auto-sync is enabled"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
                  {calendarUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={calendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open Calendar
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncNow}
                    disabled={syncingNow || status.needsReconnect || !status.canManage}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncingNow ? "animate-spin" : ""}`} />
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

              {status.needsReconnect && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex gap-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Reconnect required</p>
                    <p>The owner account ({status.connectedEmail}) needs to reconnect with Calendar permissions.</p>
                  </div>
                </div>
              )}

              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Sync cadence
                  </span>
                  <span className="text-sm font-medium">
                    {status.autoSync ? "Automatic hourly sync" : "Manual sync only"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {status.autoSync
                      ? "Calendar updates run automatically in the background"
                      : "Enable automatic sync to keep the calendar updated hourly"}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Connection owner
                  </span>
                  <span className="text-sm font-medium">{connectedByLabel || status.connectedEmail || "Unknown"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {status.viewerIsOwner ? "You own this Google connection" : "Managed by another organization admin"}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-muted bg-card p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Automatic Sync</p>
                    <p className="text-xs text-muted-foreground">
                      {status.autoSync
                        ? "Calendar syncs every hour automatically"
                        : "Enable to sync calendar hourly"}
                    </p>
                  </div>
                  <Switch
                    checked={status.autoSync ?? false}
                    onCheckedChange={handleToggleAutoSync}
                    disabled={updatingAutoSync || status.needsReconnect || !status.canManage}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDisconnectDialog(true)}
                  disabled={disconnecting || !status.canManage}
                >
                  <Unlink className="h-3.5 w-3.5 mr-2" />
                  Disconnect calendar
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl border border-dashed border-border/60 bg-muted/30 p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-border/60 bg-background shadow-sm">
              <Image
                src="/resources/google-calendar-logo.svg"
                alt="Google Calendar"
                width={24}
                height={24}
                className="size-6"
              />
            </div>
            <div>
              <p className="text-sm font-medium">No Google Account Connected</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-70 mx-auto">
                Connect a Google account to sync your organization projects to Google Calendar automatically.
              </p>
            </div>

            {status?.needsReconnect && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-left text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-medium">Reconnect required</p>
                  <p>
                    The previous Google connection expired. Reconnect the organization calendar to keep syncs running.
                  </p>
                </div>
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2 items-center">
              <Button
                onClick={() => {
                  window.location.href = connectUrl;
                }}
                className="gap-2"
              >
                <UserCircle className="h-4 w-4" />
                Connect Google Calendar
              </Button>
            </div>

            {status?.error && (
              <p className="text-xs text-muted-foreground">{status.error}</p>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect organization calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop syncing projects to the Google Calendar. Existing
              events will remain in Google Calendar until you delete them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting..." : "Disconnect"}
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
              This will disconnect the Google account from this organization, stop calendar syncs,
              and remove the organization&apos;s Google Calendar connection. You can reconnect later with a different account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectingAccount}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnectAccount} disabled={disconnectingAccount}>
              {disconnectingAccount ? "Removing..." : "Remove account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}