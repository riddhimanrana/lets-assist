import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("calendar service modules", () => {
  test("the established calendar module remains the compatibility surface", () => {
    const core = read("services/calendar.ts");
    expect(core).toContain(
      'export { getCsfPersonalCalendarProviderContext } from "./calendar-csf-personal";',
    );
    expect(core).toContain('from "./calendar-operations";');
  });

  test("connection, CSF context, and operations meet the service budget", () => {
    for (const path of [
      "services/calendar.ts",
      "services/calendar-csf-personal.ts",
      "services/calendar-operations.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });
});
