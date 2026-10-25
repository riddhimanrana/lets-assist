import { expect, test } from "bun:test";

import { readableNotificationText } from "./notification-text";

test("stored codes read as plain words", () => {
  expect(
    readableNotificationText(
      "inappropriate_content (project) report submitted. Please review in the admin dashboard.",
    ),
  ).toBe(
    "inappropriate content (project) report submitted. Please review in the admin dashboard.",
  );
});

test("ordinary text, links and empty values are left alone", () => {
  expect(readableNotificationText("Your hours were published.")).toBe(
    "Your hours were published.",
  );
  expect(readableNotificationText("See /projects/abc_DEF for details")).toBe(
    "See /projects/abc_DEF for details",
  );
  expect(readableNotificationText(null)).toBe("");
});
