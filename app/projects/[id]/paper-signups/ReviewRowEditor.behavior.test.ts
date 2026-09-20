import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const [scenario, description] of [
  [
    "roster",
    "edited roster rows become ready after renewed review and retain persisted-attendance protection",
  ],
  [
    "reason",
    "editing a time exception clears review until the coordinator confirms it again",
  ],
  [
    "unchanged",
    "saving an unchanged reviewed row retains its approval and identity",
  ],
  [
    "interval",
    "editing an interval still clears review and preserves the exception reason",
  ],
]) {
  test(
    description,
    () => {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("./ReviewRowEditor.behavior.fixture.ts", import.meta.url),
          ),
          scenario,
        ],
        { encoding: "utf8", timeout: 20000 },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    },
    25000,
  );
}
