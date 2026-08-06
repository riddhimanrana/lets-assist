import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("participant attendance action modules", () => {
  test("the compatibility barrel preserves all four public actions", () => {
    const barrel = read("app/attend/[projectId]/actions.ts");
    for (const actionName of [
      "checkInAnonymous",
      "checkInUser",
      "lookupEmailStatus",
      "checkOutUser",
    ]) {
      expect(barrel).toContain(actionName);
    }
    expect(barrel).not.toMatch(/getAdminClient|\.from\(/u);
  });

  test("the focused action modules meet the service budget", () => {
    for (const path of [
      "app/attend/[projectId]/server/check-in.ts",
      "app/attend/[projectId]/server/checkout.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });

  test("public implementations retain explicit Server Action boundaries", () => {
    const source = [
      read("app/attend/[projectId]/server/check-in.ts"),
      read("app/attend/[projectId]/server/checkout.ts"),
    ].join("\n");
    for (const actionName of [
      "checkInAnonymous",
      "checkInUser",
      "lookupEmailStatus",
      "checkOutUser",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `export async function ${actionName}\\([\\s\\S]*?\\{\\n  "use server";`,
          "u",
        ),
      );
    }
  });
});
