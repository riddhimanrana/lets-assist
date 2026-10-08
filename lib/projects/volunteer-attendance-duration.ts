import type { Project, Signup } from "@/types";
import { inspectAttendanceIntervals } from "./paper-signup/intervals";
import { getPublishStateKey } from "./hours-publish-key";

export type VolunteerCertificate = {
  id: string;
  signup_id: string;
  project_id: string;
  schedule_id: string | null;
  type: string | null;
  credited_minutes: number | null;
  event_start: string | null;
  event_end: string | null;
};

export function matchVolunteerCertificate(
  project: Pick<Project, "id" | "event_type" | "schedule">,
  signup: Pick<Signup, "id" | "schedule_id">,
  certificate: VolunteerCertificate,
) {
  return (
    certificate.signup_id === signup.id &&
    certificate.project_id === project.id &&
    (certificate.type === "verified" || certificate.type === null) &&
    (certificate.schedule_id === null ||
      getPublishStateKey(project, certificate.schedule_id) ===
        getPublishStateKey(project, signup.schedule_id))
  );
}

export function isVolunteerSessionPublished(
  project: Pick<Project, "event_type" | "schedule" | "published">,
  scheduleId: string,
) {
  return project.published?.[getPublishStateKey(project, scheduleId)] === true;
}

function displayMinutes(minutes: number | null, invalid = "Incomplete") {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) {
    return { text: invalid, isValid: false, totalMinutes: 0 };
  }
  if (minutes > 1440)
    return { text: "Over 24h", isValid: false, totalMinutes: minutes };
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return {
    text: hours
      ? `${hours}h${remaining ? ` ${remaining}m` : ""}`
      : `${remaining}m`,
    isValid: true,
    totalMinutes: minutes,
  };
}

function legacyMinutes(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const milliseconds = Date.parse(end) - Date.parse(start);
  return Number.isFinite(milliseconds)
    ? Math.trunc(milliseconds / 60000)
    : null;
}

export function volunteerAttendanceDuration(
  signup: Pick<
    Signup,
    "check_in_time" | "check_out_time" | "attendance_intervals"
  >,
  certificate?: VolunteerCertificate,
  published?: { certificateReadComplete: boolean },
) {
  if (certificate) {
    // A historical award keeps its snapshot and original whole-minute rounding.
    const minutes =
      certificate.credited_minutes ??
      legacyMinutes(certificate.event_start, certificate.event_end);
    return displayMinutes(minutes, "Invalid award duration");
  }
  if (published) {
    return displayMinutes(
      null,
      published.certificateReadComplete
        ? "Award unavailable"
        : "Loading award…",
    );
  }
  if (signup.attendance_intervals === null) {
    return displayMinutes(null, "Attendance unavailable");
  }
  if (signup.attendance_intervals?.length) {
    const inspected = inspectAttendanceIntervals(signup.attendance_intervals);
    return displayMinutes(inspected.minutes, "Attendance needs review");
  }
  return displayMinutes(
    legacyMinutes(signup.check_in_time, signup.check_out_time),
    "Incomplete",
  );
}
