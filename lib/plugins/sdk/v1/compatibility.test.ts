import { describe, expect, test } from "bun:test";

import {
  comparePluginVersions,
  isInstallContractRangeSane,
  isPluginVersionBehind,
  isPluginVersionString,
  isPluginVersionWithinContractRange,
  normalizePluginVersion,
} from "./compatibility";

describe("plugin version comparison", () => {
  test("orders by major, then minor, then patch", () => {
    expect(comparePluginVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(comparePluginVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(comparePluginVersions("1.0.2", "1.0.10")).toBeLessThan(0);
    expect(comparePluginVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(comparePluginVersions("1.1.1", "1.1.1")).toBe(0);
  });

  test("ignores a leading v and surrounding whitespace", () => {
    expect(comparePluginVersions("v1.2.3", " 1.2.3 ")).toBe(0);
  });

  test("compares prerelease builds by their release version", () => {
    expect(comparePluginVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
  });

  test("coerces unparseable input rather than throwing", () => {
    // Runtime comparisons sit on request paths, so malformed data must degrade
    // to an ordering rather than crash. Strictness lives in
    // isPluginVersionString, which the manifest and release paths use.
    expect(normalizePluginVersion(null)).toBe("0.0.0");
    expect(comparePluginVersions("nonsense", "0.0.0")).toBe(0);
  });

  test("isPluginVersionBehind is strict", () => {
    expect(isPluginVersionBehind("1.0.0", "1.0.1")).toBe(true);
    expect(isPluginVersionBehind("1.0.1", "1.0.1")).toBe(false);
    expect(isPluginVersionBehind("1.0.2", "1.0.1")).toBe(false);
  });
});

describe("version string strictness", () => {
  test("accepts well-formed versions", () => {
    expect(isPluginVersionString("1.0.0")).toBe(true);
    expect(isPluginVersionString("2.10.3")).toBe(true);
  });

  test("rejects anything else", () => {
    for (const value of [
      "v2.10.3",
      "1.0.0-rc.1",
      "1.0.0+build.1",
      "1.0",
      "one.0.0",
      "",
      null,
      undefined,
      100,
    ]) {
      expect(isPluginVersionString(value)).toBe(false);
    }
  });
});

describe("install contract ranges", () => {
  test("a range must be ordered and well formed", () => {
    expect(
      isInstallContractRangeSane({ minimum: "1.0.0", maximum: "1.1.0" }),
    ).toBe(true);
    expect(
      isInstallContractRangeSane({ minimum: "1.0.0", maximum: "1.0.0" }),
    ).toBe(true);
    expect(
      isInstallContractRangeSane({ minimum: "1.1.0", maximum: "1.0.0" }),
    ).toBe(false);
    expect(
      isInstallContractRangeSane({ minimum: "1.0", maximum: "1.1.0" } as never),
    ).toBe(false);
    expect(isInstallContractRangeSane(null)).toBe(false);
  });

  test("an exact range behaves like the previous equality gate", () => {
    const exact = { minimum: "1.1.0", maximum: "1.1.0" };

    expect(isPluginVersionWithinContractRange("1.1.0", exact)).toBe(true);
    expect(isPluginVersionWithinContractRange("1.0.0", exact)).toBe(false);
    expect(isPluginVersionWithinContractRange("1.2.0", exact)).toBe(false);
  });

  test("a widened range serves N and N-1 during a rollout", () => {
    const rollout = { minimum: "1.1.0", maximum: "1.2.0" };

    expect(isPluginVersionWithinContractRange("1.2.0", rollout)).toBe(true);
    expect(isPluginVersionWithinContractRange("1.1.0", rollout)).toBe(true);
    // N-2 is outside the declared window and must not be served.
    expect(isPluginVersionWithinContractRange("1.0.0", rollout)).toBe(false);
    expect(isPluginVersionWithinContractRange("1.3.0", rollout)).toBe(false);
  });

  test("fails closed on a missing or malformed range", () => {
    // A release that forgot to declare its contract serves nobody, rather than
    // defaulting to serving everybody.
    expect(isPluginVersionWithinContractRange("1.0.0", null)).toBe(false);
    expect(isPluginVersionWithinContractRange("1.0.0", undefined)).toBe(false);
    expect(
      isPluginVersionWithinContractRange("1.0.0", {
        minimum: "2.0.0",
        maximum: "1.0.0",
      }),
    ).toBe(false);
  });

  test("fails closed on a missing installed version", () => {
    expect(
      isPluginVersionWithinContractRange(null, {
        minimum: "1.0.0",
        maximum: "1.0.0",
      }),
    ).toBe(false);
  });
});
