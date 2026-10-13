import { expect, test } from "bun:test";
import { getProjectCalendarDate } from "@/lib/projects/recurrence-occurrence-dates";
import { landingDemoDate, landingDemoSaturday } from "./landing-demo-dates";

test("the failed CI instant has one project-calendar anchor across the DST change", () => {
  const anchor = getProjectCalendarDate(
    new Date("2026-10-12T23:41:01.616Z"),
    "America/Los_Angeles",
  );
  expect(anchor).toBe("2026-10-12");
  expect(landingDemoDate(anchor, 31)).toBe("2026-11-12");
  expect(landingDemoDate(anchor, 32)).toBe("2026-11-13");
});

test("UTC midnight does not advance the Pacific project calendar", () => {
  const anchor = getProjectCalendarDate(
    new Date("2026-10-13T00:01:00.000Z"),
    "America/Los_Angeles",
  );
  expect(anchor).toBe("2026-10-12");
  expect(landingDemoDate(anchor, 31)).toBe("2026-11-12");
});

test("calendar shifts preserve leap days and month/year boundaries", () => {
  expect(landingDemoDate("2028-02-28", 1)).toBe("2028-02-29");
  expect(landingDemoDate("2028-02-28", 2)).toBe("2028-03-01");
  expect(landingDemoDate("2026-12-31", 1)).toBe("2027-01-01");
  expect(landingDemoDate("2026-03-01", 31)).toBe("2026-04-01");
});

test("the legacy Saturday preview formats a stable calendar date", () => {
  const date = landingDemoSaturday("2026-10-12");
  expect(date.toISOString()).toBe("2026-11-14T12:00:00.000Z");
  expect(date.getUTCDay()).toBe(6);
});

test("invalid anchors and offsets cannot become silent normalized dates", () => {
  for (const anchor of ["", "2026-02-30", "2026-1-02", "private"])
    expect(() => landingDemoDate(anchor, 31)).toThrow();
  for (const offset of [-1, 1.5, 367, Number.NaN])
    expect(() => landingDemoDate("2026-10-12", offset)).toThrow();
});
