import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILES = [
  "app/organization/[id]/settings/actions.ts",
  "app/organization/[id]/settings/server/profile.ts",
  "app/organization/[id]/settings/server/plugin-shared.ts",
  "app/organization/[id]/settings/server/plugin-query.ts",
  "app/organization/[id]/settings/server/plugin-mutations.ts",
] as const;

export function readOrganizationSettingsActionSource() {
  return SOURCE_FILES.map((relativePath) =>
    readFileSync(join(process.cwd(), relativePath), "utf8"),
  ).join("\n");
}
