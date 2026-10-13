import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgressCircle } from "./ProgressCircle";
import { ExportSection } from "./ExportSection";
import { AllHoursSection } from "./AllHoursSection";

describe("dashboard progress semantics", () => {
  test("each goal identifies its own progress and retains the empty state", () => {
    for (const label of ["Hours goal progress", "Events goal progress"]) {
      const markup = renderToStaticMarkup(
        createElement(ProgressCircle, {
          label,
          value: 0,
          emptyLabel: "Not set",
          showLabel: false,
        }),
      );
      expect(markup).toContain(`aria-label="${label}"`);
      expect(markup).toContain('role="progressbar"');
      expect(markup).toContain('aria-valuetext="Not set"');
      expect(markup).toContain('aria-valuenow="0"');
    }
  });
  test("a measured progressbar keeps its accessible percentage bounds", () => {
    const markup = renderToStaticMarkup(
      createElement(ProgressCircle, {
        label: "Sample organization share of volunteer hours",
        value: 125,
        showLabel: false,
      }),
    );
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
  });
  test("an unavailable proportion never exposes NaN or infinite progress", () => {
    for (const value of [NaN, Infinity]) {
      const markup = renderToStaticMarkup(
        createElement(ProgressCircle, {
          label: "Volunteer hours share",
          value,
        }),
      );
      expect(markup).toContain('aria-valuenow="0"');
      expect(markup).not.toContain("NaN");
      expect(markup).not.toContain("Infinity");
    }
  });
});

test("the actual empty export surface names both date controls", () => {
  const markup = renderToStaticMarkup(
    createElement(ExportSection, {
      userEmail: "volunteer@local.test",
      certificatesData: [],
    }),
  );
  expect(markup).toContain('aria-label="Quick date range"');
  expect(markup).toContain('aria-label="Select date range"');
  expect(markup).toContain("Export CSV");
  expect(markup).toContain(
    "No data found for the selected date range and filters",
  );
});

test("dashboard hours and export rows show the project day beside its timezone", () => {
  const certificate = {
    id: "fictional-new-york-certificate",
    project_title: "Fictional project",
    creator_name: null,
    is_certified: true,
    event_start: "2026-10-13T05:00:00Z",
    event_end: "2026-10-13T06:00:00Z",
    credited_minutes: 60,
    volunteer_email: null,
    organization_name: null,
    project_id: null,
    schedule_id: null,
    issued_at: "2026-10-13T07:00:00Z",
    signup_id: null,
    volunteer_name: null,
    project_location: null,
    projects: { project_timezone: "America/New_York" },
  };
  const hours = renderToStaticMarkup(
    createElement(AllHoursSection, { certificates: [certificate] }),
  );
  expect(hours).toContain("Oct 13, 2026");
  expect(hours).toContain("EDT");
  expect(hours).not.toContain("Oct 12, 2026");
  const exportRows = renderToStaticMarkup(
    createElement(ExportSection, {
      userEmail: "fictional@local.test",
      certificatesData: [certificate],
    }),
  );
  expect(exportRows).toContain("2026-10-13");
  expect(exportRows).not.toContain("2026-10-12");
});
