"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { updateCalendarEventForProject } from "@/utils/calendar-helpers";

export type ProjectCalendarIssue = { message: string; retryable: boolean };

/**
 * Ask the server to refresh the creator's calendar entry for a saved project.
 * Returns null only when the server reported success.
 */
export async function runProjectCalendarUpdate(
  projectId: string,
  hasCreatorCalendarEvent: boolean,
): Promise<ProjectCalendarIssue | null> {
  try {
    const result = await updateCalendarEventForProject(projectId);
    if (result.success) return null;
    if (result.code === "not_owner") {
      // Another editor has no calendar entry of their own for this project.
      return hasCreatorCalendarEvent
        ? {
            message:
              "This project's Google Calendar entry belongs to its creator. Only the creator can refresh it, by saving this project again.",
            retryable: false,
          }
        : null;
    }
    return { message: result.error, retryable: result.retryable !== false };
  } catch {
    return {
      message: "Google Calendar could not be reached. Retry in a moment.",
      retryable: true,
    };
  }
}

export function EditProjectCalendarNotice({
  issue,
  retrying,
  onRetry,
  onViewProject,
}: {
  issue: ProjectCalendarIssue | null;
  retrying: boolean;
  onRetry: () => Promise<void>;
  onViewProject: () => void;
}) {
  if (!issue) return null;
  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden="true" />
      {/* A write may have landed without its acknowledgement, so the state is unconfirmed, not "not updated". */}
      <AlertTitle>
        Project saved. Google Calendar update is unconfirmed.
      </AlertTitle>
      <AlertDescription>
        <p>{issue.message}</p>
        <div className="flex flex-wrap gap-2">
          {issue.retryable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={() => {
                void onRetry();
              }}
            >
              {retrying && <Spinner data-icon="inline-start" />}
              Retry calendar update
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onViewProject}
          >
            View project
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
