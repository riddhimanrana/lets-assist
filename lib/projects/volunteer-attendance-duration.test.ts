import { expect, test } from "bun:test";
import type { Project } from "@/types";
import { getSlotDetails } from "@/utils/project";
import { getScheduleIdAliases } from "./hours-publish-key";
import {
  isVolunteerSessionPublished,
  matchVolunteerCertificate,
  volunteerAttendanceDuration,
  type VolunteerCertificate,
} from "./volunteer-attendance-duration";

const signup = {
  id: "signup",
  schedule_id: "oneTime",
  check_in_time: "2026-09-20T09:00:00Z",
  check_out_time: "2026-09-20T15:00:00Z",
  attendance_intervals: [
    { checkIn: "2026-09-20T09:00:00Z", checkOut: "2026-09-20T10:00:00Z" },
    { checkIn: "2026-09-20T14:00:00Z", checkOut: "2026-09-20T15:00:00Z" },
  ],
};
const certificate: VolunteerCertificate = {
  id: "certificate",
  signup_id: signup.id,
  project_id: "project",
  schedule_id: "oneTime",
  type: "verified",
  credited_minutes: 150,
  event_start: signup.check_in_time,
  event_end: signup.check_out_time,
};

test("split visits exclude breaks and a corrected award takes precedence", () => {
  expect(volunteerAttendanceDuration(signup)).toEqual({
    text: "2h",
    isValid: true,
    totalMinutes: 120,
  });
  expect(volunteerAttendanceDuration(signup, certificate)).toEqual({
    text: "2h 30m",
    isValid: true,
    totalMinutes: 150,
  });
  expect(
    volunteerAttendanceDuration(
      { ...signup, check_in_time: null, check_out_time: null },
      certificate,
    ).totalMinutes,
  ).toBe(150);
});

test("reviewed intervals sum milliseconds before rounding once", () => {
  expect(
    volunteerAttendanceDuration({
      ...signup,
      attendance_intervals: [
        { checkIn: "2026-09-20T09:00:00Z", checkOut: "2026-09-20T09:00:40Z" },
        { checkIn: "2026-09-20T14:00:00Z", checkOut: "2026-09-20T14:00:40Z" },
      ],
    }).totalMinutes,
  ).toBe(1);
});

test("historical awards keep their snapshot and legacy truncation", () => {
  const historical = {
    ...certificate,
    credited_minutes: null,
    event_end: "2026-09-20T10:00:59Z",
  };
  expect(volunteerAttendanceDuration(signup, historical)).toEqual({
    text: "1h",
    isValid: true,
    totalMinutes: 60,
  });
  expect(
    volunteerAttendanceDuration({
      ...signup,
      attendance_intervals: [],
      check_out_time: historical.event_end,
    }).totalMinutes,
  ).toBe(60);
  expect(
    volunteerAttendanceDuration({ ...signup, attendance_intervals: undefined })
      .totalMinutes,
  ).toBe(360);
});

test("invalid or unavailable reviewed intervals never fall back to the envelope", () => {
  for (const intervals of [
    null,
    [{ checkIn: signup.check_in_time, checkOut: null }],
    [signup.attendance_intervals[0], signup.attendance_intervals[0]],
  ]) {
    expect(
      volunteerAttendanceDuration({
        ...signup,
        attendance_intervals: intervals,
      }).isValid,
    ).toBe(false);
  }
  expect(
    volunteerAttendanceDuration(
      { ...signup, attendance_intervals: null },
      certificate,
    ).totalMinutes,
  ).toBe(150);
});

const slot = { startTime: "09:00", endTime: "15:00", volunteers: 10 };
for (const [eventType, schedule, canonical, aliases] of [
  [
    "oneTime",
    { oneTime: { date: "2026-09-20", ...slot } },
    "oneTime",
    ["oneTime", "default", "0"],
  ],
  [
    "sameDayMultiArea",
    {
      sameDayMultiArea: {
        date: "2026-09-20",
        roles: [
          { name: "Setup", ...slot },
          { name: "Cleanup", ...slot },
        ],
      },
    },
    "Setup",
    ["Setup", "role-0"],
  ],
  [
    "multiDay",
    { multiDay: [{ date: "2026-09-20", slots: [slot, slot] }] },
    "2026-09-20-0",
    ["2026-09-20-0-0", "2026-09-20-0", "0-0", "day-0-slot-0"],
  ],
] as const) {
  test(`${eventType} aliases resolve slot details and published certificate identity`, () => {
    const project = {
      id: "project",
      event_type: eventType,
      schedule,
      published: { [canonical]: true },
    } as unknown as Project;
    for (const alias of aliases) {
      expect(
        getSlotDetails(project, getScheduleIdAliases(project, alias)[0]),
      ).not.toBeNull();
      expect(isVolunteerSessionPublished(project, alias)).toBe(true);
      expect(
        isVolunteerSessionPublished({ ...project, published: {} }, alias),
      ).toBe(false);
      expect(
        matchVolunteerCertificate(
          project,
          { ...signup, schedule_id: alias },
          { ...certificate, schedule_id: canonical },
        ),
      ).toBe(true);
      expect(
        matchVolunteerCertificate(
          project,
          { ...signup, schedule_id: alias },
          {
            ...certificate,
            schedule_id: canonical,
            project_id: "another-project",
          },
        ),
      ).toBe(false);
      expect(
        matchVolunteerCertificate(
          project,
          { ...signup, schedule_id: alias },
          {
            ...certificate,
            schedule_id: canonical,
            signup_id: "another-signup",
          },
        ),
      ).toBe(false);
      expect(
        matchVolunteerCertificate(
          project,
          { ...signup, schedule_id: alias },
          { ...certificate, schedule_id: "another-session" },
        ),
      ).toBe(false);
    }
  });
}

test("legacy NULL-type signup-linked awards are accepted but self-reported certificates are excluded", () => {
  const project = {
    id: "project",
    event_type: "oneTime",
    schedule: { oneTime: { date: "2026-09-20", ...slot } },
  } as Project;
  expect(
    matchVolunteerCertificate(project, signup, {
      ...certificate,
      type: null,
      schedule_id: null,
    }),
  ).toBe(true);
  expect(
    matchVolunteerCertificate(project, signup, {
      ...certificate,
      type: "self-reported",
    }),
  ).toBe(false);
});

test("published cards wait for a matching certificate and never show an attendance estimate after a failed read", () => {
  expect(
    volunteerAttendanceDuration(signup, undefined, {
      certificateReadComplete: false,
    }),
  ).toEqual({ text: "Loading award…", isValid: false, totalMinutes: 0 });
  expect(
    volunteerAttendanceDuration(signup, undefined, {
      certificateReadComplete: true,
    }),
  ).toEqual({ text: "Award unavailable", isValid: false, totalMinutes: 0 });
  expect(
    volunteerAttendanceDuration(signup, certificate, {
      certificateReadComplete: true,
    }).totalMinutes,
  ).toBe(150);
});
