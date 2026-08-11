import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILES = [
  "app/admin/plugins/actions.ts",
  "app/admin/plugins/server/shared.ts",
  "app/admin/plugins/server/query.ts",
  "app/admin/plugins/server/catalog-entitlements.ts",
  "app/admin/plugins/server/installs.ts",
] as const;

export function readAdminPluginActionSource() {
  return SOURCE_FILES.map((relativePath) =>
    readFileSync(join(process.cwd(), relativePath), "utf8"),
  ).join("\n");
}
