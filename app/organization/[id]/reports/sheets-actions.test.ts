import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAdminClient: vi.fn(),
  getSheetsConnection: vi.fn(),
  hasGoogleSheetsScopes: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: mocks.getAdminClient,
}));

vi.mock("@/services/calendar", () => ({
  getSheetsConnection: mocks.getSheetsConnection,
  getGoogleAccessTokenForSheets: vi.fn(),
  getGoogleAccessTokenForSheetsForUser: vi.fn(),
  hasGoogleSheetsScopes: mocks.hasGoogleSheetsScopes,
}));

vi.mock("@/services/google-sheets", () => ({
  buildSpreadsheetUrl: vi.fn((sheetId: string) => `https://docs.google.com/spreadsheets/d/${sheetId}`),
  buildWriteRange: vi.fn(),
  createSpreadsheet: vi.fn(),
  ensureSpreadsheetTab: vi.fn(),
  extractSpreadsheetId: vi.fn(),
  getSpreadsheetMetadata: vi.fn(),
  updateSpreadsheetValues: vi.fn(),
}));

vi.mock("./actions", () => ({
  buildOrganizationReportRows: vi.fn(),
  getOrganizationReportData: vi.fn(),
}));

vi.mock("./report-layouts", () => ({
  buildRowsWithLayout: vi.fn(),
  validateLayout: vi.fn(() => ({ valid: true, errors: [] })),
}));

import { getSheetSyncStatus, unlinkSheetSync, updateSheetSyncSettings } from "./sheets-actions";

function createMembershipClient(role: "admin" | "staff" | "member" = "admin") {
  const membershipQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
  } as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
  };

  membershipQuery.select.mockImplementation(() => membershipQuery);
  membershipQuery.eq.mockImplementation(() => membershipQuery);
  membershipQuery.single.mockResolvedValue({ data: { role }, error: null });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "viewer-1" } } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "organization_members") return membershipQuery;
      throw new Error(`Unexpected table in membership client: ${table}`);
    }),
  };
}

function createMaybeSingleQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  } as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };

  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);
  query.maybeSingle.mockResolvedValue({ data: result, error: null });

  return query;
}

function createDeleteQuery(resultError: unknown = null) {
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
  } as {
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
  };

  query.delete.mockImplementation(() => query);
  query.eq.mockResolvedValue({ error: resultError });

  return query;
}

describe("sheets actions regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasGoogleSheetsScopes.mockImplementation((grantedScopes: string | null) => {
      if (!grantedScopes) return false;
      const scopes = grantedScopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
      return (
        scopes.includes("https://www.googleapis.com/auth/spreadsheets") &&
        scopes.includes("https://www.googleapis.com/auth/drive.file")
      );
    });
  });

  it("hides syncConfig when destination fields are incomplete", async () => {
    const viewerScopes =
      "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

    mocks.createClient.mockResolvedValue(createMembershipClient("admin"));
    mocks.getSheetsConnection.mockResolvedValue({
      granted_scopes: viewerScopes,
      calendar_email: "admin@example.com",
    });

    const organizationSheetSyncQuery = createMaybeSingleQuery({
      sheet_id: "",
      sheet_url: "",
      sheet_title: "Org Report",
      tab_name: "",
      range_a1: "A1",
      report_type: "member-hours",
      layout_config: null,
      auto_sync: false,
      sync_interval_minutes: 1440,
      last_synced_at: null,
      created_by: "owner-1",
    });

    const ownerConnectionQuery = createMaybeSingleQuery({
      granted_scopes: viewerScopes,
      calendar_email: "owner@example.com",
    });

    const ownerProfileQuery = createMaybeSingleQuery({
      id: "owner-1",
      full_name: "Owner Name",
      username: "owner",
      email: "owner@example.com",
    });

    mocks.getAdminClient.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "organization_sheet_syncs") return organizationSheetSyncQuery;
        if (table === "user_calendar_connections") return ownerConnectionQuery;
        if (table === "profiles") return ownerProfileQuery;
        throw new Error(`Unexpected table in admin client: ${table}`);
      }),
    });

    const result = await getSheetSyncStatus("org-1");

    expect(result.connected).toBe(true);
    expect(result.viewerConnected).toBe(true);
    expect(result.syncConfig).toBeNull();
    expect(result.connectedBy?.id).toBe("owner-1");
  });

  it("rejects sync intervals below 60 minutes", async () => {
    mocks.createClient.mockResolvedValue(createMembershipClient("admin"));

    const result = await updateSheetSyncSettings("org-1", {
      syncIntervalMinutes: 30,
    });

    expect(result).toEqual({
      success: false,
      error: "Sync interval must be at least 60 minutes",
    });
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
  });

  it("returns not configured when changing settings without a sync row", async () => {
    mocks.createClient.mockResolvedValue(createMembershipClient("admin"));

    const noSyncQuery = createMaybeSingleQuery(null);

    mocks.getAdminClient.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "organization_sheet_syncs") return noSyncQuery;
        throw new Error(`Unexpected table in admin client: ${table}`);
      }),
    });

    const result = await updateSheetSyncSettings("org-1", {
      autoSync: true,
      syncIntervalMinutes: 720,
    });

    expect(result).toEqual({
      success: false,
      error: "Sheet sync not configured",
    });
  });

  it("prevents non-owner admins from unlinking sheets sync", async () => {
    mocks.createClient.mockResolvedValue(createMembershipClient("admin"));

    const sheetOwnerQuery = createMaybeSingleQuery({
      organization_id: "org-1",
      created_by: "owner-1",
    });

    const ownerProfileQuery = createMaybeSingleQuery({
      full_name: "Owner Name",
      username: "owner",
      email: "owner@example.com",
    });

    mocks.getAdminClient.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "organization_sheet_syncs") return sheetOwnerQuery;
        if (table === "profiles") return ownerProfileQuery;
        throw new Error(`Unexpected table in admin client: ${table}`);
      }),
    });

    const result = await unlinkSheetSync("org-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("managed by Owner Name");
  });

  it("allows owner admin to unlink sheets sync", async () => {
    mocks.createClient.mockResolvedValue(createMembershipClient("admin"));

    const sheetOwnerQuery = createMaybeSingleQuery({
      organization_id: "org-1",
      created_by: "viewer-1",
    });

    const unlinkQuery = createDeleteQuery(null);

    let sheetSyncFromCount = 0;
    mocks.getAdminClient.mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "organization_sheet_syncs") {
          sheetSyncFromCount += 1;
          return sheetSyncFromCount === 1 ? sheetOwnerQuery : unlinkQuery;
        }
        throw new Error(`Unexpected table in admin client: ${table}`);
      }),
    });

    const result = await unlinkSheetSync("org-1");

    expect(result).toEqual({ success: true });
  });
});
