import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TimezoneDateDisplay,
  TimezoneEventDateRange,
  TimezonePrintEventDate,
} from "./TimezoneDateDisplay";

test("certificate endpoints label each side of a DST transition in the recorded zone", () => {
  const html = renderToStaticMarkup(
    createElement(TimezoneEventDateRange, {
      startDate: "2026-03-08T06:30:00Z",
      endDate: "2026-03-08T07:30:00Z",
      timeZone: "America/New_York",
    }),
  );
  expect(html).toContain("1:30 AM EST");
  expect(html).toContain("3:30 AM EDT");
  expect(html).not.toContain("Loading");
});

test("certificate and print date render the stored day immediately", () => {
  expect(
    renderToStaticMarkup(
      createElement(TimezoneDateDisplay, {
        dateString: "2026-03-08T07:30:00Z",
        format: "h:mm a",
        timeZone: "America/New_York",
      }),
    ),
  ).toContain("3:30 AM EDT");
  expect(
    renderToStaticMarkup(
      createElement(TimezonePrintEventDate, {
        startDate: "2026-10-12T15:30:00Z",
        timeZone: "Asia/Tokyo",
      }),
    ),
  ).toContain("October 13, 2026");
  expect(
    renderToStaticMarkup(
      createElement(TimezoneDateDisplay, {
        dateString: "2026-10-12T17:00:00Z",
        format: "MMM d, yyyy",
        timeZone: "Asia/Tokyo",
      }),
    ),
  ).toContain("Oct 13, 2026");
});

test("legacy missing zones keep the shared fallback and invalid dates stay readable", () => {
  expect(
    renderToStaticMarkup(
      createElement(TimezonePrintEventDate, {
        startDate: "2026-10-13T01:00:00Z",
      }),
    ),
  ).toContain("October 12, 2026");
  expect(
    renderToStaticMarkup(
      createElement(TimezoneDateDisplay, {
        dateString: "invalid",
        format: "MMM d, yyyy",
      }),
    ),
  ).toContain("Unknown date");
});
