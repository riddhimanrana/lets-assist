import { describe, expect, it } from "vitest";

import {
  pickBestExistingGoogleConnection,
  type ExistingGoogleConnection,
} from "./connection-selection";

const connections: ExistingGoogleConnection[] = [
  {
    id: "calendar-inactive",
    refresh_token: "rt-calendar",
    connection_type: "calendar",
    updated_at: "2026-01-01T00:00:00.000Z",
    connected_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "both-active",
    refresh_token: "rt-both",
    connection_type: "both",
    updated_at: "2026-01-02T00:00:00.000Z",
    connected_at: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "sheets-active",
    refresh_token: "rt-sheets",
    connection_type: "sheets",
    updated_at: "2026-01-03T00:00:00.000Z",
    connected_at: "2026-01-03T00:00:00.000Z",
  },
];

describe("pickBestExistingGoogleConnection", () => {
  it("prefers calendar connection for calendar reconnect even if less recent", () => {
    const selected = pickBestExistingGoogleConnection(connections, "calendar");
    expect(selected?.id).toBe("calendar-inactive");
  });

  it("prefers sheets connection for sheets reconnect", () => {
    const selected = pickBestExistingGoogleConnection(connections, "sheets");
    expect(selected?.id).toBe("sheets-active");
  });

  it("prefers both connection when reconnect requests both scopes", () => {
    const selected = pickBestExistingGoogleConnection(connections, "both");
    expect(selected?.id).toBe("both-active");
  });

  it("falls back to most recent connection when ranks are tied", () => {
    const selected = pickBestExistingGoogleConnection(
      [
        {
          id: "calendar-old",
          refresh_token: "rt-1",
          connection_type: "calendar",
          updated_at: "2026-01-01T00:00:00.000Z",
          connected_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "calendar-new",
          refresh_token: "rt-2",
          connection_type: "calendar",
          updated_at: "2026-01-05T00:00:00.000Z",
          connected_at: "2026-01-05T00:00:00.000Z",
        },
      ],
      "calendar"
    );

    expect(selected?.id).toBe("calendar-new");
  });
});