import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SIGNED_WAIVER_RETENTION_DAYS,
  SIGNED_WAIVER_RETENTION_NOTICE,
} from "./retention";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("signed waiver retention", () => {
  test("the notice states the period the cleanup job applies", () => {
    expect(SIGNED_WAIVER_RETENTION_DAYS).toBe(30);
    expect(SIGNED_WAIVER_RETENTION_NOTICE).toBe(
      "Signed waivers are deleted 30 days after the project's last session ends, or 30 days after it is cancelled. Download any you need to keep before then.",
    );
  });

  test("the cleanup job takes its cutoff from the same constant", () => {
    const route = read("app/api/cron/waiver-cleanup/route.ts");

    expect(route).toContain(
      "cutoffDate.setDate(cutoffDate.getDate() - SIGNED_WAIVER_RETENTION_DAYS);",
    );
    expect(route).not.toMatch(/getDate\(\) - \d/u);
  });

  test("organizers see the notice wherever a waiver is required", () => {
    for (const path of [
      "app/projects/create/SettingsWaiver.tsx",
      "app/projects/[id]/edit/EditProjectWaiver.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("{SIGNED_WAIVER_RETENTION_NOTICE}");
      // The copy comes from the constant, never a second hand-written number.
      expect(source).not.toMatch(/\d+ days/u);
    }
  });

  test("the edit page no longer promises a waiver the project does not have", () => {
    const source = read("app/projects/[id]/edit/EditProjectWaiver.tsx");

    expect(source).not.toMatch(/global waiver/iu);
    expect(source).not.toMatch(/default Let.{1,6}s Assist waiver/iu);
  });
});
