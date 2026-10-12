import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgressCircle } from "./ProgressCircle";
import { ExportSection } from "./ExportSection";

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
