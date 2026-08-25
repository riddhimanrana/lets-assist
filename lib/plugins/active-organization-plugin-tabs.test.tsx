import { describe, expect, test } from "bun:test";
import {
  projectActiveOrganizationPluginTabs,
  resolveActiveOrganizationTab,
} from "./active-organization-plugin-tabs";

describe("active organization plugin tabs", () => {
  test("resolves aliases without rendering the aliased tab twice", () => {
    expect(
      resolveActiveOrganizationTab({
        requestedTab: "legacy-imports",
        defaultTab: "home",
        aliases: { "legacy-imports": "classes" },
      }),
    ).toBe("classes");
  });

  test("retains navigation descriptors but strips inactive server content", () => {
    const home = <div>home server content</div>;
    const classes = <div>classes server content</div>;
    const projected = projectActiveOrganizationPluginTabs(
      [
        { value: "home", label: "Home", content: home },
        { value: "classes", label: "Classes", content: classes },
      ],
      "classes",
    );

    expect(projected).toEqual([
      { value: "home", label: "Home", content: null },
      { value: "classes", label: "Classes", content: classes },
    ]);
  });
});
