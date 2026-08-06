import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SERVER_ACTION_BARRELS = [
  "app/admin/actions.ts",
  "app/admin/moderation/actions.ts",
  "app/admin/plugins/actions.ts",
  "app/attend/[projectId]/actions.ts",
  "app/organization/[id]/admin/actions.ts",
  "app/organization/[id]/reports/sheets-actions.ts",
  "app/organization/[id]/settings/actions.ts",
  "app/projects/[id]/actions.ts",
  "app/projects/create/actions.ts",
] as const;

describe("server action compatibility barrels", () => {
  test("remain neutral re-export surfaces for Next.js compilation", () => {
    for (const path of SERVER_ACTION_BARRELS) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source, path).not.toContain('"use server"');
      expect(source, path).toMatch(/^export\s/u);
      expect(source, path).not.toMatch(/export\s+async\s+function/u);
    }
  });

  test("target only file-level Server Action modules", () => {
    const actionModules = new Set<string>();

    for (const barrelPath of SERVER_ACTION_BARRELS) {
      const source = readFileSync(join(process.cwd(), barrelPath), "utf8");
      for (const match of source.matchAll(
        /export(?:\s+type)?\s*\{[\s\S]*?\}\s*from\s*"([^"]+)";/gu,
      )) {
        if (!match[0].startsWith("export type")) {
          actionModules.add(join(dirname(barrelPath), `${match[1]}.ts`));
        }
      }
    }

    expect(actionModules.size).toBeGreaterThan(0);
    for (const path of actionModules) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source, path).toMatch(/^"use server";/u);
      expect(source, path).not.toMatch(
        /export\s+(?:const|let|var|class|enum|function|default)\b/u,
      );
    }
  });
});
