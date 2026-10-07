"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  IntegrationCard,
  IntegrationOption,
  type IntegrationDetail,
  type IntegrationState,
} from "./IntegrationCard";

type OrganizationCalendarSettingsProps = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
};

export default function OrganizationCalendarSettings({
  organizationId,
  organizationSlug,
}: OrganizationCalendarSettingsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof getOrganizationCalendarStatus>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingNow, setSyncingNow] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectingAccount, setDisconnectingAccount] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [showAccountDisconnectDialog, setShowAccountDisconnectDialog] =
    useState(false);
  const [updatingAutoSync, setUpdatingAutoSync] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const connectUrl = useMemo(
    () =>
      `/api/google/oauth/connect?purpose=organization_calendar&calendar_sync=1&org_id=${organizationId}&return_to=${encodeURIComponent(
        `/organization/${organizationSlug}/settings?section=calendar`,
      )}`,
    [organizationId, organizationSlug],
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
    const result = await updateOrganizationCalendarSettings(organizationId, {
      autoSync: enabled,
    });
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
    const result =
      await disconnectOrganizationCalendarConnection(organizationId);
    if (!result.success) {
      toast.error(result.error || "Failed to remove Google account");
    } else {
      toast.success("Google account removed from this organization");
      await loadStatus();
    }
    setDisconnectingAccount(false);
    setShowAccountDisconnectDialog(false);
  };

  const connectedByLabel =
    status?.connectedBy?.name || status?.connectedBy?.email || null;
  const lastSynced = status?.lastSyncedAt
    ? format(new Date(status.lastSyncedAt), "MMM d, yyyy h:mm a")
    : null;
  const calendarUrl = status?.calendarId
    ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(status.calendarId)}`
    : null;

  const state: IntegrationState =
    loading && !status
      ? "loading"
      : status?.needsReconnect
        ? "needs-reconnect"
        : status?.connected
          ? "connected"
          : "not-connected";

  const details: IntegrationDetail[] = status?.connected
    ? [
        {
          label: "Connected account",
          value: status.connectedEmail || "Google account",
          helper: connectedByLabel ? `Authorized by ${connectedByLabel}` : null,
        },
        {
          label: "Connection owner",
          value: connectedByLabel || status.connectedEmail || "Unknown",
          helper: status.viewerIsOwner
            ? "You own this Google connection"
            : "Managed by another organization admin",
        },
        {
          label: "Last sync",
          value: lastSynced || "Never",
          helper: status.autoSync
            ? "Updates run automatically in the background"
            : "Manual syncs only until auto-sync is enabled",
        },
        {
          label: "Calendar ID",
          value: status.calendarId || "Unknown",
        },
      ]
    : [];

  const notice = status?.needsReconnect ? (
    <Alert variant="warning">
      <AlertTriangle />
      <AlertTitle>Reconnect required</AlertTitle>
      <AlertDescription>
        {status.connected
          ? `The owner account (${status.connectedEmail}) needs to reconnect with Calendar permissions.`
          : "The previous Google connection expired. Reconnect the organization calendar to keep syncs running."}
      </AlertDescription>
    </Alert>
  ) : null;

  return (
    <>
      <IntegrationCard
        ref={containerRef}
        id="organization-calendar"
        name="Google Calendar"
        description="Sync organization projects to a shared Google Calendar."
        logo={{
          src: "/resources/google-calendar-logo-2026.png",
          width: 24,
          height: 24,
        }}
        state={state}
        details={details}
        notice={notice}
        footerHint={
          status?.connected
            ? null
            : "Connect a Google account to sync your organization projects to Google Calendar automatically."
        }
        footer={
          status?.connected ? (
            <>
              {calendarUrl && (
                <Button variant="outline" asChild>
                  <a
                    href={calendarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink data-icon="inline-start" />
                    Open calendar
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleSyncNow}
                disabled={
                  syncingNow || status.needsReconnect || !status.canManage
                }
              >
                <RefreshCw
                  data-icon="inline-start"
                  className={syncingNow ? "animate-spin" : undefined}
                />
                Sync now
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                window.location.href = connectUrl;
              }}
            >
              Connect Google Calendar
            </Button>
          )
        }
      >
        {status?.connected ? (
          <>
            <IntegrationOption
              label="Automatic sync"
              htmlFor="organization-calendar-auto-sync"
              description={
                status.autoSync
                  ? "Calendar syncs every hour automatically"
                  : "Enable to sync calendar hourly"
              }
            >
              <Switch
                id="organization-calendar-auto-sync"
                checked={status.autoSync ?? false}
                onCheckedChange={handleToggleAutoSync}
                disabled={
                  updatingAutoSync || status.needsReconnect || !status.canManage
                }
              />
            </IntegrationOption>

            <IntegrationOption
              label="Disconnect"
              description="Stop syncing to this calendar, or remove the Google account from this organization."
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowDisconnectDialog(true)}
                  disabled={disconnecting || !status.canManage}
                >
                  Disconnect calendar
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
        ) : status?.error ? (
          <p className="text-muted-foreground text-sm">{status.error}</p>
        ) : null}
      </IntegrationCard>

      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect organization calendar?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will stop syncing projects to the Google Calendar. Existing
              events will remain in Google Calendar until you delete them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
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
            <AlertDialogTitle>
              Remove the connected Google account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect the Google account from this organization,
              stop calendar syncs, and remove the organization&apos;s Google
              Calendar connection. You can reconnect later with a different
              account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectingAccount}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDisconnectAccount}
              disabled={disconnectingAccount}
            >
              {disconnectingAccount ? "Removing..." : "Remove account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
