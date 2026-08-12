import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import EventType from "./EventType";

const eventTypes = [
  ["oneTime", "Single Event"],
  ["multiDay", "Multiple Day Event"],
  ["sameDayMultiArea", "Multi-Role Event"],
] as const;

describe("create-project event type accessibility", () => {
  test("renders every schedule choice as a named native radio with checked state", () => {
    const markup = renderToStaticMarkup(
      <EventType eventType="multiDay" setEventTypeAction={() => {}} />,
    );
    const inputs = markup.match(/<input\b[^>]*>/gu) ?? [];
    const headings = markup.match(/<h3\b[^>]*>[^<]+<\/h3>/gu) ?? [];

    expect(markup).toContain('<fieldset aria-labelledby="event-type-heading"');
    expect(inputs).toHaveLength(eventTypes.length);

    for (const [value, label] of eventTypes) {
      const input = inputs.find((candidate) =>
        candidate.includes(`value="${value}"`),
      );
      const heading = headings.find((candidate) =>
        candidate.includes(`id="event-type-${value}-title"`),
      );

      expect(input, `${label} radio is missing`).toBeDefined();
      expect(input).toContain('type="radio"');
      expect(input).toContain('name="event-type"');
      expect(input).toContain(`aria-labelledby="event-type-${value}-title"`);
      expect(heading).toEndWith(`>${label}</h3>`);
      expect(input?.includes('checked=""')).toBe(value === "multiDay");
    }
  });
});
