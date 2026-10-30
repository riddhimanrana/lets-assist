import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Tabs } from "@/components/ui/tabs";
import type { OrganizationTabBehavior } from "@/types";

import { OrganizationTabsNavigation } from "./OrganizationTabsNavigation";
import type { OrganizationNavigationDestination } from "./organization-navigation-destinations";

const workspaceDestinations: OrganizationNavigationDestination[] = [
  { value: "overview", label: "Overview" },
  { value: "members", label: "Members" },
  { value: "projects", label: "Projects" },
];

const meetings: OrganizationTabBehavior = {
  value: "meetings",
  label: "Meetings",
  icon: <svg data-testid="meetings-icon" />,
  navigationSection: "more",
  content: null,
};
const settings: OrganizationTabBehavior = {
  value: "settings",
  label: "Settings",
  navigationSection: "more",
  content: null,
};

function navigation({
  activeTab,
  activePluginParentValue,
  compact = false,
  destinations = workspaceDestinations,
  moreTabs = [],
}: {
  activeTab: string;
  activePluginParentValue?: string;
  compact?: boolean;
  destinations?: OrganizationNavigationDestination[];
  moreTabs?: OrganizationTabBehavior[];
}) {
  const utilityDestinations = moreTabs.map(({ value, label, icon }) => ({
    value,
    label,
    icon,
  }));
  const switcherDestinations = [...destinations, ...utilityDestinations];
  const activeValue = activePluginParentValue ?? activeTab;
  const activeDestination =
    switcherDestinations.find((d) => d.value === activeTab) ??
    switcherDestinations.find((d) => d.value === activeValue);
  const activeMoreTab = moreTabs.find(
    (tab) => tab.value === activeTab || tab.value === activePluginParentValue,
  );

  return renderToStaticMarkup(
    <Tabs value={activeTab}>
      <OrganizationTabsNavigation
        switcherDestinations={switcherDestinations}
        workspaceDestinations={destinations}
        utilityDestinations={utilityDestinations}
        activeDestination={activeDestination}
        activeDestinationLabel={activeDestination?.label ?? "Workspace"}
        sectionGroupLabel="Workspace"
        utilityGroupLabel="Administration"
        renderSectionSwitcherItem={() => null}
        pluginNavigationOverrides={
          compact ? { compactHeader: true, utilityMenuLabel: "More" } : {}
        }
        activePluginParentValue={activePluginParentValue}
        morePluginTabs={moreTabs}
        activeMoreTab={activeMoreTab}
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

/** The opening tag of the first element carrying this attribute. */
const elementWith = (html: string, attribute: string) =>
  html.match(new RegExp(`<[^>]*${attribute}[^>]*>`, "u"))?.[0] ?? "";

/** The utility menu trigger: the menu button that is not the phone switcher. */
const moreTrigger = (html: string) =>
  [
    ...html.matchAll(
      /<button[^>]*aria-haspopup="menu"[^>]*>[\s\S]*?<\/button>/gu,
    ),
  ]
    .map((match) => match[0])
    .find((button) => !button.includes("organization-section-switcher")) ?? "";

describe("organization page navigation", () => {
  for (const compact of [false, true]) {
    const kind = compact ? "compact plugin workspace" : "generic organization";

    test(`a ${kind} gets line tabs with one selected`, () => {
      const html = navigation({ activeTab: "members", compact });
      expect(html).toContain('data-variant="line"');
      expect(html).not.toContain('data-variant="default"');
      expect(count(html, /role="tab"/gu)).toBe(3);
      for (const label of ["Overview", "Members", "Projects"]) {
        expect(html).toContain(label);
      }
      expect(count(html, /aria-selected="true"/gu)).toBe(1);
      // A directly selected tab is announced by aria-selected alone.
      expect(html).not.toContain("aria-current");
      // The strip shares one hairline with its row from tablet width up.
      expect(classCount(html, "sm:border-b")).toBe(1);
      expect(classCount(html, "focus-visible:ring-inset")).toBe(3);
    });

    test(`a ${kind} swaps the strip for one section switcher on phones`, () => {
      const html = navigation({ activeTab: "members", compact });
      const switcher = elementWith(
        html,
        'data-testid="organization-section-switcher"',
      );
      expect(count(html, /data-testid="organization-section-switcher"/gu)).toBe(
        1,
      );
      expect(switcher).toContain('aria-label="Members, change section"');
      expect(switcher).not.toContain("—");
      expect(switcher).toContain("sm:hidden");
      // A 44px phone touch target replaces the button's default h-9.
      const names = /class="([^"]*)"/u.exec(switcher)?.[1].split(/\s+/u);
      expect(names).toContain("h-11");
      expect(names).not.toContain("h-9");
      // Disclosure only: the selected menu item owns aria-current.
      expect(switcher).not.toContain("aria-current");
      const strip = elementWith(html, 'role="tablist"');
      expect(strip).toContain("hidden");
      expect(strip).toContain("sm:flex");
    });

    test(`a ${kind} underlines the parent of an active child tab`, () => {
      const html = navigation({
        activeTab: "member-detail",
        activePluginParentValue: "members",
        compact,
      });
      expect(count(html, /aria-current="page"/gu)).toBe(1);
      expect(count(html, /aria-selected="true"/gu)).toBe(0);
      expect(classCount(html, "after:opacity-100")).toBe(1);
      expect(classCount(html, "shadow-sm")).toBe(0);
      expect(html).toContain('aria-label="Members, change section"');
    });
  }

  test("a single destination keeps its tab and skips the switcher", () => {
    const html = navigation({
      activeTab: "overview",
      destinations: [{ value: "overview", label: "Overview" }],
    });
    expect(html).not.toContain("organization-section-switcher");
    const strip = elementWith(html, 'role="tablist"');
    expect(strip).not.toMatch(/(^|\s|")hidden(\s|")/u);
    expect(classCount(html, "border-b")).toBe(1);
  });

  test("the closed More trigger reads More while a workspace tab is open", () => {
    const html = navigation({
      activeTab: "overview",
      compact: true,
      moreTabs: [meetings, settings],
    });
    const trigger = moreTrigger(html);
    expect(trigger).toContain(">More<");
    expect(trigger).not.toContain("Meetings");
    expect(trigger).not.toContain("data-active");
    // Hidden on phones, where the switcher already lists every utility.
    expect(trigger).toContain("sm:inline-flex");
    expect(trigger).toContain("rounded-none");
  });

  test("the closed More trigger names an open utility page with its icon", () => {
    const html = navigation({
      activeTab: "meetings",
      compact: true,
      moreTabs: [meetings, settings],
    });
    const trigger = moreTrigger(html);
    expect(trigger).toContain("data-active");
    expect(trigger).toContain('data-testid="meetings-icon"');
    expect(trigger).toContain('<span class="truncate">Meetings</span>');
    // Screen readers hear "More: Meetings"; the visible label stays in the name.
    expect(trigger).toContain('<span class="sr-only">More: </span>');
    expect(trigger).toContain("after:opacity-100");
    expect(trigger).not.toContain("aria-current");
    // No workspace tab claims the page while a utility page is open.
    expect(count(html, /aria-selected="true"/gu)).toBe(0);
    expect(html).toContain('aria-label="Meetings, change section"');
  });

  test("the More trigger names the utility that owns an active child", () => {
    const html = navigation({
      activeTab: "meeting-detail",
      activePluginParentValue: "meetings",
      moreTabs: [meetings, settings],
    });
    const trigger = moreTrigger(html);
    expect(trigger).toContain('<span class="truncate">Meetings</span>');
    expect(trigger).toContain("data-active");
  });

  test("the More trigger uses no glossy fill on the line strip", () => {
    const html = navigation({
      activeTab: "settings",
      moreTabs: [meetings, settings],
    });
    const trigger = moreTrigger(html);
    expect(trigger).not.toContain("--control-gloss");
    expect(trigger).not.toContain("--button-primary-gloss");
  });
});
