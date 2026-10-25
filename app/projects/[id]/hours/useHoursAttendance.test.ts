import { describe, expect, test } from "bun:test";
import type { Project } from "@/types";
import {
  canSaveHoursEdit,
  certificateOf,
  correctionDeliveryRequest,
  creditedMinutes,
  hoursPublicationEntries,
  isHoursReady,
  savedDraft,
  type AttendanceHoursSignup,
  type HoursWindow,
} from "./useHoursAttendance";
import { buildHoursSessions } from "./useHoursSessions";

const start = "2026-10-01T09:00:00.000Z";
const end = "2026-10-01T12:00:00.000Z";
const window: HoursWindow = {
  startsAt: Date.parse(start),
  endsAt: Date.parse(end),
};
const project = {
  id: "project",
  event_type: "oneTime",
  verification_method: "auto",
  published: {},
  schedule: {
    oneTime: { date: "2026-10-01", startTime: "09:00", endTime: "12:00" },
  },
} as unknown as Project;
const signup = (
  id: string,
  patch: Partial<AttendanceHoursSignup> = {},
): AttendanceHoursSignup =>
  ({
    id,
    project_id: "project",
    schedule_id: "oneTime",
    attendance_revision: 0,
    status: "attended",
    user_id: id,
    anonymous_id: null,
    check_in_time: start,
    check_out_time: end,
    created_at: start,
    profile: { full_name: id, email: `${id}@example.test` },
    certificates: [],
    project_attendance_intervals: [],
    ...patch,
  }) as AttendanceHoursSignup;
const certificate = (
  patch: Partial<AttendanceHoursSignup["certificates"][number]> = {},
) => ({
  id: "certificate",
  credited_minutes: 120,
  event_start: start,
  event_end: end,
  attendance_revision: 2,
  type: "verified",
  canResendCorrection: true,
  ...patch,
});
const visits = [
  { check_in_time: start, check_out_time: "2026-10-01T10:00:00.000Z" },
  { check_in_time: "2026-10-01T11:00:00.000Z", check_out_time: end },
];
const sessions = (
  signups: AttendanceHoursSignup[],
  patch: Partial<Parameters<typeof buildHoursSessions>[0]> = {},
) =>
  buildHoursSessions({
    project,
    signups,
    windows: { oneTime: window },
    searchTerm: "",
    now: window.endsAt + 10 * 86400000,
    ...patch,
  });

describe("Hours publication selection", () => {
  test("retains every interval, optimistic revision, and exception reason", () => {
    const row = signup("multiple-visits", {
      attendance_revision: 4,
      project_attendance_intervals: [...visits].reverse(),
    });
    const draft = {
      ...savedDraft(row),
      reason: "Coordinator confirmed extended attendance",
    };
    expect(hoursPublicationEntries([row], window, () => draft)).toEqual([
      {
        signupId: row.id,
        checkIn: start,
        checkOut: end,
        isValid: true,
        intervals: visits.map((visit) => ({
          checkIn: visit.check_in_time,
          checkOut: visit.check_out_time,
        })),
        attendanceRevision: 4,
        timeExceptionReason: draft.reason,
      },
    ]);
  });

  test("search hides rows without narrowing the session publication", () => {
    const [session] = sessions([signup("Alice"), signup("Bob")], {
      searchTerm: "alice",
    });
    expect(session.visibleAttendees.map((row) => row.id)).toEqual(["Alice"]);
    expect(session.readyCount).toBe(2);
    expect(
      hoursPublicationEntries(session.attendees, session.window).map(
        (row) => row.signupId,
      ),
    ).toEqual(["Alice", "Bob"]);
  });

  test("combines every one-time alias in one session", () => {
    const grouped = sessions([
      signup("a", { schedule_id: "0" }),
      signup("b", { schedule_id: "default" }),
      signup("c"),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].attendees).toHaveLength(3);
    expect(grouped[0].scheduleId).toBe("oneTime");
  });

  test("combines all multi-day aliases without losing participants", () => {
    const multi = {
      ...project,
      event_type: "multiDay",
      schedule: {
        multiDay: [
          {
            date: "2026-10-01",
            slots: [{ startTime: "09:00", endTime: "12:00", name: "Morning" }],
          },
        ],
      },
    } as Project;
    const grouped = sessions(
      ["2026-10-01-0-0", "0-0", "2026-10-01-0", "day-0-slot-0"].map(
        (schedule_id, index) => signup(String(index), { schedule_id }),
      ),
      { project: multi, windows: { "2026-10-01-0": window } },
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].readyCount).toBe(4);
    expect(grouped[0].id).toBe("2026-10-01-0");
  });

  test("combines named and indexed area roles", () => {
    const area = {
      ...project,
      event_type: "sameDayMultiArea",
      schedule: {
        sameDayMultiArea: {
          date: "2026-10-01",
          roles: [{ name: "Food", startTime: "09:00", endTime: "12:00" }],
        },
      },
    } as Project;
    const grouped = sessions(
      [
        signup("a", { schedule_id: "Food" }),
        signup("b", { schedule_id: "role-0" }),
      ],
      { project: area, windows: { Food: window } },
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].readyCount).toBe(2);
    expect(grouped[0].scheduleId).toBe("Food");
  });

  test("excludes certificates and incomplete or overlapping attendance without blocking valid peers", () => {
    const rows = [
      signup("valid"),
      signup("awarded", { certificates: [certificate()] }),
      signup("missing", { check_out_time: null }),
      signup("overlap", {
        project_attendance_intervals: [visits[0], visits[0]],
      }),
    ];
    expect(
      hoursPublicationEntries(rows, window).map((row) => row.signupId),
    ).toEqual(["valid"]);
  });

  test("requires review and a reason for unreviewed out-of-session time", () => {
    const row = signup("early", { check_in_time: "2026-10-01T08:00:00.000Z" });
    expect(isHoursReady(row, window)).toBe(false);
    expect(
      isHoursReady(row, window, { ...savedDraft(row), reviewed: true }),
    ).toBe(false);
    expect(
      isHoursReady(row, window, {
        ...savedDraft(row),
        reviewed: true,
        reason: " ",
      }),
    ).toBe(false);
    expect(
      isHoursReady(row, window, {
        ...savedDraft(row),
        reviewed: true,
        reason: "Setup approved",
      }),
    ).toBe(true);
    expect(isHoursReady({ ...row, attendance_revision: 1 }, window)).toBe(true);
  });

  test("keeps old completed auto-verification sessions publishable with no 48-hour cutoff", () => {
    const [session] = sessions([signup("valid")]);
    expect(session.status).toBe("completed");
    expect(session.readyCount).toBe(1);
    expect(session.published).toBe(false);
  });

  test("represents upcoming, in-progress and invalid schedules separately", () => {
    expect(sessions([], { now: window.startsAt - 1 })[0].status).toBe(
      "upcoming",
    );
    expect(sessions([], { now: window.startsAt })[0].status).toBe(
      "in-progress",
    );
    expect(sessions([], { now: window.endsAt })[0].status).toBe("completed");
    expect(
      sessions([signup("unknown", { schedule_id: "missing" })]).find(
        (row) => row.id === "missing",
      )?.status,
    ).toBe("invalid");
    expect(sessions([])[0].published).toBe(false);
  });
});

describe("Hours summaries and current server records", () => {
  test("awarded credit uses certificate minutes while pending visits exclude breaks", () => {
    const [session] = sessions([
      signup("awarded", {
        certificates: [certificate()],
        project_attendance_intervals: visits,
      }),
      signup("pending", { project_attendance_intervals: visits }),
      signup("missing", { check_out_time: null }),
    ]);
    expect(session.summary).toEqual({
      awardedMinutes: 120,
      awardedCount: 1,
      recordedMinutes: 120,
      pendingCount: 1,
      unresolvedCount: 1,
    });
  });

  test("supports historical certificates without credited minutes and excludes invalid credit", () => {
    expect(
      creditedMinutes(
        signup("legacy", {
          certificates: [certificate({ type: null, credited_minutes: null })],
        }),
      ),
    ).toBe(180);
    expect(
      creditedMinutes(
        signup("invalid", {
          certificates: [
            certificate({ credited_minutes: null, event_end: "invalid" }),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      certificateOf(
        signup("self", {
          certificates: [certificate({ type: "self-reported" })],
        }),
      ),
    ).toBeUndefined();
  });

  test("refreshed corrected certificates and late attendance replace old rows", () => {
    const before = signup("corrected", {
      attendance_revision: 1,
      certificates: [
        certificate({ credited_minutes: 180, attendance_revision: 1 }),
      ],
    });
    expect(sessions([before])[0].summary.awardedMinutes).toBe(180);
    const corrected = {
      ...before,
      attendance_revision: 2,
      certificates: [certificate()],
    };
    const late = signup("late", {
      attendance_revision: 1,
      certificates: [certificate({ id: "late-cert", credited_minutes: 60 })],
    });
    const [after] = sessions([corrected, late], {
      project: { ...project, published: { oneTime: true } },
    });
    expect(after.summary.awardedMinutes).toBe(180);
    expect(after.summary.awardedCount).toBe(2);
    expect(after.attendees[0].attendance_revision).toBe(2);
    expect(after.readyCount).toBe(0);
    expect(after.published).toBe(true);
  });

  test("preserves a published session with a late pending record for review", () => {
    const [session] = sessions([signup("late", { check_out_time: null })], {
      project: { ...project, published: { oneTime: true } },
    });
    expect(session.published).toBe(true);
    expect(session.pendingCount).toBe(1);
    expect(session.attendees[0].id).toBe("late");
  });
});

describe("Hours correction concurrency and retry identity", () => {
  test("rejects stale revisions, removed rows, and newly awarded records in an open editor", () => {
    const row = signup("editing", { attendance_revision: 2 });
    expect(canSaveHoursEdit(row, 2, false)).toBe(true);
    expect(canSaveHoursEdit({ ...row, attendance_revision: 3 }, 2, false)).toBe(
      false,
    );
    expect(canSaveHoursEdit(undefined, 2, false)).toBe(false);
    expect(
      canSaveHoursEdit({ ...row, certificates: [certificate()] }, 2, false),
    ).toBe(false);
    expect(
      canSaveHoursEdit({ ...row, certificates: [certificate()] }, 2, true),
    ).toBe(true);
  });

  test("retries correction delivery with one request ID per certificate revision", () => {
    const requests = new Map<string, string>();
    let next = 0;
    const create = () => `request-${++next}`;
    const cert = certificate();
    expect(correctionDeliveryRequest(requests, cert, create)).toBe("request-1");
    expect(correctionDeliveryRequest(requests, cert, create)).toBe("request-1");
    expect(
      correctionDeliveryRequest(
        requests,
        { ...cert, attendance_revision: 3 },
        create,
      ),
    ).toBe("request-2");
    expect(
      correctionDeliveryRequest(requests, { ...cert, id: "other" }, create),
    ).toBe("request-3");
  });
});
