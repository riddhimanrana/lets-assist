const reviewedReleases = [
  {
    plugin_key: "dv-speech-debate",
    version: "2.0.3",
    commit_sha: "d100831bd2fe3374715de20510d9ae2a77dcfba8",
    manifest_hash:
      "c01b1846be90ed60dfc8a862063a0e10d19507b403738998acc8369be151b203",
    source_tree: "c04f8a0dc45e4820aee4847afb32defdd7646fc3",
    content_digest:
      "sha256:4494a5ffe6131dcc474ec9d64db5832754dbca5b2fdb61ded711a5c8f93c1395",
    release_inputs: ["plugins/dv-speech-debate"],
    build_digest: null,
    sbom_digest:
      "sha256:ccb135724d41b41db0a067642536806134088fbdde881968bd81f18f6e364a45",
    signer_identity: {
      identity:
        "https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dv-speech-debate/v2.0.3",
      issuer: "https://token.actions.githubusercontent.com",
      attestationRef:
        "github-release:dv-speech-debate/v2.0.3/release-manifest.sigstore.json",
    },
    host_api_range: {
      minimum: "1.0.0",
    },
    plugin_data_schema_version: 1,
    required_platform_schema_version: "20261008020000",
    supported_install_contracts: {
      minimum: "2.0.0",
      maximum: "2.0.3",
    },
    runtime_profile: "embedded",
    rollout_percentage: 0,
    status: "published",
    compatibility_contract: {
      host: "lets-assist",
      automaticUpdate: false,
    },
  },
  {
    plugin_key: "dvhs-csf",
    version: "1.2.87",
    commit_sha: "2c55aba805d50a981d1bc50c0755dcde5c7830ca",
    manifest_hash:
      "3e09c5fa4e8695634ddcc1c93083359d51a7963dcb2ee1e0f6240cffa4017fa6",
    source_tree: "bf58526324f1209a17142c39796361d16a0d23da",
    content_digest:
      "sha256:f3d80ca402f807edc8da800b2d69e431d5f4e2cb63435bbc34bd899305174f62",
    release_inputs: ["plugins/dvhs-csf"],
    build_digest: null,
    sbom_digest:
      "sha256:9b699cf53efe7107ba85f7091bd105e2910cc2c5ba0802bad04fba62984adf00",
    signer_identity: {
      identity:
        "https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.87",
      issuer: "https://token.actions.githubusercontent.com",
      attestationRef:
        "github-release:dvhs-csf/v1.2.87/release-manifest.sigstore.json",
    },
    host_api_range: {
      minimum: "1.0.0",
      maximum: "1.0.0",
    },
    plugin_data_schema_version: 1,
    required_platform_schema_version: "20261009030000",
    supported_install_contracts: {
      minimum: "1.1.0",
      maximum: "1.2.87",
    },
    runtime_profile: "embedded",
    rollout_percentage: 0,
    status: "published",
    compatibility_contract: {
      host: "lets-assist",
      automaticUpdate: false,
    },
  },
];

export function publishedEmbedded721Catalog(previousCatalog) {
  const rows = reviewedReleases
    .map(
      (release) =>
        `('${JSON.stringify(release).replaceAll("'", "''")}'::jsonb)`,
    )
    .join(",\n");
  return `SELECT CASE WHEN (${previousCatalog.replace(/;\s*$/u, "")}) = 1
AND NOT EXISTS (
  SELECT 1 FROM (VALUES ${rows}) expected(identity)
  LEFT JOIN public.plugin_versions release
    ON release.plugin_key = expected.identity->>'plugin_key'
    AND release.version = expected.identity->>'version'
  LEFT JOIN public.plugins catalog ON catalog.key = release.plugin_key
  WHERE release.plugin_key IS NULL
    OR NOT (to_jsonb(release) @> expected.identity)
    OR catalog.latest_version IS DISTINCT FROM release.version
    OR catalog.code_reference IS DISTINCT FROM release.commit_sha
) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
