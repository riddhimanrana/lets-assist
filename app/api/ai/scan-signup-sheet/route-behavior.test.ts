import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Isolate module mocks from the root suite's other provider and auth tests.
for (const [scenario, description] of [
  [
    "large-roster",
    "roster and guest candidates past 1000 rows remain available",
  ],
  [
    "printed-batch",
    "300 printed rows authorize once and reuse batched reference lookups",
  ],
  [
    "printed-without-candidate",
    "validated printed signup wins independently of fuzzy candidate presence",
  ],
  [
    "extraction-lease",
    "active claims refuse retry and expired claims safely replace partial staging",
  ],
  [
    "blank-sheet",
    "blank sheets fail with a retryable attendance-specific message",
  ],
  [
    "repeated-visits",
    "repeated visits preserve breaks and leave ambiguous times unresolved",
  ],
  ["unreadable", "unreadable photos fail safely and retry without reupload"],
  [
    "provider-failure",
    "provider failures preserve photos without attendance or credit",
  ],
  [
    "duplicate",
    "duplicate photos require review and reused batches cannot duplicate staging",
  ],
  ["partial-retry", "failed settlement retries replace partial staging"],
  [
    "separate-pages",
    "separate sign-in and sign-out pages retain missing times and original sources",
  ],
  [
    "partial-photo",
    "readable photos reach review while unreadable sources remain with warnings",
  ],
]) {
  test(
    description,
    () => {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("./route-behavior.fixture.ts", import.meta.url),
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
