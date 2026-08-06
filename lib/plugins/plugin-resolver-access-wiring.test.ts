import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function exportedFunctionSource(fileSource: string, name: string): string {
  const start = fileSource.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`Missing exported function ${name}`);
  const nextExport = fileSource.indexOf("\nexport ", start + 1);
  return fileSource.slice(start, nextExport < 0 ? undefined : nextExport);
}

describe("plugin contribution access wiring", () => {
  const cases = [
    {
      label: "behaviors",
      path: "lib/plugins/resolve-plugin-behaviors.ts",
      functionName: "resolveOrganizationPluginBehaviorHook",
    },
    {
      label: "surfaces",
      path: "lib/plugins/resolve-plugin-surfaces.ts",
      functionName: "resolveOrganizationPluginSurfaces",
    },
    {
      label: "experiences",
      path: "lib/plugins/resolve-org-plugins.ts",
      functionName: "resolveOrganizationPluginExperiences",
    },
  ];

  for (const resolver of cases) {
    test(`${resolver.label} use canonical fail-closed plugin access`, () => {
      const fileSource = source(resolver.path);
      const functionSource = exportedFunctionSource(
        fileSource,
        resolver.functionName,
      );

      expect(fileSource).toContain("loadAccessibleOrganizationPluginAccess");
      expect(functionSource).toContain(
        "loadAccessibleOrganizationPluginAccess({",
      );
      expect(functionSource).not.toContain(
        '.from("organization_plugin_installs")',
      );
    });
  }
});
