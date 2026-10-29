import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CalendarConnectionSection } from "./CalendarConnectionSection";

const unexpected = () => {
  throw new Error("Rendering must not connect or disconnect");
};

const render = (
  connection: { calendar_email: string; created_at: string } | null,
  legacyReconnectRequired: boolean,
) =>
  renderToStaticMarkup(
    <CalendarConnectionSection
      connection={connection}
      legacyReconnectRequired={legacyReconnectRequired}
      isDisconnecting={false}
      onConnect={unexpected}
      onDisconnect={unexpected}
    />,
  );

describe("calendar connection section", () => {
  test("a legacy connection explains that reconnecting restores syncing", () => {
    const html = render(null, true);
    expect(html).toContain("Reconnect required");
    expect(html).toContain(
      "Reconnect Google Calendar to restore event syncing.",
    );
    expect(html).toContain(">Reconnect Google Calendar</button>");
    expect(html).toContain('data-variant="warning"');
    // No internal authorization vocabulary in the user's explanation.
    expect(html).not.toContain("verified purpose");
    expect(html).not.toContain("purpose");
    expect(html).not.toContain("Not connected");
  });

  test("an unlinked account stays distinct from a legacy one", () => {
    const html = render(null, false);
    expect(html).toContain("No calendar connected");
    expect(html).toContain(">Connect Google Calendar</button>");
    expect(html).toContain('data-variant="neutral"');
    expect(html).not.toContain("Reconnect");
  });

  test("a connected account shows its address and only Disconnect", () => {
    const html = render(
      {
        calendar_email: "calendar@local.test",
        created_at: "2040-01-01T00:00:00Z",
      },
      false,
    );
    expect(html).toContain("calendar@local.test");
    expect(html).toContain("Connected on January 1, 2040");
    expect(html).toContain(">Disconnect</button>");
    expect(html).toContain('data-variant="success"');
    expect(html).not.toContain("Connect Google Calendar");
    expect(html).not.toContain("How it works");
  });
});
