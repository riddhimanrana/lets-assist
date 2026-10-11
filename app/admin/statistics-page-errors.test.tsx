import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let isAdmin = true;
let reads = 0;
let reportResult: { data?: Record<string, number>; error?: string };
let moderationResult: { data?: Record<string, number>; error?: string };

const emptyRead = async () => {
  reads += 1;
  return { data: [] };
};
mock.module("next/navigation", () => ({
  redirect(path: string) {
    throw new Error(`REDIRECT:${path}`);
  },
}));
mock.module("./actions", () => ({
  checkSuperAdmin: async () => ({ isAdmin }),
  getAllFeedback: emptyRead,
  getTrustedMemberApplications: emptyRead,
}));
mock.module("./server/landing-demo-mode", () => ({
  getLandingDemoModeForAdmin: async () => ({ enabled: false }),
}));
mock.module("./components/LandingDemoControl", () => ({
  LandingDemoControl: () => <div>LANDING_DEMO_CONTROL</div>,
}));
mock.module("./moderation/actions", () => ({
  getModerationStats: async () => {
    reads += 1;
    return moderationResult;
  },
  getContentReportsStats: async () => {
    reads += 1;
    return reportResult;
  },
  getFlaggedContent: emptyRead,
  getContentReports: emptyRead,
}));
mock.module("./server/project-schedule-health", () => ({
  getProjectScheduleHealth: async () => ({ data: [] }),
}));
mock.module("./components/ProjectScheduleHealth", () => ({
  ProjectScheduleHealth: () => null,
}));
mock.module("./components/OverviewTab", () => ({
  OverviewTab: () => <div>SUCCESSFUL_OVERVIEW</div>,
}));
mock.module("./moderation/ModerationDashboardWrapper", () => ({
  default: () => <div>SUCCESSFUL_MODERATION</div>,
}));

const { default: overview } = await import("./page");
const { default: moderation } = await import("./moderation/page");

beforeEach(() => {
  isAdmin = true;
  reads = 0;
  reportResult = {
    data: { total: 0, pending: 0, resolved: 0, highPriority: 0, recentWeek: 0 },
  };
  moderationResult = {
    data: { total: 0, pending: 0, pendingFlags: 0, pendingReports: 0 },
  };
});

describe("admin statistics page error boundaries", () => {
  for (const [name, page, success] of [
    ["overview", overview, "SUCCESSFUL_OVERVIEW"],
    ["moderation", moderation, "SUCCESSFUL_MODERATION"],
  ] as const) {
    for (const source of ["reports", "moderation"] as const) {
      test(`${name} shows the existing load error when ${source} statistics fail`, async () => {
        const error = `Unable to load ${source === "reports" ? "report" : "moderation"} statistics. Please try again.`;
        if (source === "reports") reportResult = { error };
        else moderationResult = { error };

        const html = renderToStaticMarkup(await page());
        expect(html).toContain(error);
        expect(html).toContain("Error loading");
        expect(html).not.toContain(success);
        expect(html).not.toContain("All clear");
        if (name === "overview") expect(html).toContain("LANDING_DEMO_CONTROL");
      });
    }

    test(`${name} still renders a successfully empty snapshot`, async () => {
      const html = renderToStaticMarkup(await page());
      expect(html).toContain(success);
      expect(html).not.toContain("Error loading");
    });

    test(`${name} redirects an unauthorized actor before any queue read`, async () => {
      isAdmin = false;
      await expect(page()).rejects.toThrow("REDIRECT:/not-found");
      expect(reads).toBe(0);
    });
  }
});

function landingControlKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(landingControlKeys);
  if (!React.isValidElement<{ children?: unknown }>(value)) return [];
  const keys =
    typeof value.type === "function" && value.type.name === "LandingDemoControl"
      ? [String(value.key)]
      : [];
  return [...keys, ...landingControlKeys(value.props.children)];
}

test("every authoritative overview read remounts the control even when the mode repeats", async () => {
  for (const failed of [false, true]) {
    reportResult = failed ? { error: "Unavailable" } : { data: {} };
    const first = landingControlKeys(await overview());
    const refreshed = landingControlKeys(await overview());
    expect(first).toHaveLength(1);
    expect(refreshed).toHaveLength(1);
    expect(first[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(refreshed[0]).not.toBe(first[0]);
  }
});
