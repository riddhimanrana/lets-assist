import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILES = [
  "app/attend/[projectId]/actions.ts",
  "app/attend/[projectId]/server/shared.ts",
  "app/attend/[projectId]/server/check-in.ts",
  "app/attend/[projectId]/server/checkout.ts",
] as const;

export function readAttendanceActionSource() {
  return SOURCE_FILES.map((relativePath) =>
    readFileSync(join(process.cwd(), relativePath), "utf8"),
  ).join("\n");
}
