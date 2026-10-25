import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Tabs } from "@/components/ui/tabs";

import { OrganizationTabsNavigation } from "./OrganizationTabsNavigation";
import type { OrganizationNavigationDestination } from "./organization-navigation-destinations";

const workspaceDestinations: OrganizationNavigationDestination[] = [
  { value: "overview", label: "Overview" },
  { value: "members", label: "Members" },
  { value: "projects", label: "Projects" },
];

function navigation({
  activeTab,
  activePluginParentValue,
  compact = false,
}: {
  activeTab: string;
  activePluginParentValue?: string;
  compact?: boolean;
}) {
  return renderToStaticMarkup(
    <Tabs value={activeTab}>
      <OrganizationTabsNavigation
        usesFullSectionMobileNav={compact}
        switcherDestinations={workspaceDestinations}
        workspaceDestinations={workspaceDestinations}
        utilityDestinations={[]}
        activeDestination={workspaceDestinations.find(
          (destination) =>
            destination.value === (activePluginParentValue ?? activeTab),
        )}
        activeDestinationLabel="Members"
        sectionGroupLabel="Workspace"
        utilityGroupLabel="Administration"
        renderSectionSwitcherItem={() => null}
        pluginNavigationOverrides={compact ? { compactHeader: true } : {}}
        activePluginParentValue={activePluginParentValue}
        morePluginTabs={[]}
        hasActiveMoreTab={false}
        activeTab={activeTab}
        getTabHref={(value) => `?tab=${value}`}
        fullDocumentTabNavigation={false}
      />
    </Tabs>,
  );
}

const count = (html: string, pattern: RegExp) =>
  (html.match(pattern) ?? []).length;

/**
 * How many elements carry exactly this class. The Tabs primitive ships
 * variant-prefixed forms of several classes on every trigger, and
 * `border-border` contains `border-b`, so a substring match proves nothing.
 */
const classCount = (html: string, token: string) =>
  [...html.matchAll(/class="([^"]*)"/gu)]
    .flatMap((match) => match[1].split(/\s+/u))
    .filter((className) => className === token).length;

describe("organization tab strip", () => {
  test("a generic organization gets line tabs with one selected", () => {
    const html = navigation({ activeTab: "members" });
    expect(html).toContain('data-variant="line"');
    expect(html).not.toContain('data-variant="default"');
    // The row carries the hairline the underline sits on.
    expect(classCount(html, "border-b")).toBe(1);
    expect(classCount(html, "focus-visible:ring-inset")).toBe(3);
    expect(count(html, /role="tab"/gu)).toBe(3);
    for (const label of ["Overview", "Members", "Projects"]) {
      expect(html).toContain(label);
    }
    expect(count(html, /aria-selected="true"/gu)).toBe(1);
    // A directly selected tab is announced by aria-selected alone.
    expect(html).not.toContain("aria-current");
  });

  test("marks the parent tab current while one of its child tabs is active", () => {
    const html = navigation({
      activeTab: "member-detail",
      activePluginParentValue: "members",
    });
    expect(count(html, /aria-current="page"/gu)).toBe(1);
    expect(count(html, /aria-selected="true"/gu)).toBe(0);
    // Underlined like the active tab, not raised.
    expect(classCount(html, "after:opacity-100")).toBe(1);
    expect(classCount(html, "shadow-sm")).toBe(0);
  });

  test("generic organizations get no phone switcher", () => {
    const html = navigation({ activeTab: "overview" });
    expect(html).not.toContain("organization-section-switcher");
  });

  test("compact workspaces add the phone switcher beside the same strip", () => {
    const html = navigation({ activeTab: "members", compact: true });
    expect(count(html, /data-testid="organization-section-switcher"/gu)).toBe(
      1,
    );
    expect(html).toContain('aria-label="Members — change section"');
    expect(count(html, /role="tab"/gu)).toBe(3);
  });

  test("a compact workspace keeps its segmented switch", () => {
    const html = navigation({ activeTab: "members", compact: true });
    expect(html).toContain('data-variant="default"');
    expect(html).not.toContain('data-variant="line"');
    expect(count(html, /aria-selected="true"/gu)).toBe(1);
    // No line-strip chrome leaks onto the workspace sheet.
    expect(classCount(html, "border-b")).toBe(0);
    expect(classCount(html, "focus-visible:ring-inset")).toBe(0);
    expect(classCount(html, "rounded-none")).toBe(0);
    expect(classCount(html, "mb-3")).toBe(1);
  });

  test("a compact workspace raises the parent of an active child tab", () => {
    const html = navigation({
      activeTab: "member-detail",
      activePluginParentValue: "members",
      compact: true,
    });
    expect(count(html, /aria-current="page"/gu)).toBe(1);
    // Raised like the active pill, not underlined.
    expect(classCount(html, "shadow-sm")).toBe(1);
    expect(classCount(html, "after:opacity-100")).toBe(0);
  });
});
