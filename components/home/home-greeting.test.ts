import { describe, expect, test } from "bun:test";

import {
  HOME_GREETING_FALLBACK,
  greetingFirstName,
  homeGreeting,
  homeGreetingText,
  msUntilWeekdayRefresh,
  resolveTimeZone,
  weekdayInTimeZone,
} from "./home-greeting";

// Sunday 2026-10-11 02:30 UTC. Still Saturday evening across the Americas.
const saturdayNightPacific = new Date("2026-10-11T02:30:00Z");

describe("weekdayInTimeZone", () => {
  test("uses the named zone, not UTC, when the local day differs", () => {
    expect(weekdayInTimeZone(saturdayNightPacific, "UTC")).toBe("Sunday");
    expect(weekdayInTimeZone(saturdayNightPacific, "America/Los_Angeles")).toBe(
      "Saturday",
    );
    expect(weekdayInTimeZone(saturdayNightPacific, "America/Chicago")).toBe(
      "Saturday",
    );
    expect(weekdayInTimeZone(saturdayNightPacific, "Asia/Tokyo")).toBe(
      "Sunday",
    );
  });

  test("a zone ahead of UTC reaches the next day first", () => {
    const fridayAfternoonUtc = new Date("2026-10-09T13:30:00Z");
    expect(weekdayInTimeZone(fridayAfternoonUtc, "UTC")).toBe("Friday");
    expect(weekdayInTimeZone(fridayAfternoonUtc, "Pacific/Kiritimati")).toBe(
      "Saturday",
    );
  });

  test("accepts an epoch number", () => {
    expect(
      weekdayInTimeZone(saturdayNightPacific.getTime(), "America/Denver"),
    ).toBe("Saturday");
  });

  test("an invalid, empty, or missing zone returns null without throwing", () => {
    for (const zone of ["Mars/Olympus_Mons", "not a zone", "", "  ", null])
      expect(weekdayInTimeZone(saturdayNightPacific, zone)).toBeNull();
    expect(weekdayInTimeZone(saturdayNightPacific, undefined)).toBeNull();
  });

  test("an invalid date returns null", () => {
    expect(weekdayInTimeZone(new Date("nope"), "UTC")).toBeNull();
    expect(weekdayInTimeZone(Number.NaN, "UTC")).toBeNull();
  });
});

describe("resolveTimeZone", () => {
  test("keeps a valid zone and trims it", () => {
    expect(resolveTimeZone(" America/New_York ")).toBe("America/New_York");
  });

  test("rejects an unknown zone", () => {
    expect(resolveTimeZone("Nowhere/Special")).toBeNull();
  });
});

describe("greetingFirstName", () => {
  test("takes the first word of a display name", () => {
    expect(greetingFirstName("Avery Example")).toBe("Avery");
    expect(greetingFirstName("  Mary  Jane  Lee ")).toBe("Mary");
    expect(greetingFirstName("Zoë")).toBe("Zoë");
  });

  test("never returns part of an email address", () => {
    expect(greetingFirstName("someone@example.com")).toBeNull();
    expect(greetingFirstName("Sam someone@example.com")).toBeNull();
  });

  test("blank, missing, and oversized names are anonymous", () => {
    for (const name of ["", "   ", null, undefined, "x".repeat(41)])
      expect(greetingFirstName(name)).toBeNull();
  });
});

describe("homeGreeting", () => {
  test("greets by local weekday and first name", () => {
    expect(
      homeGreeting({
        now: saturdayNightPacific,
        timeZone: "America/Los_Angeles",
        name: "Avery Example",
      }),
    ).toBe("Happy Saturday, Avery");
  });

  test("falls back before the time zone is known", () => {
    expect(
      homeGreeting({
        now: saturdayNightPacific,
        timeZone: null,
        name: "Avery Example",
      }),
    ).toBe(HOME_GREETING_FALLBACK);
  });

  test("falls back for an anonymous visitor even when the day is known", () => {
    expect(
      homeGreeting({
        now: saturdayNightPacific,
        timeZone: "America/Los_Angeles",
        name: null,
      }),
    ).toBe("Hi there");
  });

  test("falls back for an invalid time zone", () => {
    expect(
      homeGreeting({
        now: saturdayNightPacific,
        timeZone: "Invalid/Zone",
        name: "Avery",
      }),
    ).toBe("Hi there");
  });

  test("homeGreetingText needs both parts", () => {
    expect(homeGreetingText({ weekday: "Monday", name: "Avery" })).toBe(
      "Happy Monday, Avery",
    );
    expect(homeGreetingText({ weekday: null, name: "Avery" })).toBe("Hi there");
    expect(homeGreetingText({ weekday: "Monday", name: "a@b.co" })).toBe(
      "Hi there",
    );
  });
});

describe("msUntilWeekdayRefresh", () => {
  test("returns the time left before local midnight when it is close", () => {
    // 23:59:30.000 in Los Angeles (UTC-7 in October).
    const now = new Date("2026-10-11T06:59:30.000Z");
    expect(msUntilWeekdayRefresh(now, "America/Los_Angeles")).toBe(30_000);
    expect(
      weekdayInTimeZone(now.getTime() + 30_000, "America/Los_Angeles"),
    ).toBe("Sunday");
    expect(weekdayInTimeZone(now, "America/Los_Angeles")).toBe("Saturday");
  });

  test("caps the wait at one hour", () => {
    const noonUtc = new Date("2026-10-10T12:00:00Z");
    expect(msUntilWeekdayRefresh(noonUtc, "UTC")).toBe(3_600_000);
  });

  test("never returns less than one second", () => {
    const now = new Date("2026-10-10T23:59:59.900Z");
    expect(msUntilWeekdayRefresh(now, "UTC")).toBe(1000);
  });

  test("unusable input returns the cap", () => {
    expect(msUntilWeekdayRefresh(new Date("nope"), "UTC")).toBe(3_600_000);
    expect(msUntilWeekdayRefresh(Date.now(), "Invalid/Zone")).toBe(3_600_000);
  });
});
