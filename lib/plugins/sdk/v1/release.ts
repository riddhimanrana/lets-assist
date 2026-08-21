/**
 * Release identity: what a published version actually is.
 *
 * A release is immutable code plus the metadata needed to decide whether it may
 * run for a given organization. It is deliberately distinct from a deployment
 * (that release running somewhere) and from an installation (an organization
 * having activated it).
 */

import type { PluginInstallContractRange } from "./compatibility";
import type { PluginRuntimeProfile } from "./runtime-profile";

/**
 * The source subtrees whose bytes constitute a release.
 *
 * This exists because a digest is only an integrity claim about the inputs it
 * covers. An `embedded` plugin's program is its own subtree. An `application`
 * plugin's program is its subtree *plus* the child application that imports it
 * *plus* the dependency lock that pins what gets built — so a digest over the
 * plugin subtree alone would sign something other than the code that ran.
 *
 * Paths are repository-relative, POSIX-separated, and sorted before hashing.
 */
export type PluginReleaseInputs = string[];

export interface PluginReleaseSigner {
  /** Certificate subject identity, e.g. the signing workflow's URI. */
  identity: string;
  /** OIDC issuer. Verification must constrain this, not only the identity. */
  issuer: string;
  /** Where the signature bundle lives, relative to the repository. */
  attestationRef: string;
}

export interface PluginSingleEnvironmentBuildArtifact {
  name: "plugin-build.tar.gz";
  format: "vercel-prebuilt-v1";
  root: string;
  projectName: string;
  projectId: string;
  organizationId: string;
}

export interface PluginEnvironmentBuild {
  name: "plugin-build-development.tar.gz" | "plugin-build-production.tar.gz";
  digest: string;
}

export interface PluginMultiEnvironmentBuildArtifact {
  format: "vercel-prebuilt-multi-env-v1";
  root: string;
  projectName: string;
  projectId: string;
  organizationId: string;
  artifacts: {
    development: PluginEnvironmentBuild;
    production: PluginEnvironmentBuild;
  };
}

export type PluginBuildArtifact =
  PluginSingleEnvironmentBuildArtifact | PluginMultiEnvironmentBuildArtifact;

export interface PluginReleaseIdentity {
  pluginKey: string;
  version: string;
  runtimeProfile: PluginRuntimeProfile;

  /** Exact commit the release was cut from. */
  sourceCommit: string;
  /**
   * Git tree object id of the plugin subtree at `sourceCommit`. Cheap exact
   * equality check: a descendant commit that left the subtree untouched has the
   * same tree id, while any change to the plugin produces a different one.
   */
  sourceTree: string;
  /** Declared inputs the content digest covers. */
  releaseInputs: PluginReleaseInputs;
  /** Digest over every declared input. */
  contentDigest: string;
  /** Digest of the manifest file alone. Retained for continuity. */
  manifestDigest: string;

  /**
   * Digest of the built artifact. Null is honest for `embedded`, whose artifact
   * is the host build; required for profiles that build independently.
   */
  buildDigest: string | null;
  buildArtifact: PluginBuildArtifact | null;
  sbomDigest: string | null;
  signer: PluginReleaseSigner | null;

  supportedInstallContracts: PluginInstallContractRange;
  hostApiRange: PluginHostApiRange;
  pluginDataSchemaVersion: number;
  requiredPlatformSchemaVersion: string;

  changelog: string;
  /** Plugin-scoped tag, e.g. `dvhs-csf/v1.2.0`. Null for pre-tagging releases. */
  releaseTag: string | null;
}

/** Host API versions a release is known to work against. */
export interface PluginHostApiRange {
  minimum: string;
  maximum?: string;
}

export const PLUGIN_TREE_DIGEST_ALGORITHM = "la-plugin-tree-v1" as const;

/**
 * The inputs an `application` or `service` release must declare beyond its own
 * plugin subtree. Used by manifest validation to reject a release whose digest
 * would silently omit the code that actually runs.
 */
export function releaseInputsAreComplete(
  profile: PluginRuntimeProfile,
  pluginKey: string,
  inputs: PluginReleaseInputs | null | undefined,
): boolean {
  if (!Array.isArray(inputs) || inputs.length === 0) return false;

  const normalized = inputs.map((entry) => entry.trim()).filter(Boolean);
  if (normalized.length !== inputs.length) return false;

  const ownsPluginSubtree = normalized.some(
    (entry) =>
      entry === `plugins/${pluginKey}` ||
      entry.startsWith(`plugins/${pluginKey}/`),
  );
  if (!ownsPluginSubtree) return false;

  if (profile === "embedded") return true;

  // An independently built profile must also pin what it builds. Without a
  // lockfile the same declared sources can resolve to different dependencies,
  // so the digest would not identify the deployed program.
  return normalized.some((entry) =>
    /(?:^|\/)(?:bun\.lock|bun\.lockb|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(
      entry,
    ),
  );
}

const HEX_40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/u;

export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && HEX_40.test(value);
}

export function isContentDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}
