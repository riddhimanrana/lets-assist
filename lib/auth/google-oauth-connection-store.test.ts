import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readSource = (path: string) =>
  readFileSync(join(root, path), "utf8");

describe("Google OAuth credential purpose boundaries", () => {
  test("the callback resolves and saves only the signed binding", () => {
    const source = readSource("app/api/calendar/google/callback/route.ts");

    expect(source).toContain("getGoogleOAuthConnectionForBinding(");
    expect(source).toContain("saveGoogleOAuthConnectionForBinding({");
    expect(source).toContain("purpose: stateData.purpose");
    expect(source).toContain("organizationId: stateData.organizationId");
    expect(source).toContain("pluginKey: stateData.pluginKey");
    expect(source).not.toContain('.from("user_calendar_connections")');
    expect(source).not.toContain("google_oauth_binding:");
  });

  test("the store resolves the locked binding relation before credentials", () => {
    const source = readSource("lib/auth/google-oauth-connection-store.ts");
    const bindingLookup = source.indexOf(
      '.from("user_google_oauth_connection_bindings")',
    );
    const credentialLookup = source.indexOf(
      '.from("user_calendar_connections")',
    );

    expect(bindingLookup).toBeGreaterThan(-1);
    expect(credentialLookup).toBeGreaterThan(bindingLookup);
    expect(source).toContain('.eq("purpose", expected.purpose)');
    expect(source).toContain('.eq("organization_id", expected.organizationId)');
    expect(source).toContain('.eq("plugin_key", expected.pluginKey)');
  });

  test("generic and organization consumers declare a purpose binding", () => {
    const service = readSource("services/calendar.ts");
    const orgCalendar = readSource("lib/organization/calendar-sync.ts");
    const orgSheets = readSource(
      "app/organization/[id]/reports/sheets-actions.ts",
    );
    const sheetsWorker = readSource(
      "app/api/cron/organization-sheet-sync/route.ts",
    );

    expect(service).not.toContain("matchesGoogleOAuthConnectionBinding");
    expect(service).toContain("expectedBinding: GoogleOAuthConnectionBindingExpectation");
    expect(orgCalendar).toContain(
      "expectedBinding: organizationCalendarGoogleBinding(organizationId)",
    );
    expect(orgSheets).toContain(
      "organizationSheetsGoogleBinding(organizationId)",
    );
    expect(sheetsWorker).toContain(
      "organizationSheetsGoogleBinding(row.organization_id)",
    );
  });

  test("disconnects delete only the selected purpose credential and report shared-grant handling", () => {
    const service = readSource("services/calendar.ts");
    const personalDisconnect = readSource(
      "app/api/calendar/google/disconnect/route.ts",
    );
    const orgCalendar = readSource(
      "app/organization/[id]/calendar/actions.ts",
    );
    const orgSheets = readSource(
      "app/organization/[id]/reports/sheets-actions.ts",
    );

    expect(service).toContain(
      "options.expectedBinding ?? PERSONAL_CALENDAR_GOOGLE_BINDING",
    );
    expect(service).toContain(
      "{ activeOnly: false, useServiceRole: options.useServiceRole }",
    );
    expect(personalDisconnect).toContain(
      "deactivateGoogleConnection(user.id, {",
    );
    expect(orgCalendar).toContain(
      "expectedBinding: organizationCalendarGoogleBinding(organizationId)",
    );
    expect(orgSheets).toContain(
      "expectedBinding: organizationSheetsGoogleBinding(organizationId)",
    );
    expect(service).toContain('.from("user_calendar_connections")');
    expect(service).toContain(".delete()");
    expect(service).toContain("hasOtherActiveGoogleOAuthConnection(");
    expect(personalDisconnect).toContain(
      "remoteRevocation: deactivateResult.remoteRevocation",
    );
  });

  test("organization token reads reauthorize the current membership and exact CSF capability", () => {
    const service = readSource("services/calendar.ts");
    const authorizationIndex = service.indexOf(
      "authorizeGoogleOAuthOrganizationRequest({",
    );
    const connectionIndex = service.indexOf(
      "getGoogleOAuthConnectionForBinding(\n    userId,\n    options.expectedBinding",
    );

    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(connectionIndex).toBeGreaterThan(authorizationIndex);
    expect(service).toContain(
      'options.expectedBinding.purpose === "csf_import"',
    );
    expect(service).toContain("!options.requestedCapability");
    expect(service).toContain(
      "requestedCapability: options.requestedCapability ?? null",
    );
  });

  test("slow token refreshes reauthorize before persistence and return", () => {
    const service = readSource("services/calendar.ts");
    const functionStart = service.indexOf(
      "export async function getGoogleAccessTokenForUser(",
    );
    const functionSource = service.slice(functionStart);
    const refresh = functionSource.indexOf(
      "refreshAccessToken(decryptedRefreshToken)",
    );
    const reauthorization = functionSource.indexOf(
      "const refreshedAuthorization = await authorizeGoogleOAuthOrganizationRequest({",
    );
    const connectionRecheck = functionSource.indexOf(
      "const currentConnection = await getGoogleOAuthConnectionForBinding(",
    );
    const persistence = functionSource.indexOf(
      "const { data: persistedConnection, error: persistError }",
    );
    const tokenReturn = functionSource.indexOf("return refreshed.accessToken;");
    const authorizationCalls = [
      ...functionSource.matchAll(/authorizeGoogleOAuthOrganizationRequest\(\{/gu),
    ];

    expect(functionStart).toBeGreaterThan(-1);
    expect(authorizationCalls).toHaveLength(2);
    expect(refresh).toBeGreaterThan(-1);
    expect(reauthorization).toBeGreaterThan(refresh);
    expect(connectionRecheck).toBeGreaterThan(reauthorization);
    expect(persistence).toBeGreaterThan(connectionRecheck);
    expect(tokenReturn).toBeGreaterThan(persistence);
  });

  test("OAuth token failures never log provider response bodies", () => {
    const callback = readSource("app/api/calendar/google/callback/route.ts");
    const service = readSource("services/calendar.ts");
    const refreshStart = service.indexOf("async function refreshAccessToken(");
    const refreshEnd = service.indexOf(
      "\n/**\n * Get a valid access token",
      refreshStart,
    );
    const refreshSource = service.slice(refreshStart, refreshEnd);

    expect(callback).not.toContain("tokenResponse.text()");
    expect(callback).not.toContain('console.error("Token exchange failed:",');
    expect(callback).toContain("status: tokenResponse.status");
    expect(refreshSource).not.toContain("response.text()");
    expect(refreshSource).toContain("status: response.status");
  });

  test("unbound legacy rows fail closed and are surfaced as reconnect-required", () => {
    const store = readSource("lib/auth/google-oauth-connection-store.ts");
    const service = readSource("services/calendar.ts");
    const calendarPage = readSource("app/account/calendar/page.tsx");
    const csfActions = readSource(
      "lib/plugins/private/plugins/dvhs-csf/actions.ts",
    );

    expect(store).toContain("hasUnboundActiveGoogleOAuthConnection(");
    expect(store).toContain("if (!connectionId) return null;");
    expect(service).toContain("hasLegacyGoogleOAuthReconnectRequired");
    expect(calendarPage).toContain("legacyReconnectRequired");
    expect(csfActions).toContain('"legacy_unbound"');
  });
});
