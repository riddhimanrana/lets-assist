import { format, parseISO } from "date-fns";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { formatTimeTo12Hour } from "@/lib/utils";

import type { SessionDetails } from "./attendance-session";

/**
 * The frame every check-in step shares: which event and session this is, then
 * the step itself on a phone-width measure.
 */
export function AttendanceShell({
  projectTitle,
  sessionName,
  sessionDetails,
  children,
}: {
  projectTitle: string;
  sessionName: string;
  sessionDetails: SessionDetails | null;
  children: ReactNode;
}) {
  const hasTimes = sessionDetails?.startTime && sessionDetails?.endTime;

  return (
    <div className="mx-auto grid w-full max-w-md gap-6 px-4 py-8 sm:px-6">
      <PageHeader
        title={projectTitle}
        description={
          <>Confirm your attendance for the session: {sessionName}</>
        }
        meta={
          sessionDetails?.date || hasTimes ? (
            <>
              {sessionDetails?.date ? (
                <span>
                  {format(parseISO(sessionDetails.date), "EEEE, MMMM d, yyyy")}
                </span>
              ) : null}
              {hasTimes ? (
                <span className="tabular-nums">
                  {formatTimeTo12Hour(sessionDetails.startTime)} -{" "}
                  {formatTimeTo12Hour(sessionDetails.endTime)}
                </span>
              ) : null}
            </>
          ) : undefined
        }
      />
      {children}
    </div>
  );
}
