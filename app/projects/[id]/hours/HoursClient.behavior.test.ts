import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const [scenario, description] of [
  [
    "legacy",
    "legacy null-type awards retain credit and offer correction instead of new attendance",
  ],
  ["verified", "canonical awards use credited minutes and offer correction"],
  [
    "self-reported",
    "self-reported certificates do not imply a published platform award",
  ],
  ["past", "ended sessions can publish completed attendance"],
  ["future", "future sessions explain why publication is disabled"],
  ["missing-window", "unresolvable sessions cannot offer publication"],
]) {
  test(
    description,
    () => {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("./HoursClient.behavior.fixture.tsx", import.meta.url),
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
