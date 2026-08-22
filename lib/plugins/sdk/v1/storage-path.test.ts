import { describe, expect, test } from "bun:test";

import {
  PRIVATE_PLUGIN_STORAGE_BUCKET,
  buildPluginStoragePath,
  isPathWithinPluginNamespace,
  parsePluginStoragePath,
  pluginStorageNamespacePrefix,
} from "./storage-path";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

describe("plugin storage paths", () => {
  test("the bucket is the shared private plugin bucket", () => {
    expect(PRIVATE_PLUGIN_STORAGE_BUCKET).toBe("plugins");
  });

  test("builds an organization- and plugin-scoped key", () => {
    expect(
      buildPluginStoragePath({
        organizationId: ORG,
        pluginKey: "dvhs-csf",
        resource: ["proofs", "term-1", "file.pdf"],
      }),
    ).toBe(`${ORG}/dvhs-csf/proofs/term-1/file.pdf`);
  });

  test("accepts a pre-joined suffix", () => {
    expect(
      buildPluginStoragePath({
        organizationId: ORG,
        pluginKey: "dvhs-csf",
        resource: "proofs/file.pdf",
      }),
    ).toBe(`${ORG}/dvhs-csf/proofs/file.pdf`);
  });

  test("refuses traversal and malformed suffixes", () => {
    // The bucket has no row-level policies: scope is enforced entirely by the
    // key the server builds, so a traversal here is a tenancy break.
    for (const resource of [
      "../other-org/file.pdf",
      "proofs/../../escape.pdf",
      "/absolute.pdf",
      "trailing/",
      "double//segment.pdf",
      "back\\slash.pdf",
      ".",
      "",
    ]) {
      expect(() =>
        buildPluginStoragePath({
          organizationId: ORG,
          pluginKey: "dvhs-csf",
          resource,
        }),
      ).toThrow();
    }
  });

  test("refuses a non-canonical organization or plugin key", () => {
    expect(() =>
      buildPluginStoragePath({
        organizationId: "not-a-uuid",
        pluginKey: "dvhs-csf",
        resource: "file.pdf",
      }),
    ).toThrow();

    expect(() =>
      buildPluginStoragePath({
        organizationId: ORG,
        pluginKey: "Invalid Key",
        resource: "file.pdf",
      }),
    ).toThrow();

    for (const pluginKey of ["school_tools", "school.plugin", "school-"]) {
      expect(() =>
        buildPluginStoragePath({
          organizationId: ORG,
          pluginKey,
          resource: "file.pdf",
        }),
      ).toThrow();
    }
  });

  test("round-trips through parse", () => {
    const path = buildPluginStoragePath({
      organizationId: ORG,
      pluginKey: "dvhs-csf",
      resource: ["a", "b.pdf"],
    });

    expect(parsePluginStoragePath(path)).toEqual({
      organizationId: ORG,
      pluginKey: "dvhs-csf",
      resource: ["a", "b.pdf"],
    });
  });

  test("parse rejects keys outside the grammar", () => {
    expect(parsePluginStoragePath("")).toBeNull();
    expect(parsePluginStoragePath(`${ORG}/dvhs-csf`)).toBeNull();
    expect(parsePluginStoragePath(`not-a-uuid/dvhs-csf/file.pdf`)).toBeNull();
    expect(parsePluginStoragePath(`${ORG}//file.pdf`)).toBeNull();
  });

  test("namespace membership is scoped to both organization and plugin", () => {
    const path = `${ORG}/dvhs-csf/proofs/file.pdf`;

    expect(isPathWithinPluginNamespace(path, ORG, "dvhs-csf")).toBe(true);
    // Cross-tenant and cross-plugin reads are the two failures this guards.
    expect(isPathWithinPluginNamespace(path, OTHER_ORG, "dvhs-csf")).toBe(
      false,
    );
    expect(isPathWithinPluginNamespace(path, ORG, "dv-speech-debate")).toBe(
      false,
    );
  });

  test("the namespace prefix bounds list and delete operations", () => {
    expect(pluginStorageNamespacePrefix(ORG, "dvhs-csf")).toBe(
      `${ORG}/dvhs-csf/`,
    );
    expect(() =>
      pluginStorageNamespacePrefix("not-a-uuid", "dvhs-csf"),
    ).toThrow();
  });
});
