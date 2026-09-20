import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const [scenario, description] of [
  [
    "canonical",
    "public certificate props retain canonical minutes and exclude private fields",
  ],
  [
    "legacy",
    "legacy certificate props retain historical duration without internal identifiers",
  ],
  [
    "self-reported",
    "self-reported display retains its snapshot with the same private-data boundary",
  ],
]) {
  test(
    description,
    () => {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("./public-projection.fixture.ts", import.meta.url),
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
