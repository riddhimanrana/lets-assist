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
    hostBuildSurface: ["@/lib/plugins/supabase"],
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

  test("rejects release inputs that omit the plugin's own subtree", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({ releaseInputs: ["plugins/some-other-plugin"] }),
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

  test("rejects an inverted install-contract range", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        supportedInstallContracts: { minimum: "2.0.0", maximum: "1.0.0" },
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/supportedInstallContracts");
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
