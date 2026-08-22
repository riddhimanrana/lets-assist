import { describe, expect, test } from "bun:test";

import {
  getCsfApplicationOrganizationId,
  isCsfApplicationPath,
  parsePluginApplicationRouteTarget,
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
        routeTargetAvailable: false,
      }),
    ).toBe(false);
    expect(
      shouldRouteCsfApplication({
        pathname: path,
        routeTargetAvailable: true,
      }),
    ).toBe(true);
    expect(
      shouldRouteCsfApplication({
        pathname: `/organization/${organizationId}/plugins/dvhs-csf/classes`,
        routeTargetAvailable: true,
      }),
    ).toBe(false);
  });

  test("accepts only an immutable Vercel deployment origin", () => {
    expect(
      parsePluginApplicationRouteTarget({
        routable: true,
        deploymentId: "dpl_v1",
        deploymentUrl: "https://lets-assist-csf-v1.vercel.app",
        runtimeVersion: "1.2.7",
      }),
    ).toEqual({
      deploymentId: "dpl_v1",
      deploymentUrl: "https://lets-assist-csf-v1.vercel.app",
      runtimeVersion: "1.2.7",
    });
    expect(
      parsePluginApplicationRouteTarget({
        routable: true,
        deploymentId: "dpl_v1",
        deploymentUrl: "https://attacker.example.test",
        runtimeVersion: "1.2.7",
      }),
    ).toBeNull();
  });
});
