import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILES = [
  "app/admin/actions.ts",
  "app/admin/server/auth.ts",
  "app/admin/server/shared.ts",
  "app/admin/server/notifications.ts",
  "app/admin/server/feedback.ts",
  "app/admin/server/trusted-members.ts",
  "app/admin/server/enforcement.ts",
  "app/admin/server/organizations.ts",
] as const;

export function readAdminActionSource() {
  return SOURCE_FILES.map((relativePath) =>
    readFileSync(join(process.cwd(), relativePath), "utf8"),
  ).join("\n");
}
