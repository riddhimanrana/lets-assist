import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const actionModulePaths = [
  "app/admin/moderation/server/queues.ts",
  "app/admin/moderation/server/reports.ts",
  "app/admin/moderation/server/ai-review-actions.ts",
  "app/admin/moderation/server/enforcement.ts",
] as const;

describe("moderation action modules", () => {
  test("the compatibility barrel preserves the public action surface", () => {
    const barrel = read("app/admin/moderation/actions.ts");
    const exportedNames = Array.from(
      barrel.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]+),?$/gmu),
      (match) => match[1],
    ).sort();

    expect(exportedNames).toEqual(
      [
        "applyAiRecommendationForReport",
        "getContentReports",
        "getContentReportsStats",
        "getDetailedReportWithContext",
        "getFlaggedContent",
        "getModerationStats",
        "getRepeatOffenders",
        "getUserModerationLogs",
        "runAiReviewForProject",
        "runAiReviewForReport",
        "runAiScan",
        "sendReportFeedback",
        "takeFlaggedContentAction",
        "takeModeratorAction",
        "updateContentReportStatus",
        "updateFlaggedContentStatus",
      ].sort(),
    );
    expect(barrel).not.toMatch(/getAdminClient|\.from\(/u);
  });

  test("focused action modules stay within the service budget", () => {
    for (const path of actionModulePaths) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });

  test("all public implementations retain explicit Server Action boundaries", () => {
    const source = actionModulePaths.map(read).join("\n");
    const publicNames = [
      "applyAiRecommendationForReport",
      "getContentReports",
      "getContentReportsStats",
      "getDetailedReportWithContext",
      "getFlaggedContent",
      "getModerationStats",
      "getRepeatOffenders",
      "getUserModerationLogs",
      "runAiReviewForProject",
      "runAiReviewForReport",
      "runAiScan",
      "sendReportFeedback",
      "takeFlaggedContentAction",
      "takeModeratorAction",
      "updateContentReportStatus",
      "updateFlaggedContentStatus",
    ];

    for (const name of publicNames) {
      expect(source).toMatch(
        new RegExp(
          `export async function ${name}\\([\\s\\S]*?\\{\\n  "use server";`,
          "u",
        ),
      );
    }
  });

  test("notification and removal helpers are not exported by the action barrel", () => {
    const barrel = read("app/admin/moderation/actions.ts");
    expect(barrel).not.toContain("notifyContentOwnerOfModeration");
    expect(barrel).not.toContain("notifyReporterOfReportUpdate");
    expect(barrel).not.toContain("softRemoveContent");
  });
});
