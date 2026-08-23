import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("plugin admin console", () => {
  it("starts with an operator overview and keeps recovery controls separate", () => {
    const controlPlane = read("app/admin/plugins/PluginControlPlane.tsx");
    const overview = read("app/admin/plugins/PluginOverview.tsx");

    expect(controlPlane).toContain('useState("overview")');
    expect(controlPlane).toContain('value="advanced"');
    expect(overview).toContain("Microfrontend app");
    expect(overview).toContain("Manage access, installed versions, runtimes");
    expect(overview).not.toContain("How a release moves");
  });

  it("keeps handwritten plugin console modules within the component limit", () => {
    const modules = [
      "PluginControlPlane.tsx",
      "PluginOverview.tsx",
      "PluginAccessControls.tsx",
      "PluginAdvancedControls.tsx",
      "PluginDataBoundaries.tsx",
      "PluginDetails.tsx",
    ];

    for (const filename of modules) {
      const lines = read(`app/admin/plugins/${filename}`).split("\n").length;
      expect(lines, `${filename} has ${lines} lines`).toBeLessThanOrEqual(600);
    }
  });

  it("links the local plugin workflow from the documentation index", () => {
    expect(read("docs/README.md")).toContain("plugin-quickstart.md");
    expect(read("docs/development/plugin-quickstart.md")).toContain(
      "## Work on a plugin with another coding agent",
    );
  });
});
