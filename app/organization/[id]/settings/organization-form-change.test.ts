import { describe, expect, test } from "bun:test";

import { hasOrganizationFormChanges } from "./organization-form-change";

describe("organization settings change detection", () => {
  const initialValues = {
    name: "DVHigh CSF",
    description: "Chapter records",
    showMembersPublicly: true,
  };

  test("enables saving when member visibility changes", () => {
    expect(
      hasOrganizationFormChanges(initialValues, {
        ...initialValues,
        showMembersPublicly: false,
      }),
    ).toBe(true);
  });

  test("does not report unchanged form-shaped values", () => {
    expect(hasOrganizationFormChanges(initialValues, initialValues)).toBe(
      false,
    );
  });
});
