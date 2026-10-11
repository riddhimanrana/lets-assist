import { describe, expect, test } from "bun:test";

import { getOrganizationDirectoryEmptyActions } from "./organization-directory-actions";

describe("empty organization directory actions", () => {
  test("a visitor is only asked to sign in", () => {
    const actions = getOrganizationDirectoryEmptyActions({
      isLoggedIn: false,
      canCreate: false,
    });
    expect(actions).toMatchObject({ signIn: true, join: false, create: false });
    expect(actions.description).toContain("Sign in");
  });

  test("a visitor never gets a create action, whatever the caller passes", () => {
    const actions = getOrganizationDirectoryEmptyActions({
      isLoggedIn: false,
      canCreate: true,
    });
    expect(actions.create).toBe(false);
    expect(actions.join).toBe(false);
  });

  test("a signed-in user without Trusted Member access can join but not create", () => {
    const actions = getOrganizationDirectoryEmptyActions({
      isLoggedIn: true,
      canCreate: false,
    });
    expect(actions).toMatchObject({ signIn: false, join: true, create: false });
    expect(actions.description).toContain("Trusted Member");
  });

  test("a signed-in user who can create gets both actions", () => {
    const actions = getOrganizationDirectoryEmptyActions({
      isLoggedIn: true,
      canCreate: true,
    });
    expect(actions).toMatchObject({ signIn: false, join: true, create: true });
  });
});
