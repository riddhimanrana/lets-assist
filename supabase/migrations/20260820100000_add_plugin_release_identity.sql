-- Extend the publication ledger with the identity of the source and build
-- inputs that constitute a plugin release. Existing releases remain honest
-- legacy records: compatibility ranges are pinned, while provenance that was
-- never captured remains NULL. Any release published after this migration must
-- carry the complete profile-appropriate identity.

BEGIN;

ALTER TABLE public.plugin_versions
  ADD COLUMN IF NOT EXISTS source_tree text,
  ADD COLUMN IF NOT EXISTS content_digest text,
  ADD COLUMN IF NOT EXISTS release_inputs jsonb,
  ADD COLUMN IF NOT EXISTS build_digest text,
  ADD COLUMN IF NOT EXISTS sbom_digest text,
  ADD COLUMN IF NOT EXISTS signer_identity jsonb,
  ADD COLUMN IF NOT EXISTS host_api_range jsonb,
  ADD COLUMN IF NOT EXISTS plugin_data_schema_version integer,
  ADD COLUMN IF NOT EXISTS required_platform_schema_version text,
  ADD COLUMN IF NOT EXISTS supported_install_contracts jsonb,
  ADD COLUMN IF NOT EXISTS runtime_profile text;

ALTER TABLE public.plugin_versions
  ADD CONSTRAINT plugin_versions_source_tree_check
    CHECK (source_tree IS NULL OR source_tree ~ '^[0-9a-f]{40}$'),
  ADD CONSTRAINT plugin_versions_content_digest_check
    CHECK (content_digest IS NULL OR content_digest ~ '^(sha256:)?[0-9a-f]{64}$'),
  ADD CONSTRAINT plugin_versions_build_digest_check
    CHECK (build_digest IS NULL OR build_digest ~ '^(sha256:)?[0-9a-f]{64}$'),
  ADD CONSTRAINT plugin_versions_sbom_digest_check
    CHECK (sbom_digest IS NULL OR sbom_digest ~ '^(sha256:)?[0-9a-f]{64}$'),
  ADD CONSTRAINT plugin_versions_release_inputs_check
    CHECK (
      release_inputs IS NULL
      OR (
        jsonb_typeof(release_inputs) = 'array'
        AND jsonb_array_length(release_inputs) > 0
        AND NOT jsonb_path_exists(release_inputs, '$[*] ? (@.type() != "string" || @ == "")')
      )
    ),
  ADD CONSTRAINT plugin_versions_signer_identity_check
    CHECK (signer_identity IS NULL OR jsonb_typeof(signer_identity) = 'object'),
  ADD CONSTRAINT plugin_versions_host_api_range_check
    CHECK (
      host_api_range IS NULL
      OR (
        jsonb_typeof(host_api_range) = 'object'
        AND jsonb_typeof(host_api_range -> 'minimum') = 'string'
        AND (
          NOT host_api_range ? 'maximum'
          OR jsonb_typeof(host_api_range -> 'maximum') = 'string'
        )
      )
    ),
  ADD CONSTRAINT plugin_versions_plugin_data_schema_version_check
    CHECK (plugin_data_schema_version IS NULL OR plugin_data_schema_version >= 1),
  ADD CONSTRAINT plugin_versions_required_platform_schema_version_check
    CHECK (
      required_platform_schema_version IS NULL
      OR length(btrim(required_platform_schema_version)) > 0
    ),
  ADD CONSTRAINT plugin_versions_supported_install_contracts_check
    CHECK (
      supported_install_contracts IS NULL
      OR (
        jsonb_typeof(supported_install_contracts) = 'object'
        AND jsonb_typeof(supported_install_contracts -> 'minimum') = 'string'
        AND jsonb_typeof(supported_install_contracts -> 'maximum') = 'string'
      )
    ),
  ADD CONSTRAINT plugin_versions_runtime_profile_check
    CHECK (runtime_profile IS NULL OR runtime_profile IN ('embedded', 'application', 'service'));

UPDATE public.plugin_versions
SET
  host_api_range = COALESCE(
    host_api_range,
    jsonb_build_object('minimum', '1.0.0', 'maximum', '1.0.0')
  ),
  supported_install_contracts = COALESCE(
    supported_install_contracts,
    jsonb_build_object('minimum', version, 'maximum', version)
  ),
  plugin_data_schema_version = COALESCE(plugin_data_schema_version, 1),
  required_platform_schema_version = COALESCE(
    required_platform_schema_version,
    'legacy'
  ),
  runtime_profile = COALESCE(runtime_profile, 'embedded');

COMMENT ON COLUMN public.plugin_versions.source_tree IS
  'Exact Git tree object id for the plugin subtree at commit_sha.';
COMMENT ON COLUMN public.plugin_versions.content_digest IS
  'SHA-256 digest over every path declared by release_inputs.';
COMMENT ON COLUMN public.plugin_versions.release_inputs IS
  'Repository-relative source paths covered by content_digest.';
COMMENT ON COLUMN public.plugin_versions.build_digest IS
  'SHA-256 digest of an independently deployed build artifact.';
COMMENT ON COLUMN public.plugin_versions.sbom_digest IS
  'SHA-256 digest of the release software bill of materials.';
COMMENT ON COLUMN public.plugin_versions.signer_identity IS
  'Signing identity, issuer, and attestation reference when a signature exists.';
COMMENT ON COLUMN public.plugin_versions.host_api_range IS
  'Inclusive host API compatibility range declared by the release.';
COMMENT ON COLUMN public.plugin_versions.plugin_data_schema_version IS
  'Plugin-owned data contract version expected by the release.';
COMMENT ON COLUMN public.plugin_versions.required_platform_schema_version IS
  'Minimum platform migration contract expected by the release.';
COMMENT ON COLUMN public.plugin_versions.supported_install_contracts IS
  'Inclusive organization install-contract range supported by the release.';
COMMENT ON COLUMN public.plugin_versions.runtime_profile IS
  'Execution profile: embedded, application, or service.';

CREATE OR REPLACE FUNCTION private.require_plugin_release_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('published', 'deprecated', 'revoked')
    AND (
      TG_OP = 'INSERT'
      OR OLD.status NOT IN ('published', 'deprecated', 'revoked')
    )
  THEN
    IF NEW.commit_sha IS NULL
      OR NEW.manifest_hash IS NULL
      OR NEW.source_tree IS NULL
      OR NEW.content_digest IS NULL
      OR NEW.release_inputs IS NULL
      OR NEW.host_api_range IS NULL
      OR NEW.plugin_data_schema_version IS NULL
      OR NEW.required_platform_schema_version IS NULL
      OR NEW.supported_install_contracts IS NULL
      OR NEW.runtime_profile IS NULL
      OR NEW.published_at IS NULL
    THEN
      RAISE EXCEPTION 'new published plugin releases require complete release identity';
    END IF;

    IF NEW.runtime_profile IN ('application', 'service')
      AND (NEW.build_digest IS NULL OR NEW.sbom_digest IS NULL)
    THEN
      RAISE EXCEPTION 'independently deployed plugin releases require build and SBOM digests';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_plugin_release_identity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS plugin_versions_require_release_identity
  ON public.plugin_versions;
CREATE TRIGGER plugin_versions_require_release_identity
BEFORE INSERT OR UPDATE OF status ON public.plugin_versions
FOR EACH ROW
EXECUTE FUNCTION private.require_plugin_release_identity();

CREATE OR REPLACE FUNCTION private.enforce_plugin_release_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'deprecated', 'revoked') THEN
    IF NEW.plugin_key IS DISTINCT FROM OLD.plugin_key
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.changelog IS DISTINCT FROM OLD.changelog
      OR NEW.commit_sha IS DISTINCT FROM OLD.commit_sha
      OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash
      OR NEW.compatibility_contract IS DISTINCT FROM OLD.compatibility_contract
      OR NEW.source_tree IS DISTINCT FROM OLD.source_tree
      OR NEW.content_digest IS DISTINCT FROM OLD.content_digest
      OR NEW.release_inputs IS DISTINCT FROM OLD.release_inputs
      OR NEW.build_digest IS DISTINCT FROM OLD.build_digest
      OR NEW.sbom_digest IS DISTINCT FROM OLD.sbom_digest
      OR NEW.signer_identity IS DISTINCT FROM OLD.signer_identity
      OR NEW.host_api_range IS DISTINCT FROM OLD.host_api_range
      OR NEW.plugin_data_schema_version IS DISTINCT FROM OLD.plugin_data_schema_version
      OR NEW.required_platform_schema_version IS DISTINCT FROM OLD.required_platform_schema_version
      OR NEW.supported_install_contracts IS DISTINCT FROM OLD.supported_install_contracts
      OR NEW.runtime_profile IS DISTINCT FROM OLD.runtime_profile
      OR NEW.published_by IS DISTINCT FROM OLD.published_by
      OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'published plugin release metadata is immutable';
    END IF;

    IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
      RAISE EXCEPTION 'a revoked plugin release cannot be restored';
    END IF;

    IF NEW.status NOT IN ('published', 'deprecated', 'revoked') THEN
      RAISE EXCEPTION 'a published plugin release cannot return to a draft workflow';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.status = 'published'
    AND NEW.status IN ('deprecated', 'revoked')
    AND EXISTS (
      SELECT 1
      FROM public.plugins AS plugin
      WHERE plugin.key = OLD.plugin_key
        AND plugin.latest_version = OLD.version
        AND plugin.is_active = true
    )
  THEN
    RAISE EXCEPTION 'advance or deactivate the plugin catalog before retiring its latest release';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_plugin_release_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
