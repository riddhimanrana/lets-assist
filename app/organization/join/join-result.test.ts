import { expect, test } from "bun:test";
import { joinedOrganizationPath } from "./join-result";

test("new and returning organization members reach the organization", () => {
  expect(
    joinedOrganizationPath({
      success: true,
      organizationUsername: "fictional-csf",
    }),
  ).toBe("/organization/fictional-csf");
  expect(
    joinedOrganizationPath({
      error: "You are already a member of this organization",
      organizationUsername: "fictional-csf",
    }),
  ).toBe("/organization/fictional-csf");
});
test("failed and incomplete joins do not become a success destination", () => {
  expect(
    joinedOrganizationPath({
      error: "Invalid join code",
      organizationUsername: "fictional-csf",
    }),
  ).toBeNull();
  expect(joinedOrganizationPath({ success: true })).toBeNull();
});
