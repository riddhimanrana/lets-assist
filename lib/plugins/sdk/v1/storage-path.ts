/**
 * The private plugin storage grammar.
 *
 * Every organization-owned plugin file lives at
 * `plugins/{organizationId}/{pluginKey}/{resource...}`. The rules here are the
 * authority for that shape and are byte-compatible with the private repo's
 * `plugin-storage.ts`, which shipped the same grammar first; a parity test
 * keeps the two from drifting until that module re-exports this one.
 *
 * Path construction is the only sanctioned way to address plugin storage,
 * because the bucket has no row-level policies at all: scope is enforced
 * entirely by the server code that builds the key. A traversal or a wrong
 * prefix is therefore a tenancy break, not a 404.
 */

export const PRIVATE_PLUGIN_STORAGE_BUCKET = "plugins";

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLUGIN_KEY_PATTERN = /^[a-z0-9][a-z0-9-_.]*$/u;

export function isCanonicalOrganizationId(value: unknown): value is string {
  return typeof value === "string" && ORGANIZATION_ID_PATTERN.test(value);
}

export function isCanonicalPluginKey(value: unknown): value is string {
  return typeof value === "string" && PLUGIN_KEY_PATTERN.test(value);
}

/**
 * Rejects anything that could escape or blur the tenant prefix: absolute
 * paths, trailing separators, backslashes, empty segments, and both dot
 * segments.
 */
export function isCanonicalStorageSuffix(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value) return false;
  if (value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("\\")) return false;

  return value
    .split("/")
    .every(
      (segment) => Boolean(segment) && segment !== "." && segment !== "..",
    );
}

export interface PluginStoragePathInput {
  organizationId: string;
  pluginKey: string;
  /** Either a pre-joined suffix or the resource segments. */
  resource: string | string[];
}

export function buildPluginStoragePath(input: PluginStoragePathInput): string {
  const suffix = Array.isArray(input.resource)
    ? input.resource.join("/")
    : input.resource;

  if (!isCanonicalOrganizationId(input.organizationId)) {
    throw new Error("A canonical organization identifier is required.");
  }
  if (!isCanonicalPluginKey(input.pluginKey)) {
    throw new Error("A canonical plugin key is required.");
  }
  if (!isCanonicalStorageSuffix(suffix)) {
    throw new Error("A canonical plugin storage suffix is required.");
  }

  return `${input.organizationId}/${input.pluginKey}/${suffix}`;
}

export interface ParsedPluginStoragePath {
  organizationId: string;
  pluginKey: string;
  resource: string[];
}

export function parsePluginStoragePath(
  name: string,
): ParsedPluginStoragePath | null {
  if (typeof name !== "string" || !name) return null;

  const segments = name.split("/");
  if (segments.length < 3) return null;

  const [organizationId, pluginKey, ...resource] = segments;
  if (!isCanonicalOrganizationId(organizationId)) return null;
  if (!isCanonicalPluginKey(pluginKey)) return null;
  if (!isCanonicalStorageSuffix(resource.join("/"))) return null;

  return { organizationId, pluginKey, resource };
}

/**
 * Whether an existing object key belongs to exactly one organization and
 * plugin. Used before every read, move, and delete, so an operation cannot
 * reach across a tenant boundary even when handed a key from elsewhere.
 */
export function isPathWithinPluginNamespace(
  name: string,
  organizationId: string,
  pluginKey: string,
): boolean {
  const parsed = parsePluginStoragePath(name);
  if (!parsed) return false;

  return (
    parsed.organizationId === organizationId && parsed.pluginKey === pluginKey
  );
}

/** The prefix every key for one organization and plugin must start with. */
export function pluginStorageNamespacePrefix(
  organizationId: string,
  pluginKey: string,
): string {
  if (!isCanonicalOrganizationId(organizationId)) {
    throw new Error("A canonical organization identifier is required.");
  }
  if (!isCanonicalPluginKey(pluginKey)) {
    throw new Error("A canonical plugin key is required.");
  }

  return `${organizationId}/${pluginKey}/`;
}
