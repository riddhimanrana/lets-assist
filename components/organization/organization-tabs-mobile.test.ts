import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const controllerSource = readFileSync(
  new URL("./OrganizationTabs.tsx", import.meta.url),
  "utf8",
);
const navigationSource = readFileSync(
  new URL("./OrganizationTabsNavigation.tsx", import.meta.url),
  "utf8",
);
const source = `${controllerSource}\n${navigationSource}`;

describe("organization navigation on phones", () => {
  test("every organization with more than one destination gets the section switcher", () => {
    expect(navigationSource).toContain(
      "const usesPhoneSwitcher = switcherDestinations.length > 1;",
    );
    expect(source).toContain('data-testid="organization-section-switcher"');
    // The compact chrome flag no longer decides page navigation.
    expect(source).not.toContain("usesFullSectionMobileNav");
    expect(source).not.toContain("usesLineTabs");
  });

  test("hides the category strip and More menu on phones when the switcher shows", () => {
    expect(navigationSource).toContain('usesPhoneSwitcher && "hidden sm:flex"');
    expect(navigationSource).toContain(
      'usesPhoneSwitcher && "hidden sm:inline-flex"',
    );
    expect(navigationSource).toContain("{usesPhoneSwitcher ? (");
  });

  test("keeps every permitted destination reachable from one phone switcher", () => {
    expect(source).toContain(
      "const { workspaceDestinations, utilityDestinations, switcherDestinations } =",
    );
    expect(source).toContain(
      "{workspaceDestinations.map(renderSectionSwitcherItem)}",
    );
    expect(source).toContain(
      "{utilityDestinations.map(renderSectionSwitcherItem)}",
    );
  });

  test("deduplicates overlapping destinations before rendering switcher keys", () => {
    expect(source).toContain(
      "buildNavigationDestinationGroups(\n      workspaceCandidateDestinations,\n      utilityCandidateDestinations,\n    );",
    );
    expect(source).toContain('from "./organization-navigation-destinations"');
  });

  test("labels workspace and administration groups inside the switcher", () => {
    expect(source).toContain(
      "<DropdownMenuLabel>{sectionGroupLabel}</DropdownMenuLabel>",
    );
    expect(source).toContain(
      "<DropdownMenuLabel>{utilityGroupLabel}</DropdownMenuLabel>",
    );
    expect(source).toContain(
      'pluginNavigationOverrides.sectionMenuLabel ?? "Workspace"',
    );
    expect(source).toContain(
      'pluginNavigationOverrides.utilityMenuGroupLabel ?? "Administration"',
    );
  });

  test("closed trigger names the current destination without claiming to be a navigation item", () => {
    expect(source).toContain("aria-label={`${activeDestinationLabel}");
    expect(source).toContain(
      '<span className="truncate">{activeDestinationLabel}</span>',
    );
    // aria-current belongs to the selected menu item, never to the disclosure
    // trigger, so no element may carry it unconditionally.
    expect(source).not.toContain('aria-current="page"');
  });

  test("names the parent destination for subnavigation housed under More", () => {
    expect(source).toContain(
      "const activeDestination = findActiveNavigationDestination(",
    );
    expect(source).toContain("activePluginParentValue,");
    expect(source).toContain(
      "const activeDestinationLabel = activeDestination?.label ?? sectionGroupLabel;",
    );
  });

  // Menu items only render once the menu opens, so static markup cannot show
  // them. This pins the class; real target size is a browser measurement.
  test("gives phone switcher entries 44px touch targets", () => {
    expect(controllerSource).toContain('className="min-h-11 justify-between"');
  });

  test("marks the selected switcher entry as the current page", () => {
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
  });

  test("gives the desktop More menu the same selected treatment for an active child's parent", () => {
    expect(source).toContain(
      "const activeMoreTab = morePluginTabs.find((tab) =>\n    isNavigationValueActive(tab.value, activeTab, activePluginParentValue),\n  );",
    );
    expect(source).toMatch(
      /const isActive = isNavigationValueActive\(\s*pt\.value,\s*activeTab,\s*activePluginParentValue,?\s*\);/u,
    );
    expect(source).toContain(
      '{isActive ? <Check aria-hidden="true" /> : null}',
    );
    // The old direct-only comparison must not linger in the utility menu.
    expect(source).not.toContain("{pt.value === activeTab ? <Check");
  });

  test("derives destinations only from server-filtered navigation inputs", () => {
    expect(source).toContain("...primaryPluginTabs.map((tab) => ({");
    expect(source).toMatch(
      /const utilityCandidateDestinations: OrganizationNavigationDestination\[\] =\s*morePluginTabs\.map\(\(tab\) => \(\{/u,
    );
    expect(source).toContain("...visiblePluginRouteTabs.map((tab) => ({");
    // No plugin-specific destinations may be hardcoded in host navigation.
    expect(source).not.toContain("csf-");
  });

  test("renders the tab strip from the same destinations as the switcher", () => {
    expect(navigationSource).toContain(
      "{workspaceDestinations.map((destination) => {",
    );
    expect(navigationSource).toContain("value={destination.value}");
    // No core tab is hand-written beside the destination list any more.
    for (const coreTab of ["overview", "members", "projects", "reports"]) {
      expect(navigationSource).not.toContain(`value="${coreTab}"`);
    }
    // Entity sections use page-level line tabs; the phone switcher shares
    // their destination list and active parent semantics.
    expect(navigationSource).toContain('variant="line"');
  });

  test("retires the competing mobile overflow strip", () => {
    expect(source).not.toContain("compactMobileOverflowTabs");
    expect(source).not.toContain(
      "index >= 2 && pluginNavigationOverrides.compactHeader",
    );
  });

  test("renders the More menu only when utility destinations exist", () => {
    expect(source).toContain("{morePluginTabs.length > 0 ? (");
    expect(source).not.toContain('morePluginTabs.length === 0 && "sm:hidden"');
  });

  test("uses one line tab strip for every organization", () => {
    expect(navigationSource.match(/<TabsList\b/gu)?.length).toBe(1);
    expect(navigationSource).toContain('variant="line"');
  });
});
