import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./OrganizationTabs.tsx", import.meta.url),
  "utf8",
);

describe("compact organization navigation on phones", () => {
  test("opts into the full-section switcher through existing navigation metadata", () => {
    expect(source).toContain(
      "const usesFullSectionMobileNav = Boolean(pluginNavigationOverrides.compactHeader);",
    );
    expect(source).toContain('data-testid="organization-section-switcher"');
  });

  test("hides the horizontal category strip on phones in full-section mode", () => {
    expect(source).toContain('usesFullSectionMobileNav && "hidden sm:flex"');
    expect(source).toContain(
      "usesFullSectionMobileNav && switcherDestinations.length > 0 ? (",
    );
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

  test("marks the selected switcher entry as the current page", () => {
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
  });

  test("gives the desktop More menu the same selected treatment for an active child's parent", () => {
    expect(source).toContain(
      "const activeMoreTab = morePluginTabs.find((tab) =>\n    isNavigationValueActive(tab.value, activeTab, activePluginParentValue),\n  );",
    );
    expect(source).toContain(
      "const isActive = isNavigationValueActive(\n                    pt.value,\n                    activeTab,\n                    activePluginParentValue,\n                  );",
    );
    expect(source).toContain(
      '{isActive ? <Check aria-hidden="true" /> : null}',
    );
    // The old direct-only comparison must not linger in the utility menu.
    expect(source).not.toContain("{pt.value === activeTab ? <Check");
  });

  test("derives destinations only from server-filtered navigation inputs", () => {
    expect(source).toContain("...primaryPluginTabs.map((tab) => ({");
    expect(source).toContain(
      "const utilityCandidateDestinations: OrganizationNavigationDestination[] = morePluginTabs.map((tab) => ({",
    );
    expect(source).toContain("...visiblePluginRouteTabs.map((tab) => ({");
    // No plugin-specific destinations may be hardcoded in host navigation.
    expect(source).not.toContain("csf-");
  });

  test("retires the competing mobile overflow strip", () => {
    expect(source).not.toContain("compactMobileOverflowTabs");
    expect(source).not.toContain(
      "index >= 2 && pluginNavigationOverrides.compactHeader",
    );
  });

  test("preserves generic organization navigation at every width", () => {
    expect(source).toContain("{morePluginTabs.length > 0 ? (");
    expect(source).toContain(
      'cn("shrink-0", usesFullSectionMobileNav && "hidden sm:flex")',
    );
    expect(source).not.toContain('morePluginTabs.length === 0 && "sm:hidden"');
  });
});
