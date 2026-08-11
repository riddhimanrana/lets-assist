import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSuperAdminMetadataPatch,
  hasSuperAdminMetadata,
  isSuperAdminUser,
} from "./super-admin";

test("rejects user-editable metadata for super-admin authorization", () => {
  assert.equal(
    hasSuperAdminMetadata({
      user_metadata: { is_super_admin: true, role: "super_admin" },
      app_metadata: {},
    }),
    false,
  );
});

test("accepts admin-controlled app metadata", () => {
  assert.equal(
    isSuperAdminUser({ app_metadata: { is_super_admin: true } }),
    true,
  );
  assert.equal(
    isSuperAdminUser({ app_metadata: { role: "super_admin" } }),
    true,
  );
});

test("builds promotion patches only in app metadata", () => {
  const patch = buildSuperAdminMetadataPatch({
    app_metadata: { existing: "value" },
    user_metadata: { display_name: "User-controlled" },
  });

  assert.deepEqual(patch, {
    app_metadata: {
      existing: "value",
      role: "super_admin",
      is_super_admin: true,
    },
  });
  assert.equal("user_metadata" in patch, false);
});
