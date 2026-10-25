import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("resumed alias batches retain capture, retry context, and canonical publication state", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./PaperSignupsClient.aliases.fixture.tsx", import.meta.url),
      ),
    ],
    { encoding: "utf8", timeout: 20000 },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}, 25000);
