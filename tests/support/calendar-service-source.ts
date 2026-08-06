import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../..");
const SOURCE_FILES = [
  "services/calendar.ts",
  "services/calendar-csf-personal.ts",
  "services/calendar-operations.ts",
] as const;

export function readCalendarServiceSource() {
  return SOURCE_FILES.map((relativePath) =>
    readFileSync(join(repositoryRoot, relativePath), "utf8"),
  ).join("\n");
}
