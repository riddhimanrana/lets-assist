import { describe, expect, test } from "bun:test";
import * as React from "react";
import { render } from "react-email";

import ProjectFeedbackRequest from "./project-feedback-request";

describe("project-feedback-request email", () => {
  test("renders with default preview props", async () => {
    const html = await render(React.createElement(ProjectFeedbackRequest));
    expect(html).toContain("Beach Cleanup Drive");
    expect(html).toContain("never shown publicly");
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
