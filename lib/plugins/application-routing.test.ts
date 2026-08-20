import { describe, expect, test } from "bun:test";

import { shouldRouteCsfApplication } from "./application-routing";

const organizationId = "22222222-2222-4222-8222-222222222222";
const path = `/organization/${organizationId}/plugins/dvhs-csf/access-proof`;

describe("CSF application microfrontend routing", () => {
  test("fails closed unless both the flag and organization allowlist match", () => {
    expect(
      shouldRouteCsfApplication({
        pathname: path,
        enabled: undefined,
        organizationIds: organizationId,
      }),
    ).toBe(false);
    expect(
      shouldRouteCsfApplication({
        pathname: path,
        enabled: "true",
        organizationIds: "",
      }),
    ).toBe(false);
  });

  test("routes only the reviewed child path for an allowed organization", () => {
    expect(
      shouldRouteCsfApplication({
        pathname: path,
        enabled: " TRUE ",
        organizationIds: `11111111-1111-4111-8111-111111111111, ${organizationId}`,
      }),
    ).toBe(true);
    expect(
      shouldRouteCsfApplication({
        pathname: `/organization/${organizationId}/plugins/dvhs-csf/classes`,
        enabled: "true",
        organizationIds: organizationId,
      }),
    ).toBe(false);
  });
});
