-- Make plugin_versions the publication authority instead of allowing the
-- mutable plugins.latest_version field to advertise a release that does not
-- exist. Existing manifests are registered below from the exact private
-- gitlink shipped by this root commit; later releases must add their own
-- immutable publication record before advancing the catalog.

BEGIN;

ALTER TABLE public.plugin_versions
  ADD COLUMN IF NOT EXISTS manifest_hash text,
  ADD COLUMN IF NOT EXISTS compatibility_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rollout_percentage integer NOT NULL DEFAULT 0;

ALTER TABLE public.plugin_versions
  DROP CONSTRAINT IF EXISTS plugin_versions_status_check;
ALTER TABLE public.plugin_versions
  ADD CONSTRAINT plugin_versions_status_check
  CHECK (status IN ('draft', 'review', 'published', 'rejected', 'deprecated', 'revoked'));

ALTER TABLE public.plugin_versions
  ADD CONSTRAINT plugin_versions_version_semver_check
  CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'),
  ADD CONSTRAINT plugin_versions_manifest_hash_check
  CHECK (manifest_hash IS NULL OR manifest_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT plugin_versions_commit_sha_check
  CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$'),
  ADD CONSTRAINT plugin_versions_compatibility_object_check
  CHECK (jsonb_typeof(compatibility_contract) = 'object'),
  ADD CONSTRAINT plugin_versions_rollout_percentage_check
  CHECK (rollout_percentage BETWEEN 0 AND 100),
  ADD CONSTRAINT plugin_versions_published_metadata_check
  CHECK (
    status NOT IN ('published', 'deprecated', 'revoked')
    OR (
      manifest_hash IS NOT NULL
      AND commit_sha IS NOT NULL
      AND published_at IS NOT NULL
    )
  ) NOT VALID;

COMMENT ON COLUMN public.plugin_versions.manifest_hash IS
  'SHA-256 of the reviewed manifest source shipped by this release.';
COMMENT ON COLUMN public.plugin_versions.compatibility_contract IS
  'Machine-readable host and upgrade compatibility. An empty object means pinned/manual only.';
COMMENT ON COLUMN public.plugin_versions.rollout_percentage IS
  'Percentage of eligible auto-update installs that may be staged onto this published release. Zero is the fail-closed default.';

-- Releases published before source attestation existed cannot remain
-- installable merely because they once carried the `published` label. Keep
-- them as review evidence and publish only the exact current manifests below.
UPDATE public.plugin_versions
SET status = 'review',
    review_notes = concat_ws(
      E'\n',
      nullif(review_notes, ''),
      'Legacy publication predates manifest/source attestation; review and republish before use.'
    )
WHERE status = 'published'
  AND (manifest_hash IS NULL OR commit_sha IS NULL);

-- The runtime registry is code-owned, so ensure every registered plugin has a
-- catalog identity before its release row is inserted. Existing descriptive
-- catalog metadata remains untouched.
INSERT INTO public.plugins (
  key,
  name,
  description,
  visibility,
  is_active,
  latest_version,
  private_codebase,
  code_repository,
  code_reference,
  metadata
)
VALUES
  (
    'calendar-tools',
    'Calendar Tools',
    'Calendar workflow helpers for organization staff.',
    'global',
    true,
    '1.0.0',
    true,
    'private://lets-assist-plugins/calendar-tools',
    '5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5',
    '{"owner":{"name":"Let''s Assist","type":"platform-official"}}'::jsonb
  ),
  (
    'community-impact-radar',
    'Community Impact Radar',
    'Organization impact analytics backed by host-controlled read paths.',
    'global',
    true,
    '0.1.0',
    true,
    'private://lets-assist-plugins/community-impact-radar',
    '5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5',
    '{}'::jsonb
  ),
  (
    'family-liaison-workbench',
    'Family Liaison Workbench',
    'Entitlement-controlled family intake and liaison workflows.',
    'private',
    true,
    '0.1.0',
    true,
    'private://lets-assist-plugins/family-liaison-workbench',
    '5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5',
    '{}'::jsonb
  ),
  (
    'dv-speech-debate',
    'DV Speech & Debate Ops',
    'Private membership, tournament, and staffing workflows.',
    'private',
    true,
    '2.0.0',
    true,
    'private://dv-speech-debate-plugin',
    '5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5',
    '{}'::jsonb
  ),
  (
    'dvhs-csf',
    'DVHS CSF',
    'Private CSF membership and operations workflows.',
    'private',
    true,
    '0.1.0',
    true,
    'private://lets-assist-plugins/dvhs-csf',
    '5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5',
    '{}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.plugin_versions (
  plugin_key,
  version,
  status,
  changelog,
  commit_sha,
  manifest_hash,
  compatibility_contract,
  rollout_percentage,
  published_at
)
SELECT
  release.plugin_key,
  release.version,
  'published',
  'Authoritative release registration for the deployed private plugin manifest.',
  '5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5',
  release.manifest_hash,
  jsonb_build_object(
    'host', 'lets-assist',
    'minimumHostVersion', '1.0.0',
    'automaticUpdate', false
  ),
  0,
  now()
FROM (
  VALUES
    ('calendar-tools', '1.0.0', 'be1e70a3d3ab06b066fe302bc2404fcf248b5a9df5ccd8318ac4451ed9be3dc6'),
    ('community-impact-radar', '0.1.0', '82f81a3504e5a21ede82e161e2ad84e11feb81df6ab5cbfdbd8e614b8e65e18c'),
    ('family-liaison-workbench', '0.1.0', 'c85614bc36e58d69ca1d05ac3636b28750048067de4a97f974c0404ec091b272'),
    ('dv-speech-debate', '2.0.0', '82a9b548b570c8a2b7af3fe7a13fe889fc214abfb169ca0c64865063d4810f1b'),
    ('dvhs-csf', '0.1.0', 'e767ea535558bba0987e9b7dec8af7dc809c2131e725c3fa697e22d195a06f1a')
) AS release(plugin_key, version, manifest_hash)
JOIN public.plugins AS plugin ON plugin.key = release.plugin_key
ON CONFLICT (plugin_key, version) DO UPDATE SET
  status = EXCLUDED.status,
  changelog = EXCLUDED.changelog,
  commit_sha = EXCLUDED.commit_sha,
  manifest_hash = EXCLUDED.manifest_hash,
  compatibility_contract = EXCLUDED.compatibility_contract,
  rollout_percentage = EXCLUDED.rollout_percentage,
  published_at = COALESCE(public.plugin_versions.published_at, EXCLUDED.published_at);

UPDATE public.plugins AS plugin
SET latest_version = release.version,
    code_reference = '5e21d5dd60744dc50b7817bfc734a4e2ca71c8f5',
    updated_at = now()
FROM (
  VALUES
    ('calendar-tools', '1.0.0'),
    ('community-impact-radar', '0.1.0'),
    ('family-liaison-workbench', '0.1.0'),
    ('dv-speech-debate', '2.0.0'),
    ('dvhs-csf', '0.1.0')
) AS release(plugin_key, version)
WHERE plugin.key = release.plugin_key;

ALTER TABLE public.plugin_versions
  VALIDATE CONSTRAINT plugin_versions_published_metadata_check;

-- Automatic updates were historically opt-out. Flip the default and current
-- rows to pinned: a later reviewed release may opt a staged cohort back in only
-- after publishing an explicit compatibility contract and non-zero rollout.
ALTER TABLE public.organization_plugin_installs
  ALTER COLUMN auto_update SET DEFAULT false;
UPDATE public.organization_plugin_installs SET auto_update = false WHERE auto_update = true;

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

REVOKE ALL ON FUNCTION private.enforce_plugin_release_immutability() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS plugin_versions_enforce_immutable_release
  ON public.plugin_versions;
CREATE TRIGGER plugin_versions_enforce_immutable_release
BEFORE UPDATE ON public.plugin_versions
FOR EACH ROW
EXECUTE FUNCTION private.enforce_plugin_release_immutability();

CREATE OR REPLACE FUNCTION private.enforce_catalog_published_plugin_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_active = true AND NOT EXISTS (
    SELECT 1
    FROM public.plugin_versions AS release
    WHERE release.plugin_key = NEW.key
      AND release.version = NEW.latest_version
      AND release.status = 'published'
      AND release.manifest_hash IS NOT NULL
      AND release.commit_sha IS NOT NULL
      AND release.published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'active plugin latest_version must reference a complete published release';
  END IF;

  IF NEW.force_update_version IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.plugin_versions AS release
    WHERE release.plugin_key = NEW.key
      AND release.version = NEW.force_update_version
      AND release.status = 'published'
  ) THEN
    RAISE EXCEPTION 'force_update_version must reference a published release';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_catalog_published_plugin_release() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS plugins_require_published_latest_release
  ON public.plugins;
CREATE CONSTRAINT TRIGGER plugins_require_published_latest_release
AFTER INSERT OR UPDATE OF key, latest_version, is_active ON public.plugins
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION private.enforce_catalog_published_plugin_release();

CREATE OR REPLACE FUNCTION private.enforce_plugin_install_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.enabled = true AND NOT EXISTS (
    SELECT 1
    FROM public.plugin_versions AS release
    JOIN public.plugins AS plugin ON plugin.key = release.plugin_key
    WHERE release.plugin_key = NEW.plugin_key
      AND release.version = NEW.installed_version
      AND release.status = 'published'
      AND plugin.is_active = true
  ) THEN
    RAISE EXCEPTION 'enabled plugin install must reference a published compatible release';
  END IF;

  IF NEW.auto_update = true AND NOT EXISTS (
    SELECT 1
    FROM public.plugin_versions AS release
    WHERE release.plugin_key = NEW.plugin_key
      AND release.version = NEW.installed_version
      AND release.status = 'published'
      AND release.compatibility_contract @> '{"automaticUpdate":true}'::jsonb
      AND release.rollout_percentage > 0
  ) THEN
    RAISE EXCEPTION 'auto_update requires an explicitly compatible staged release';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_plugin_install_release() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS organization_plugin_installs_require_release
  ON public.organization_plugin_installs;
CREATE TRIGGER organization_plugin_installs_require_release
BEFORE INSERT OR UPDATE OF plugin_key, installed_version, enabled, auto_update
ON public.organization_plugin_installs
FOR EACH ROW
EXECUTE FUNCTION private.enforce_plugin_install_release();

CREATE OR REPLACE FUNCTION private.enforce_plugin_entitlement_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active' AND NOT EXISTS (
    SELECT 1
    FROM public.plugins AS plugin
    JOIN public.plugin_versions AS release
      ON release.plugin_key = plugin.key
      AND release.version = plugin.latest_version
    WHERE plugin.key = NEW.plugin_key
      AND plugin.is_active = true
      AND release.status = 'published'
  ) THEN
    RAISE EXCEPTION 'active entitlement requires an active published plugin release';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_plugin_entitlement_release() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS organization_plugin_entitlements_require_release
  ON public.organization_plugin_entitlements;
CREATE TRIGGER organization_plugin_entitlements_require_release
BEFORE INSERT OR UPDATE OF plugin_key, status
ON public.organization_plugin_entitlements
FOR EACH ROW
EXECUTE FUNCTION private.enforce_plugin_entitlement_release();

DROP POLICY IF EXISTS "plugin_versions_read" ON public.plugin_versions;
DROP POLICY IF EXISTS "plugin_versions_published_read" ON public.plugin_versions;
CREATE POLICY "plugin_versions_published_read"
  ON public.plugin_versions
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "plugin_versions_trusted_read" ON public.plugin_versions;
CREATE POLICY "plugin_versions_trusted_read"
  ON public.plugin_versions
  FOR SELECT
  TO authenticated
  USING (public.is_trusted_member((SELECT auth.uid())));

COMMIT;
