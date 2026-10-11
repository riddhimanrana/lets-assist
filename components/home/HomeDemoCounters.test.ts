import { expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const childScenario = process.env.LETS_ASSIST_COUNTER_SCENARIO;
if (childScenario) {
  const runtime = await import("./HomeDemoCounters.fixture");
  mock.module("react", () => runtime.counterReact);
  test(`isolated scenario: ${childScenario}`, runtime.runCounterScenario);
} else {
  for (const scenario of ["hidden", "reduced", "cap"]) {
    test(`sample counters manage their real timer lifecycle: ${scenario}`, () => {
      const result = spawnSync(
        process.execPath,
        ["test", fileURLToPath(import.meta.url)],
        {
          encoding: "utf8",
          timeout: 20000,
          env: { ...process.env, LETS_ASSIST_COUNTER_SCENARIO: scenario },
        },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    }, 25000);
  }
}
