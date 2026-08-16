import { describe, expect, test } from "bun:test";

import {
  canReuseExistingGoogleRefreshToken,
  type ExistingGoogleConnection,
} from "./connection-selection";

function connection(
  overrides: Partial<ExistingGoogleConnection> = {},
): ExistingGoogleConnection {
  return {
    id: "connection-1",
    refresh_token: "encrypted-refresh-token",
    calendar_email: "chapter@local.test",
    connection_type: "sheets",
    updated_at: "2026-07-22T12:00:00.000Z",
    connected_at: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
}

describe("Google callback connection selection", () => {
  test("reuses a refresh token only for the same normalized Google identity", () => {
    const existing = connection({ calendar_email: " Chapter@Local.Test " });

    expect(
      canReuseExistingGoogleRefreshToken(existing, "chapter@local.test"),
    ).toBe(true);
    expect(
      canReuseExistingGoogleRefreshToken(existing, "other@local.test"),
    ).toBe(false);
    expect(
      canReuseExistingGoogleRefreshToken(
        connection({ calendar_email: null }),
        "chapter@local.test",
      ),
    ).toBe(false);
    expect(
      canReuseExistingGoogleRefreshToken(
        connection({ refresh_token: null }),
        "chapter@local.test",
      ),
    ).toBe(false);
  });
});
