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

test("only an explicitly active membership carries a role", () => {
  assert.equal(
    activeOrganizationRole({ role: "admin", status: "active" }),
    "admin",
  );
  assert.equal(
    activeOrganizationRole({ role: "staff", status: "active" }),
    "staff",
  );
});

test("a membership that is not active confers no role", () => {
  for (const status of ["invited", "inactive", "pending", "removed", ""]) {
    assert.equal(activeOrganizationRole({ role: "admin", status }), null);
    assert.equal(activeOrganizationRole({ role: "staff", status }), null);
  }

  // `status` is nullable in the schema, so an unset status fails closed here and
  // in the SQL predicates rather than being read as active.
  assert.equal(activeOrganizationRole({ role: "admin", status: null }), null);
  assert.equal(activeOrganizationRole({ role: "staff" }), null);
  assert.equal(activeOrganizationRole(null), null);
  assert.equal(activeOrganizationRole(undefined), null);
  assert.equal(activeOrganizationRole({ status: "active" }), null);
});

test("an inactive or status-less admin or staff membership cannot manage", () => {
  for (const role of ["admin", "staff"]) {
    for (const status of ["inactive", null]) {
      assert.equal(
        canManageProjectAccess({
          ...common,
          organizationRole: activeOrganizationRole({ role, status }),
          canBeManagedByStaff: true,
        }),
        false,
      );
    }
  }
});
