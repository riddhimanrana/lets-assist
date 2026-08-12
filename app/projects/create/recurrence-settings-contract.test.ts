import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("recurrence UI consumes the shared occurrence ceiling", () => {
  const source = readFileSync(
    join(import.meta.dir, "RecurrenceSettings.tsx"),
    "utf8",
  );

  expect(source).toContain(
    'import { RECURRENCE_OCCURRENCE_MAX } from "@/lib/projects/schedule-validation";',
  );
  expect(source).toContain("max={RECURRENCE_OCCURRENCE_MAX}");
  expect(source).not.toContain('max="52"');
});
