-- Replace the CSF-specific private bucket with the host-wide plugin storage
-- boundary, then publish the exact DVHS CSF manifest that understands it.
-- There is deliberately no object-copy fallback: release preflight proved the
-- legacy bucket empty in Development and Production, and this migration aborts
-- if that fact changes before application.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'csf-private'
  ) THEN
    RAISE EXCEPTION
      'csf-private contains objects; migrate object bodies before changing plugin storage coordinates.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_application_files
    WHERE bucket = 'csf-private'
  ) OR EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files
    WHERE bucket = 'csf-private'
  ) OR EXISTS (
    SELECT 1
    FROM plugin_data.csf_storage_deletion_queue
    WHERE bucket = 'csf-private'
  ) OR EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_import_staging_objects
    WHERE bucket = 'csf-private'
  ) THEN
    RAISE EXCEPTION
      'Legacy CSF storage coordinates remain; reconcile metadata before the generic plugin bucket cutover.';
  END IF;
END;
$$;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'plugins',
  'plugins',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage protects direct deletion unless the transaction explicitly opts in.
-- The empty-object assertion above is the fail-closed equivalent of the
-- Storage API's delete-bucket precondition; this local setting affects only
-- the following transactional catalog cleanup.
SELECT pg_catalog.set_config('storage.allow_delete_query', 'true', true);
DELETE FROM storage.buckets
WHERE id = 'csf-private';
SELECT pg_catalog.set_config('storage.allow_delete_query', 'false', true);

ALTER TABLE plugin_data.csf_application_files
  ALTER COLUMN bucket SET DEFAULT 'plugins';
ALTER TABLE plugin_data.csf_submission_files
  ALTER COLUMN bucket SET DEFAULT 'plugins';

-- Rewrite only the reviewed stored routines. pg_get_functiondef preserves the
-- complete preceding implementation while these exact substitutions keep the
-- forward migration small enough to audit. Every function is named by its full
-- signature and the migration fails if the expected old coordinate is absent.
DO $$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_replaced text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'plugin_data.csf_begin_point_submission_authority_base_20260810(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)'::regprocedure,
    'plugin_data.csf_begin_point_submission_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid)'::regprocedure,
    'plugin_data.csf_finalize_point_submission_proof(uuid,uuid,uuid,uuid,uuid)'::regprocedure,
    'plugin_data.csf_open_staging_object(uuid,uuid,uuid,text,text,text,bigint,integer)'::regprocedure,
    'plugin_data.csf_resubmit_point_submission_request(uuid,uuid,numeric,text,date,text,uuid,uuid)'::regprocedure,
    'plugin_data.csf_review_point_appeal(uuid,uuid,text,text,uuid,uuid)'::regprocedure,
    'plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)'::regprocedure,
    'plugin_data.csf_release_staging_claim(uuid,uuid,uuid,text,boolean)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_function) INTO v_definition;
    v_replaced := replace(v_definition, 'csf-private', 'plugins');
    v_replaced := replace(
      v_replaced,
      '''organizations/'' || p_organization_id::text',
      'p_organization_id::text || ''/dvhs-csf'''
    );
    v_replaced := replace(
      v_replaced,
      '''csf/'' || p_organization_id::text || ''/record-imports/''',
      'p_organization_id::text || ''/dvhs-csf/record-imports/'''
    );
    v_replaced := replace(
      v_replaced,
      '''csf/'' || v_staging.organization_id::text',
      'v_staging.organization_id::text || ''/dvhs-csf'''
    );

    IF v_replaced IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'Expected legacy storage coordinate is absent from %', v_function;
    END IF;
    EXECUTE v_replaced;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission_authority_base_20260810(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  uuid, text, text, text, text, bigint, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_submission_request(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_submission_request(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text, date, uuid,
  text, text, bigint, text, uuid
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_point_submission_proof(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_open_staging_object(
  uuid, uuid, uuid, text, text, text, bigint, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_open_staging_object(
  uuid, uuid, uuid, text, text, text, bigint, integer
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission_request(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission_request(
  uuid, uuid, numeric, text, date, text, uuid, uuid
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_appeal(
  uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_v2(
  uuid, uuid, text, numeric, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_release_staging_claim(
  uuid, uuid, uuid, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_release_staging_claim(
  uuid, uuid, uuid, text, boolean
) TO service_role;

DO $$
DECLARE
  v_function constant regprocedure :=
    'app_private.storage_bucket_posture_catalog()'::regprocedure;
  v_definition text;
  v_replaced text;
BEGIN
  SELECT pg_get_functiondef(v_function) INTO v_definition;
  v_replaced := replace(v_definition, '''csf-private''::text', '''plugins''::text');
  IF v_replaced IS NOT DISTINCT FROM v_definition THEN
    RAISE EXCEPTION 'The storage posture catalog did not contain csf-private.';
  END IF;
  EXECUTE v_replaced;
END;
$$;

REVOKE ALL ON FUNCTION app_private.storage_bucket_posture_catalog()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.storage_bucket_posture_catalog()
  TO service_role;

-- Immutable release certificate: reviewed manifest digest + exact private
-- source commit + explicit compatibility and rollout posture.
DO $$
DECLARE
  v_existing public.plugin_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.plugin_versions
  WHERE plugin_key = 'dvhs-csf'
    AND version = '1.1.0';

  IF FOUND AND (
    v_existing.status IS DISTINCT FROM 'published'
    OR v_existing.commit_sha IS DISTINCT FROM '4d1001e9d3269b8bd28de93c071c6b4b216824fd'
    OR v_existing.manifest_hash IS DISTINCT FROM '04aca8efa43e9d287c8d04909b733df97f6804224a4c6960a3609358eb574e79'
    OR v_existing.rollout_percentage IS DISTINCT FROM 0
    OR v_existing.compatibility_contract IS DISTINCT FROM jsonb_build_object(
      'host', 'lets-assist',
      'minimumHostVersion', '1.0.0',
      'automaticUpdate', false,
      'storageNamespace', '{organizationId}/dvhs-csf'
    )
  ) THEN
    RAISE EXCEPTION
      'The existing DVHS CSF 1.1.0 release does not match the reviewed source attestation.';
  END IF;
END;
$$;

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
VALUES (
  'dvhs-csf',
  '1.1.0',
  'published',
  'Generic organization/plugin-scoped private storage, class-centric CSF workflows, and production release hardening.',
  '4d1001e9d3269b8bd28de93c071c6b4b216824fd',
  '04aca8efa43e9d287c8d04909b733df97f6804224a4c6960a3609358eb574e79',
  jsonb_build_object(
    'host', 'lets-assist',
    'minimumHostVersion', '1.0.0',
    'automaticUpdate', false,
    'storageNamespace', '{organizationId}/dvhs-csf'
  ),
  0,
  now()
)
ON CONFLICT (plugin_key, version) DO NOTHING;

INSERT INTO public.plugin_audit_logs (
  organization_id,
  plugin_key,
  action,
  actor_type,
  details
)
SELECT
  install.organization_id,
  install.plugin_key,
  'install.version_updated',
  'system',
  jsonb_build_object(
    'fromVersion', install.installed_version,
    'toVersion', '1.1.0',
    'reason', 'production release migration',
    'automaticUpdate', false
  )
FROM public.organization_plugin_installs AS install
WHERE install.plugin_key = 'dvhs-csf'
  AND install.installed_version IS DISTINCT FROM '1.1.0';

UPDATE public.organization_plugin_installs
SET installed_version = '1.1.0',
    auto_update = false,
    updated_at = now()
WHERE plugin_key = 'dvhs-csf'
  AND installed_version IS DISTINCT FROM '1.1.0';

UPDATE public.plugins
SET latest_version = '1.1.0',
    code_reference = '4d1001e9d3269b8bd28de93c071c6b4b216824fd',
    updated_at = now()
WHERE key = 'dvhs-csf';

UPDATE public.plugin_runtime_contracts
SET manifest_version = '1.1.0',
    storage_access = jsonb_build_array(
      jsonb_build_object(
        'bucket', 'plugins',
        'pathPattern', '{organizationId}/dvhs-csf/profiles/{profileId}/terms/{termId}/*',
        'access', 'server-only',
        'purpose', 'Protected transcripts, receipts, point evidence, and import snapshots.'
      ),
      jsonb_build_object(
        'bucket', 'plugins',
        'pathPattern', '{organizationId}/dvhs-csf/record-imports/{sourceId}/*',
        'access', 'server-only',
        'purpose', 'Ephemeral uploaded import generations stored under the organization, plugin, and source boundary.'
      ),
      jsonb_build_object(
        'bucket', 'plugins',
        'pathPattern', '{organizationId}/dvhs-csf/partner-renewals/{termId}/*',
        'access', 'server-only',
        'purpose', 'Private partner-renewal source evidence stored under the organization, plugin, and term boundary.'
      )
    ),
    synced_at = now(),
    updated_at = now()
WHERE plugin_key = 'dvhs-csf';

COMMIT;
