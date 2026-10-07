import { editableConfigProperties } from "@/lib/plugins/config-fields";
import type { OrganizationPluginAdminSetting } from "@/types";

type ConfigSchemaProperty = NonNullable<
  OrganizationPluginAdminSetting["configSchema"]
>["properties"][string];

type ConfigFieldKind =
  "text" | "textarea" | "number" | "boolean" | "enum" | "unsupported";

export type ConfigFieldDescriptor = {
  key: string;
  label: string;
  required: boolean;
  kind: ConfigFieldKind;
  property: ConfigSchemaProperty;
};

function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase())
    .trim();
}

function resolveConfigFieldKind(
  property: ConfigSchemaProperty,
): ConfigFieldKind {
  if (Array.isArray(property.enum) && property.enum.length > 0) {
    return "enum";
  }

  if (property.type === "boolean") {
    return "boolean";
  }

  if (property.type === "number" || property.type === "integer") {
    return "number";
  }

  if (property.type === "string") {
    if (property.format === "textarea" || (property.maxLength ?? 0) > 180) {
      return "textarea";
    }

    return "text";
  }

  return "unsupported";
}

export function buildPluginConfigFields(
  schema: OrganizationPluginAdminSetting["configSchema"] | undefined,
): ConfigFieldDescriptor[] {
  if (!schema) return [];
  const required = new Set(schema.required ?? []);
  return editableConfigProperties(schema).map(([key, property]) => ({
    key,
    label: property.title ?? formatFieldLabel(key),
    required: required.has(key),
    kind: resolveConfigFieldKind(property),
    property,
  }));
}
