import { describe, expect, test } from "bun:test";
import {
  deriveOrganizationSetupChecklist,
  type OrganizationSetupSnapshot,
} from "./setup-checklist";

function snapshot(
  overrides: Partial<OrganizationSetupSnapshot> = {},
): OrganizationSetupSnapshot {
  return {
    organizationSlug: "riverside",
    hasLogo: false,
    hasDescription: false,
    hasType: false,
    memberCount: 1,
    projectCount: 0,
    hasPluginAvailable: true,
    hasEnabledPlugin: false,
    dismissedAt: null,
    ...overrides,
  };
}

describe("deriveOrganizationSetupChecklist", () => {
  test("a brand new organization has everything outstanding", () => {
    const result = deriveOrganizationSetupChecklist(snapshot());

    expect(result.totalCount).toBe(4);
    expect(result.completedCount).toBe(0);
    expect(result.isComplete).toBe(false);
    expect(result.shouldShow).toBe(true);
  });

  test("details needs all three fields, not just one", () => {
    const partial = deriveOrganizationSetupChecklist(
      snapshot({ hasLogo: true, hasDescription: true }),
    );
    expect(
      partial.items.find((item) => item.id === "details")?.complete,
    ).toBe(false);

    const full = deriveOrganizationSetupChecklist(
      snapshot({ hasLogo: true, hasDescription: true, hasType: true }),
    );
    expect(full.items.find((item) => item.id === "details")?.complete).toBe(
      true,
    );
  });

  test("there is no join-method step, because every organization has a join code", () => {
    const result = deriveOrganizationSetupChecklist(snapshot());
    expect(result.items.map((item) => item.id)).toEqual([
      "details",
      "invite",
      "plugin",
      "project",
    ]);
  });

  test("the creator alone does not count as having invited a team", () => {
    expect(
      deriveOrganizationSetupChecklist(snapshot({ memberCount: 1 })).items.find(
        (item) => item.id === "invite",
      )?.complete,
    ).toBe(false);

    expect(
      deriveOrganizationSetupChecklist(snapshot({ memberCount: 2 })).items.find(
        (item) => item.id === "invite",
      )?.complete,
    ).toBe(true);
  });

  test("the plugin step disappears when no plugin is available", () => {
    const result = deriveOrganizationSetupChecklist(
      snapshot({ hasPluginAvailable: false }),
    );

    expect(result.items.map((item) => item.id)).not.toContain("plugin");
    expect(result.totalCount).toBe(3);
  });

  test("an organization with no plugin can still reach complete", () => {
    const result = deriveOrganizationSetupChecklist(
      snapshot({
        hasPluginAvailable: false,
        hasLogo: true,
        hasDescription: true,
        hasType: true,
        memberCount: 4,
        projectCount: 1,
      }),
    );

    expect(result.isComplete).toBe(true);
    expect(result.shouldShow).toBe(false);
  });

  test("a fully set up organization stops showing the checklist", () => {
    const result = deriveOrganizationSetupChecklist(
      snapshot({
        hasLogo: true,
        hasDescription: true,
        hasType: true,
        memberCount: 6,
        projectCount: 2,
        hasEnabledPlugin: true,
      }),
    );

    expect(result.completedCount).toBe(4);
    expect(result.isComplete).toBe(true);
    expect(result.shouldShow).toBe(false);
  });

  test("dismissal hides an incomplete checklist without marking it complete", () => {
    const result = deriveOrganizationSetupChecklist(
      snapshot({ dismissedAt: "2026-08-10T00:00:00.000Z" }),
    );

    expect(result.shouldShow).toBe(false);
    expect(result.isComplete).toBe(false);
    expect(result.completedCount).toBe(0);
  });

  test("every item links somewhere inside the product", () => {
    const result = deriveOrganizationSetupChecklist(snapshot());

    for (const item of result.items) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
    }
  });
});
