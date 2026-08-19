import { describe, expect, test } from "bun:test";
import * as React from "react";
import { render } from "react-email";

import ProjectFeedbackRequest from "./project-feedback-request";

describe("project-feedback-request email", () => {
  test("renders with default preview props — no fabricated date", async () => {
    const html = await render(React.createElement(ProjectFeedbackRequest));
    expect(html).toContain("Beach Cleanup Drive");
    expect(html).toContain("never shown publicly");
    // Fabricated default date must never appear in the rendered output.
    expect(html).not.toContain("January 15, 2026");
  });

  test("omitting eventDate renders without a date phrase", async () => {
    const html = await render(
      React.createElement(ProjectFeedbackRequest, {
        volunteerName: "Alex",
        projectTitle: "Park Day",
        feedbackUrl: "https://lets-assist.com/feedback/req-2?token=t",
        unsubscribeUrl:
          "https://lets-assist.com/feedback/req-2/unsubscribe?token=t",
      }),
    );
    // When eventDate is omitted (defaults to null), the " on <date>" phrase
    // must not appear for any fabricated value.
    expect(html).not.toMatch(/ on January/);
    expect(html).not.toMatch(/ on \w+ \d+, \d{4}/);
  });

  test("explicit eventDate null renders without a date phrase", async () => {
    const html = await render(
      React.createElement(ProjectFeedbackRequest, {
        volunteerName: "Sam",
        projectTitle: "Food Drive",
        feedbackUrl: "https://lets-assist.com/feedback/req-3?token=t",
        unsubscribeUrl:
          "https://lets-assist.com/feedback/req-3/unsubscribe?token=t",
        eventDate: null,
      }),
    );
    expect(html).not.toMatch(/ on \w+ \d+, \d{4}/);
  });

  test("star links pre-select a rating without writing anything", async () => {
    const html = await render(
      React.createElement(ProjectFeedbackRequest, {
        volunteerName: "Jane",
        projectTitle: "Park Day",
        organizationName: "Green Org",
        feedbackUrl: "https://lets-assist.com/feedback/req-1?token=tok",
        unsubscribeUrl:
          "https://lets-assist.com/feedback/req-1/unsubscribe?token=tok",
        eventDate: "August 9, 2026",
      }),
    );
    expect(html).toContain(
      "https://lets-assist.com/feedback/req-1?token=tok&amp;rating=5",
    );
    expect(html).toContain(
      "https://lets-assist.com/feedback/req-1/unsubscribe?token=tok",
    );
    expect(html).toContain("Green Org");
  });
});
