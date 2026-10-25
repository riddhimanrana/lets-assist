// Exact signed1.2.89 publication. No organization install is advanced.
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
    version: "1.2.89",
    commit_sha: "f116483844d8bfc04c99899c1e38d501a01be191",
    manifest_hash:
      "294820838a4efd49d089230a506847e0b15b24a5313f8f68bccb41fd5c9c348d",
    source_tree: "a5366fbb9ba6e7fca88d513702c2ad121f120420",
    content_digest:
      "sha256:36ffd4e5a5df6e47ee2baf8226a185e8546da8ee88425c75d1974bb563be603d",
    release_inputs: ["plugins/dvhs-csf"],
    build_digest: null,
    sbom_digest:
      "sha256:c3514cea442bc7e9d41cea5de2e50b0364d5a9130d83c84f22dec5c1a22e0d91",
    signer_identity: {
      identity:
        "https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.89",
      issuer: "https://token.actions.githubusercontent.com",
      attestationRef:
        "github-release:dvhs-csf/v1.2.89/release-manifest.sigstore.json",
    },
    host_api_range: {
      minimum: "1.0.0",
      maximum: "1.0.0",
    },
    plugin_data_schema_version: 1,
    required_platform_schema_version: "20261011110000",
    supported_install_contracts: {
      minimum: "1.1.0",
      maximum: "1.2.89",
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

export function publishedEmbedded732Catalog(previousCatalog) {
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
