/**
 * Supabase CLI v2.120.0 legacy Docker resource oracle, transcribed from source.
 * Keep this fixture independent of dv-local-env.mjs. The hermetic CLI creates
 * resources from this list so implementation drift cannot change its oracle.
 *
 * Verified source commit: 753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4.
 * https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/command-internal/docker-ids.ts#L25-L93
 * defines fourteen container names and the network. It retains the v2.117.0
 * naming rule, supabase_<service>_<project>, after project-ID sanitization.
 * https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/command-internal/db-bootstrap/container-lifecycle.ts#L665-L695
 * sets com.supabase.cli.project and com.docker.compose.project on resources.
 * Containers also carry com.supabase.cli.workdir. Volumes do not.
 * https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/command-internal/db-bootstrap/postgres.service.ts#L312
 * https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/commands/start/services/storage.service.ts#L193
 * https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/command-internal/pgdelta.ts#L49-L51
 * identify the database, storage, and edge runtime volumes.
 * https://github.com/supabase/cli/blob/v2.120.0/apps/cli/src/commands/db/shared/migra.ts#L257-L303
 * precreates the existing edge runtime cache with project labels.
 *
 * The downloaded Darwin ARM64 release archive matched both checksums.txt and
 * the GitHub release asset digest, SHA-256:
 * 3b8546cc61aeabab6fd1f68edc7f664ebdfa96bdd6a9b18d8d612708f430ae28.
 * Source verification does not claim a completed runtime acceptance run.
 *
 * SUPABASE_EXPERIMENTAL_STACK=0 is mandatory. Managed-stack names and volumes
 * are outside this oracle. DifferId exists as a constant but does not establish
 * a persistent container; migra, pg_prove, and test helpers have no stable names.
 */

export const PINNED_SUPABASE_CLI_VERSION = "2.120.0";

export const PINNED_SUPABASE_CLI_RESOURCE_PREFIXES = {
  container: [
    "supabase_db_",
    "supabase_kong_",
    "supabase_auth_",
    "supabase_inbucket_",
    "supabase_realtime_",
    "supabase_rest_",
    "supabase_storage_",
    "supabase_imgproxy_",
    "supabase_pg_meta_",
    "supabase_studio_",
    "supabase_edge_runtime_",
    "supabase_analytics_",
    "supabase_vector_",
    "supabase_pooler_",
  ],
  volume: ["supabase_db_", "supabase_storage_", "supabase_edge_runtime_"],
  network: ["supabase_network_"],
} as const;

/**
 * Names a previous revision wrongly treated as created, stable resources. None
 * of these may ever reappear in the implementation contract: each would either
 * grant deletion authority over something the CLI never created, or mask a
 * genuinely foreign resource during the post-start ownership proof.
 */
export const PINNED_SUPABASE_CLI_UNSUPPORTED_PREFIXES = {
  container: [
    "supabase_differ_",
    "supabase_migra_",
    "supabase_pg_prove_",
    "supabase_test_",
    "realtime-dev.supabase_realtime_",
    "storage_imgproxy_",
  ],
  volume: ["supabase_config_", "supabase_inbucket_"],
  network: [],
} as const;

export type PinnedResourceKind =
  keyof typeof PINNED_SUPABASE_CLI_RESOURCE_PREFIXES;

export const PINNED_RESOURCE_KINDS: PinnedResourceKind[] = [
  "container",
  "volume",
  "network",
];

/** The exact resource names the pinned CLI creates for one isolated project. */
export function pinnedResourceNames(
  projectId: string,
  kind: PinnedResourceKind,
) {
  return PINNED_SUPABASE_CLI_RESOURCE_PREFIXES[kind].map(
    (prefix) => `${prefix}${projectId}`,
  );
}

export function pinnedUnsupportedNames(
  projectId: string,
  kind: PinnedResourceKind,
) {
  return PINNED_SUPABASE_CLI_UNSUPPORTED_PREFIXES[kind].map(
    (prefix) => `${prefix}${projectId}`,
  );
}

export function pinnedDatabaseVolumeName(projectId: string) {
  return `supabase_db_${projectId}`;
}
