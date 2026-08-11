import { describe, expect, test } from "bun:test";
import { TZDate } from "@date-fns/tz";

import {
  composeSlotInstant,
  normalizeTimeString,
  resolveRowWindow,
} from "./normalize";

const TZ = "America/Los_Angeles";

function windowFor(
  date: string,
  start: string,
  end: string,
  timezone = TZ,
): { startsAt: number; endsAt: number } {
  const [y, m, d] = date.split("-").map(Number);
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startsAt = new TZDate(y, m - 1, d, sh, sm, 0, timezone).getTime();
  let endsAt = new TZDate(y, m - 1, d, eh, em, 0, timezone).getTime();
  if (endsAt <= startsAt) endsAt += 24 * 60 * 60 * 1000;
  return { startsAt, endsAt };
}

describe("normalizeTimeString", () => {
  test.each([
    ["9", "09:00"],
    ["9am", "09:00"],
    ["9 AM", "09:00"],
    ["9:00 AM", "09:00"],
    ["9:30", "09:30"],
    ["9.30pm", "21:30"],
    ["12pm", "12:00"],
    ["12am", "00:00"],
    ["12:15 a.m.", "00:15"],
    ["14:00", "14:00"],
    ["0930", "09:30"],
    ["1730", "17:30"],
    ["23:59", "23:59"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeTimeString(input)).toBe(expected);
  });

  test.each([
    ["noon"],
    ["25:00"],
    ["9:75"],
    ["13pm"],
    ["0am"],
    [""],
    ["  "],
    ["abc"],
    ["9::30"],
  ])("garbage %s -> null", (input) => {
    expect(normalizeTimeString(input)).toBeNull();
  });

  test("null and undefined -> null", () => {
    expect(normalizeTimeString(null)).toBeNull();
    expect(normalizeTimeString(undefined)).toBeNull();
  });
});

describe("composeSlotInstant", () => {
  test("composes on the slot's local date in the project timezone", () => {
    const window = windowFor("2026-06-15", "10:00", "12:00");
    const instant = composeSlotInstant(window, TZ, "11:00");
    expect(instant).toBe(
      new TZDate(2026, 5, 15, 11, 0, 0, TZ).getTime(),
    );
  });

  test("stays correct across the fall-back DST boundary", () => {
    // 2026-11-01 is the US fall-back date; the local day is 25 hours long.
    const window = windowFor("2026-11-01", "08:00", "17:00");
    const instant = composeSlotInstant(window, TZ, "15:00");
    expect(instant).toBe(new TZDate(2026, 10, 1, 15, 0, 0, TZ).getTime());
  });

  test("unreadable time -> null", () => {
    const window = windowFor("2026-06-15", "10:00", "12:00");
    expect(composeSlotInstant(window, TZ, "later")).toBeNull();
  });
});

describe("resolveRowWindow", () => {
  const window = windowFor("2026-06-15", "10:00", "14:00");

  test("null times fall back to the slot boundaries", () => {
    const resolved = resolveRowWindow({
      window,
      timezone: TZ,
      timeIn: null,
      timeOut: null,
    });
    expect(resolved).toEqual({
      checkInMs: window.startsAt,
      checkOutMs: window.endsAt,
    });
  });

  test("times outside the window are clamped, not rejected", () => {
    const resolved = resolveRowWindow({
      window,
      timezone: TZ,
      timeIn: "8:00",
      timeOut: "8pm",
    });
    expect(resolved).toEqual({
      checkInMs: window.startsAt,
      checkOutMs: window.endsAt,
    });
  });

  test("in-window times are preserved", () => {
    const resolved = resolveRowWindow({
      window,
      timezone: TZ,
      timeIn: "10:30",
      timeOut: "1:30pm",
    });
    expect(resolved).toEqual({
      checkInMs: new TZDate(2026, 5, 15, 10, 30, 0, TZ).getTime(),
      checkOutMs: new TZDate(2026, 5, 15, 13, 30, 0, TZ).getTime(),
    });
  });

  test("an overnight slot maps an earlier out-time to the next day", () => {
    const overnight = windowFor("2026-06-15", "22:00", "02:00");
    const resolved = resolveRowWindow({
      window: overnight,
      timezone: TZ,
      timeIn: "22:30",
      timeOut: "1:00am",
    });
    expect(resolved).toEqual({
      checkInMs: new TZDate(2026, 5, 15, 22, 30, 0, TZ).getTime(),
      checkOutMs: new TZDate(2026, 5, 16, 1, 0, 0, TZ).getTime(),
    });
  });

  test("a window that collapses after clamping is unusable", () => {
    const resolved = resolveRowWindow({
      window,
      timezone: TZ,
      timeIn: "3pm",
      timeOut: "4pm",
    });
    expect(resolved).toBeNull();
  });

  test("unreadable time -> null", () => {
    const resolved = resolveRowWindow({
      window,
      timezone: TZ,
      timeIn: "??",
      timeOut: null,
    });
    expect(resolved).toBeNull();
  });
});
