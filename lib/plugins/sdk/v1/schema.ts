/**
 * JSON Schema validation for the serializable plugin manifest.
 *
 * JSON Schema rather than a code-defined validator, because the manifest is a
 * cross-deployment document: a separately deployed plugin, a review tool, or a
 * future non-TypeScript consumer needs the contract as data, not as a function.
 * Ajv is already the repository's validator for plugin configuration, so this
 * keeps one validation stack.
 *
 * `additionalProperties: false` runs throughout. Besides catching typos, it is
 * what makes "serializable" enforceable: a manifest carrying a React renderer
 * or a database client cannot validate.
 */

import Ajv, { type ErrorObject } from "ajv";

import {
  isInstallContractRangeSane,
  isPluginVersionString,
} from "./compatibility";
import { PLUGIN_STORAGE_BUCKETS, type PluginSdkManifest } from "./manifest";
import { releaseInputsAreComplete } from "./release";
import { PLUGIN_RUNTIME_PROFILES } from "./runtime-profile";

export interface PluginManifestValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface PluginManifestValidationResult {
  valid: boolean;
  errors: PluginManifestValidationError[];
}

const ACCESS_ROLES = ["admin", "staff", "member"] as const;
/**
 * Routes and capabilities can be reachable without organization membership —
 * a guardian acting on a signed token holds no role — so they admit `public`
 * where `minimumRole` on the manifest itself does not.
 */
const SURFACE_ACCESS_LEVELS = [...ACCESS_ROLES, "public"] as const;
const SEMVER_PATTERN =
  "^(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})$";

const jsonValueSchema = {
  anyOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number" },
    { type: "string" },
    { type: "array", items: { $ref: "#/$defs/jsonValue" } },
    {
      type: "object",
      additionalProperties: { $ref: "#/$defs/jsonValue" },
    },
  ],
} as const;

const configPropertySchema = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    type: {
      enum: ["string", "number", "integer", "boolean", "array", "object"],
    },
    title: { type: "string" },
    description: { type: "string" },
    default: { $ref: "#/$defs/jsonValue" },
    enum: { type: "array", items: { $ref: "#/$defs/jsonValue" } },
    minimum: { type: "number" },
    maximum: { type: "number" },
    minLength: { type: "integer" },
    maxLength: { type: "integer" },
    pattern: { type: "string" },
    format: { type: "string" },
    items: { $ref: "#/$defs/configProperty" },
    properties: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/configProperty" },
    },
  },
} as const;

const manifestSchema = {
  $id: "https://lets-assist.com/schemas/plugin-manifest-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "sdkVersion",
    "key",
    "name",
    "version",
    "visibility",
    "runtime",
    "hostApiRange",
    "pluginDataSchemaVersion",
    "requiredPlatformSchemaVersion",
    "supportedInstallContracts",
    "releaseInputs",
    "dataIsolation",
  ],
  properties: {
    sdkVersion: { const: 1 },
    key: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    version: { type: "string", pattern: SEMVER_PATTERN },
    visibility: { enum: ["global", "private"] },
    minimumRole: { enum: [...ACCESS_ROLES] },

    runtime: {
      type: "object",
      required: ["profile"],
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["profile"],
          properties: { profile: { const: "embedded" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["profile", "pathPrefix", "directAccessProtection"],
          properties: {
            profile: { const: "application" },
            pathPrefix: { type: "string", pattern: "^/" },
            // Required rather than optional: a child domain bypasses the host
            // request chain, so unprotected direct access would make the host's
            // authorization decorative.
            directAccessProtection: { const: "required" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["profile", "endpoints"],
          properties: {
            profile: { const: "service" },
            endpoints: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "target", "auth"],
                properties: {
                  key: { type: "string", minLength: 1 },
                  target: { type: "string", minLength: 1 },
                  auth: { enum: ["service-role-jwt", "oidc", "shared-secret"] },
                },
              },
            },
          },
        },
      ],
    },

    hostApiRange: {
      type: "object",
      additionalProperties: false,
      required: ["minimum"],
      properties: {
        minimum: { type: "string", pattern: SEMVER_PATTERN },
        maximum: { type: "string", pattern: SEMVER_PATTERN },
      },
    },

    pluginDataSchemaVersion: { type: "integer", minimum: 1 },
    requiredPlatformSchemaVersion: { type: "string", pattern: "^\\d{14}$" },

    supportedInstallContracts: {
      type: "object",
      additionalProperties: false,
      required: ["minimum", "maximum"],
      properties: {
        minimum: { type: "string", pattern: SEMVER_PATTERN },
        maximum: { type: "string", pattern: SEMVER_PATTERN },
      },
    },

    releaseInputs: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
    },

    routes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "label"],
        properties: {
          path: { type: "string" },
          label: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          minimumRole: { enum: [...SURFACE_ACCESS_LEVELS] },
          navSection: { enum: ["plugin", "organization", "hidden"] },
        },
      },
    },

    navigation: {
      type: "object",
      additionalProperties: false,
      properties: {
        navLabel: { type: "string" },
        organizationPageChrome: { enum: ["default", "workspace"] },
      },
    },

    capabilities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "kind", "description"],
        properties: {
          key: { type: "string" },
          kind: {
            enum: [
              "server-action",
              "route-handler",
              "cron",
              "webhook",
              "external-api",
              "ai",
              "workflow",
            ],
          },
          description: { type: "string" },
          route: { type: "string" },
          minimumRole: { enum: [...SURFACE_ACCESS_LEVELS] },
          idempotencyRequired: { type: "boolean" },
        },
      },
    },

    requiredScopes: { type: "array", items: { type: "string" } },

    configSchema: {
      type: "object",
      additionalProperties: false,
      required: ["type", "properties"],
      properties: {
        type: { const: "object" },
        properties: {
          type: "object",
          additionalProperties: { $ref: "#/$defs/configProperty" },
        },
        required: { type: "array", items: { type: "string" } },
        additionalProperties: { type: "boolean" },
      },
    },
    configVisibility: {
      type: "object",
      additionalProperties: { enum: ["admin", "staff", "hidden"] },
    },

    dataIsolation: { const: "shared" },

    dataAccess: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["schema", "relation", "access", "purpose"],
        properties: {
          schema: { type: "string" },
          relation: { type: "string" },
          access: {
            enum: [
              "server-only",
              "rls-client",
              "public-read-model",
              "rpc",
              "background-job",
            ],
          },
          purpose: { type: "string" },
          containsPersonalData: { type: "boolean" },
          containsSensitiveData: { type: "boolean" },
          tenantColumn: { type: "string" },
        },
      },
    },

    storageAccess: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["bucket", "pathPattern", "access", "purpose"],
        properties: {
          bucket: { enum: [...PLUGIN_STORAGE_BUCKETS] },
          pathPattern: { type: "string" },
          access: {
            enum: [
              "public-read",
              "authenticated-read",
              "staff-only",
              "server-only",
            ],
          },
          purpose: { type: "string" },
        },
      },
    },

    dataDeletion: {
      type: "object",
      additionalProperties: false,
      required: [
        "reviewed",
        "reviewedAt",
        "execution",
        "dataTargets",
        "storageTargets",
        "externalSystemsNotCovered",
      ],
      properties: {
        reviewed: { const: true },
        // A pattern rather than `format: "date"`: the base Ajv build has no
        // format vocabulary, so a format keyword here would be silently
        // ignored and the constraint would only look enforced.
        reviewedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        execution: {
          type: "object",
          additionalProperties: false,
          required: ["atomicity", "retrySafety"],
          properties: {
            atomicity: { enum: ["transactional", "non-transactional"] },
            retrySafety: { enum: ["idempotent", "manual-reconciliation"] },
          },
        },
        dataTargets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["schema", "relation", "tenantColumn", "disposition"],
            properties: {
              schema: { type: "string" },
              relation: { type: "string" },
              tenantColumn: { type: ["string", "null"] },
              disposition: { enum: ["delete", "retain"] },
              reason: { type: "string" },
            },
          },
        },
        storageTargets: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["bucket", "pathPattern", "disposition"],
            properties: {
              bucket: { type: "string" },
              pathPattern: { type: "string" },
              disposition: { enum: ["delete", "retain"] },
              reason: { type: "string" },
            },
          },
        },
        externalSystemsNotCovered: { type: "array", items: { type: "string" } },
      },
    },
  },
  $defs: {
    configProperty: configPropertySchema,
    jsonValue: jsonValueSchema,
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(manifestSchema);

function escapeJsonPointerSegment(segment: string) {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * Locate values that JSON cannot preserve. This runs before Ajv because a
 * circular object can make a recursive JSON Schema validator recurse forever.
 */
function findNonJsonValue(
  value: unknown,
  path = "",
  ancestors = new WeakSet<object>(),
): string | null {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return null;
    case "number":
      return Number.isFinite(value) ? null : path || "/";
    case "undefined":
    case "bigint":
    case "symbol":
    case "function":
      return path || "/";
    case "object":
      break;
  }

  if (ancestors.has(value)) return path || "/";
  ancestors.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        ancestors.delete(value);
        return `${path}/${index}`;
      }
      const invalidPath = findNonJsonValue(
        descriptor.value,
        `${path}/${index}`,
        ancestors,
      );
      if (invalidPath) {
        ancestors.delete(value);
        return invalidPath;
      }
    }
    const allowedKeys = new Set([
      "length",
      ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol" || !allowedKeys.has(key)) {
        ancestors.delete(value);
        return (
          `${path}/${
            typeof key === "symbol" ? "" : escapeJsonPointerSegment(key)
          }`.replace(/\/$/u, "") || "/"
        );
      }
    }
    ancestors.delete(value);
    return null;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    ancestors.delete(value);
    return path || "/";
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      ancestors.delete(value);
      return path || "/";
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      ancestors.delete(value);
      return `${path}/${escapeJsonPointerSegment(key)}`;
    }
    const invalidPath = findNonJsonValue(
      descriptor.value,
      `${path}/${escapeJsonPointerSegment(key)}`,
      ancestors,
    );
    if (invalidPath) {
      ancestors.delete(value);
      return invalidPath;
    }
  }

  ancestors.delete(value);
  return null;
}

function toValidationErrors(
  errors: ErrorObject[] | null | undefined,
): PluginManifestValidationError[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    message: error.message ?? "is invalid",
    keyword: error.keyword,
  }));
}

function validateConfigPropertyValues(
  property: Record<string, unknown>,
  path: string,
  errors: PluginManifestValidationError[],
): void {
  let validateValue: ReturnType<Ajv["compile"]>;
  try {
    validateValue = ajv.compile(property);
  } catch {
    errors.push({
      path,
      message: "must be a valid configuration property schema",
      keyword: "configPropertySchema",
    });
    return;
  }

  for (const [minimumKey, maximumKey] of [
    ["minimum", "maximum"],
    ["minLength", "maxLength"],
  ] as const) {
    const minimum = property[minimumKey];
    const maximum = property[maximumKey];
    if (
      typeof minimum === "number" &&
      typeof maximum === "number" &&
      minimum > maximum
    ) {
      errors.push({
        path: `${path}/${maximumKey}`,
        message: `must not be below ${minimumKey}`,
        keyword: "configPropertyRange",
      });
    }
  }

  const validateCandidate = (candidate: unknown, candidatePath: string) => {
    if (validateValue(candidate)) return;
    errors.push({
      path: candidatePath,
      message: "must satisfy its enclosing configuration property schema",
      keyword: "configPropertyValue",
    });
  };

  if (Object.hasOwn(property, "default")) {
    validateCandidate(property.default, `${path}/default`);
  }
  if (Array.isArray(property.enum)) {
    property.enum.forEach((candidate, index) => {
      validateCandidate(candidate, `${path}/enum/${index}`);
    });
  }
  if (property.items && typeof property.items === "object") {
    validateConfigPropertyValues(
      property.items as Record<string, unknown>,
      `${path}/items`,
      errors,
    );
  }
  if (property.properties && typeof property.properties === "object") {
    for (const [key, child] of Object.entries(property.properties)) {
      validateConfigPropertyValues(
        child as Record<string, unknown>,
        `${path}/properties/${escapeJsonPointerSegment(key)}`,
        errors,
      );
    }
  }
}

/**
 * Structural validation plus the cross-field rules JSON Schema cannot express:
 * an ordered range, and a release-input set that actually covers the deployed
 * program for the declared profile.
 */
export function validatePluginSdkManifest(
  value: unknown,
): PluginManifestValidationResult {
  let nonJsonPath: string | null;
  try {
    nonJsonPath = findNonJsonValue(value);
  } catch {
    nonJsonPath = "/";
  }
  if (nonJsonPath) {
    return {
      valid: false,
      errors: [
        {
          path: nonJsonPath,
          message: "must be a finite, acyclic JSON value",
          keyword: "jsonSerializable",
        },
      ],
    };
  }

  const structurallyValid = validate(value);
  const errors = toValidationErrors(validate.errors);

  if (!structurallyValid) {
    return { valid: false, errors };
  }

  const manifest = value as PluginSdkManifest;

  if (manifest.configSchema) {
    for (const [index, requiredKey] of (
      manifest.configSchema.required ?? []
    ).entries()) {
      if (!Object.hasOwn(manifest.configSchema.properties, requiredKey)) {
        errors.push({
          path: `/configSchema/required/${index}`,
          message: "must name a declared configuration property",
          keyword: "configRequiredProperty",
        });
      }
    }
    for (const [key, property] of Object.entries(
      manifest.configSchema.properties,
    )) {
      validateConfigPropertyValues(
        property as unknown as Record<string, unknown>,
        `/configSchema/properties/${escapeJsonPointerSegment(key)}`,
        errors,
      );
    }
  }

  if (!isInstallContractRangeSane(manifest.supportedInstallContracts)) {
    errors.push({
      path: "/supportedInstallContracts",
      message: "maximum must not be below minimum",
      keyword: "installContractRange",
    });
  }

  if (manifest.supportedInstallContracts.maximum !== manifest.version) {
    errors.push({
      path: "/supportedInstallContracts/maximum",
      message: "must equal the manifest version",
      keyword: "installContractVersion",
    });
  }

  if (
    manifest.hostApiRange.maximum !== undefined &&
    !isInstallContractRangeSane({
      minimum: manifest.hostApiRange.minimum,
      maximum: manifest.hostApiRange.maximum,
    })
  ) {
    errors.push({
      path: "/hostApiRange",
      message: "maximum must not be below minimum",
      keyword: "hostApiRange",
    });
  }

  if (!isPluginVersionString(manifest.version)) {
    errors.push({
      path: "/version",
      message: "must be a semantic version",
      keyword: "semver",
    });
  }

  if (
    !releaseInputsAreComplete(
      manifest.runtime.profile,
      manifest.key,
      manifest.releaseInputs,
    )
  ) {
    errors.push({
      path: "/releaseInputs",
      message:
        manifest.runtime.profile === "embedded"
          ? "must include the plugin's own source subtree"
          : "must include the plugin subtree, a separate build source root, and a dependency lockfile inside that root, or the digest would not identify the deployed program",
      keyword: "releaseInputs",
    });
  }

  if (
    !(PLUGIN_RUNTIME_PROFILES as readonly string[]).includes(
      manifest.runtime.profile,
    )
  ) {
    errors.push({
      path: "/runtime/profile",
      message: "unknown runtime profile",
      keyword: "runtimeProfile",
    });
  }

  return { valid: errors.length === 0, errors };
}

export const pluginManifestJsonSchema = manifestSchema;
