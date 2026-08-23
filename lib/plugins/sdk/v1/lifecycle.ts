/**
 * Lifecycle contracts as wire shapes.
 *
 * The embedded runtime calls lifecycle hooks as in-process functions and will
 * keep doing so. These types exist so the same contract survives a process
 * boundary: everything here is JSON, with no functions, React nodes, database
 * clients, or host types crossing the line.
 *
 * The variants map one-to-one onto the host's existing lifecycle invocations,
 * so the embedded adapter translates rather than reimplements.
 */

export type PluginJsonValue =
  | string
  | number
  | boolean
  | null
  | PluginJsonValue[]
  | { [key: string]: PluginJsonValue };

export type PluginJsonObject = { [key: string]: PluginJsonValue };

export interface PluginLifecycleActor {
  id: string;
  type: "user" | "admin" | "system";
}

export interface PluginLifecycleBase {
  sdkVersion: 1;
  pluginKey: string;
  organizationId: string;
  actor: PluginLifecycleActor;
  /**
   * Required, not optional. Every lifecycle call is retryable, and a retry
   * without a stable key is a second execution rather than a resumption.
   */
  idempotencyKey: string;
}

export type PluginLifecycleRequest =
  | ({ kind: "install"; config: PluginJsonObject } & PluginLifecycleBase)
  | ({
      kind: "config_change";
      config: PluginJsonObject;
      previousConfig: PluginJsonObject;
    } & PluginLifecycleBase)
  | ({ kind: "enable"; config: PluginJsonObject } & PluginLifecycleBase)
  | ({ kind: "disable"; config: PluginJsonObject } & PluginLifecycleBase)
  | ({
      kind: "version_activation";
      config: PluginJsonObject;
      previousVersion: string;
      nextVersion: string;
    } & PluginLifecycleBase)
  /**
   * Compensation for an install whose side effects ran but whose platform row
   * failed to persist. This is not organization-initiated uninstall, which
   * deliberately runs no plugin code at all.
   */
  | ({
      kind: "uninstall_compensation";
      config: PluginJsonObject;
    } & PluginLifecycleBase)
  | ({
      kind: "permanent_data_deletion";
      confirmation: { requestId: string; reviewedAt: string };
    } & PluginLifecycleBase);

export type PluginLifecycleKind = PluginLifecycleRequest["kind"];

export interface PluginLifecycleError {
  code: string;
  /** Safe for an operator to read. Never carries configuration or row content. */
  message: string;
  retryable: boolean;
}

export type PluginLifecycleResponse =
  | { ok: true; detail?: PluginJsonObject }
  | { ok: false; error: PluginLifecycleError };

export const PLUGIN_LIFECYCLE_KINDS: readonly PluginLifecycleKind[] = [
  "install",
  "config_change",
  "enable",
  "disable",
  "version_activation",
  "uninstall_compensation",
  "permanent_data_deletion",
] as const;

export function isPluginLifecycleKind(
  value: unknown,
): value is PluginLifecycleKind {
  return (
    typeof value === "string" &&
    (PLUGIN_LIFECYCLE_KINDS as readonly string[]).includes(value)
  );
}
