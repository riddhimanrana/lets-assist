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
    default: {},
    enum: { type: "array" },
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
    requiredPlatformSchemaVersion: { type: "string", minLength: 1 },

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
  $defs: { configProperty: configPropertySchema },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(manifestSchema);

function toValidationErrors(
  errors: ErrorObject[] | null | undefined,
): PluginManifestValidationError[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    message: error.message ?? "is invalid",
    keyword: error.keyword,
  }));
}

/**
 * Structural validation plus the cross-field rules JSON Schema cannot express:
 * an ordered range, and a release-input set that actually covers the deployed
 * program for the declared profile.
 */
export function validatePluginSdkManifest(
  value: unknown,
): PluginManifestValidationResult {
  const structurallyValid = validate(value);
  const errors = toValidationErrors(validate.errors);

  if (!structurallyValid) {
    return { valid: false, errors };
  }

  const manifest = value as PluginSdkManifest;

  if (!isInstallContractRangeSane(manifest.supportedInstallContracts)) {
    errors.push({
      path: "/supportedInstallContracts",
      message: "maximum must not be below minimum",
      keyword: "installContractRange",
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
          : "must include the plugin subtree and a dependency lockfile, or the digest would not identify the deployed program",
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
