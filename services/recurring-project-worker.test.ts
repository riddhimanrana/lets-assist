import { describe, expect, test } from "bun:test";
import { format, parseISO } from "date-fns";

import { getProjectCalendarDate } from "@/lib/projects/recurrence-occurrence-dates";

import {
  firstOccurrenceIndexAfter,
  getOccurrenceDate,
  type RecurrenceRule,
} from "./recurring-project-worker";

function occurrenceDates(
  firstDate: string,
  rule: RecurrenceRule,
  count: number,
): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = getOccurrenceDate(parseISO(firstDate), rule, index + 1);
    return date ? format(date, "yyyy-MM-dd") : "none";
  });
}

const monthly: RecurrenceRule = {
  frequency: "monthly",
  interval: 1,
  end_type: "never",
};

describe("occurrence dates are counted from the first date of the series", () => {
  const cases: Array<{
    name: string;
    firstDate: string;
    rule: RecurrenceRule;
    expected: string[];
  }> = [
    {
      name: "monthly on the 29th keeps the 29th after a short February",
      firstDate: "2027-01-29",
      rule: monthly,
      expected: ["2027-02-28", "2027-03-29", "2027-04-29", "2027-05-29"],
    },
    {
      name: "monthly on the 30th keeps the 30th after February",
      firstDate: "2027-01-30",
      rule: monthly,
      expected: ["2027-02-28", "2027-03-30", "2027-04-30", "2027-05-30"],
    },
    {
      name: "monthly on the 31st uses the last day of each shorter month",
      firstDate: "2027-01-31",
      rule: monthly,
      expected: [
        "2027-02-28",
        "2027-03-31",
        "2027-04-30",
        "2027-05-31",
        "2027-06-30",
      ],
    },
    {
      name: "monthly on the 31st in a leap year lands on February 29",
      firstDate: "2028-01-31",
      rule: monthly,
      expected: ["2028-02-29", "2028-03-31", "2028-04-30"],
    },
    {
      name: "every second month on the 31st",
      firstDate: "2027-08-31",
      rule: { ...monthly, interval: 2 },
      expected: ["2027-10-31", "2027-12-31", "2028-02-29", "2028-04-30"],
    },
    {
      name: "yearly on February 29 returns to the 29th in the next leap year",
      firstDate: "2028-02-29",
      rule: { frequency: "yearly", interval: 1, end_type: "never" },
      expected: [
        "2029-02-28",
        "2030-02-28",
        "2031-02-28",
        "2032-02-29",
        "2033-02-28",
      ],
    },
    {
      name: "daily every third day",
      firstDate: "2027-02-26",
      rule: { frequency: "daily", interval: 3, end_type: "never" },
      expected: ["2027-03-01", "2027-03-04", "2027-03-07"],
    },
    {
      name: "weekly without weekdays repeats on the first date's weekday",
      firstDate: "2027-03-03",
      rule: { frequency: "weekly", interval: 2, end_type: "never" },
      expected: ["2027-03-17", "2027-03-31", "2027-04-14"],
    },
    {
      // 2027-03-01 is a Monday.
      name: "weekly on Monday, Wednesday and Friday",
      firstDate: "2027-03-01",
      rule: {
        frequency: "weekly",
        interval: 1,
        end_type: "never",
        weekdays: ["friday", "monday", "wednesday"],
      },
      expected: [
        "2027-03-03",
        "2027-03-05",
        "2027-03-08",
        "2027-03-10",
        "2027-03-12",
        "2027-03-15",
      ],
    },
    {
      // 2027-03-03 is a Wednesday; the series finishes its own week first.
      name: "every second week on Tuesday and Thursday, starting midweek",
      firstDate: "2027-03-03",
      rule: {
        frequency: "weekly",
        interval: 2,
        end_type: "never",
        weekdays: ["tuesday", "thursday"],
      },
      expected: [
        "2027-03-04",
        "2027-03-16",
        "2027-03-18",
        "2027-03-30",
        "2027-04-01",
      ],
    },
    {
      // 2027-03-06 is a Saturday, so nothing is left in its week.
      name: "weekly on Sunday and Saturday, starting on the Saturday",
      firstDate: "2027-03-06",
      rule: {
        frequency: "weekly",
        interval: 1,
        end_type: "never",
        weekdays: ["saturday", "sunday"],
      },
      expected: ["2027-03-07", "2027-03-13", "2027-03-14", "2027-03-20"],
    },
  ];

  for (const { name, firstDate, rule, expected } of cases) {
    test(name, () => {
      expect(occurrenceDates(firstDate, rule, expected.length)).toEqual(
        expected,
      );
    });
  }

  test("index 0 is the first date and a negative index has no date", () => {
    const firstDate = parseISO("2027-01-31");
    expect(getOccurrenceDate(firstDate, monthly, 0)).toEqual(firstDate);
    expect(getOccurrenceDate(firstDate, monthly, -1)).toBeNull();
  });
});

describe("finding the first occurrence after a date", () => {
  const cases: Array<{
    name: string;
    firstDate: string;
    rule: RecurrenceRule;
    boundary: string;
    minimumIndex?: number;
    expected: number;
  }> = [
    {
      name: "the first occurrence when the series has not started",
      firstDate: "2027-01-31",
      rule: monthly,
      boundary: "2027-01-31",
      expected: 1,
    },
    {
      name: "an occurrence on the boundary itself is not after it",
      firstDate: "2027-01-31",
      rule: monthly,
      boundary: "2027-02-28",
      expected: 2,
    },
    {
      name: "a boundary between two occurrences picks the later one",
      firstDate: "2027-01-31",
      rule: monthly,
      boundary: "2027-03-28",
      expected: 2,
    },
    {
      name: "years of daily history are skipped by search, not by walking",
      firstDate: "2020-01-01",
      rule: { frequency: "daily", interval: 1, end_type: "never" },
      boundary: "2026-08-11",
      expected: 2415,
    },
    {
      name: "never returns less than the minimum index",
      firstDate: "2027-01-31",
      rule: monthly,
      boundary: "2027-01-31",
      minimumIndex: 4,
      expected: 4,
    },
  ];

  for (const {
    name,
    firstDate,
    rule,
    boundary,
    minimumIndex,
    expected,
  } of cases) {
    test(name, () => {
      expect(
        firstOccurrenceIndexAfter(
          parseISO(firstDate),
          rule,
          parseISO(boundary),
          minimumIndex,
        ),
      ).toBe(expected);
    });
  }
});

describe("today for a series is the date in its own time zone", () => {
  const earlyUtc = new Date("2026-08-12T01:10:00Z");

  test.each([
    ["America/Los_Angeles", "2026-08-11"],
    ["UTC", "2026-08-12"],
    ["Asia/Kolkata", "2026-08-12"],
    ["Pacific/Kiritimati", "2026-08-12"],
  ])("at 01:10 UTC it is %s -> %s", (timeZone, expected) => {
    expect(getProjectCalendarDate(earlyUtc, timeZone)).toBe(expected);
  });

  test("a zone ahead of UTC is already on the next date late in the UTC day", () => {
    expect(
      getProjectCalendarDate(
        new Date("2026-08-11T13:00:00Z"),
        "Pacific/Auckland",
      ),
    ).toBe("2026-08-12");
  });

  test.each([null, undefined, "", "not-a-zone"])(
    "a missing or invalid zone (%p) falls back to UTC",
    (timeZone) => {
      expect(getProjectCalendarDate(earlyUtc, timeZone)).toBe("2026-08-12");
    },
  );
});
