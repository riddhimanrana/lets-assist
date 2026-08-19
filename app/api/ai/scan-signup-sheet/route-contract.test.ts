import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

describe("paper signup scan route module", () => {
  test("exports only supported Next.js route fields", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    const exportedValues = [
      ...source.matchAll(
        /^export\s+(?:async\s+)?(?:const|function)\s+([A-Za-z_$][\w$]*)/gmu,
      ),
    ]
      .map((match) => match[1])
      .sort();

    expect(exportedValues).toEqual(["POST", "dynamic", "maxDuration"]);
  });
});
