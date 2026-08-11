import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("project creation action modules", () => {
  test("the compatibility barrel preserves creation, asset, and draft actions", () => {
    const barrel = read("app/projects/create/actions.ts");
    for (const actionName of [
      "autoSaveDraft",
      "checkProfanity",
      "createBasicProject",
      "createProject",
      "deleteDraft",
      "finalizeProject",
      "getProjectById",
      "linkProjectUploadedAssets",
      "publishDraft",
      "saveProjectAsDraft",
      "saveProjectAsNewDraft",
      "updateDraft",
      "uploadCoverImage",
      "uploadProjectDocument",
      "uploadWaiverPdf",
    ]) {
      expect(barrel).toContain(actionName);
    }
    expect(barrel).not.toMatch(/createClient|\.from\(/u);
  });

  test("all focused action modules meet the service budget", () => {
    for (const path of [
      "app/projects/create/server/create.ts",
      "app/projects/create/server/assets.ts",
      "app/projects/create/server/drafts.ts",
      "app/projects/create/server/validation.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });
});
