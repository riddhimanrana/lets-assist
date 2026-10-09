import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/lib/logger", () => ({
  logError: () => undefined,
  logInfo: () => undefined,
  logWarn: () => undefined,
}));

type Row = Record<string, unknown>;

let targetMembership: Row | null = { role: "admin", status: "active" };
let syncUpdates: Row[] = [];
let tokenRequests: string[] = [];

/** The viewer is always an active admin. Only the target varies. */
const serverClient = {
  auth: { getUser: async () => ({ data: { user: { id: "viewer-admin" } } }) },
  from: () => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({ data: { role: "admin", status: "active" } }),
    };
    return query;
  },
};

const adminClient = {
  from: (table: string) => {
    if (table === "organization_sheet_syncs") {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: { organization_id: "org-1", sheet_id: "sheet-1" },
        }),
        update: (payload: Row) => ({
          eq: async () => {
            syncUpdates.push(payload);
            return { error: null };
          },
        }),
      };
      return query;
    }
    if (table === "organization_members") {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: targetMembership, error: null }),
      };
      return query;
    }
    throw new Error(`Unexpected admin table: ${table}`);
  },
};

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => serverClient,
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => adminClient,
}));
mock.module("@/services/calendar", () => ({
  organizationSheetsGoogleBinding: (organizationId: string) => ({
    purpose: "organization_sheets",
    organizationId,
    pluginKey: null,
  }),
  hasGoogleSheetsScopes: (scopes: unknown) => scopes === "sheets",
  getSheetsConnection: async () => ({ granted_scopes: "sheets" }),
  getGoogleAccessTokenForSheets: async () => "viewer-token",
  getGoogleAccessTokenForSheetsForUser: async (userId: string) => {
    tokenRequests.push(userId);
    return `token-for-${userId}`;
  },
  deactivateGoogleConnection: async () => ({ success: true }),
}));

const { updateSheetOwner } = await import("./ownership");

const originalFetch = globalThis.fetch;
let probes: Array<{ url: string; authorization: string | null }> = [];
let probeResponse: () => Response;

beforeEach(() => {
  targetMembership = { role: "admin", status: "active" };
  syncUpdates = [];
  tokenRequests = [];
  probes = [];
  probeResponse = () =>
    Response.json({
      spreadsheetId: "sheet-1",
      properties: { title: "Fixture" },
      sheets: [{ properties: { sheetId: 0, title: "Member Hours" } }],
    });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    probes.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return probeResponse();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("changing the sheet sync owner", () => {
  test("refuses a target who is not an active admin, before anything changes", async () => {
    for (const membership of [
      { role: "staff", status: "active" },
      { role: "admin", status: "inactive" },
      null,
    ]) {
      targetMembership = membership;

      expect(await updateSheetOwner("org-1", "target-1")).toEqual({
        success: false,
        error: "The sync owner must be an active admin of this organization.",
      });
    }
    expect(syncUpdates).toHaveLength(0);
    expect(probes).toHaveLength(0);
  });

  test("probes the spreadsheet with the new owner's token", async () => {
    expect(await updateSheetOwner("org-1", "target-1")).toEqual({
      success: true,
      needsReselect: false,
    });

    expect(tokenRequests).toEqual(["target-1"]);
    expect(probes).toHaveLength(1);
    expect(probes[0].url).toContain("/spreadsheets/sheet-1?fields=");
    expect(probes[0].authorization).toBe("Bearer token-for-target-1");
    expect(syncUpdates).toHaveLength(1);
    expect(syncUpdates[0].created_by).toBe("target-1");
  });

  test("turns automatic sync off and says so when the new owner cannot open the file", async () => {
    for (const status of [403, 404]) {
      syncUpdates = [];
      probeResponse = () => new Response("{}", { status });

      expect(await updateSheetOwner("org-1", "target-1")).toEqual({
        success: true,
        needsReselect: true,
      });
      expect(syncUpdates.map((update) => Object.keys(update).sort())).toEqual([
        ["created_by", "updated_at"],
        ["auto_sync", "updated_at"],
      ]);
      expect(syncUpdates[1].auto_sync).toBe(false);
    }
  });

  test("does not flag the sync when Google could not answer", async () => {
    probeResponse = () => new Response("{}", { status: 503 });

    expect(await updateSheetOwner("org-1", "target-1")).toEqual({
      success: true,
      needsReselect: false,
    });
    expect(syncUpdates).toHaveLength(1);
  });
});
