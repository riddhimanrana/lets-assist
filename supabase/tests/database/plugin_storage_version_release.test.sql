BEGIN;

SELECT plan(13);

SELECT ok(
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'plugins' AND public = false),
  'the generic plugins bucket exists and stays private'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'csf-private'),
  'the empty CSF-specific bucket is retired'
);

SELECT is(
  (SELECT posture FROM app_private.storage_bucket_posture_catalog() WHERE bucket_id = 'plugins'),
  'server-only'::text,
  'the plugins bucket is cataloged as server-only'
);

SELECT is(
  (SELECT column_default::text FROM information_schema.columns
   WHERE table_schema = 'plugin_data' AND table_name = 'csf_application_files' AND column_name = 'bucket'),
  '''plugins''::text'::text,
  'application file metadata defaults to the generic plugins bucket'
);

SELECT is(
  (SELECT column_default::text FROM information_schema.columns
   WHERE table_schema = 'plugin_data' AND table_name = 'csf_submission_files' AND column_name = 'bucket'),
  '''plugins''::text'::text,
  'submission file metadata defaults to the generic plugins bucket'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname = ANY (ARRAY[
        'csf_begin_point_submission_authority_base_20260810',
        'csf_begin_point_submission_request',
        'csf_finalize_point_submission_proof',
        'csf_open_staging_object',
        'csf_resubmit_point_submission_request',
        'csf_review_point_appeal',
        'csf_review_point_submission_v2',
        'csf_release_staging_claim'
      ]::text[])
      AND pg_get_functiondef(proc.oid) LIKE '%csf-private%'
  ),
  'all reviewed CSF routines reject the legacy bucket coordinate'
);

SELECT ok(
  pg_get_functiondef(
    'plugin_data.csf_open_staging_object(uuid,uuid,uuid,text,text,text,bigint,integer)'::regprocedure
  ) LIKE '%/dvhs-csf/record-imports/%',
  'staged imports use the organization/plugin namespace'
);

SELECT ok(
  pg_get_functiondef(
    'plugin_data.csf_begin_point_submission_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid)'::regprocedure
  ) LIKE '%''/dvhs-csf''%''/profiles/''%',
  'point proof coordinates use the organization/plugin namespace'
);

SELECT is(
  (SELECT status FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.1.0'),
  'published'::text,
  'DVHS CSF 1.1.0 is an authoritative published release'
);

SELECT is(
  (SELECT manifest_hash FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.1.0'),
  '04aca8efa43e9d287c8d04909b733df97f6804224a4c6960a3609358eb574e79'::text,
  'the release certificate pins the exact reviewed manifest bytes'
);

SELECT is(
  (SELECT commit_sha FROM public.plugin_versions WHERE plugin_key = 'dvhs-csf' AND version = '1.1.0'),
  '4d1001e9d3269b8bd28de93c071c6b4b216824fd'::text,
  'the release certificate pins the exact private source commit'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.organization_plugin_installs
    WHERE plugin_key = 'dvhs-csf'
      AND (installed_version <> '1.1.0' OR auto_update = true)
  ),
  'every existing DVHS CSF install is explicitly pinned to 1.1.0'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.plugin_runtime_contracts
    WHERE plugin_key = 'dvhs-csf'
      AND NOT (
        manifest_version = '1.1.0'
        AND storage_access @> '[{"bucket":"plugins","pathPattern":"{organizationId}/dvhs-csf/record-imports/{sourceId}/*","access":"server-only"}]'::jsonb
      )
  ),
  'any persisted runtime contract uses the 1.1.0 generic server-only namespace'
);

SELECT * FROM finish();

ROLLBACK;
