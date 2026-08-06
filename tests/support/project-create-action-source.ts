import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILES = [
  "app/projects/create/actions.ts",
  "app/projects/create/server/shared.ts",
  "app/projects/create/server/create.ts",
  "app/projects/create/server/assets.ts",
  "app/projects/create/server/drafts.ts",
  "app/projects/create/server/validation.ts",
] as const;

export function readProjectCreateActionSource() {
  return SOURCE_FILES.map((relativePath) =>
    readFileSync(join(process.cwd(), relativePath), "utf8"),
  ).join("\n");
}
