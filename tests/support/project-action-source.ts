import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ACTION_FILES = [
  "app/projects/[id]/actions.ts",
  "app/projects/[id]/server/shared.ts",
  "app/projects/[id]/server/access-helpers.ts",
  "app/projects/[id]/server/access.ts",
  "app/projects/[id]/server/waiver-assets.ts",
  "app/projects/[id]/server/waiver-persistence.ts",
  "app/projects/[id]/server/signup.ts",
  "app/projects/[id]/server/signup-registered.ts",
  "app/projects/[id]/server/signup-anonymous.ts",
  "app/projects/[id]/server/cancellation.ts",
  "app/projects/[id]/server/lifecycle.ts",
  "app/projects/[id]/server/attendance.ts",
  "app/projects/[id]/server/waiver-queries.ts",
  "app/projects/[id]/server/confirmation.ts",
  "app/projects/[id]/server/waiver-definition.ts",
] as const;

/**
 * Source-contract tests inspect the complete implementation surface while the
 * public import contract remains the small actions.ts barrel.
 */
export function readProjectActionSource(root = process.cwd()): string {
  return PROJECT_ACTION_FILES.map((file) =>
    readFileSync(join(root, file), "utf8"),
  ).join("\n");
}
