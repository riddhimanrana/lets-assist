import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAdminClient: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: mocks.getAdminClient,
}));

vi.mock("@/lib/encryption", () => ({
  decrypt: mocks.decrypt,
  encrypt: mocks.encrypt,
}));

import { getGoogleAccessTokenForSheetsForUser, hasGoogleSheetsScopes } from "./calendar";

type MockConnection = {
  id: string;
  user_id: string;
  provider: "google";
  is_active: boolean;
  connection_type: "calendar" | "sheets" | "both";
  granted_scopes: string | null;
  token_expires_at: string;
  access_token: string;
  refresh_token: string;
  updated_at?: string;
  connected_at?: string;
};

function createSupabaseMock(connections: MockConnection[]) {
  const deactivatedIds: string[] = [];

  const query: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    __orderCallCount: number;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    update: vi.fn(),
    __orderCallCount: 0,
  };

  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);
  query.in.mockImplementation(() => query);
  query.order.mockImplementation(() => {
    query.__orderCallCount += 1;
    if (query.__orderCallCount >= 2) {
      return Promise.resolve({ data: connections, error: null });
    }
    return query;
  });
  query.update.mockImplementation(() => ({
    eq: vi.fn().mockImplementation((_field: string, id: string) => {
      deactivatedIds.push(id);
      return Promise.resolve({ error: null });
    }),
  }));

  const from = vi.fn().mockImplementation(() => {
    query.__orderCallCount = 0;
    return query;
  });

  const client = { from };
  return { client, deactivatedIds };
}

describe("calendar token resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decrypt.mockImplementation((value: string) => `dec:${value}`);
    mocks.encrypt.mockImplementation((value: string) => `enc:${value}`);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("prefers exact sheets connection over both when both are valid", async () => {
    const now = Date.now();
    const validExpiry = new Date(now + 60 * 60 * 1000).toISOString();
    const scopes = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

    const { client } = createSupabaseMock([
      {
        id: "both-1",
        user_id: "user-1",
        provider: "google",
        is_active: true,
        connection_type: "both",
        granted_scopes: scopes,
        token_expires_at: validExpiry,
        access_token: "access-both",
        refresh_token: "refresh-both",
      },
      {
        id: "sheets-1",
        user_id: "user-1",
        provider: "google",
        is_active: true,
        connection_type: "sheets",
        granted_scopes: scopes,
        token_expires_at: validExpiry,
        access_token: "access-sheets",
        refresh_token: "refresh-sheets",
      },
    ]);

    mocks.getAdminClient.mockReturnValue(client);

    const token = await getGoogleAccessTokenForSheetsForUser("user-1", true);

    expect(token).toBe("dec:access-sheets");
  });

  it("falls back to next candidate when first refresh fails", async () => {
    const now = Date.now();
    const expired = new Date(now - 60 * 1000).toISOString();
    const validExpiry = new Date(now + 60 * 60 * 1000).toISOString();
    const scopes = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

    const { client, deactivatedIds } = createSupabaseMock([
      {
        id: "sheets-expired",
        user_id: "user-1",
        provider: "google",
        is_active: true,
        connection_type: "sheets",
        granted_scopes: scopes,
        token_expires_at: expired,
        access_token: "access-expired",
        refresh_token: "refresh-expired",
      },
      {
        id: "both-valid",
        user_id: "user-1",
        provider: "google",
        is_active: true,
        connection_type: "both",
        granted_scopes: scopes,
        token_expires_at: validExpiry,
        access_token: "access-valid",
        refresh_token: "refresh-valid",
      },
    ]);

    mocks.getAdminClient.mockReturnValue(client);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      text: async () => "refresh failed",
    });

    const token = await getGoogleAccessTokenForSheetsForUser("user-1", true);

    expect(token).toBe("dec:access-valid");
    expect(deactivatedIds).toContain("sheets-expired");
  });

  it("returns null when required sheets scopes are missing", async () => {
    const validExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { client } = createSupabaseMock([
      {
        id: "calendar-only",
        user_id: "user-1",
        provider: "google",
        is_active: true,
        connection_type: "calendar",
        granted_scopes: "https://www.googleapis.com/auth/calendar",
        token_expires_at: validExpiry,
        access_token: "access-calendar",
        refresh_token: "refresh-calendar",
      },
    ]);

    mocks.getAdminClient.mockReturnValue(client);

    const token = await getGoogleAccessTokenForSheetsForUser("user-1", true);

    expect(token).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(hasGoogleSheetsScopes("https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file")).toBe(true);
    expect(hasGoogleSheetsScopes("https://www.googleapis.com/auth/spreadsheets")).toBe(false);
  });
});
