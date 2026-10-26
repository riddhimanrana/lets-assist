import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("Vercel consumes its token before forwarding native curl flags", () => {
  const dir = mkdtempSync(join(tmpdir(), "vercel-curl-fixture-"));
  try {
    writeFileSync(join(dir, "bunx"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
      mode: 0o755,
    });
    const args = [
      "/maintenance-health.txt",
      "--deployment=https://fixture.vercel.app",
      "--yes",
      "--",
      "--connect-timeout",
      "10",
      "--max-time",
      "30",
    ];
    const result = spawnSync(
      "bash",
      [new URL("./vercel-curl.sh", import.meta.url).pathname, ...args],
      {
        encoding: "utf8",
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          VERCEL_TOKEN: "fixture-token",
        },
      },
    );
    assert.equal(result.status, 0);
    assert.deepEqual(result.stdout.trim().split("\n"), [
      "vercel@59.3.0",
      "--token=fixture-token",
      "curl",
      ...args,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
