import { describe, expect, test } from "bun:test";

import {
  getCsfApplicationOrganizationId,
  isCsfApplicationPath,
  shouldRouteCsfApplication,
} from "./application-routing";

const organizationId = "22222222-2222-4222-8222-222222222222";
const path = `/organization/${organizationId}/plugins/dvhs-csf/access-proof`;

describe("CSF application microfrontend routing", () => {
  test("extracts only the reviewed CSF application route", () => {
    expect(getCsfApplicationOrganizationId(path)).toBe(organizationId);
    expect(isCsfApplicationPath(`${path}/`)).toBe(true);
    expect(
      isCsfApplicationPath(
        `/organization/${organizationId}/plugins/dvhs-csf/classes`,
      ),
    ).toBe(false);
  });

  test("fails closed unless the database-backed flag is enabled", () => {
    expect(
      shouldRouteCsfApplication({
        pathname: path,
        featureFlagEnabled: false,
      }),
    ).toBe(false);
    expect(
      shouldRouteCsfApplication({
        pathname: path,
        featureFlagEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldRouteCsfApplication({
        pathname: `/organization/${organizationId}/plugins/dvhs-csf/classes`,
        featureFlagEnabled: true,
      }),
    ).toBe(false);
  });
});
