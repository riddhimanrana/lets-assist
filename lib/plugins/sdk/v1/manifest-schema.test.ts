import { describe, expect, test } from "bun:test";

import type { PluginSdkManifest } from "./manifest";
import { validatePluginSdkManifest } from "./schema";

function embeddedManifest(
  overrides: Partial<PluginSdkManifest> = {},
): PluginSdkManifest {
  return {
    sdkVersion: 1,
    key: "example-plugin",
    name: "Example Plugin",
    version: "1.0.0",
    visibility: "private",
    runtime: { profile: "embedded" },
    hostApiRange: { minimum: "1.0.0" },
    pluginDataSchemaVersion: 1,
    requiredPlatformSchemaVersion: "20260325181408",
    supportedInstallContracts: { minimum: "1.0.0", maximum: "1.0.0" },
    releaseInputs: ["plugins/example-plugin"],
    dataIsolation: "shared",
    ...overrides,
  } as PluginSdkManifest;
}

function pathsOf(result: ReturnType<typeof validatePluginSdkManifest>) {
  return result.errors.map((error) => error.path);
}

describe("plugin manifest validation", () => {
  test("accepts a minimal embedded manifest", () => {
    const result = validatePluginSdkManifest(embeddedManifest());

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("accepts an application manifest that declares its full build inputs", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        runtime: {
          profile: "application",
          pathPrefix: "/organization/:id/plugins/example-plugin",
          directAccessProtection: "required",
        },
        releaseInputs: [
          "plugins/example-plugin",
          "apps/example",
          "apps/example/bun.lock",
        ],
      }),
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("rejects an application manifest whose digest would miss the built program", () => {
    // The plugin subtree alone does not describe an independently built app:
    // the child application sources and the dependency lock also determine what
    // Vercel ran, so signing only the subtree would attest the wrong thing.
    const result = validatePluginSdkManifest(
      embeddedManifest({
        runtime: {
          profile: "application",
          pathPrefix: "/organization/:id/plugins/example-plugin",
          directAccessProtection: "required",
        },
        releaseInputs: ["plugins/example-plugin"],
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/releaseInputs");
  });

  test("rejects an application lockfile whose source root is not declared", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        runtime: {
          profile: "application",
          pathPrefix: "/organization/:id/plugins/example-plugin",
          directAccessProtection: "required",
        },
        releaseInputs: ["plugins/example-plugin", "unrelated/bun.lock"],
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/releaseInputs");
  });

  test("rejects an application lockfile outside its declared source root", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        runtime: {
          profile: "application",
          pathPrefix: "/organization/:id/plugins/example-plugin",
          directAccessProtection: "required",
        },
        releaseInputs: [
          "plugins/example-plugin",
          "apps/example",
          "unrelated/bun.lock",
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/releaseInputs");
  });

  test("rejects the plugin subtree as an independent build root", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        runtime: {
          profile: "application",
          pathPrefix: "/organization/:id/plugins/example-plugin",
          directAccessProtection: "required",
        },
        releaseInputs: [
          "plugins/example-plugin",
          "plugins/example-plugin/bun.lock",
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/releaseInputs");
  });

  test("rejects release inputs outside normalized repository-relative paths", () => {
    for (const invalidRoot of [
      "/tmp/app",
      "../app",
      "apps/../app",
      "apps//app",
      "apps\\app",
      " apps/example",
    ]) {
      const result = validatePluginSdkManifest(
        embeddedManifest({
          runtime: {
            profile: "application",
            pathPrefix: "/organization/:id/plugins/example-plugin",
            directAccessProtection: "required",
          },
          releaseInputs: [
            "plugins/example-plugin",
            invalidRoot,
            `${invalidRoot}/bun.lock`,
          ],
        }),
      );

      expect(result.valid).toBe(false);
      expect(pathsOf(result)).toContain("/releaseInputs");
    }
  });

  test("rejects duplicate release inputs", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        releaseInputs: [
          "plugins/example-plugin",
          "plugins/example-plugin",
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/releaseInputs");
  });

  test("rejects release inputs that omit the plugin's own subtree", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({ releaseInputs: ["plugins/some-other-plugin"] }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/releaseInputs");
  });

  test("rejects a nested file in place of the plugin source root", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        releaseInputs: ["plugins/example-plugin/manifest.ts"],
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/releaseInputs");
  });

  test("requires direct access protection on an application runtime", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        runtime: {
          profile: "application",
          pathPrefix: "/organization/:id/plugins/example-plugin",
        } as never,
        releaseInputs: ["plugins/example-plugin", "apps/example/bun.lock"],
      }),
    );

    expect(result.valid).toBe(false);
  });

  test("rejects an unknown runtime profile", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({ runtime: { profile: "serverless" } as never }),
    );

    expect(result.valid).toBe(false);
  });

  test("rejects a non-semver version", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({ version: "one point oh" }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/version");
  });

  test("rejects versions outside the stable publication lane", () => {
    for (const version of [
      "v1.0.0",
      "1.0.0-beta.1",
      "1.0.0+build.1",
      "1000000000.0.0",
      "01.0.0",
    ]) {
      expect(
        validatePluginSdkManifest(embeddedManifest({ version })).valid,
      ).toBe(false);
    }
  });

  test("uses the host plugin-key grammar", () => {
    for (const key of ["school_tools", "school.plugin", "school-"]) {
      expect(validatePluginSdkManifest(embeddedManifest({ key })).valid).toBe(
        false,
      );
    }
    expect(
      validatePluginSdkManifest(
        embeddedManifest({
          key: "school-tools",
          releaseInputs: ["plugins/school-tools"],
        }),
      ).valid,
    ).toBe(true);
  });

  test("rejects an inverted install-contract range", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        supportedInstallContracts: { minimum: "2.0.0", maximum: "1.0.0" },
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/supportedInstallContracts");
  });

  test("requires the maximum install contract to match the release version", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        version: "1.2.0",
        supportedInstallContracts: { minimum: "1.0.0", maximum: "1.1.0" },
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/supportedInstallContracts/maximum");
  });

  test("rejects an inverted host API range", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        hostApiRange: { minimum: "2.0.0", maximum: "1.0.0" },
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/hostApiRange");
  });

  test("rejects a storage bucket the platform does not operate", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        storageAccess: [
          {
            bucket: "some-other-bucket",
            pathPattern: "{organizationId}/example-plugin/",
            access: "server-only",
            purpose: "test",
          },
        ],
      }),
    );

    expect(result.valid).toBe(false);
  });

  test("rejects an isolation mode the platform does not enforce", () => {
    // Claiming dedicated isolation without runtime enforcement would be a false
    // assurance to an organization, so the schema admits only `shared`.
    const result = validatePluginSdkManifest(
      embeddedManifest({ dataIsolation: "dedicated_schema" as never }),
    );

    expect(result.valid).toBe(false);
  });

  test("rejects unknown top-level properties", () => {
    // This is what keeps the manifest serializable: a renderer, a client, or
    // any other host object attached to the manifest cannot validate.
    const result = validatePluginSdkManifest({
      ...embeddedManifest(),
      renderOrganizationPage: () => null,
    });

    expect(result.valid).toBe(false);
  });

  test("rejects a data-deletion contract that is not explicitly reviewed", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        dataDeletion: {
          reviewed: false,
          reviewedAt: "2026-08-19",
          execution: { atomicity: "transactional", retrySafety: "idempotent" },
          dataTargets: [],
          storageTargets: [],
          externalSystemsNotCovered: [],
        } as never,
      }),
    );

    expect(result.valid).toBe(false);
  });

  test("rejects a malformed review date", () => {
    // Asserted because the base Ajv build has no format vocabulary: without an
    // explicit pattern this constraint would be silently ignored.
    const result = validatePluginSdkManifest(
      embeddedManifest({
        dataDeletion: {
          reviewed: true,
          reviewedAt: "last Tuesday",
          execution: { atomicity: "transactional", retrySafety: "idempotent" },
          dataTargets: [],
          storageTargets: [],
          externalSystemsNotCovered: [],
        },
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/dataDeletion/reviewedAt");
  });

  test("rejects a non-object", () => {
    expect(validatePluginSdkManifest(null).valid).toBe(false);
    expect(validatePluginSdkManifest("manifest").valid).toBe(false);
  });
});
