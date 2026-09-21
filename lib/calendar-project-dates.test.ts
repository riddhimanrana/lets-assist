import { expect, test } from "bun:test";
import { getCalendarProjectDates } from "./calendar-project-dates";

test("reads dates for a single event and a multi-area event", () => {
  expect(
    getCalendarProjectDates("oneTime", {
      oneTime: {
        date: "2039-09-22",
        startTime: "09:00",
        endTime: "10:00",
        volunteers: 10,
      },
    }),
  ).toEqual({ start_date: "2039-09-22", end_date: "2039-09-22" });
  expect(
    getCalendarProjectDates("sameDayMultiArea", {
      sameDayMultiArea: {
        date: "2039-09-23",
        overallStart: "09:00",
        overallEnd: "12:00",
        roles: [],
      },
    }),
  ).toEqual({ start_date: "2039-09-23", end_date: "2039-09-23" });
});

test("rejects absent schedules and impossible dates", () => {
  expect(getCalendarProjectDates("multiDay", { multiDay: [] })).toBeNull();
  expect(getCalendarProjectDates("oneTime", null)).toBeNull();
  expect(
    getCalendarProjectDates("multiDay", {
      multiDay: [{ date: "2039-02-30", slots: [] }],
    }),
  ).toBeNull();
});
