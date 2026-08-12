-- Hostile contract for the service-only Drive metadata compare-and-set fence.
-- Every fixture is synthetic and every failure assertion also proves that no
-- provenance column, access-check timestamp, or row timestamp moved.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(35);

SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)'
  ) IS NOT NULL,
  'the exact seven-argument Drive metadata RPC exists'
);

SELECT extensions.is(
  (
    SELECT proc.proargnames
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure
  ),
  ARRAY[
    'p_organization_id',
    'p_actor_user_id',
    'p_source_id',
    'p_expected_provider',
    'p_expected_file_id',
    'p_provider_file_id',
    'p_metadata'
  ]::text[],
  'the RPC exposes the exact named PostgREST caller contract'
);

SELECT extensions.ok(
  to_regprocedure(
    'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,jsonb)'
  ) IS NULL,
  'the obsolete four-argument overload is absent'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'plugin_data'
      AND proc.proname = 'csf_refresh_sheet_source_drive_metadata'
  ),
  1,
  'the compare-and-set signature is the only metadata refresh overload'
);

SELECT extensions.results_eq(
  $$
    SELECT COALESCE(roles.rolname, 'PUBLIC')::text COLLATE "C"
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        proc.proacl,
        pg_catalog.acldefault('f', proc.proowner)
      )
    ) AS privilege
    LEFT JOIN pg_catalog.pg_roles AS roles ON roles.oid = privilege.grantee
    WHERE proc.oid =
      'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> proc.proowner
    ORDER BY 1
  $$,
  $$ VALUES ('service_role'::text COLLATE "C") $$,
  'the final signature grants execute to service_role and no non-owner role'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute the metadata fence'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot execute the metadata fence'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'service_role can execute the metadata fence'
);

SELECT extensions.is(
  (
    SELECT proc.prosecdef
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure
  ),
  true,
  'the metadata fence remains SECURITY DEFINER'
);

SELECT extensions.is(
  (
    SELECT proc.proconfig
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_refresh_sheet_source_drive_metadata(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure
  ),
  ARRAY['search_path=""']::text[],
  'the metadata fence has exactly an empty search_path'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'da000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'metadata-admin@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'da000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'metadata-member@local.test', now(),
    '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'da100000-0000-4000-8000-000000000001',
    'CSF Metadata Fence',
    'csf-metadata-fence',
    'school',
    '996301'
  ),
  (
    'da100000-0000-4000-8000-000000000002',
    'CSF Metadata Other Tenant',
    'csf-metadata-other-tenant',
    'school',
    '996302'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  (
    'da100000-0000-4000-8000-000000000001',
    'da000000-0000-4000-8000-000000000001',
    'admin',
    'active'
  ),
  (
    'da100000-0000-4000-8000-000000000001',
    'da000000-0000-4000-8000-000000000002',
    'staff',
    'active'
  );

INSERT INTO plugin_data.csf_sheet_sources (
  id,
  organization_id,
  source_type,
  title,
  provider,
  spreadsheet_id,
  drive_file_id,
  drive_file_name,
  drive_modified_at,
  drive_mime_type,
  drive_web_view_link,
  drive_trashed,
  drive_access_state,
  drive_access_checked_at,
  settings,
  updated_at
)
VALUES (
  'da200000-0000-4000-8000-000000000001',
  'da100000-0000-4000-8000-000000000001',
  'application_responses',
  'Synthetic Spring application source',
  'google_sheets',
  'synthetic-sheet-file-123',
  'synthetic-sheet-file-123',
  'Before refresh',
  '2026-01-01T00:00:00Z',
  'application/vnd.google-apps.spreadsheet',
  'https://example.test/before',
  false,
  'unknown',
  '2026-01-01T00:00:00Z',
  '{"sourceKind":"application_responses"}'::jsonb,
  '2026-01-01T00:00:00Z'
);

CREATE FUNCTION pg_temp.csf_drive_metadata_snapshot(p_source_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'driveFileName', source.drive_file_name,
    'driveModifiedAt', source.drive_modified_at,
    'driveMimeType', source.drive_mime_type,
    'driveWebViewLink', source.drive_web_view_link,
    'driveTrashed', source.drive_trashed,
    'driveAccessState', source.drive_access_state,
    'driveAccessCheckedAt', source.drive_access_checked_at,
    'updatedAt', source.updated_at
  )
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.id = p_source_id
$$;

CREATE TEMPORARY TABLE csf_metadata_baseline (
  snapshot jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000001',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'synthetic-sheet-file-123',
      'synthetic-sheet-file-123',
      jsonb_build_object(
        'name', 'Synthetic Spring applications',
        'modifiedAt', '2026-08-12T12:34:56Z',
        'mimeType', 'application/vnd.google-apps.spreadsheet',
        'webViewLink', 'https://example.test/synthetic-sheet-file-123',
        'trashed', false,
        'accessState', 'accessible'
      )
    )
  $$,
  'matching locked identities permit a metadata refresh'
);

SELECT extensions.is(
  (
    SELECT pg_catalog.jsonb_build_object(
      'name', source.drive_file_name,
      'modifiedAt', source.drive_modified_at,
      'mimeType', source.drive_mime_type,
      'webViewLink', source.drive_web_view_link,
      'trashed', source.drive_trashed,
      'accessState', source.drive_access_state
    )
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.id = 'da200000-0000-4000-8000-000000000001'
  ),
  pg_catalog.jsonb_build_object(
    'name', 'Synthetic Spring applications',
    'modifiedAt', '2026-08-12T12:34:56Z'::timestamptz,
    'mimeType', 'application/vnd.google-apps.spreadsheet',
    'webViewLink', 'https://example.test/synthetic-sheet-file-123',
    'trashed', false,
    'accessState', 'accessible'
  ),
  'the successful refresh writes only the supplied provenance values'
);

SELECT extensions.ok(
  (
    SELECT source.drive_access_checked_at > '2026-01-01T00:00:00Z'::timestamptz
      AND source.updated_at > '2026-01-01T00:00:00Z'::timestamptz
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.id = 'da200000-0000-4000-8000-000000000001'
  ),
  'the successful refresh advances both provenance timestamps'
);

UPDATE plugin_data.csf_sheet_sources AS source
SET drive_access_state = 'accessible',
    drive_access_checked_at = '2026-02-01T00:00:00Z',
    updated_at = '2026-02-01T00:00:00Z'
WHERE source.id = 'da200000-0000-4000-8000-000000000001';

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000001',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'synthetic-sheet-file-123',
      NULL,
      '{"accessState":"not_found"}'::jsonb
    )
  $$,
  'a provider response with no file id may refresh access state'
);

SELECT extensions.ok(
  (
    SELECT source.drive_access_state = 'not_found'
      AND source.drive_access_checked_at > '2026-02-01T00:00:00Z'::timestamptz
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.id = 'da200000-0000-4000-8000-000000000001'
  ),
  'a null provider file id updates access state and its checked timestamp'
);

INSERT INTO csf_metadata_baseline (snapshot)
SELECT pg_temp.csf_drive_metadata_snapshot(
  'da200000-0000-4000-8000-000000000001'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000099',
      'da200000-0000-4000-8000-000000000001',
      'uploaded_xlsx',
      'synthetic-sheet-file-123',
      'synthetic-sheet-file-123',
      '{"name":"must not write"}'::jsonb
    )
  $$,
  '22023',
  'CSF source expected provider must be google_sheets.',
  'a non-Google expected provider is refused before authorization'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'an invalid expected provider mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000099',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      NULL,
      NULL,
      '{"accessState":"not_found"}'::jsonb
    )
  $$,
  '22023',
  'CSF source expected file id must be nonblank.',
  'a null expected file id is refused before authorization'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'a null expected file id mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000099',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      '   ',
      NULL,
      '{"accessState":"not_found"}'::jsonb
    )
  $$,
  '22023',
  'CSF source expected file id must be nonblank.',
  'a blank expected file id is refused before authorization'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'a blank expected file id mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000001',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'stale-sheet-file',
      'stale-sheet-file',
      '{"name":"must not write"}'::jsonb
    )
  $$,
  '40001',
  'The CSF source file changed before its metadata could be refreshed.',
  'a stale expected file id fails closed'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'a stale expected file id mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000001',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'synthetic-sheet-file-123',
      'different-provider-file',
      '{"name":"must not write"}'::jsonb
    )
  $$,
  '23514',
  'The provider answered for a different CSF source file.',
  'a mismatched provider response file id fails closed'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'a mismatched provider response file id mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000002',
      'da000000-0000-4000-8000-000000000001',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'synthetic-sheet-file-123',
      'synthetic-sheet-file-123',
      '{"name":"must not write"}'::jsonb
    )
  $$,
  '42501',
  'CSF sheet source was not found for this organization.',
  'the source cannot be crossed into another organization'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'a wrong organization mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000099',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'synthetic-sheet-file-123',
      'synthetic-sheet-file-123',
      '{"name":"must not write"}'::jsonb
    )
  $$,
  '42501',
  'The acting officer for this CSF import is not a known user.',
  'a missing actor fails closed'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'a missing actor mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000002',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'synthetic-sheet-file-123',
      'synthetic-sheet-file-123',
      '{"name":"must not write"}'::jsonb
    )
  $$,
  '42501',
  'This officer does not hold the import_applications capability for CSF application_responses imports in this organization.',
  'an active but unauthorized actor fails closed'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'an unauthorized actor mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000001',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'synthetic-sheet-file-123',
      'synthetic-sheet-file-123',
      '[]'::jsonb
    )
  $$,
  '22023',
  'CSF source drive metadata must be a JSON object.',
  'a non-object metadata payload fails closed'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'a non-object metadata payload mutates no provenance'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_refresh_sheet_source_drive_metadata(
      'da100000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000001',
      'da200000-0000-4000-8000-000000000001',
      'google_sheets',
      'synthetic-sheet-file-123',
      'synthetic-sheet-file-123',
      '{"unreviewedKey":"must not write"}'::jsonb
    )
  $$,
  '23514',
  'CSF source drive metadata may not carry "unreviewedKey".',
  'the metadata object remains a closed vocabulary'
);

SELECT extensions.is(
  pg_temp.csf_drive_metadata_snapshot('da200000-0000-4000-8000-000000000001'),
  (SELECT baseline.snapshot FROM csf_metadata_baseline AS baseline),
  'an unsupported metadata field mutates no provenance'
);

SELECT * FROM extensions.finish();
ROLLBACK;
