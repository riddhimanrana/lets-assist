import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILES = [
  "app/organization/[id]/reports/sheets-actions.ts",
  "app/organization/[id]/reports/server/shared.ts",
  "app/organization/[id]/reports/server/status.ts",
  "app/organization/[id]/reports/server/sync.ts",
  "app/organization/[id]/reports/server/setup.ts",
  "app/organization/[id]/reports/server/ownership.ts",
] as const;

export function readOrganizationSheetActionsSource() {
  return SOURCE_FILES.map((relativePath) =>
    readFileSync(join(process.cwd(), relativePath), "utf8"),
  ).join("\n");
}
