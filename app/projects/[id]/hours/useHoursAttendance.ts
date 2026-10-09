import type { ProjectSignup } from "@/types";
import {
  inspectAttendanceIntervals,
  readAttendanceIntervals,
  type AttendanceInterval,
} from "@/lib/projects/paper-signup/intervals";

export type AttendanceHoursSignup = ProjectSignup & {
  attendance_revision: number;
  project_attendance_intervals: Array<{
    check_in_time: string;
    check_out_time: string;
  }>;
  certificates: Array<{
    id: string;
    credited_minutes: number | null;
    event_start: string;
    event_end: string;
    attendance_revision: number;
    type: string | null;
    canResendCorrection: boolean;
  }>;
};
export type HoursWindow = { startsAt: number; endsAt: number };
export type HoursWindows = Record<string, HoursWindow | null>;
export type HoursDraft = {
  intervals: AttendanceInterval[];
  reason: string;
  reviewed: boolean;
};

export const nameOf = (signup: ProjectSignup) =>
  signup.profile?.full_name ||
  signup.anonymous_signup?.name ||
  "Unnamed volunteer";
export const emailOf = (signup: ProjectSignup) =>
  signup.profile?.email || signup.anonymous_signup?.email || "";
export const minutesLabel = (minutes: number | null) =>
  minutes === null
    ? "Needs review"
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
export const certificateOf = (signup: AttendanceHoursSignup) =>
  signup.certificates.find(
    (certificate) =>
      certificate.type === "verified" || certificate.type === null,
  );

export function savedDraft(signup: AttendanceHoursSignup): HoursDraft {
  return {
    intervals: signup.project_attendance_intervals.length
      ? signup.project_attendance_intervals
          .map((interval) => ({
            checkIn: interval.check_in_time,
            checkOut: interval.check_out_time,
          }))
          .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
      : readAttendanceIntervals(
          null,
          signup.check_in_time,
          signup.check_out_time,
        ),
    reason: "",
    reviewed: signup.attendance_revision > 0,
  };
}

export function creditedMinutes(signup: AttendanceHoursSignup): number | null {
  const certificate = certificateOf(signup);
  if (!certificate) return null;
  const minutes =
    certificate.credited_minutes ??
    Math.round(
      (Date.parse(certificate.event_end) -
        Date.parse(certificate.event_start)) /
        60000,
    );
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export function isHoursReady(
  signup: AttendanceHoursSignup,
  window: HoursWindow | null,
  draft = savedDraft(signup),
): boolean {
  const inspection = inspectAttendanceIntervals(draft.intervals, window);
  return (
    inspection.minutes !== null &&
    (draft.reviewed || !inspection.outsideSession) &&
    (!inspection.outsideSession ||
      signup.attendance_revision > 0 ||
      Boolean(draft.reason.trim()))
  );
}

/** Serialize the full session, regardless of the current search filter. */
export function hoursPublicationEntries(
  attendees: AttendanceHoursSignup[],
  window: HoursWindow | null,
  draftFor = savedDraft,
) {
  return attendees
    .filter(
      (signup) =>
        !certificateOf(signup) &&
        isHoursReady(signup, window, draftFor(signup)),
    )
    .map((signup) => {
      const draft = draftFor(signup);
      return {
        signupId: signup.id,
        checkIn: draft.intervals[0]?.checkIn ?? null,
        checkOut: draft.intervals.at(-1)?.checkOut ?? null,
        isValid: true,
        intervals: draft.intervals,
        attendanceRevision: signup.attendance_revision,
        timeExceptionReason: draft.reason,
      };
    });
}

export function canSaveHoursEdit(
  current: AttendanceHoursSignup | undefined,
  expectedRevision: number,
  correcting: boolean,
): boolean {
  return Boolean(
    current &&
    current.attendance_revision === expectedRevision &&
    Boolean(certificateOf(current)) === correcting,
  );
}

export function correctionDeliveryRequest(
  requests: Map<string, string>,
  certificate: AttendanceHoursSignup["certificates"][number],
  createId = () => crypto.randomUUID(),
): string {
  const key = `${certificate.id}:${certificate.attendance_revision}`;
  const requestId = requests.get(key) ?? createId();
  requests.set(key, requestId);
  return requestId;
}
