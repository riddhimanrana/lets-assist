import assert from "node:assert/strict";
import test from "node:test";

import {
  activeOrganizationRole,
  canManageProjectAccess,
} from "./management-access";

const common = {
  creatorId: "creator",
  userId: "viewer",
};

test("project creators and organization admins can manage a project", () => {
  assert.equal(canManageProjectAccess({ ...common, userId: "creator" }), true);
  assert.equal(
    canManageProjectAccess({ ...common, organizationRole: "admin" }),
    true,
  );
});

test("organization staff require the project opt-in", () => {
  assert.equal(
    canManageProjectAccess({
      ...common,
      organizationRole: "staff",
      canBeManagedByStaff: true,
    }),
    true,
  );
  assert.equal(
    canManageProjectAccess({
      ...common,
      organizationRole: "staff",
      canBeManagedByStaff: false,
    }),
    false,
  );
  assert.equal(
    canManageProjectAccess({
      ...common,
      organizationRole: "staff",
      canBeManagedByStaff: null,
    }),
    false,
  );
});

test("members and unrelated users cannot manage a project", () => {
  assert.equal(
    canManageProjectAccess({ ...common, organizationRole: "member" }),
    false,
  );
  assert.equal(canManageProjectAccess(common), false);
});

test("only an active membership carries a role", () => {
  assert.equal(
    activeOrganizationRole({ role: "admin", status: "active" }),
    "admin",
  );
  // status is nullable with an `active` default, and the transactional RPCs
  // read it as COALESCE(status, 'active'), so a legacy row stays active here.
  assert.equal(activeOrganizationRole({ role: "staff" }), "staff");
  assert.equal(
    activeOrganizationRole({ role: "staff", status: null }),
    "staff",
  );
});

test("a membership that is not active confers no role", () => {
  for (const status of ["invited", "inactive", "pending", "removed", ""]) {
    assert.equal(activeOrganizationRole({ role: "admin", status }), null);
    assert.equal(activeOrganizationRole({ role: "staff", status }), null);
  }

  assert.equal(activeOrganizationRole(null), null);
  assert.equal(activeOrganizationRole(undefined), null);
  assert.equal(activeOrganizationRole({ status: "active" }), null);
});

test("an inactive admin or staff membership cannot manage a project", () => {
  for (const role of ["admin", "staff"]) {
    assert.equal(
      canManageProjectAccess({
        ...common,
        organizationRole: activeOrganizationRole({
          role,
          status: "inactive",
        }),
        canBeManagedByStaff: true,
      }),
      false,
    );
  }
});
