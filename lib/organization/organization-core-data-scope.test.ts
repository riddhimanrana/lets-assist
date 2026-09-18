import { describe, expect, test } from "bun:test";

import { getOrganizationCoreDataScope } from "./organization-core-data-scope";

describe("organization core data scope", () => {
  test("skips member and project payloads when a plugin hides those tabs and the header count", () => {
    expect(
      getOrganizationCoreDataScope({
        canViewMembers: true,
        navigation: {
          hideOverviewTab: true,
          hideMembersTab: true,
          hideProjectsTab: true,
          hideMemberCount: true,
        },
      }),
    ).toEqual({ memberRows: false, projects: false });
  });

  test("keeps full data for ordinary organization tabs", () => {
    expect(
      getOrganizationCoreDataScope({
        canViewMembers: true,
        navigation: {},
      }),
    ).toEqual({ memberRows: true, projects: true });
  });

  test("retains rows for a visible header count even when tabs are hidden", () => {
    expect(
      getOrganizationCoreDataScope({
        canViewMembers: true,
        navigation: {
          hideOverviewTab: true,
          hideMembersTab: true,
          hideProjectsTab: true,
        },
      }),
    ).toEqual({ memberRows: true, projects: false });
  });

  test("never loads a private member list for a viewer without access", () => {
    expect(
      getOrganizationCoreDataScope({
        canViewMembers: false,
        navigation: {},
      }),
    ).toEqual({ memberRows: false, projects: true });
  });
});
