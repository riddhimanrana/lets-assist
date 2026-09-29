import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const [scenario, description] of [
  [
    "oneTime-alias",
    "saved one-time alias retries its existing batch and preserves its session ID",
  ],
  [
    "multiDay-alias",
    "saved multi-day alias retries its existing batch and preserves its session ID",
  ],
  [
    "role-alias",
    "saved role alias retries its existing batch and preserves its session ID",
  ],
  [
    "draft",
    "saved draft retries the same batch without uploading or registering photos",
  ],
  [
    "failed",
    "saved failed scan offers an enabled retry and opens recovered review",
  ],
  [
    "lost-response",
    "lost retry response recovers the saved batch without deleting photos",
  ],
  [
    "refused",
    "failed retry refreshes durable state and retains registered photos",
  ],
  ["empty", "batch without saved photos still offers photo capture"],
  [
    "different-slot",
    "changing sessions cannot retry a batch from another session",
  ],
  [
    "extracting",
    "in-progress scans retain progress recovery instead of another retry",
  ],
]) {
  test(
    description,
    () => {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("./CaptureStep.behavior.fixture.tsx", import.meta.url),
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
