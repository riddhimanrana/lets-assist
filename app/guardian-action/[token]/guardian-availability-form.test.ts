import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const formSource = readFileSync(
  join(import.meta.dir, "GuardianAvailabilityForm.tsx"),
  "utf8",
);
const pageSource = readFileSync(join(import.meta.dir, "page.tsx"), "utf8");

test("guardian availability waits for hydration and preserves the reviewed values", () => {
  expect(formSource).toContain('"use client"');
  expect(formSource).toContain('data-hydrated={hydrated ? "true" : "false"}');
  expect(formSource).toContain('useState<AvailabilityStatus>("available")');
  expect(formSource).toContain('checked={status === "limited"}');
  expect(formSource).toContain('onChange={() => setStatus("limited")}');
  expect(formSource).toContain("value={notes}");
  expect(formSource).toContain(
    "onChange={(event) => setNotes(event.target.value)}",
  );
  expect(formSource).toContain("disabled={!hydrated || pending}");
  expect(pageSource).toContain("<GuardianAvailabilityForm");
  expect(pageSource).not.toContain("defaultChecked");
});
