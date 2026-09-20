"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Project, ProjectSignup } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AttendanceTools } from "@/components/projects/AttendanceTools";
import { AttendanceExport } from "@/components/projects/AttendanceExport";
import { AttendanceIntervalEditor } from "@/components/projects/AttendanceIntervalEditor";
import { getAttendanceScheduleWindow } from "@/lib/attendance/challenge";
import { getPublishStateKey } from "@/lib/projects/hours-publish-key";
import { summarizeAttendanceHours } from "@/lib/projects/attendance-hours-summary";
import {
  inspectAttendanceIntervals,
  readAttendanceIntervals,
  type AttendanceInterval,
} from "@/lib/projects/paper-signup/intervals";
import { getMultiDaySlotDisplayName } from "@/utils/project";
import {
  correctVolunteerAttendance,
  recordVolunteerAttendance,
  publishVolunteerHours,
  resendCertificateEmails,
} from "./actions";

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
    type: string;
  }>;
};
type Draft = {
  intervals: AttendanceInterval[];
  reason: string;
  reviewed: boolean;
};
const nameOf = (signup: ProjectSignup) =>
  signup.profile?.full_name ||
  signup.anonymous_signup?.name ||
  "Unnamed volunteer";
const minutesLabel = (minutes: number | null) =>
  minutes === null
    ? "Needs review"
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const savedIntervals = (signup: AttendanceHoursSignup) =>
  signup.project_attendance_intervals?.length
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
      );
const certificateOf = (signup: AttendanceHoursSignup) =>
  signup.certificates?.find((certificate) => certificate.type === "verified");

function sessionLabel(project: Project, sessionId: string) {
  const key = getPublishStateKey(project, sessionId);
  if (project.event_type === "oneTime") return "Main session";
  if (project.event_type === "multiDay") {
    for (const [dayIndex, day] of (project.schedule.multiDay ?? []).entries()) {
      for (const [slotIndex, slot] of day.slots.entries()) {
        if (
          getPublishStateKey(
            project,
            `${day.date}-${dayIndex}-${slotIndex}`,
          ) === key
        )
          return `${day.date}: ${getMultiDaySlotDisplayName(slot, slotIndex)}`;
      }
    }
  }
  return sessionId;
}

export function HoursClient({
  project,
  initialSignups,
}: {
  project: Project;
  initialSignups: AttendanceHoursSignup[];
}) {
  const router = useRouter();
  const timezone = project.project_timezone || "America/Los_Angeles";
  const [search, setSearch] = useState("");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<AttendanceHoursSignup | null>(null);
  const [correctionRequest, setCorrectionRequest] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSession, setConfirmSession] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const sessions = useMemo(() => {
    const groups = new Map<string, AttendanceHoursSignup[]>();
    for (const signup of initialSignups) {
      const key = getPublishStateKey(project, signup.schedule_id);
      groups.set(key, [...(groups.get(key) ?? []), signup]);
    }
    return [...groups.entries()];
  }, [initialSignups, project]);
  const draftFor = (signup: AttendanceHoursSignup): Draft =>
    drafts[signup.id] ?? {
      intervals: savedIntervals(signup),
      reason: "",
      reviewed: signup.attendance_revision > 0,
    };
  const isReady = (signup: AttendanceHoursSignup) => {
    const draft = draftFor(signup);
    const inspection = inspectAttendanceIntervals(
      draft.intervals,
      getAttendanceScheduleWindow(project, signup.schedule_id),
    );
    return (
      inspection.minutes !== null &&
      (draft.reviewed || !inspection.outsideSession) &&
      (!inspection.outsideSession ||
        signup.attendance_revision > 0 ||
        Boolean(draft.reason))
    );
  };
  const publish = async (key: string, attendees: AttendanceHoursSignup[]) => {
    setBusy(key);
    try {
      const result = await publishVolunteerHours(
        project.id,
        attendees[0].schedule_id,
        attendees.filter(isReady).map((signup) => {
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
        }),
      );
      if (!result.success) {
        toast.error(result.error || "Hours could not be published.");
        return;
      }
      setNotice(
        `Hours published. ${result.certificatesCreated ?? 0} certificates created; ${result.emailsSent ?? 0} emails accepted for delivery.${result.emailErrors?.length ? ` Delivery needs attention: ${result.emailErrors.join(" ")}` : ""}`,
      );
      setConfirmSession(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };
  const resend = async (key: string, scheduleId: string) => {
    setBusy(key);
    try {
      const result = await resendCertificateEmails(project.id, scheduleId);
      if (!result.success)
        toast.error(result.error || "Could not retry delivery.");
      else
        setNotice(
          `${result.emailsSent ?? 0} certificate emails accepted for delivery.${result.emailErrors?.length ? ` ${result.emailErrors.join(" ")}` : ""}`,
        );
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Link href={`/projects/${project.id}`} className="text-sm underline">
        Back to project
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">Volunteer hours</h1>
        <p className="text-muted-foreground">{project.title}</p>
        <p className="mt-2 text-sm">
          Review actual attendance, publish credit, and correct earlier awards.
          Times use {timezone}.
        </p>
      </header>
      <AttendanceTools projectId={project.id} />
      <AttendanceExport
        scope="project"
        scopeId={project.id}
        sessionId={sessionFilter}
      />
      {notice && (
        <p role="status" className="rounded border p-4 text-sm">
          {notice}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label="Search volunteers"
          placeholder="Search name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter sessions"
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          className="rounded border bg-background p-2"
        >
          <option value="all">All sessions</option>
          {sessions.map(([key, attendees]) => (
            <option key={key} value={key}>
              {sessionLabel(project, attendees[0].schedule_id)}
            </option>
          ))}
        </select>
      </div>
      {!sessions.length && (
        <p className="rounded border p-6 text-muted-foreground">
          No approved volunteers or recorded attendance yet. Add a walk-in or
          scan a completed sheet to begin.
        </p>
      )}
      {sessions
        .filter(([key]) => sessionFilter === "all" || sessionFilter === key)
        .map(([key, attendees]) => {
          const published = Boolean(
            project.published?.[key] || attendees.some(certificateOf),
          );
          const ready = attendees.filter(isReady);
          const visible = attendees.filter((signup) =>
            `${nameOf(signup)} ${signup.profile?.email || signup.anonymous_signup?.email || ""}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          );
          const summary = summarizeAttendanceHours(
            attendees.map((signup) => {
              const certificate = certificateOf(signup);
              const minutes = certificate
                ? (certificate.credited_minutes ??
                  Math.round(
                    (Date.parse(certificate.event_end) -
                      Date.parse(certificate.event_start)) /
                      60000,
                  ))
                : null;
              return {
                creditedMinutes: minutes,
                recordedMinutes: inspectAttendanceIntervals(
                  draftFor(signup).intervals,
                ).minutes,
              };
            }),
          );
          return (
            <section key={key} className="rounded-lg border overflow-hidden">
              <div className="bg-muted/30 p-4 space-y-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="font-semibold">
                    {sessionLabel(project, attendees[0].schedule_id)}
                  </h2>
                  <Badge variant={published ? "secondary" : "outline"}>
                    {published ? "Published" : "Not published"}
                  </Badge>
                </div>
                <p className="text-sm">
                  {attendees.length} volunteers ·{" "}
                  {minutesLabel(summary.awardedMinutes)} awarded
                </p>
                {summary.pendingCount > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {minutesLabel(summary.recordedMinutes)} recorded for{" "}
                    {summary.pendingCount} volunteers awaiting publication.
                  </p>
                )}
                {published ? (
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void resend(key, attendees[0].schedule_id)}
                  >
                    Retry certificate delivery
                  </Button>
                ) : (
                  <Button
                    disabled={busy !== null || !ready.length}
                    onClick={() => setConfirmSession(key)}
                  >
                    Review and publish {ready.length} volunteers
                  </Button>
                )}
                {!published && ready.length !== attendees.length && (
                  <p className="text-sm text-muted-foreground">
                    {attendees.length - ready.length} volunteers still need
                    valid attendance times.
                  </p>
                )}
                {confirmSession === key && (
                  <div className="rounded border bg-background p-3 space-y-3">
                    <p className="text-sm">
                      Publish {ready.length} reviewed attendance records and
                      queue their certificate emails? Search filters do not
                      change the publication selection. Missing or invalid times
                      receive no credit.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        disabled={busy !== null}
                        onClick={() => void publish(key, attendees)}
                      >
                        {busy === key ? "Publishing…" : "Publish hours"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => setConfirmSession(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="divide-y">
                {visible.map((signup) => {
                  const certificate = certificateOf(signup);
                  const draft = draftFor(signup);
                  const inspection = inspectAttendanceIntervals(
                    draft.intervals,
                  );
                  const minutes = certificate
                    ? (certificate.credited_minutes ??
                      Math.round(
                        (Date.parse(certificate.event_end) -
                          Date.parse(certificate.event_start)) /
                          60000,
                      ))
                    : inspection.minutes;
                  return (
                    <article
                      key={signup.id}
                      className="p-4 flex flex-col gap-3 sm:flex-row sm:justify-between"
                    >
                      <div className="space-y-1">
                        <h3 className="font-medium">
                          {nameOf(signup)}{" "}
                          <span className="text-xs text-muted-foreground">
                            {signup.user_id ? "Account" : "Guest"}
                          </span>
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {signup.profile?.email ||
                            signup.anonymous_signup?.email ||
                            "Email missing"}
                        </p>
                        {draft.intervals.map((interval, index) => (
                          <p className="text-sm" key={index}>
                            Visit {index + 1}:{" "}
                            {interval.checkIn
                              ? new Date(interval.checkIn).toLocaleString(
                                  "en-US",
                                  { timeZone: timezone },
                                )
                              : "Sign-in missing"}{" "}
                            to{" "}
                            {interval.checkOut
                              ? new Date(interval.checkOut).toLocaleString(
                                  "en-US",
                                  { timeZone: timezone },
                                )
                              : "Sign-out missing"}
                          </p>
                        ))}
                        <p className="font-medium text-sm">
                          {minutesLabel(minutes)}
                          {draft.intervals.length > 1
                            ? ", excluding breaks"
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-start flex-wrap gap-2">
                        {certificate && (
                          <Button
                            variant="outline"
                            render={
                              <Link href={`/certificates/${certificate.id}`} />
                            }
                          >
                            View certificate
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => {
                            setEditing(signup);
                            setCorrectionRequest(crypto.randomUUID());
                          }}
                        >
                          {certificate ? "Correct hours" : "Edit visits"}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      {editing && (
        <AttendanceIntervalEditor
          name={nameOf(editing)}
          timezone={timezone}
          initialIntervals={draftFor(editing).intervals}
          window={getAttendanceScheduleWindow(project, editing.schedule_id)}
          correction={Boolean(certificateOf(editing))}
          onClose={() => setEditing(null)}
          onSave={async (intervals, reason) => {
            if (certificateOf(editing)) {
              const result = await correctVolunteerAttendance(
                project.id,
                editing.id,
                editing.attendance_revision,
                reason,
                intervals,
                correctionRequest,
              );
              if ("error" in result && result.error) {
                toast.error(result.error);
                return false;
              }
              setNotice(
                "Correction saved. The existing certificate now shows the corrected hours. No email was sent.",
              );
              setDrafts((current) => {
                const next = { ...current };
                delete next[editing.id];
                return next;
              });
              router.refresh();
            } else {
              const result = await recordVolunteerAttendance(
                project.id,
                editing.id,
                editing.attendance_revision,
                reason || "Coordinator reviewed attendance",
                intervals,
                correctionRequest,
              );
              if ("error" in result && result.error) {
                toast.error(result.error);
                return false;
              }
              setDrafts((current) => ({
                ...current,
                [editing.id]: { intervals, reason, reviewed: true },
              }));
              setNotice(
                "Attendance saved. If this session is already published, its certificate is available. Otherwise publish the session to award hours.",
              );
              router.refresh();
            }
            return true;
          }}
        />
      )}
    </main>
  );
}
