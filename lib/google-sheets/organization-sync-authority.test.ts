import { afterAll, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let ownerAllowed = true;
let authorizationFault: Error | null = null;
// The bound credential as the store holds it now, or null once it is gone.
let stored: Record<string, unknown> | null = null;
// The saved sync row as the database holds it now.
let savedRow: Record<string, unknown> | null = null;
let rowFault: { message: string } | null = null;
let duringTokenRead: () => void = () => undefined;
let issuedToken: string | null = "fixture-token";
const selections: unknown[] = [];

mock.module("@/lib/auth/google-oauth-authorization", () => ({
  authorizeGoogleOAuthOrganizationRequest: async () => {
    if (authorizationFault) throw authorizationFault;
    return { allowed: ownerAllowed };
  },
}));
mock.module("@/lib/auth/google-oauth-connection-store", () => ({
  getGoogleOAuthConnectionForBinding: async () =>
    stored ? { ...stored } : null,
}));
mock.module("@/services/calendar", () => ({
  getGoogleAccessTokenForSheetsForUser: async () => {
    duringTokenRead();
    return issuedToken;
  },
  organizationSheetsGoogleBinding: (organizationId: string) => ({
    organizationId,
    purpose: "organization_sheets",
    pluginKey: null,
  }),
}));
// The sync module is loaded for its column list only. Nothing here builds a
// report or reaches a provider.
mock.module("@/lib/logger", () => ({
  logError: () => undefined,
  logInfo: () => undefined,
  logWarn: () => undefined,
}));
mock.module("@/lib/organization/report-service", () => ({
  buildOrganizationReportRowsForSync: async () => {
    throw new Error("No report is built in authority tests");
  },
}));

const { ORGANIZATION_SHEET_SYNC_COLUMNS } =
  await import("./organization-report-sync");
const { prepareOrganizationSheetSyncAuthority } =
  await import("./organization-sync-authority");

const supabase = {
  from: () => ({
    select: (columns: unknown) => {
      selections.push(columns);
      return {
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => ({
            data:
              !rowFault && savedRow && savedRow[column] === value
                ? { ...savedRow }
                : null,
            error: rowFault,
          }),
        }),
      };
    },
  }),
} as unknown as Parameters<typeof prepareOrganizationSheetSyncAuthority>[0];

const config = () => ({
  organization_id: "org-1",
  sheet_id: "sheet-1",
  tab_name: "Member Hours",
  range_a1: "A1",
  report_type: "member-hours",
  layout_config: { reportType: "member-hours", columns: [{ key: "email" }] },
  created_by: "owner-1",
  updated_at: "2026-10-11T00:00:00.000Z",
});
const prepare = (signal?: AbortSignal) =>
  prepareOrganizationSheetSyncAuthority(supabase, config(), signal);
const SANITIZED = "Organization sheet export authority changed";

beforeEach(() => {
  ownerAllowed = true;
  authorizationFault = null;
  rowFault = null;
  issuedToken = "fixture-token";
  duringTokenRead = () => undefined;
  selections.length = 0;
  stored = {
    id: "connection-1",
    user_id: "owner-1",
    access_token: "fictional-ciphertext-a",
    refresh_token: "fictional-ciphertext-r",
    token_expires_at: "2040-01-01T00:00:00.000Z",
    is_active: true,
  };
  // The stored row also carries columns a sync never selects.
  savedRow = { ...config(), auto_sync: true, last_synced_at: null };
});
afterAll(() => mock.restore());

test("an unchanged owner, configuration and credential may write and complete", async () => {
  const authority = await prepare();

  expect(authority.accessToken).toBe("fixture-token");
  expect(authority.failure()).toBeNull();
  await authority.beforeWrite();
  await authority.beforeWrite();
  expect(authority.failure()).toBeNull();
  // One read at preparation and one before each of the two writes.
  expect(selections).toEqual(Array(3).fill(ORGANIZATION_SHEET_SYNC_COLUMNS));
  expect(Object.keys(config()).join(", ")).toBe(
    ORGANIZATION_SHEET_SYNC_COLUMNS,
  );
});

test("extra fields on the caller's row or the saved row are not part of the comparison", async () => {
  // The worker and the manual action both select more than the saved columns.
  const authority = await prepareOrganizationSheetSyncAuthority(supabase, {
    ...config(),
    auto_sync: false,
    sync_interval_minutes: 60,
    sheet_url: "https://example.test/fixture",
  } as ReturnType<typeof config>);
  savedRow!.last_synced_at = "2026-10-11T00:10:00.000Z";

  await authority.beforeWrite();
  expect(authority.failure()).toBeNull();
});

test("a token refresh pins the refreshed credential of the same connection", async () => {
  duringTokenRead = () =>
    Object.assign(stored!, {
      access_token: "fictional-ciphertext-b",
      token_expires_at: "2040-01-02T00:00:00.000Z",
    });
  const authority = await prepare();

  expect(authority.accessToken).toBe("fixture-token");
  await authority.beforeWrite();
  expect(authority.failure()).toBeNull();
});

test("a connection replaced while the token is read never yields a token", async () => {
  duringTokenRead = () => Object.assign(stored!, { id: "connection-2" });
  const authority = await prepare();

  expect(authority.accessToken).toBeNull();
  expect(authority.failure()).toMatchObject({
    success: false,
    code: "authorization_changed",
  });
  await expect(authority.beforeWrite()).rejects.toThrow(SANITIZED);
});
test("a scope regrant during token acquisition never authorizes an old token", async () => {
  duringTokenRead = () =>
    Object.assign(stored!, {
      granted_scopes_updated_at: "2026-10-11T02:00:00.000Z",
    });
  const authority = await prepare();
  expect(authority.accessToken).toBeNull();
  expect(authority.failure()).toMatchObject({ code: "authorization_changed" });
});

test.each([
  ["a missing connection", () => (stored = null)],
  ["a refused token", () => (issuedToken = null)],
  ["a revoked owner", () => (ownerAllowed = false)],
])("%s before the export yields no token", async (_name, arrange) => {
  arrange();
  const authority = await prepare();

  expect(authority.accessToken).toBeNull();
  expect(authority.failure()).toMatchObject({ code: "authorization_changed" });
});

test.each([
  ["sheet_id", "sheet-2"],
  ["tab_name", null],
  ["range_a1", "B2:D20"],
  ["report_type", "project-summary"],
  ["layout_config", { reportType: "member-hours", columns: [{ key: "name" }] }],
  ["created_by", "owner-2"],
  ["updated_at", "2026-10-11T01:00:00.000Z"],
])(
  "a saved %s that changed after preparation refuses the next write",
  async (column, value) => {
    const authority = await prepare();
    savedRow![column] = value;

    await expect(authority.beforeWrite()).rejects.toThrow(SANITIZED);
    expect(authority.failure()).toMatchObject({
      success: false,
      code: "configuration_changed",
    });
  },
);

test("a removed or unreadable configuration refuses the next write", async () => {
  for (const arrange of [
    () => (savedRow = null),
    () => (rowFault = { message: "private database detail" }),
  ]) {
    savedRow = { ...config() };
    rowFault = null;
    const authority = await prepare();
    arrange();

    await expect(authority.beforeWrite()).rejects.toThrow(SANITIZED);
    expect(authority.failure()).toMatchObject({
      code: "configuration_changed",
    });
    expect(JSON.stringify(authority.failure())).not.toContain("private");
  }
});

test.each([
  [
    "a reconnect that reissues the tokens",
    { refresh_token: "fictional-ciphertext-new" },
  ],
  ["a refresh by another run", { access_token: "fictional-ciphertext-c" }],
  ["a new expiry", { token_expires_at: "2041-01-01T00:00:00.000Z" }],
  ["a rebound connection", { id: "connection-2" }],
  ["a changed scope grant", { granted_scopes: "fictional-revoked-scope" }],
  [
    "a changed scope revision",
    { granted_scopes_updated_at: "2026-10-11T01:00:00.000Z" },
  ],
  ["a changed connection purpose", { connection_type: "calendar" }],
  ["a changed account identity", { calendar_email: "another@example.test" }],
])("%s after preparation refuses the next write", async (_name, change) => {
  const authority = await prepare();
  Object.assign(stored!, change);

  await expect(authority.beforeWrite()).rejects.toThrow(SANITIZED);
  expect(authority.failure()).toMatchObject({ code: "authorization_changed" });
});

test("a deactivated or unbound connection after preparation refuses the next write", async () => {
  const authority = await prepare();
  // The store returns nothing for an inactive credential or a missing binding.
  stored = null;

  await expect(authority.beforeWrite()).rejects.toThrow(SANITIZED);
  expect(authority.failure()).toMatchObject({ code: "authorization_changed" });
});

test("the first late refusal is kept when later checks would say something else", async () => {
  const authority = await prepare();
  ownerAllowed = false;
  await expect(authority.beforeWrite()).rejects.toThrow(SANITIZED);
  const refusal = authority.failure();
  expect(refusal).toMatchObject({ code: "authorization_changed" });

  // Access returns and the destination moves: neither reopens the export.
  ownerAllowed = true;
  savedRow!.sheet_id = "sheet-2";
  await expect(authority.beforeWrite()).rejects.toThrow(SANITIZED);
  expect(authority.failure()).toBe(refusal);
  savedRow!.sheet_id = "sheet-1";
  await expect(authority.beforeWrite()).rejects.toThrow(SANITIZED);
  expect(authority.failure()).toBe(refusal);
});

test("a lookup fault fails closed without carrying its detail", async () => {
  const authority = await prepare();
  authorizationFault = new Error("private credential detail");

  const thrown = await authority.beforeWrite().catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(SANITIZED);
  expect(JSON.stringify(authority.failure())).not.toContain("private");
  expect(authority.failure()).toMatchObject({ code: "authorization_changed" });

  const early = await prepare();
  expect(early.accessToken).toBeNull();
  expect(JSON.stringify(early.failure())).not.toContain("private");
});

test("a deadline is reported as a timeout and is not recorded as a late refusal", async () => {
  const expired = new AbortController();
  expired.abort();
  const early = await prepare(expired.signal);
  expect(early.accessToken).toBeNull();
  expect(early.failure()).toMatchObject({ code: "sheets_timeout" });

  const controller = new AbortController();
  const authority = await prepare(controller.signal);
  controller.abort();
  await expect(authority.beforeWrite()).rejects.toThrow();
  expect(authority.failure()).toBeNull();
});
