"use client";

import { AttendanceIntervalEditor } from "@/components/projects/AttendanceIntervalEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getPublishStateKey } from "@/lib/projects/hours-publish-key";
import type { Project } from "@/types";
import { certificateOf, nameOf, type HoursWindows } from "./useHoursAttendance";
import type { HoursEdits } from "./useHoursEdits";
import type { HoursPublishing } from "./useHoursPublishing";

export function HoursConfirmPublishDialog({
  publishing,
}: {
  publishing: HoursPublishing;
}) {
  const session = publishing.confirmSession;
  const busy = publishing.busy !== null || publishing.isRefreshing;
  return (
    <Dialog
      open={session !== null}
      onOpenChange={(open) =>
        !open && !busy && publishing.setConfirmSessionId(null)
      }
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish volunteer hours</DialogTitle>
          <DialogDescription>
            Publish {session?.readyCount ?? 0} reviewed attendance records for{" "}
            {session?.name} and queue their certificate emails?
          </DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Search filters do not change the publication selection. Missing or
          invalid times receive no credit. You can correct awarded hours later
          without automatically sending another email.
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => publishing.setConfirmSessionId(null)}
          >
            Cancel
          </Button>
          <Button
            disabled={
              busy || !session?.readyCount || session.status !== "completed"
            }
            onClick={() => session && void publishing.publish(session)}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "Publishing..." : "Publish hours"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HoursEditDialog({
  edits,
  project,
  windows,
}: {
  edits: HoursEdits;
  project: Project;
  windows: HoursWindows;
}) {
  if (!edits.editing) return null;
  const { signup, intervals, requestId } = edits.editing;
  return (
    <AttendanceIntervalEditor
      key={requestId}
      name={nameOf(signup)}
      timezone={project.project_timezone || "America/Los_Angeles"}
      initialIntervals={intervals}
      window={windows[getPublishStateKey(project, signup.schedule_id)] ?? null}
      correction={Boolean(certificateOf(signup))}
      onClose={edits.close}
      onSave={edits.save}
    />
  );
}
