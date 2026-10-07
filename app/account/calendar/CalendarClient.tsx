"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/PageHeader";
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
import { removeSyncedCalendarEvent } from "@/lib/calendar-remove-event";
import type { CalendarConnection } from "@/types";

import { CalendarConnectionSection } from "./CalendarConnectionSection";
import { SyncedEventsSection, type SyncedEvent } from "./SyncedEventsSection";

interface CalendarClientProps {
  connection: CalendarConnection | null;
  legacyReconnectRequired: boolean;
  creatorProjects: Array<{
    id: string;
    title: string;
    description: string | null;
    start_date: string;
    end_date: string | null;
    location: string | null;
    creator_calendar_event_id: string;
    creator_synced_at: string;
    schedule_type: string;
  }>;
  volunteerSignups: Array<{
    id: string;
    volunteer_calendar_event_id: string;
    volunteer_synced_at: string;
    scheduled_start: string;
    scheduled_end: string;
    projects: {
      id: string;
      title: string;
      description: string | null;
      location: string | null;
      schedule_type: string;
    };
  }>;
}

type RemovableEvent =
  | CalendarClientProps["creatorProjects"][number]
  | CalendarClientProps["volunteerSignups"][number];

/** A row for the list, plus the original record the remove call needs. */
type SyncedEventEntry = SyncedEvent & { source: RemovableEvent };

export default function CalendarClient({
  connection,
  legacyReconnectRequired,
  creatorProjects,
  volunteerSignups,
}: CalendarClientProps) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [removingEventId, setRemovingEventId] = useState<string | null>(null);
  const [eventToRemove, setEventToRemove] = useState<SyncedEventEntry | null>(
    null,
  );

  const creatorEvents: SyncedEventEntry[] = creatorProjects.map((project) => ({
    key: project.id,
    projectId: project.id,
    title: project.title,
    start: project.start_date,
    end: project.end_date,
    location: project.location,
    syncedAt: project.creator_synced_at,
    source: project,
  }));
  const volunteerEvents: SyncedEventEntry[] = volunteerSignups.map(
    (signup) => ({
      key: signup.id,
      projectId: signup.projects.id,
      title: signup.projects.title,
      start: signup.scheduled_start,
      end: signup.scheduled_end,
      location: signup.projects.location,
      syncedAt: signup.volunteer_synced_at,
      source: signup,
    }),
  );

  const handleConnect = async () => {
    // OAuth begins with a redirect response, so this must be a document navigation.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href =
      "/api/google/oauth/connect?purpose=personal_calendar";
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/google/oauth/disconnect", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to disconnect calendar");
      }

      toast.success("Calendar disconnected", {
        description:
          "Your Google Calendar has been disconnected. Existing synced events will remain in your calendar.",
      });

      router.refresh();
    } catch (error) {
      console.error("Failed to disconnect calendar:", error);
      toast.error("Could not disconnect", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to disconnect Google Calendar",
      });
    } finally {
      setIsDisconnecting(false);
      setShowDisconnectDialog(false);
    }
  };

  const handleRemoveEvent = async (event: RemovableEvent) => {
    setRemovingEventId(event.id);
    try {
      await removeSyncedCalendarEvent(event);

      toast.success("Event removed", {
        description: "The event has been removed from your calendar.",
      });

      router.refresh();
    } catch (error) {
      console.error("Failed to remove event:", error);
      toast.error("Could not remove event", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to remove event from calendar",
      });
    } finally {
      setRemovingEventId(null);
      setEventToRemove(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Sync your projects and signups to Google Calendar."
      />

      <CalendarConnectionSection
        connection={connection}
        legacyReconnectRequired={legacyReconnectRequired}
        isDisconnecting={isDisconnecting}
        onConnect={handleConnect}
        onDisconnect={() => setShowDisconnectDialog(true)}
      />

      {connection && (
        <SyncedEventsSection
          creatorEvents={creatorEvents}
          volunteerEvents={volunteerEvents}
          removing={removingEventId !== null}
          onRemove={setEventToRemove}
        />
      )}

      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect your Google Calendar from Let&apos;s Assist.
              Your existing synced events will remain in your calendar, but new
              events won&apos;t be automatically synced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={eventToRemove !== null}
        onOpenChange={(open) => {
          if (!open && removingEventId === null) setEventToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this event?</AlertDialogTitle>
            <AlertDialogDescription>
              {eventToRemove
                ? `"${eventToRemove.title}" will be removed from your Google Calendar.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingEventId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (eventToRemove) void handleRemoveEvent(eventToRemove.source);
              }}
              disabled={removingEventId !== null}
            >
              {removingEventId !== null ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
