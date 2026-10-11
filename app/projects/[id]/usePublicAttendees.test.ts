import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const scenario of [
  "participant",
  "manager",
  "restricted",
  "error-retry",
  "stale",
]) {
  test(`roster hook preserves authorization and loading lifecycle: ${scenario}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("./usePublicAttendees.fixture.ts", import.meta.url),
        ),
        scenario,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 25000);
}
