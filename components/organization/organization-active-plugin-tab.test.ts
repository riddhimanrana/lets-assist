import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const organizationPage = readFileSync(
  new URL("../../app/organization/[id]/page.tsx", import.meta.url),
  "utf8",
);

describe("organization plugin tab server rendering", () => {
  test("sends server content only for the active embedded plugin tab", () => {
    expect(organizationPage).toMatch(
      /projectActiveOrganizationPluginTabs\(\s*pluginTabs,\s*activeEmbeddedTab,?\s*\)/u,
    );
    expect(organizationPage).not.toContain("pluginTabs={pluginTabs}");
  });
});
