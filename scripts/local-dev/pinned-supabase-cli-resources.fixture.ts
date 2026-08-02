/**
 * Pinned Supabase CLI v2.111.0 Docker resource oracle.
 *
 * This is a literal transcription of the resources the pinned CLI's legacy shell
 * actually creates. It is deliberately independent of
 * `scripts/local-dev/dv-local-env.mjs`: the implementation is asserted against
 * this file, and the hermetic fake CLI materializes its "observed" resources
 * from this file, so an implementation drift cannot be hidden by a fake that
 * drifted the same way.
 *
 * Provenance (verified against the tag, not inferred from local behaviour):
 * - Release workflow for `v2.111.0` selects the legacy shell.
 * - `apps/cli-go/internal/utils/config.go` @ `v2.111.0` assigns the identifiers:
 *   NetId "supabase_network_", DbId "supabase_db_", KongId "supabase_kong_",
 *   GotrueId "supabase_auth_", InbucketId "supabase_inbucket_",
 *   RealtimeId "supabase_realtime_", RestId "supabase_rest_",
 *   StorageId "supabase_storage_", ImgProxyId "supabase_imgproxy_",
 *   DifferId "supabase_differ_", PgmetaId "supabase_pg_meta_",
 *   StudioId "supabase_studio_", EdgeRuntimeId "supabase_edge_runtime_",
 *   LogflareId "supabase_analytics_", VectorId "supabase_vector_",
 *   PoolerId "supabase_pooler_". Every identifier is `supabase_<name>_` +
 *   `Config.ProjectId` via GetId(); there is no `realtime-dev.` container form
 *   and no `storage_imgproxy_` container form at this tag.
 * - `apps/cli-go/internal/utils/docker.go` @ `v2.111.0` labels resources with
 *   `com.supabase.cli.project`.
 * - `apps/cli-go/internal/start/start.go` documents the legacy start topology;
 *   the distributed `v2.111.0` CLI creates named volumes for database, storage,
 *   and edge runtime state. The launcher verifies the observed names and project
 *   labels before recording ownership.
 *
 * DifferId exists as a constant but the tagged implementation does not create a
 * persistent named differ container, and migra / pg_prove / test helpers run
 * without stable container names. A constant alone is not a cleanup target.
 */

export const PINNED_SUPABASE_CLI_VERSION = "2.111.0";

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
  volume: [
    "supabase_config_",
    "supabase_inbucket_",
  ],
  network: [],
} as const;

export type PinnedResourceKind = keyof typeof PINNED_SUPABASE_CLI_RESOURCE_PREFIXES;

export const PINNED_RESOURCE_KINDS: PinnedResourceKind[] = [
  "container",
  "volume",
  "network",
];

/** The exact resource names the pinned CLI creates for one isolated project. */
export function pinnedResourceNames(projectId: string, kind: PinnedResourceKind) {
  return PINNED_SUPABASE_CLI_RESOURCE_PREFIXES[kind].map(
    (prefix) => `${prefix}${projectId}`,
  );
}

export function pinnedUnsupportedNames(projectId: string, kind: PinnedResourceKind) {
  return PINNED_SUPABASE_CLI_UNSUPPORTED_PREFIXES[kind].map(
    (prefix) => `${prefix}${projectId}`,
  );
}

export function pinnedDatabaseVolumeName(projectId: string) {
  return `supabase_db_${projectId}`;
}
