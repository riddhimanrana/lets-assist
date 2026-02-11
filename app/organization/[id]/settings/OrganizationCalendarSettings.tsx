"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Calendar, CalendarCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

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
  getOrganizationCalendarStatus,
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
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [updatingAutoSync, setUpdatingAutoSync] = useState(false);

  const connectUrl = useMemo(
    () =>
      `/api/calendar/google/connect?scopes=calendar&calendar_sync=1&org_id=${organizationId}&return_to=${encodeURIComponent(
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

    if (section === "calendar" && (success || error)) {
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

  const connectedByLabel = status?.connectedBy?.name || status?.connectedBy?.email || null;
  const lastSynced = status?.lastSyncedAt
    ? format(new Date(status.lastSyncedAt), "MMM d, yyyy h:mm a")
    : null;

  return (
    <Card id="organization-calendar">
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
          <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-success" />
                  {status.autoSync ? "Calendar connected & syncing automatically" : "Calendar connected"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {status.connectedEmail || "Google account"}
                </p>
                {connectedByLabel && (
                  <p className="text-xs text-muted-foreground">Connected by {connectedByLabel}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDisconnectDialog(true)}
                  disabled={disconnecting}
                >
                  Disconnect
                </Button>
              </div>
            </div>

            {status.needsReconnect && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                The connected Google account needs to be reconnected.
              </div>
            )}

            <div className="rounded-lg border border-muted bg-card p-4">
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
              {status.autoSync && lastSynced && (
                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                  Last synced: {lastSynced}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-dashed border-border/60 bg-muted/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Connect Google Calendar
            </p>
            {status?.needsReconnect && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <div>
                  <p className="font-medium">Reconnect required</p>
                  <p>
                    The previous Google connection expired. Reconnect the
                    organization calendar to keep syncs running.
                  </p>
                </div>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Connect a Google account (like an org-managed inbox) to sync events.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = connectUrl;
              }}
            >
              Connect Google Calendar
            </Button>
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
    </Card>
  );
}