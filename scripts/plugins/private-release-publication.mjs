import { readdirSync } from "node:fs";

const MIGRATION_VERSION = /^\d{14}$/u;
const fail = (message) => {
  throw new Error(message);
};

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function formatMigrationDate(date) {
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${part(date.getUTCMonth() + 1)}${part(date.getUTCDate())}${part(date.getUTCHours())}${part(date.getUTCMinutes())}${part(date.getUTCSeconds())}`;
}

function parseMigrationDate(value) {
  if (!MIGRATION_VERSION.test(value))
    fail("invalid migration ledger timestamp");
  const date = new Date(
    Date.UTC(
      Number.parseInt(value.slice(0, 4), 10),
      Number.parseInt(value.slice(4, 6), 10) - 1,
      Number.parseInt(value.slice(6, 8), 10),
      Number.parseInt(value.slice(8, 10), 10),
      Number.parseInt(value.slice(10, 12), 10),
      Number.parseInt(value.slice(12, 14), 10),
    ),
  );
  if (formatMigrationDate(date) !== value)
    fail("invalid migration ledger date");
  return date;
}

export function nextMigrationVersion(migrationsDir, now = new Date()) {
  const versions = readdirSync(migrationsDir)
    .map((file) => /^(\d{14})_/u.exec(file)?.[1])
    .filter(Boolean)
    .sort();
  const latest = versions.at(-1);
  if (!latest) return formatMigrationDate(now);
  const afterLatest = new Date(parseMigrationDate(latest).getTime() + 1000);
  return formatMigrationDate(afterLatest > now ? afterLatest : now);
}

function buildPublicationStatement(
  manifest,
  releaseNotes,
  catalogRelease,
  attestationRef,
) {
  const manifestHash = manifest.manifestDigest.slice("sha256:".length);
  const signer = {
    identity: manifest.signerIdentity.subject,
    issuer: manifest.signerIdentity.issuer,
    attestationRef,
  };
  const compatibility = { host: "lets-assist", automaticUpdate: false };
  const catalogUpdate =
    manifest.runtimeProfile === "embedded"
      ? `UPDATE public.plugins
  SET latest_version = ${sqlString(manifest.version)},
      code_reference = ${sqlString(manifest.sourceCommit)},
      updated_at = now()
  WHERE key = ${sqlString(manifest.pluginKey)}
    AND latest_version = ${sqlString(catalogRelease.version)}
    AND code_reference = ${sqlString(catalogRelease.sourceCommit)};

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.plugins
    WHERE key = ${sqlString(manifest.pluginKey)}
      AND latest_version = ${sqlString(manifest.version)}
      AND code_reference = ${sqlString(manifest.sourceCommit)}
  ) THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;`
      : `PERFORM 1
  FROM public.plugins
  WHERE key = ${sqlString(manifest.pluginKey)}
    AND latest_version = ${sqlString(catalogRelease.version)}
    AND code_reference = ${sqlString(catalogRelease.sourceCommit)};

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plugin catalog moved since this signed integration was prepared';
  END IF;`;

  return `DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = ${sqlString(manifest.pluginKey)}
    AND version = ${sqlString(manifest.version)};

  IF FOUND THEN
    IF v_existing.status IS DISTINCT FROM 'published'
      OR v_existing.commit_sha IS DISTINCT FROM ${sqlString(manifest.sourceCommit)}
      OR v_existing.manifest_hash IS DISTINCT FROM ${sqlString(manifestHash)}
      OR v_existing.source_tree IS DISTINCT FROM ${sqlString(manifest.sourceTree)}
      OR v_existing.content_digest IS DISTINCT FROM ${sqlString(manifest.contentDigest)}
      OR v_existing.release_inputs IS DISTINCT FROM ${sqlJson(manifest.releaseInputs)}
      OR v_existing.build_digest IS DISTINCT FROM ${manifest.buildDigest === null ? "NULL" : sqlString(manifest.buildDigest)}
      OR v_existing.sbom_digest IS DISTINCT FROM ${sqlString(manifest.sbomDigest)}
      OR v_existing.signer_identity IS DISTINCT FROM ${sqlJson(signer)}
      OR v_existing.host_api_range IS DISTINCT FROM ${sqlJson(manifest.hostApiRange)}
      OR v_existing.plugin_data_schema_version IS DISTINCT FROM ${manifest.pluginDataSchemaVersion}
      OR v_existing.required_platform_schema_version IS DISTINCT FROM ${sqlString(manifest.requiredPlatformSchemaVersion)}
      OR v_existing.supported_install_contracts IS DISTINCT FROM ${sqlJson(manifest.supportedInstallContracts)}
      OR v_existing.runtime_profile IS DISTINCT FROM ${sqlString(manifest.runtimeProfile)}
      OR v_existing.rollout_percentage IS DISTINCT FROM 0
    THEN
      RAISE EXCEPTION 'Existing plugin release conflicts with the signed release identity';
    END IF;
  ELSE
    INSERT INTO public.plugin_versions (
      plugin_key, version, status, changelog, commit_sha, manifest_hash,
      compatibility_contract, rollout_percentage, source_tree, content_digest,
      release_inputs, build_digest, sbom_digest, signer_identity, host_api_range,
      plugin_data_schema_version, required_platform_schema_version,
      supported_install_contracts, runtime_profile, published_at
    ) VALUES (
      ${sqlString(manifest.pluginKey)},
      ${sqlString(manifest.version)},
      'published',
      ${sqlString(releaseNotes)},
      ${sqlString(manifest.sourceCommit)},
      ${sqlString(manifestHash)},
      ${sqlJson(compatibility)},
      0,
      ${sqlString(manifest.sourceTree)},
      ${sqlString(manifest.contentDigest)},
      ${sqlJson(manifest.releaseInputs)},
      ${manifest.buildDigest === null ? "NULL" : sqlString(manifest.buildDigest)},
      ${sqlString(manifest.sbomDigest)},
      ${sqlJson(signer)},
      ${sqlJson(manifest.hostApiRange)},
      ${manifest.pluginDataSchemaVersion},
      ${sqlString(manifest.requiredPlatformSchemaVersion)},
      ${sqlJson(manifest.supportedInstallContracts)},
      ${sqlString(manifest.runtimeProfile)},
      now()
    );
  END IF;

  ${catalogUpdate}
END;
$$;
`;
}

export function buildMigration(...args) {
  return `-- Publish a signed private plugin release without changing organization installs.\n\nBEGIN;\n\n${buildPublicationStatement(...args)}\nCOMMIT;\n`;
}

export function buildBatchMigration(plans) {
  const statements = plans.map(
    ({ manifest, releaseNotes, catalogRelease, attestationRef }) =>
      buildPublicationStatement(
        manifest,
        releaseNotes,
        catalogRelease,
        attestationRef,
      ),
  );
  return `-- Publish verified private releases together without changing organization installs.\n\nBEGIN;\n\n${statements.join("\n")}\nCOMMIT;\n`;
}

export function buildMigrationTest(manifest, catalogRelease) {
  const manifestHash = manifest.manifestDigest.slice("sha256:".length);
  const expectedCatalogVersion =
    manifest.runtimeProfile === "embedded"
      ? manifest.version
      : catalogRelease.version;
  const expectedCodeReference =
    manifest.runtimeProfile === "embedded"
      ? manifest.sourceCommit
      : catalogRelease.sourceCommit;

  return `BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.is(
  (SELECT status::text FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),
  'published',
  'signed plugin release is published'
);

SELECT extensions.is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),
  ${sqlString(manifest.sourceCommit)},
  'signed source commit is recorded'
);

SELECT extensions.is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),
  ${sqlString(manifestHash)},
  'signed manifest hash is recorded'
);

SELECT extensions.is(
  (SELECT source_tree FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),
  ${sqlString(manifest.sourceTree)},
  'signed source tree is recorded'
);

SELECT extensions.is(
  (SELECT content_digest FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),
  ${sqlString(manifest.contentDigest)},
  'signed content digest is recorded'
);

SELECT extensions.is(
  (SELECT supported_install_contracts FROM public.plugin_versions WHERE plugin_key = ${sqlString(manifest.pluginKey)} AND version = ${sqlString(manifest.version)}),
  ${sqlJson(manifest.supportedInstallContracts)},
  'install compatibility range is recorded'
);

SELECT extensions.is(
  (SELECT latest_version FROM public.plugins WHERE key = ${sqlString(manifest.pluginKey)}),
  ${sqlString(expectedCatalogVersion)},
  'plugin catalog keeps the serving embedded release truthful'
);

SELECT extensions.is(
  (SELECT code_reference FROM public.plugins WHERE key = ${sqlString(manifest.pluginKey)}),
  ${sqlString(expectedCodeReference)},
  'plugin catalog keeps the serving embedded source truthful'
);

SELECT * FROM extensions.finish();
ROLLBACK;
`;
}
