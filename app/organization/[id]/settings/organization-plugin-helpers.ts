import { formatDistanceToNowStrict } from "date-fns";

import type {
  OrganizationPluginAdminSetting,
  OrganizationPluginScope,
} from "@/types";

export type MarketplaceFilter = "all" | "installed" | "available" | "updates";
export type SettingsEditorMode = "guided" | "json";
export type PluginActionIntent = "install" | "uninstall";

export type PluginActionConfirmation = {
  plugin: OrganizationPluginAdminSetting;
  intent: PluginActionIntent;
} | null;

export type ConfigSchemaProperty = NonNullable<
  OrganizationPluginAdminSetting["configSchema"]
>["properties"][string];

export type ConfigFieldKind =
  "text" | "textarea" | "number" | "boolean" | "enum" | "unsupported";

export type ConfigFieldDescriptor = {
  key: string;
  label: string;
  required: boolean;
  kind: ConfigFieldKind;
  property: ConfigSchemaProperty;
};

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase())
    .trim();
}

export function stringifyConfig(config: Record<string, unknown>): string {
  return JSON.stringify(config, null, 2);
}

export function encodeEnumValue(value: unknown): string {
  return JSON.stringify(value);
}

export function decodeEnumValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function resolveConfigFieldKind(
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

export function formatOwnerTypeLabel(
  ownerType: OrganizationPluginAdminSetting["ownerType"],
): string {
  switch (ownerType) {
    case "partner":
      return "Partner";
    case "community":
      return "Community";
    case "platform-official":
    default:
      return "Platform official";
  }
}

export function formatScopeLabel(scope: OrganizationPluginScope): string {
  switch (scope) {
    case "org:read":
      return "Read organization data";
    case "org:write":
      return "Modify organization settings";
    case "members:read":
      return "Read member list";
    case "members:write":
      return "Manage members and roles";
    case "projects:read":
      return "Read projects";
    case "projects:write":
      return "Create or modify projects";
    case "signups:read":
      return "Read anonymous signups";
    case "signups:write":
      return "Modify anonymous signups";
    case "notifications:send":
      return "Send notifications";
    case "storage:read":
      return "Read storage files";
    case "storage:write":
      return "Upload and modify storage files";
    case "api:expose":
      return "Expose custom API endpoints";
    default:
      return scope;
  }
}

export function formatLastUpdated(
  lastUpdatedAt: string | null | undefined,
): string {
  if (!lastUpdatedAt) {
    return "Unknown";
  }

  const parsedDate = new Date(lastUpdatedAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown";
  }

  return formatDistanceToNowStrict(parsedDate, { addSuffix: true });
}

/** What a plugin row can ask the settings section to do. */
export type PluginRowActions = {
  updatingActionId: string | null;
  onToggle: (plugin: OrganizationPluginAdminSetting, enabled: boolean) => void;
  onRequestAction: (
    plugin: OrganizationPluginAdminSetting,
    intent: PluginActionIntent,
  ) => void;
  onRequestDataDeletion: (plugin: OrganizationPluginAdminSetting) => void;
  onUpdate: (pluginKey: string) => void;
  handleApplicationRuntime: (
    plugin: OrganizationPluginAdminSetting,
    enabled: boolean,
  ) => void;
  onConfigure: (plugin: OrganizationPluginAdminSetting) => void;
};
