import { describe, expect, test } from "bun:test";
import {
  buildNavigationDestinationGroups,
  dedupeNavigationDestinations,
  findActiveNavigationDestination,
  isNavigationValueActive,
  type OrganizationNavigationDestination,
} from "./organization-navigation-destinations";

const destination = (
  value: string,
  overrides: Partial<OrganizationNavigationDestination> = {},
): OrganizationNavigationDestination => ({
  value,
  label: value,
  ...overrides,
});

describe("dedupeNavigationDestinations", () => {
  test("keeps the first destination per value and preserves input order", () => {
    const deduped = dedupeNavigationDestinations([
      destination("overview", { label: "Dashboard" }),
      destination("members", { label: "Roster" }),
      destination("overview", { label: "Overview duplicate" }),
      destination("reports", { label: "Reports" }),
      destination("members", { label: "Members duplicate" }),
    ]);

    expect(deduped.map((entry) => entry.value)).toEqual([
      "overview",
      "members",
      "reports",
    ]);
    expect(deduped.map((entry) => entry.label)).toEqual([
      "Dashboard",
      "Roster",
      "Reports",
    ]);
  });

  test("preserves the href, icon, and label of the first permitted destination", () => {
    const deduped = dedupeNavigationDestinations([
      destination("members", {
        label: "Roster",
        href: "/organization/dvhs/plugins/example/roster",
        icon: "roster-icon",
      }),
      destination("members", {
        label: "Members",
        href: "/organization/dvhs/plugins/other/members",
        icon: "other-icon",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual({
      value: "members",
      label: "Roster",
      href: "/organization/dvhs/plugins/example/roster",
      icon: "roster-icon",
    });
  });

  test("skips empty entries without inventing destinations", () => {
    const deduped = dedupeNavigationDestinations([
      null,
      undefined,
      destination(""),
      destination("projects"),
    ]);

    expect(deduped.map((entry) => entry.value)).toEqual(["projects"]);
  });

  test("shares a seen set across successive calls", () => {
    const seenValues = new Set<string>();
    const first = dedupeNavigationDestinations(
      [destination("overview")],
      seenValues,
    );
    const second = dedupeNavigationDestinations(
      [destination("overview"), destination("hours")],
      seenValues,
    );

    expect(first.map((entry) => entry.value)).toEqual(["overview"]);
    expect(second.map((entry) => entry.value)).toEqual(["hours"]);
  });
});

describe("buildNavigationDestinationGroups", () => {
  test("workspace wins over a utility entry with the same value", () => {
    const groups = buildNavigationDestinationGroups(
      [
        destination("hours", {
          label: "Service Hours",
          icon: "workspace-icon",
        }),
      ],
      [
        destination("hours", {
          label: "Hours (utility)",
          icon: "utility-icon",
        }),
        destination("audit", { label: "Audit Log" }),
      ],
    );

    expect(groups.workspaceDestinations.map((entry) => entry.label)).toEqual([
      "Service Hours",
    ]);
    expect(groups.utilityDestinations.map((entry) => entry.value)).toEqual([
      "audit",
    ]);
    expect(groups.switcherDestinations.map((entry) => entry.value)).toEqual([
      "hours",
      "audit",
    ]);
  });

  test("produces switcher values that are unique and workspace-first", () => {
    const groups = buildNavigationDestinationGroups(
      [
        destination("overview"),
        destination("members"),
        // A core replacement that is also exposed as a plugin route tab.
        destination("members", { href: "/duplicate" }),
        destination("projects"),
      ],
      [destination("projects"), destination("admin"), destination("admin")],
    );

    const values = groups.switcherDestinations.map((entry) => entry.value);
    expect(values).toEqual(["overview", "members", "projects", "admin"]);
    expect(new Set(values).size).toBe(values.length);
    expect(groups.switcherDestinations).toEqual([
      ...groups.workspaceDestinations,
      ...groups.utilityDestinations,
    ]);
  });

  test("keeps empty input groups empty", () => {
    const groups = buildNavigationDestinationGroups([], []);

    expect(groups.workspaceDestinations).toEqual([]);
    expect(groups.utilityDestinations).toEqual([]);
    expect(groups.switcherDestinations).toEqual([]);
  });
});

describe("findActiveNavigationDestination", () => {
  const destinations = [
    destination("overview", { label: "Overview" }),
    destination("admin", { label: "Administration" }),
  ];

  test("prefers the directly active destination", () => {
    expect(
      findActiveNavigationDestination(destinations, "overview", "admin")?.value,
    ).toBe("overview");
  });

  test("falls back to the parent that owns the active child tab", () => {
    expect(
      findActiveNavigationDestination(
        destinations,
        "admin-recovery-queue",
        "admin",
      )?.label,
    ).toBe("Administration");
  });

  test("returns undefined when neither the value nor the parent is reachable", () => {
    expect(
      findActiveNavigationDestination(destinations, "hidden-tab"),
    ).toBeUndefined();
    expect(
      findActiveNavigationDestination(
        destinations,
        "hidden-tab",
        "not-permitted",
      ),
    ).toBeUndefined();
  });
});

describe("isNavigationValueActive", () => {
  test("marks the direct match and the active child's parent as active", () => {
    expect(isNavigationValueActive("admin", "admin")).toBe(true);
    expect(
      isNavigationValueActive("admin", "admin-recovery-queue", "admin"),
    ).toBe(true);
  });

  test("leaves unrelated values inactive", () => {
    expect(isNavigationValueActive("reports", "admin", "admin")).toBe(false);
    expect(isNavigationValueActive("reports", "admin")).toBe(false);
  });

  test("does not treat a missing parent as a match", () => {
    expect(isNavigationValueActive("", "admin-recovery-queue", undefined)).toBe(
      false,
    );
  });
});
