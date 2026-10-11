// Exact signed1.2.88 publication. No organization install is advanced.
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
    version: "1.2.88",
    commit_sha: "4322648cebb79a82d050105910b5c2faf6ee44d8",
    manifest_hash:
      "81a5741a2957d479bfca021fa51399997676e586c57fb29e3877507289a9d4a0",
    source_tree: "f89b9baf27d4a28dd2ad6201a8d5c79d24a13a9a",
    content_digest:
      "sha256:780b5a7d9e4f5b87c7bdfc75eb9ea66e635a2a913b7bb1881ef15a295b6c8af0",
    release_inputs: ["plugins/dvhs-csf"],
    build_digest: null,
    sbom_digest:
      "sha256:a1fbd8ce5009bcc9c99a138fc438cfbc2447fa086d20e92fe02d2b64fa9546ed",
    signer_identity: {
      identity:
        "https://github.com/riddhimanrana/lets-assist-plugins/.github/workflows/plugin-release.yml@refs/tags/dvhs-csf/v1.2.88",
      issuer: "https://token.actions.githubusercontent.com",
      attestationRef:
        "github-release:dvhs-csf/v1.2.88/release-manifest.sigstore.json",
    },
    host_api_range: {
      minimum: "1.0.0",
      maximum: "1.0.0",
    },
    plugin_data_schema_version: 1,
    required_platform_schema_version: "20261011110000",
    supported_install_contracts: {
      minimum: "1.1.0",
      maximum: "1.2.88",
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

export function publishedEmbedded731Catalog(previousCatalog) {
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
