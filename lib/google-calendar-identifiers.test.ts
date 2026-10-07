import { describe, expect, test } from "bun:test";
import { googleCalendarEventUrl } from "./google-calendar-identifiers";

describe("calendar provider path boundaries", () => {
  test("encodes a calendar identifier once and preserves recurring event IDs", () => {
    const url = new URL(
      googleCalendarEventUrl(
        "en.usa#holiday@group.v.calendar.google.com",
        "abc123_20261007T160000Z",
      ),
    );
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.pathname).toBe(
      "/calendar/v3/calendars/en.usa%23holiday%40group.v.calendar.google.com/events/abc123_20261007T160000Z",
    );
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });
  test.each([
    "..",
    ".",
    "../calendar",
    "a/b",
    "a\\b",
    "a?token=x",
    "a%2fb",
    "a\nheader",
  ])("rejects invalid calendar %s", (value) => {
    expect(() => googleCalendarEventUrl(value, "event12345")).toThrow();
  });
  test.each([
    "",
    "..",
    "../another",
    "%2e%2e",
    "event/name",
    "event?token=value",
    "event#fragment",
    "x".repeat(1025),
  ])("rejects invalid event %s", (value) => {
    expect(() => googleCalendarEventUrl("primary", value)).toThrow();
  });
});
