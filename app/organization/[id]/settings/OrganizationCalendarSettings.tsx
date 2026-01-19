"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Calendar, CalendarCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  syncOrganizationCalendarNow,
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
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getOrganizationCalendarStatus>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  const connectUrl = useMemo(
    () =>
      `/api/calendar/google/connect?org_id=${organizationId}&return_to=${encodeURIComponent(
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

  const handleSyncNow = async () => {
    setSyncing(true);
    const result = await syncOrganizationCalendarNow(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to sync calendar");
    } else {
      toast.success(
        `Calendar synced (${result.createdCount ?? 0} created, ${result.updatedCount ?? 0} updated, ${result.removedCount ?? 0} removed)`
      );
      await loadStatus();
    }
    setSyncing(false);
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
                  <CalendarCheck className="h-4 w-4 text-chart-5" />
                  Calendar connected
                </p>
                <p className="text-xs text-muted-foreground">
                  {status.connectedEmail || "Google account"}
                </p>
                {connectedByLabel && (
                  <p className="text-xs text-muted-foreground">Connected by {connectedByLabel}</p>
                )}
                {lastSynced && (
                  <p className="text-xs text-muted-foreground">Last synced {lastSynced}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSyncNow}
                  disabled={syncing || status.needsReconnect}
                >
                  {syncing ? "Syncing..." : "Sync now"}
                </Button>
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

            <p className="text-xs text-muted-foreground">
              Run “Sync now” anytime to refresh the calendar with the latest projects.
            </p>
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