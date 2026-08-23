-- Data-only local reset seed.
-- Schema, RLS, functions, storage buckets, and plugin catalog structure belong
-- in migrations so `supabase db reset` proves the production migration chain.

INSERT INTO public.plugins (
  key,
  name,
  description,
  visibility,
  is_active,
  latest_version,
  private_codebase
)
VALUES (
  'dv-speech-debate',
  'DV Speech & Debate Ops',
  'Server-only seasonal membership, tournament, guardian, and team operations for speech and debate organizations.',
  'private',
  true,
  '2.0.2',
  true
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  visibility = EXCLUDED.visibility,
  is_active = EXCLUDED.is_active,
  latest_version = EXCLUDED.latest_version,
  private_codebase = EXCLUDED.private_codebase,
  updated_at = now();

INSERT INTO public.plugins (
  key,
  name,
  description,
  visibility,
  is_active,
  latest_version,
  private_codebase,
  metadata
)
VALUES (
  'dvhs-csf',
  'DVHS CSF',
  'Private CSF workflow system for class membership, applications, officer roles, points, posts, and sheets.',
  'private',
  true,
  '1.2.8',
  true,
  jsonb_build_object('privacyMode', 'strict-minor-safe', 'defaultOwnerEmails', jsonb_build_array('dvhs-csf-admin@local.test'))
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  visibility = EXCLUDED.visibility,
  is_active = EXCLUDED.is_active,
  latest_version = EXCLUDED.latest_version,
  private_codebase = EXCLUDED.private_codebase,
  metadata = public.plugins.metadata || EXCLUDED.metadata,
  updated_at = now();

-- ===========================================================================
-- The deterministic local-development import fixture seam.
--
-- Deliberately defined HERE and not in a migration. `supabase/config.toml`
-- applies this file during a local `db reset`; a production migration deployment
-- never runs it. That is the deployment boundary -- a reserved UUID prefix is a
-- naming convention, and shipping a callable fixture mutation seam to every
-- environment and then hoping the prefix holds is not a boundary at all.
--
-- The seeder needs shapes the production construction RPCs correctly refuse:
-- terminal row statuses, fixed primary keys, and a pre-completed commit job.
-- So it gets its own entry points, and those entry points are narrow:
--
--   * explicit JSON key allowlists -- no jsonb_populate_record, no
--     jsonb_to_record, no whole-row insertion, no caller-stated table columns;
--   * explicit INSERT column lists, explicit casts, explicit defaults;
--   * every identifier re-checked against the reserved synthetic namespace;
--   * every domain reference resolved inside the SAME synthetic organization;
--   * a primary key already owned by another organization is a hard failure;
--   * conflict updates carry an organization predicate;
--   * one malformed entry aborts the whole call, because these functions are
--     PL/pgSQL and a RAISE rolls back everything the statement did.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_is_synthetic_fixture_id(p_id uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_id IS NOT NULL
    AND p_id::text ~ '^10000000-0000-4000-8000-[0-9a-f]{12}$';
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_synthetic_fixture_scope(
  p_organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT plugin_data.csf_is_synthetic_fixture_id(p_organization_id) THEN
    RAISE EXCEPTION
      'CSF fixture seeding is limited to the reserved synthetic namespace; % is not a fixture organization.',
      p_organization_id USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Refuse any JSON key the fixture contract does not name.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_fixture_keys(
  p_label text,
  p_entry jsonb,
  p_allowed text[]
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_entry IS NULL OR pg_catalog.jsonb_typeof(p_entry) <> 'object' THEN
    RAISE EXCEPTION 'A CSF % fixture entry must be a JSON object.', p_label
      USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(p_entry) AS keys(key)
  LOOP
    IF NOT (v_key = ANY (p_allowed)) THEN
      RAISE EXCEPTION 'A CSF % fixture entry may not set "%".', p_label, v_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;

-- A referenced row must exist in the SAME synthetic organization. NULL is allowed
-- only where the caller says it is.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_fixture_reference(
  p_label text,
  p_organization_id uuid,
  p_relation regclass,
  p_id uuid,
  p_nullable boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF p_id IS NULL THEN
    IF p_nullable THEN RETURN; END IF;
    RAISE EXCEPTION 'A CSF fixture % reference is required.', p_label
      USING ERRCODE = '23502';
  END IF;
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %s WHERE id = $1 AND organization_id = $2)', p_relation
  ) INTO v_exists USING p_id, p_organization_id;
  IF NOT v_exists THEN
    RAISE EXCEPTION
      'A CSF fixture % reference (%) does not exist in synthetic organization %.',
      p_label, p_id, p_organization_id USING ERRCODE = '23503';
  END IF;
END;
$$;

-- A primary key already owned by a different organization is never adopted.
CREATE OR REPLACE FUNCTION plugin_data.csf_assert_fixture_owner(
  p_label text,
  p_relation regclass,
  p_id uuid,
  p_organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
BEGIN
  EXECUTE format('SELECT organization_id FROM %s WHERE id = $1', p_relation)
    INTO v_owner USING p_id;
  IF v_owner IS NOT NULL AND v_owner <> p_organization_id THEN
    RAISE EXCEPTION
      'CSF fixture % % already belongs to organization %; refusing to adopt it.',
      p_label, p_id, v_owner USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_seed_reset_synthetic_import(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer := 0;
  v_jobs integer := 0;
  v_sources integer := 0;
BEGIN
  PERFORM plugin_data.csf_assert_synthetic_fixture_scope(p_organization_id);

  DELETE FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  DELETE FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  DELETE FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id;
  GET DIAGNOSTICS v_sources = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object(
    'importRows', v_rows, 'importJobs', v_jobs, 'sheetSources', v_sources
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_seed_synthetic_import_fixture(
  p_organization_id uuid,
  -- Each collection defaults to empty so the seeder can send one at a time, in
  -- the order the foreign keys require, without restating the others.
  p_sources jsonb DEFAULT '[]'::jsonb,
  p_jobs jsonb DEFAULT '[]'::jsonb,
  p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_source_keys constant text[] := ARRAY[
    'id', 'cohortId', 'sourceType', 'title', 'provider', 'spreadsheetId',
    'sheetUrl', 'syncOwnerUserId', 'syncMode', 'syncStatus', 'lastSyncStatus',
    'lastSyncError', 'lastPreviewedAt', 'lastCommittedAt', 'lastSyncedAt',
    'duplicatePolicy', 'targetStrategy', 'driveAccessState', 'columnMappings',
    'tabMappings', 'settings'
  ];
  c_job_keys constant text[] := ARRAY[
    'id', 'sourceId', 'previewJobId', 'initiatedBy', 'mode', 'status',
    'sourceType', 'mappingVersion', 'summary', 'startedAt', 'completedAt'
  ];
  c_row_keys constant text[] := ARRAY[
    'id', 'jobId', 'sourceId', 'cohortId', 'termId', 'matchedProfileId',
    'sheetTabName', 'rowNumber', 'sourceRange', 'rawData', 'normalizedData',
    'rowHash', 'mappingVersion', 'importStatus', 'warnings', 'errors'
  ];
  v_entry jsonb;
  v_id uuid;
  v_actor uuid;
  v_sources integer := 0;
  v_jobs integer := 0;
  v_rows integer := 0;
BEGIN
  PERFORM plugin_data.csf_assert_synthetic_fixture_scope(p_organization_id);

  -- ---- sources -------------------------------------------------------------
  FOR v_entry IN
    SELECT value FROM pg_catalog.jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) AS e(value)
  LOOP
    PERFORM plugin_data.csf_assert_fixture_keys('sheet source', v_entry, c_source_keys);
    v_id := (v_entry ->> 'id')::uuid;
    PERFORM plugin_data.csf_assert_synthetic_fixture_scope(v_id);
    PERFORM plugin_data.csf_assert_fixture_owner(
      'sheet source', 'plugin_data.csf_sheet_sources'::regclass, v_id, p_organization_id
    );
    PERFORM plugin_data.csf_assert_fixture_reference(
      'sheet source cohort', p_organization_id, 'plugin_data.csf_cohorts'::regclass,
      nullif(v_entry ->> 'cohortId', '')::uuid, true
    );

    -- The sync owner must be a real user with an active membership of THIS
    -- synthetic organization; a valid user from elsewhere is still wrong here.
    v_actor := nullif(v_entry ->> 'syncOwnerUserId', '')::uuid;
    -- ACTIVE membership, exactly as csf_assert_import_actor requires of a real
    -- officer. A fixture that seeds a source owned by a removed member would
    -- describe a state the production authorization matrix refuses.
    IF v_actor IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = v_actor
        AND coalesce(member.status, 'active') = 'active'
    ) THEN
      RAISE EXCEPTION
        'CSF fixture sheet source names a sync owner who is not an active member of synthetic organization %.',
        p_organization_id USING ERRCODE = '23503';
    END IF;

    -- Explicit columns, explicit casts, explicit defaults. Nothing about this
    -- INSERT is derived from the caller's key set.
    INSERT INTO plugin_data.csf_sheet_sources AS target (
      id, organization_id, cohort_id, source_type, title, provider,
      spreadsheet_id, sheet_url, sync_owner_user_id, sync_mode, sync_status,
      last_sync_status, last_sync_error, last_previewed_at, last_committed_at,
      last_synced_at, duplicate_policy, target_strategy, drive_access_state,
      column_mappings, tab_mappings, settings, updated_at
    ) VALUES (
      v_id,
      p_organization_id,
      nullif(v_entry ->> 'cohortId', '')::uuid,
      coalesce(nullif(v_entry ->> 'sourceType', ''), 'student_roster'),
      coalesce(nullif(v_entry ->> 'title', ''), 'Synthetic fixture source'),
      coalesce(nullif(v_entry ->> 'provider', ''), 'google_sheets'),
      nullif(v_entry ->> 'spreadsheetId', ''),
      nullif(v_entry ->> 'sheetUrl', ''),
      v_actor,
      coalesce(nullif(v_entry ->> 'syncMode', ''), 'manual'),
      coalesce(nullif(v_entry ->> 'syncStatus', ''), 'not_synced'),
      nullif(v_entry ->> 'lastSyncStatus', ''),
      nullif(v_entry ->> 'lastSyncError', ''),
      nullif(v_entry ->> 'lastPreviewedAt', '')::timestamptz,
      nullif(v_entry ->> 'lastCommittedAt', '')::timestamptz,
      nullif(v_entry ->> 'lastSyncedAt', '')::timestamptz,
      coalesce(nullif(v_entry ->> 'duplicatePolicy', ''), 'match_email_then_name'),
      coalesce(nullif(v_entry ->> 'targetStrategy', ''), 'fixed'),
      coalesce(nullif(v_entry ->> 'driveAccessState', ''), 'unknown'),
      coalesce(v_entry -> 'columnMappings', '{}'::jsonb),
      coalesce(v_entry -> 'tabMappings', '[]'::jsonb),
      coalesce(v_entry -> 'settings', '{}'::jsonb),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      settings = excluded.settings,
      tab_mappings = excluded.tab_mappings,
      column_mappings = excluded.column_mappings,
      sync_status = excluded.sync_status,
      last_sync_status = excluded.last_sync_status,
      last_sync_error = excluded.last_sync_error,
      updated_at = now()
    -- The organization predicate: a conflicting row from another tenant is never
    -- silently updated, even though the owner check above should have caught it.
    WHERE target.organization_id = p_organization_id;
    v_sources := v_sources + 1;
  END LOOP;

  -- ---- jobs ----------------------------------------------------------------
  FOR v_entry IN
    SELECT value FROM pg_catalog.jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) AS e(value)
  LOOP
    PERFORM plugin_data.csf_assert_fixture_keys('import job', v_entry, c_job_keys);
    v_id := (v_entry ->> 'id')::uuid;
    PERFORM plugin_data.csf_assert_synthetic_fixture_scope(v_id);
    PERFORM plugin_data.csf_assert_fixture_owner(
      'import job', 'plugin_data.csf_sheet_import_jobs'::regclass, v_id, p_organization_id
    );
    PERFORM plugin_data.csf_assert_fixture_reference(
      'import job source', p_organization_id, 'plugin_data.csf_sheet_sources'::regclass,
      nullif(v_entry ->> 'sourceId', '')::uuid, true
    );
    PERFORM plugin_data.csf_assert_fixture_reference(
      'import job preview', p_organization_id, 'plugin_data.csf_sheet_import_jobs'::regclass,
      nullif(v_entry ->> 'previewJobId', '')::uuid, true
    );

    v_actor := nullif(v_entry ->> 'initiatedBy', '')::uuid;
    IF v_actor IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = v_actor
        AND coalesce(member.status, 'active') = 'active'
    ) THEN
      RAISE EXCEPTION
        'CSF fixture import job names an initiator who is not an active member of synthetic organization %.',
        p_organization_id USING ERRCODE = '23503';
    END IF;

    INSERT INTO plugin_data.csf_sheet_import_jobs AS target (
      id, organization_id, source_id, preview_job_id, initiated_by, mode, status,
      source_type, mapping_version, summary, started_at, completed_at, updated_at
    ) VALUES (
      v_id,
      p_organization_id,
      nullif(v_entry ->> 'sourceId', '')::uuid,
      nullif(v_entry ->> 'previewJobId', '')::uuid,
      v_actor,
      coalesce(nullif(v_entry ->> 'mode', ''), 'preview'),
      coalesce(nullif(v_entry ->> 'status', ''), 'pending'),
      coalesce(nullif(v_entry ->> 'sourceType', ''), 'student_roster'),
      coalesce(nullif(v_entry ->> 'mappingVersion', '')::integer, 1),
      coalesce(v_entry -> 'summary', '{}'::jsonb),
      nullif(v_entry ->> 'startedAt', '')::timestamptz,
      nullif(v_entry ->> 'completedAt', '')::timestamptz,
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      status = excluded.status,
      summary = excluded.summary,
      completed_at = excluded.completed_at,
      updated_at = now()
    WHERE target.organization_id = p_organization_id;
    v_jobs := v_jobs + 1;
  END LOOP;

  -- ---- rows ----------------------------------------------------------------
  FOR v_entry IN
    SELECT value FROM pg_catalog.jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS e(value)
  LOOP
    PERFORM plugin_data.csf_assert_fixture_keys('import row', v_entry, c_row_keys);
    v_id := (v_entry ->> 'id')::uuid;
    PERFORM plugin_data.csf_assert_synthetic_fixture_scope(v_id);
    PERFORM plugin_data.csf_assert_fixture_owner(
      'import row', 'plugin_data.csf_sheet_import_rows'::regclass, v_id, p_organization_id
    );
    PERFORM plugin_data.csf_assert_fixture_reference(
      'import row job', p_organization_id, 'plugin_data.csf_sheet_import_jobs'::regclass,
      nullif(v_entry ->> 'jobId', '')::uuid, false
    );
    PERFORM plugin_data.csf_assert_fixture_reference(
      'import row source', p_organization_id, 'plugin_data.csf_sheet_sources'::regclass,
      nullif(v_entry ->> 'sourceId', '')::uuid, true
    );
    PERFORM plugin_data.csf_assert_fixture_reference(
      'import row cohort', p_organization_id, 'plugin_data.csf_cohorts'::regclass,
      nullif(v_entry ->> 'cohortId', '')::uuid, true
    );
    PERFORM plugin_data.csf_assert_fixture_reference(
      'import row term', p_organization_id, 'plugin_data.csf_terms'::regclass,
      nullif(v_entry ->> 'termId', '')::uuid, true
    );
    PERFORM plugin_data.csf_assert_fixture_reference(
      'import row profile', p_organization_id, 'plugin_data.csf_profiles'::regclass,
      nullif(v_entry ->> 'matchedProfileId', '')::uuid, true
    );

    IF coalesce(v_entry ->> 'rowNumber', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'A CSF import row fixture needs a positive row number.'
        USING ERRCODE = '22023';
    END IF;
    IF nullif(v_entry ->> 'sheetTabName', '') IS NULL THEN
      RAISE EXCEPTION 'A CSF import row fixture needs a sheet tab name.'
        USING ERRCODE = '23502';
    END IF;

    INSERT INTO plugin_data.csf_sheet_import_rows AS target (
      id, organization_id, job_id, source_id, cohort_id, term_id,
      matched_profile_id, sheet_tab_name, row_number, source_range,
      raw_data, normalized_data, row_hash, mapping_version, import_status,
      warnings, errors
    ) VALUES (
      v_id,
      p_organization_id,
      (v_entry ->> 'jobId')::uuid,
      nullif(v_entry ->> 'sourceId', '')::uuid,
      nullif(v_entry ->> 'cohortId', '')::uuid,
      nullif(v_entry ->> 'termId', '')::uuid,
      nullif(v_entry ->> 'matchedProfileId', '')::uuid,
      v_entry ->> 'sheetTabName',
      (v_entry ->> 'rowNumber')::integer,
      nullif(v_entry ->> 'sourceRange', ''),
      coalesce(v_entry -> 'rawData', '{}'::jsonb),
      coalesce(v_entry -> 'normalizedData', '{}'::jsonb),
      nullif(v_entry ->> 'rowHash', ''),
      coalesce(nullif(v_entry ->> 'mappingVersion', '')::integer, 1),
      coalesce(nullif(v_entry ->> 'importStatus', ''), 'pending'),
      coalesce(
        (SELECT array_agg(value) FROM pg_catalog.jsonb_array_elements_text(
          coalesce(v_entry -> 'warnings', '[]'::jsonb)) AS w(value)),
        ARRAY[]::text[]
      ),
      coalesce(
        (SELECT array_agg(value) FROM pg_catalog.jsonb_array_elements_text(
          coalesce(v_entry -> 'errors', '[]'::jsonb)) AS e(value)),
        ARRAY[]::text[]
      )
    )
    ON CONFLICT (id) DO UPDATE SET
      import_status = excluded.import_status,
      normalized_data = excluded.normalized_data,
      raw_data = excluded.raw_data,
      warnings = excluded.warnings,
      errors = excluded.errors
    WHERE target.organization_id = p_organization_id;
    v_rows := v_rows + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'sheetSources', v_sources, 'importJobs', v_jobs, 'importRows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_is_synthetic_fixture_id(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_synthetic_fixture_scope(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_fixture_keys(text, jsonb, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_fixture_reference(text, uuid, regclass, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_assert_fixture_owner(text, regclass, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_seed_reset_synthetic_import(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_seed_reset_synthetic_import(uuid) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_seed_synthetic_import_fixture(uuid, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_seed_synthetic_import_fixture(uuid, jsonb, jsonb, jsonb)
  TO service_role;
