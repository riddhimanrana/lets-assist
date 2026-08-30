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

  test("keeps the current tab rendered until navigation supplies the next payload", () => {
    const organizationTabs = readFileSync(
      new URL("./OrganizationTabs.tsx", import.meta.url),
      "utf8",
    );
    const handleTabChange = organizationTabs.match(
      /const handleTabChange = \(value: string\) => \{([\s\S]*?)\n {2}\};/u,
    )?.[1];

    expect(handleTabChange).toBeDefined();
    expect(handleTabChange).not.toContain("setActiveTab(canonicalValue)");
    expect(handleTabChange).toContain("router.replace");
  });

  test("lets data-heavy plugins release prior route trees with document navigation", () => {
    const organizationTabs = readFileSync(
      new URL("./OrganizationTabs.tsx", import.meta.url),
      "utf8",
    );
    const organizationNavigation = readFileSync(
      new URL("./OrganizationTabsNavigation.tsx", import.meta.url),
      "utf8",
    );

    expect(organizationTabs).toContain(
      "pluginNavigationOverrides.fullDocumentTabNavigation",
    );
    expect(organizationTabs).toContain("navigateWithFullDocument(nextHref)");
    expect(organizationTabs).toContain(
      "data-organization-tabs-hydrated={navigationHydrated}",
    );
    expect(organizationNavigation).toContain(
      "fullDocumentTabNavigation ? <a href={href} /> : <Link href={href} />",
    );
  });
});
