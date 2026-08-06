import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const modulePaths = [
  "app/organization/[id]/reports/server/status.ts",
  "app/organization/[id]/reports/server/sync.ts",
  "app/organization/[id]/reports/server/setup.ts",
  "app/organization/[id]/reports/server/ownership.ts",
] as const;

describe("organization sheet action modules", () => {
  test("the compatibility barrel exposes the established action surface", () => {
    const barrel = read("app/organization/[id]/reports/sheets-actions.ts");
    const exportedNames = Array.from(
      barrel.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]+),?$/gmu),
      (match) => match[1],
    ).sort();

    expect(exportedNames).toEqual(
      [
        "connectExistingSheet",
        "createSheetSync",
        "disconnectOrganizationSheetConnection",
        "getAvailableSheetOwners",
        "getSheetReportPreview",
        "getSheetsAccessTokenForPicker",
        "getSpreadsheetSetupMetadata",
        "syncSheetNow",
        "unlinkSheetSync",
        "updateSheetOwner",
        "updateSheetSyncConfig",
        "updateSheetSyncSettings",
      ].sort(),
    );
    expect(barrel).toContain(
      'export { getSheetSyncStatus } from "./server/status";',
    );
    expect(barrel).not.toMatch(/getAdminClient|\.from\(/u);
  });

  test("focused action modules remain below the service budget", () => {
    for (const path of modulePaths) {
      const lineCount = read(path).split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(800);
    }
  });

  test("the service-role and OAuth binding primitives remain server-only", () => {
    const shared = read("app/organization/[id]/reports/server/shared.ts");
    expect(shared).toStartWith('import "server-only";');
    expect(shared).toContain("organizationSheetsGoogleBinding(organizationId)");
  });
});
