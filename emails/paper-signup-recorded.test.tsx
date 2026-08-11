import { describe, expect, test } from "bun:test";
import * as React from "react";
import { render } from "react-email";

import PaperSignupRecorded from "./paper-signup-recorded";

/**
 * A template bug otherwise surfaces only as definitive_failure/render_failed
 * at send time; a cheap render with real props catches it in CI.
 */
describe("paper-signup-recorded email", () => {
  test("renders with default preview props", async () => {
    const html = await render(React.createElement(PaperSignupRecorded));
    expect(html).toContain("Beach Cleanup Drive");
    expect(html).toContain("paper signup sheet");
  });

  test("renders the recipient's record link", async () => {
    const html = await render(
      React.createElement(PaperSignupRecorded, {
        volunteerName: "Jane Doe",
        projectName: "Park Restoration",
        organizerName: "Sam Organizer",
        projectDate: "August 9, 2026",
        projectTime: "9:00 AM - 12:00 PM",
        anonymousProfileUrl:
          "https://lets-assist.com/anonymous/anon-1?token=tok",
      }),
    );
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Park Restoration");
    expect(html).toContain(
      "https://lets-assist.com/anonymous/anon-1?token=tok",
    );
  });
});
