import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarCleanupEvent } from "@/services/personal-calendar/cleanup";

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
const { default: CalendarClient } = await import("./CalendarClient");

const cleanupEvents: CalendarCleanupEvent[] = ["project", "signup"].map(
  (kind, index) => ({
    source_kind: kind as CalendarCleanupEvent["source_kind"],
    source_id: `ec300000-0000-4000-8000-00000000000${index + 1}`,
    event_id: `fictional-event-${index}`,
  }),
);

for (const connected of [false, true]) {
  test(`calendar cleanup ${connected ? "enables removal after reconnecting" : "requires reconnecting before removal"}`, () => {
    const html = renderToStaticMarkup(
      <CalendarClient
        cleanupEvents={cleanupEvents}
        connection={
          connected
            ? {
                calendar_email: "calendar@local.test",
                created_at: "2040-01-01T00:00:00Z",
              }
            : null
        }
        legacyReconnectRequired={false}
        creatorProjects={[]}
        volunteerSignups={[]}
      />,
    );
    const buttons = [
      ...html.matchAll(/<button\b([^>]*)>Remove from calendar<\/button>/g),
    ];
    expect(buttons).toHaveLength(2);
    for (const [, attributes] of buttons) {
      expect(/\bdisabled(?:=|\s|$)/.test(attributes)).toBe(!connected);
    }
    expect(
      html.includes(
        "Reconnect the same Google account to remove these entries",
      ),
    ).toBe(!connected);
    expect(html).toContain("Removed project");
    expect(html).toContain("Removed volunteer signup");
  });
}
