import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProjectStatus } from "@/types";

import {
  getProjectStatusPresentation,
  ProjectStatusBadge,
  StatusBadge,
} from "./status-badge";

const classNames = (html: string) =>
  /class="([^"]*)"/u.exec(html)?.[1].split(/\s+/u) ?? [];

describe("project status badge", () => {
  const cases: Array<[ProjectStatus, string, string, string]> = [
    ["completed", "success", "Completed", "lucide-circle-check"],
    ["in-progress", "warning", "In progress", "lucide-clock"],
    ["upcoming", "info", "Upcoming", "lucide-calendar-clock"],
    ["cancelled", "destructive", "Cancelled", "lucide-circle-x"],
  ];

  for (const [status, variant, label, icon] of cases) {
    test(`${status} uses the flat ${variant} tint with its own icon and label`, () => {
      const html = renderToStaticMarkup(<ProjectStatusBadge status={status} />);
      expect(html).toContain(`data-variant="${variant}"`);
      expect(html).toContain(`>${label}</span>`);
      expect(html).toContain(icon);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('data-icon="inline-start"');
      // No gloss, no shadow and no hand-tinted palette classes.
      expect(html).not.toContain("--button-primary-gloss");
      expect(html).not.toContain("--control-gloss");
      expect(html).not.toContain("shadow-(");
      expect(html).not.toMatch(/bg-(gray|emerald|green|amber|blue)-/u);
      // Hover tints only apply when the badge is a link.
      expect(html).not.toMatch(/(^|\s)hover:bg-/u);
      // Sentence case, never title case.
      expect(classNames(html)).not.toContain("capitalize");
    });
  }

  test("an unknown status falls back to the neutral tint", () => {
    const html = renderToStaticMarkup(
      <StatusBadge status={"archived" as ProjectStatus} />,
    );
    expect(html).toContain('data-variant="neutral"');
    expect(html).toContain("Archived");
    expect(html).toContain("lucide-circle-alert");
    expect(html).not.toContain("bg-gray-200");
  });

  for (const key of [
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
    "valueOf",
  ]) {
    test(`the inherited object key "${key}" is an unknown status`, () => {
      expect(getProjectStatusPresentation(key)).toEqual({
        variant: "neutral",
        icon: expect.anything(),
      });
      const html = renderToStaticMarkup(
        <StatusBadge status={key as ProjectStatus} />,
      );
      expect(html).toContain('data-variant="neutral"');
      expect(html).toContain("lucide-circle-alert");
    });
  }

  test("the badge stays on one line and never shrinks in a dense row", () => {
    const names = classNames(
      renderToStaticMarkup(<ProjectStatusBadge status="completed" size="sm" />),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "whitespace-nowrap",
        "shrink-0",
        "inline-flex",
        "items-center",
        "py-0",
      ]),
    );
    expect(names).not.toContain("py-0.5");
  });

  test("the icon can be hidden without losing the label", () => {
    const html = renderToStaticMarkup(
      <StatusBadge status="completed" showIcon={false} />,
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain("Completed");
  });
});
