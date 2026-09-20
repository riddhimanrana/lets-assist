import { describe, expect, test } from "bun:test";

import { requiresFullValidation } from "./classify-change.mjs";

describe("CI change classification", () => {
  test("ordinary documentation changes skip the isolated database and browser gate", () => {
    expect(
      requiresFullValidation([
        "README.md",
        "docs/development/testing.md",
        "docs/csf/operator-guide.mdx",
      ]),
    ).toBe(false);
  });

  test("source, workflow, agent, deletion paths, and non-text evidence keep the full gate", () => {
    for (const path of [
      "app/page.tsx",
      "app/deleted-route/page.tsx",
      ".github/workflows/ci.yml",
      "AGENTS.md",
      ".github/copilot-instructions.md",
      "docs/csf/evidence/screenshot.png",
      "supabase/migrations/20260920080000_example.sql",
    ]) {
      expect(requiresFullValidation([path])).toBe(true);
    }
  });

  test("empty or unknown input fails closed", () => {
    expect(requiresFullValidation([])).toBe(true);
  });
});
