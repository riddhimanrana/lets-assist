import { describe, expect, test } from "bun:test";

import { validatePluginConfig } from "../../config-schema";
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

  test("keeps presentation-only configuration formats valid at runtime", () => {
    const configSchema = {
      type: "object" as const,
      properties: {
        message: { type: "string" as const, format: "textarea" },
      },
      additionalProperties: false,
    };
    const manifestResult = validatePluginSdkManifest(
      embeddedManifest({ configSchema }),
    );

    expect(manifestResult.valid).toBe(true);
    expect(validatePluginConfig({ message: "Hello" }, configSchema)).toEqual({
      valid: true,
      errors: [],
    });
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
        releaseInputs: ["plugins/example-plugin", "plugins/example-plugin"],
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/releaseInputs");
  });

  test("rejects extra release inputs for an embedded plugin", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        releaseInputs: ["plugins/example-plugin", "apps/unrelated"],
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

  test("requires a migration-shaped platform schema version", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({ requiredPlatformSchemaVersion: "not-a-migration" }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain("/requiredPlatformSchemaVersion");
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

  test("rejects configuration defaults that cannot cross the JSON boundary", () => {
    for (const invalidDefault of [
      () => null,
      Symbol("not-json"),
      BigInt(1),
      Number.POSITIVE_INFINITY,
    ]) {
      const result = validatePluginSdkManifest(
        embeddedManifest({
          configSchema: {
            type: "object",
            properties: {
              setting: { type: "string", default: invalidDefault },
            },
            additionalProperties: false,
          } as never,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]?.keyword).toBe("jsonSerializable");
      expect(pathsOf(result)).toContain(
        "/configSchema/properties/setting/default",
      );
    }
  });

  test("rejects circular configuration defaults before recursive schema validation", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const result = validatePluginSdkManifest(
      embeddedManifest({
        configSchema: {
          type: "object",
          properties: {
            setting: { type: "object", default: circular },
          },
          additionalProperties: false,
        } as never,
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        path: "/configSchema/properties/setting/default/self",
        message: "must be a finite, acyclic JSON value",
        keyword: "jsonSerializable",
      },
    ]);
  });

  test("rejects non-JSON values nested in a configuration enum", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        configSchema: {
          type: "object",
          properties: {
            setting: { type: "array", enum: [["valid", undefined]] },
          },
          additionalProperties: false,
        } as never,
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain(
      "/configSchema/properties/setting/enum/0/1",
    );
  });

  test("rejects defaults and enum members that violate their property schema", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        configSchema: {
          type: "object",
          properties: {
            retries: { type: "integer", default: "many" },
            enabled: { type: "boolean", enum: [true, "sometimes"] },
          },
          additionalProperties: false,
        } as never,
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain(
      "/configSchema/properties/retries/default",
    );
    expect(pathsOf(result)).toContain(
      "/configSchema/properties/enabled/enum/1",
    );
  });

  test("rejects required configuration keys without declared properties", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        configSchema: {
          type: "object",
          properties: {},
          required: ["missing"],
          additionalProperties: false,
        },
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: "/configSchema/required/0",
      message: "must name a declared configuration property",
      keyword: "configRequiredProperty",
    });
  });

  test("rejects inverted configuration property bounds", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        configSchema: {
          type: "object",
          properties: {
            retries: { type: "number", minimum: 10, maximum: 1 },
            label: { type: "string", minLength: 8, maxLength: 2 },
          },
          additionalProperties: false,
        },
      }),
    );

    expect(result.valid).toBe(false);
    expect(pathsOf(result)).toContain(
      "/configSchema/properties/retries/maximum",
    );
    expect(pathsOf(result)).toContain(
      "/configSchema/properties/label/maxLength",
    );
  });

  test("rejects an ordered integer range containing no integer", () => {
    const result = validatePluginSdkManifest(
      embeddedManifest({
        configSchema: {
          type: "object",
          properties: {
            count: { type: "integer", minimum: 0.1, maximum: 0.9 },
          },
          required: ["count"],
          additionalProperties: false,
        },
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      path: "/configSchema/properties/count/maximum",
      message: "must form a range containing at least one integer",
      keyword: "configIntegerRange",
    });
  });

  test("rejects values JSON would omit or execute while serializing", () => {
    const hidden = embeddedManifest();
    Object.defineProperty(hidden, "hidden", {
      value: "unsigned",
      enumerable: false,
    });
    expect(validatePluginSdkManifest(hidden).valid).toBe(false);

    const accessor = embeddedManifest();
    Object.defineProperty(accessor, "description", {
      get() {
        throw new Error("must not execute");
      },
      enumerable: true,
    });
    expect(validatePluginSdkManifest(accessor).valid).toBe(false);

    const hostile = new Proxy(embeddedManifest(), {
      ownKeys() {
        throw new Error("hostile object");
      },
    });
    expect(validatePluginSdkManifest(hostile).valid).toBe(false);
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
