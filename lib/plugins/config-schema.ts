import Ajv from "ajv";

const ajv = new Ajv({ allErrors: false });

export interface PluginConfigSchema {
  $schema?: string;
  type: "object";
  properties: Record<string, ConfigPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ConfigPropertySchema {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: ConfigPropertySchema;
  properties?: Record<string, ConfigPropertySchema>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

/**
 * Validate plugin configuration against its schema
 */
export function validatePluginConfig(
  config: Record<string, unknown>,
  schema: PluginConfigSchema,
): ValidationResult {
  const validate = ajv.compile(schema);
  const valid = validate(config);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validate.errors ?? []).map((err) => ({
    path: (err as { instancePath?: string }).instancePath || "/",
    message: err.message ?? "Invalid value",
    keyword: err.keyword,
  }));

  return { valid: false, errors };
}

/**
 * Apply default values from schema to config
 */
export function applyConfigDefaults(
  config: Record<string, unknown>,
  schema: PluginConfigSchema,
): Record<string, unknown> {
  const result = { ...config };

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!(key in result) && propSchema.default !== undefined) {
      result[key] = propSchema.default;
    }

    // Recursively apply defaults to nested objects
    if (
      propSchema.type === "object" &&
      propSchema.properties &&
      result[key] &&
      typeof result[key] === "object"
    ) {
      result[key] = applyConfigDefaults(
        result[key] as Record<string, unknown>,
        {
          type: "object",
          properties: propSchema.properties,
        },
      );
    }
  }

  return result;
}

/**
 * Generate a human-readable form from a config schema
 * Used by the admin UI to auto-generate config forms
 */
export interface ConfigFormField {
  key: string;
  type: "text" | "number" | "checkbox" | "select" | "textarea" | "json";
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: unknown }[];
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

export function generateConfigFormFields(
  schema: PluginConfigSchema,
): ConfigFormField[] {
  const fields: ConfigFormField[] = [];
  const required = new Set(schema.required ?? []);

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const field: ConfigFormField = {
      key,
      type: mapSchemaTypeToFormType(propSchema),
      label: propSchema.title ?? formatKeyAsLabel(key),
      description: propSchema.description,
      required: required.has(key),
      defaultValue: propSchema.default,
    };

    // Add enum options
    if (propSchema.enum) {
      field.options = propSchema.enum.map((value) => ({
        label: String(value),
        value,
      }));
    }

    // Add validation rules
    if (
      propSchema.minimum !== undefined ||
      propSchema.maximum !== undefined ||
      propSchema.minLength !== undefined ||
      propSchema.maxLength !== undefined ||
      propSchema.pattern
    ) {
      field.validation = {
        min: propSchema.minimum,
        max: propSchema.maximum,
        minLength: propSchema.minLength,
        maxLength: propSchema.maxLength,
        pattern: propSchema.pattern,
      };
    }

    fields.push(field);
  }

  return fields;
}

function mapSchemaTypeToFormType(
  schema: ConfigPropertySchema,
): ConfigFormField["type"] {
  if (schema.enum) return "select";

  switch (schema.type) {
    case "boolean":
      return "checkbox";
    case "number":
    case "integer":
      return "number";
    case "array":
    case "object":
      return "json";
    case "string":
      if (schema.format === "textarea" || (schema.maxLength ?? 0) > 200) {
        return "textarea";
      }
      return "text";
    default:
      return "text";
  }
}

function formatKeyAsLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

/**
 * Example plugin config schema
 */
export const examplePluginConfigSchema: PluginConfigSchema = {
  type: "object",
  properties: {
    enabled_features: {
      type: "array",
      title: "Enabled Features",
      description: "Select which features to enable",
      items: {
        type: "string",
        enum: ["feature_a", "feature_b", "feature_c"],
      },
      default: ["feature_a"],
    },
    max_items: {
      type: "integer",
      title: "Maximum Items",
      description: "Maximum number of items to display",
      minimum: 1,
      maximum: 100,
      default: 10,
    },
    custom_message: {
      type: "string",
      title: "Custom Message",
      description: "Optional custom message to display",
      maxLength: 500,
    },
    notify_admins: {
      type: "boolean",
      title: "Notify Admins",
      description: "Send notifications to org admins",
      default: false,
    },
  },
  required: ["enabled_features", "max_items"],
  additionalProperties: false,
};
