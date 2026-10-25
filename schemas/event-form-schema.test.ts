import { describe, expect, test } from "bun:test";

import {
  getWallClockInTimeZone,
  getWeekdayInTimeZone,
  isDateTimeInPast,
  richTextToPlainText,
} from "./event-form-helpers";
import {
  DUPLICATE_ROLE_NAME_MESSAGE,
  basicInfoSchema,
  createMultiDaySchema,
  createMultiRoleSchema,
  createOneTimeSchema,
} from "./event-form-schema";

const basicInfo = {
  title: "Beach cleanup",
  location: "Local beach",
  description: "<p>Bring gloves.</p>",
  organizationId: null,
};

function firstMessage(result: {
  success: boolean;
  error?: { issues: Array<{ message: string }> };
}) {
  return result.success ? null : (result.error?.issues[0]?.message ?? null);
}

describe("description length counts the text a reader sees", () => {
  test("an empty editor is an empty description", () => {
    for (const description of ["", "<p></p>", "<p>   </p>", "<p><br></p>"]) {
      expect(
        firstMessage(basicInfoSchema.safeParse({ ...basicInfo, description })),
      ).toBe("Description is required");
    }
  });

  test("markup does not count against the 2000 character limit", () => {
    const text = "a".repeat(2000);
    const description = `<p><strong>${text.slice(0, 1000)}</strong></p><ul><li>${text.slice(1000)}</li></ul>`;
    expect(description.length).toBeGreaterThan(2000);
    expect(
      basicInfoSchema.safeParse({ ...basicInfo, description }).success,
    ).toBe(true);
  });

  test("2001 characters of text is too long, with or without markup", () => {
    for (const description of [
      "a".repeat(2001),
      `<p>${"a".repeat(2001)}</p>`,
    ]) {
      expect(
        firstMessage(basicInfoSchema.safeParse({ ...basicInfo, description })),
      ).toBe("Description cannot exceed 2000 characters");
    }
  });

  test("an entity counts as the one character it shows", () => {
    expect(richTextToPlainText("<p>Fish &amp; chips&nbsp;&lt;3</p>")).toBe(
      "Fish & chips <3",
    );
  });
});

describe("volunteer counts", () => {
  const oneTime = {
    date: "2099-06-01",
    startTime: "09:00",
    endTime: "12:00",
    volunteers: 5,
  };

  test("a cleared field asks for a number instead of exposing NaN", () => {
    for (const volunteers of [Number.NaN, null, undefined, "12"]) {
      const result = createOneTimeSchema().safeParse({
        ...oneTime,
        volunteers,
      });
      expect(firstMessage(result)).toBe("Enter a number of volunteers");
      expect(
        result.error?.issues.map((issue) => issue.message).join(" "),
      ).not.toMatch(/nan/iu);
    }
  });

  test("at least one volunteer is required", () => {
    expect(
      firstMessage(
        createOneTimeSchema().safeParse({ ...oneTime, volunteers: 0 }),
      ),
    ).toBe("At least 1 volunteer is required");
    expect(createOneTimeSchema().safeParse(oneTime).success).toBe(true);
  });
});

describe("role names", () => {
  const role = { startTime: "09:00", endTime: "12:00", volunteers: 2 };
  const schedule = (names: string[]) => ({
    date: "2099-06-01",
    overallStart: "09:00",
    overallEnd: "12:00",
    roles: names.map((name) => ({ ...role, name })),
  });

  test("a repeated name is reported on that role's name field", () => {
    const result = createMultiRoleSchema().safeParse(
      schedule(["Setup", "Greeter", " setup ", "SETUP"]),
    );

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    ).toEqual([
      { path: "roles.2.name", message: DUPLICATE_ROLE_NAME_MESSAGE },
      { path: "roles.3.name", message: DUPLICATE_ROLE_NAME_MESSAGE },
    ]);
  });

  test("different names pass", () => {
    expect(
      createMultiRoleSchema().safeParse(schedule(["Setup", "Greeter"])).success,
    ).toBe(true);
  });
});

describe("times are judged in the project's timezone", () => {
  // 05:30 UTC on March 1 is still 21:30 on February 28 in Los Angeles and
  // already 18:30 on March 1 in Auckland.
  const now = new Date("2027-03-01T05:30:00Z");

  test("the wall clock follows the timezone", () => {
    expect(getWallClockInTimeZone(now, "America/Los_Angeles")).toEqual({
      date: "2027-02-28",
      time: "21:30",
    });
    expect(getWallClockInTimeZone(now, "Pacific/Auckland")).toEqual({
      date: "2027-03-01",
      time: "18:30",
    });
    expect(getWallClockInTimeZone(now, "UTC")).toEqual({
      date: "2027-03-01",
      time: "05:30",
    });
    expect(getWeekdayInTimeZone(now, "America/Los_Angeles")).toBe("Sunday");
    expect(getWeekdayInTimeZone(now, "Pacific/Auckland")).toBe("Monday");
  });

  test("the same date and time is past in one zone and future in another", () => {
    expect(
      isDateTimeInPast("2027-02-28", "22:00", "America/Los_Angeles", now),
    ).toBe(false);
    expect(isDateTimeInPast("2027-02-28", "22:00", "UTC", now)).toBe(true);
    expect(
      isDateTimeInPast("2027-03-01", "12:00", "Pacific/Auckland", now),
    ).toBe(true);
    expect(
      isDateTimeInPast("2027-03-01", "12:00", "America/Los_Angeles", now),
    ).toBe(false);
  });

  test("a missing date or time is not judged, and an unknown zone does not throw", () => {
    expect(isDateTimeInPast("", "09:00", "UTC", now)).toBe(false);
    expect(isDateTimeInPast("2027-03-01", "", "UTC", now)).toBe(false);
    expect(() =>
      isDateTimeInPast("2027-03-01", "09:00", "Not/A/Zone", now),
    ).not.toThrow();
  });

  test("the schedule schemas use the project's timezone", () => {
    const evening = {
      date: "2027-02-28",
      startTime: "22:00",
      endTime: "23:00",
      volunteers: 5,
    };
    const inLosAngeles = { timeZone: "America/Los_Angeles", now: () => now };
    const inUtc = { timeZone: "UTC", now: () => now };

    expect(createOneTimeSchema(inLosAngeles).safeParse(evening).success).toBe(
      true,
    );
    expect(firstMessage(createOneTimeSchema(inUtc).safeParse(evening))).toBe(
      "Start time must be in the future",
    );

    const days = [
      {
        date: evening.date,
        slots: [
          {
            name: "",
            startTime: evening.startTime,
            endTime: evening.endTime,
            volunteers: 5,
          },
        ],
      },
    ];
    expect(createMultiDaySchema(inLosAngeles).safeParse(days).success).toBe(
      true,
    );
    expect(firstMessage(createMultiDaySchema(inUtc).safeParse(days))).toBe(
      "All dates and times must be in the future",
    );
  });
});
