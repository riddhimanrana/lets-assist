import { describe, expect, it } from "vitest";

import {
  buildStaffInviteRedirectPath,
  getStaffInviteOrgLabel,
  getStaffInviteToastContent,
} from "./staff-invite-outcome";

describe("staff invite outcome helpers", () => {
  it("uses the organization name when one is available", () => {
    expect(
      getStaffInviteOrgLabel({
        orgUsername: "troop941",
        orgName: "Troop 941",
      }),
    ).toBe("Troop 941");
  });

  it("builds organization redirects with invite metadata", () => {
    expect(
      buildStaffInviteRedirectPath(
        {
          status: "success",
          orgUsername: "troop941",
          orgName: "Troop 941",
        },
        { toastPosition: "bottom-center" },
      ),
    ).toBe(
      "/organization/troop941?invite_status=success&invite_org=Troop+941&invite_toast_position=bottom-center",
    );
  });

  it("falls back to the supplied redirect when the org cannot be found", () => {
    expect(
      buildStaffInviteRedirectPath(
        {
          status: "org_not_found",
          orgUsername: "ghost-org",
        },
        { fallbackPath: "/home?tab=calendar" },
      ),
    ).toBe(
      "/home?tab=calendar&invite_status=org_not_found&invite_org=ghost-org",
    );
  });

  it("builds success toast copy from the organization name", () => {
    expect(getStaffInviteToastContent("success", "Troop 941")).toEqual({
      title: "Staff invite applied",
      description: 'You were added to "Troop 941" as staff.',
    });
  });
});