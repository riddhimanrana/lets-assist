import assert from "node:assert/strict";
import test from "node:test";

import { canManageProjectAccess } from "./management-access";

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
