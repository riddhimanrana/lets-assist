import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const scenario of ["hidden", "reduced", "cap"]) {
  test(`sample counters manage their real timer lifecycle: ${scenario}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("./HomeDemoCounters.fixture.tsx", import.meta.url),
        ),
        scenario,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 25000);
}
