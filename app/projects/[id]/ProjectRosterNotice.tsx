"use client";

import { AlertCircle, History } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  SlotAttendeesDropdown,
  type SlotAttendee,
} from "@/components/projects/SlotAttendeesDropdown";
import type { RosterLoadState } from "./usePublicAttendees";

export function ProjectRosterNotice({
  state,
  previousSchedule,
  onRetry,
}: {
  state: RosterLoadState;
  previousSchedule: SlotAttendee[];
  onRetry: () => Promise<void>;
}) {
  if (state === "restricted") return null;
  if (state === "loading") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner /> Loading signups…
      </p>
    );
  }
  if (state === "error") {
    return (
      <Alert variant="warning">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Signups couldn’t be loaded</AlertTitle>
        <AlertDescription>
          <p>Please try again to see the saved signups.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void onRetry();
            }}
          >
            Retry loading signups
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!previousSchedule.length) return null;
  return (
    <section aria-labelledby="previous-schedule-title" className="grid gap-2">
      <Alert variant="info">
        <History aria-hidden="true" />
        <AlertTitle id="previous-schedule-title">
          Signups from a previous schedule
        </AlertTitle>
        <AlertDescription>
          These signups are still saved, but their dates or slots are no longer
          in the current schedule. Contact the organizer to confirm their
          details.
        </AlertDescription>
      </Alert>
      <SlotAttendeesDropdown attendees={previousSchedule} />
    </section>
  );
}
