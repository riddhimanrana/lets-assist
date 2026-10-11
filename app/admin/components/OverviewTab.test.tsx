import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OverviewTab } from "./OverviewTab";

type Props = ComponentProps<typeof OverviewTab>;

function overview(overrides: Partial<Props> = {}) {
  return renderToStaticMarkup(
    <OverviewTab
      stats={{
        feedbackCount: 0,
        trustedPendingCount: 0,
        flaggedPendingCount: 0,
        reportsPendingCount: 0,
      }}
      flaggedContent={[]}
      reportPreview={[]}
      reportsStats={{
        total: 0,
        pending: 0,
        resolved: 0,
        highPriority: 0,
        recentWeek: 0,
      }}
      {...overrides}
    />,
  );
}

describe("admin overview queue signals", () => {
  test("zero counts cannot promise a successful empty read", () => {
    const html = overview();
    expect(html).not.toContain("All clear");
    expect(html).toContain("Pending review");
    expect(html).toContain("AI &amp; system flags");
    expect(html).toContain("User submitted reports");
  });

  test("a report still under review is visible even when pending is zero", () => {
    const html = overview({
      reportPreview: [
        {
          id: "fictional-review-report",
          reason: "Fictional report awaiting review",
          status: "under_review",
        },
      ],
    });
    expect(html).toContain("Fictional report awaiting review");
    expect(html).not.toContain("No user reports");
    expect(html).not.toContain("All clear");
  });

  test("historical high-priority totals alone do not create a new destructive alert", () => {
    const html = overview({
      reportsStats: {
        total: 2,
        pending: 0,
        resolved: 2,
        highPriority: 2,
        recentWeek: 0,
      },
    });
    expect(html).toContain("High priority");
    expect(html).not.toContain('data-variant="destructive"');
  });

  test("positive queues use specific pending guidance rather than an all-clear claim", () => {
    const html = overview({
      stats: {
        feedbackCount: 0,
        trustedPendingCount: 1,
        flaggedPendingCount: 3,
        reportsPendingCount: 2,
      },
    });
    expect(html).toContain("Pending moderation items");
    expect(html).toContain("Pending review");
    expect((html.match(/data-variant="warning"/gu) ?? []).length).toBe(3);
    expect(html).not.toContain("All clear");
  });
});
