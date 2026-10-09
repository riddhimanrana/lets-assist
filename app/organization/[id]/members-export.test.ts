import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;

describe("member CSV exports", () => {
  test.each(["members-export.ts", "member-details-export.ts"])(
    "%s escapes every cell through the shared CSV helper",
    (file) => {
      const source = readFileSync(join(here, file), "utf8");

      expect(source).toContain(
        'from "@/lib/organization/report-output-safety"',
      );
      expect(source).toContain(".map(escapeCsvCell)");
      // No hand-quoted cells: user-controlled names and titles must not
      // reach the file without quote escaping and formula neutralisation.
      expect(source).not.toMatch(/`"\$\{/u);
    },
  );
});
