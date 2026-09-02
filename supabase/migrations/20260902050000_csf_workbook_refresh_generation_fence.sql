-- Keep refresh workers bound to the exact Drive generation they claimed.

BEGIN;

ALTER TABLE plugin_data.csf_class_workbook_refresh_jobs
  ADD COLUMN claimed_owner_user_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION plugin_data.csf_queue_class_workbook_preparation(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_drive_owner_user_id uuid,
  p_provider_version text,
  p_provider_modified_at text,
  p_discovered_tabs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_job_id uuid;
BEGIN
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_drive_owner_user_id,
    'class_history'
  );
  IF p_drive_file_id IS NULL OR pg_catalog.btrim(p_drive_file_id) = '' THEN
    RAISE EXCEPTION 'Choose a class workbook.';
  END IF;
  IF p_provider_version IS NULL
    OR p_provider_version !~ '^[1-9][0-9]{0,18}$'
  THEN
    RAISE EXCEPTION 'The workbook version is unavailable.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_discovered_tabs) <> 'array' THEN
    RAISE EXCEPTION 'Workbook tabs must be an array.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.id = p_cohort_id
      AND cohort.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'This class does not belong to the organization.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_class_workbook:'
        || p_organization_id::text || ':' || p_cohort_id::text,
      0
    )
  );

  INSERT INTO plugin_data.csf_class_workbooks (
    organization_id,
    cohort_id,
    drive_file_id,
    drive_owner_user_id,
    provider_version,
    provider_modified_at,
    discovered_tabs,
    source_candidates,
    last_checked_at,
    last_prepared_version,
    state,
    last_error_code,
    check_lease_token,
    check_lease_expires_at,
    updated_at
  ) VALUES (
    p_organization_id,
    p_cohort_id,
    p_drive_file_id,
    p_drive_owner_user_id,
    p_provider_version,
    p_provider_modified_at,
    p_discovered_tabs,
    pg_catalog.jsonb_build_array(p_drive_file_id),
    pg_catalog.now(),
    NULL,
    'linked',
    NULL,
    NULL,
    NULL,
    pg_catalog.now()
  )
  ON CONFLICT (organization_id, cohort_id) DO UPDATE
  SET drive_file_id = EXCLUDED.drive_file_id,
      drive_owner_user_id = EXCLUDED.drive_owner_user_id,
      provider_version = EXCLUDED.provider_version,
      provider_modified_at = EXCLUDED.provider_modified_at,
      discovered_tabs = CASE
        WHEN plugin_data.csf_class_workbooks.drive_file_id = EXCLUDED.drive_file_id
          AND plugin_data.csf_class_workbooks.provider_version = EXCLUDED.provider_version
          AND plugin_data.csf_class_workbooks.last_prepared_version = EXCLUDED.provider_version
          AND EXCLUDED.discovered_tabs = '[]'::jsonb
        THEN plugin_data.csf_class_workbooks.discovered_tabs
        ELSE EXCLUDED.discovered_tabs
      END,
      source_candidates = EXCLUDED.source_candidates,
      last_checked_at = EXCLUDED.last_checked_at,
      last_prepared_version = CASE
        WHEN plugin_data.csf_class_workbooks.drive_file_id = EXCLUDED.drive_file_id
          AND plugin_data.csf_class_workbooks.provider_version = EXCLUDED.provider_version
          AND plugin_data.csf_class_workbooks.last_prepared_version = EXCLUDED.provider_version
        THEN plugin_data.csf_class_workbooks.last_prepared_version
        ELSE NULL
      END,
      state = 'linked',
      last_error_code = NULL,
      check_lease_token = NULL,
      check_lease_expires_at = NULL,
      updated_at = pg_catalog.now()
  RETURNING * INTO v_workbook;

  IF v_workbook.last_prepared_version = p_provider_version THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'unchanged',
      'workbookId', v_workbook.id
    );
  END IF;

  INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
    organization_id,
    workbook_id,
    drive_file_id,
    provider_version,
    requested_by,
    status,
    updated_at
  ) VALUES (
    p_organization_id,
    v_workbook.id,
    p_drive_file_id,
    p_provider_version,
    p_drive_owner_user_id,
    'queued',
    pg_catalog.now()
  )
  ON CONFLICT (workbook_id, drive_file_id, provider_version) DO UPDATE
  SET status = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN 'running'
        ELSE 'queued'
      END,
      requested_by = EXCLUDED.requested_by,
      lease_token = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.lease_token
        ELSE NULL
      END,
      lease_expires_at = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
        ELSE NULL
      END,
      claimed_owner_user_id = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.claimed_owner_user_id
        ELSE NULL
      END,
      attempt_count = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.attempt_count
        ELSE 0
      END,
      started_at = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.started_at
        ELSE NULL
      END,
      result_counts = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.result_counts
        ELSE '{}'::jsonb
      END,
      error_code = NULL,
      finished_at = NULL,
      updated_at = pg_catalog.now()
  RETURNING id INTO v_job_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'queued',
    'workbookId', v_workbook.id,
    'jobId', v_job_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_queue_class_workbook_preparation(
  uuid, uuid, text, uuid, text, text, jsonb
) IS
  'Registers one exact class workbook generation. A metadata-only repeat of an already prepared generation preserves its discovered tabs; a new file or version resets them.';

REVOKE ALL ON FUNCTION plugin_data.csf_queue_class_workbook_preparation(
  uuid, uuid, text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_class_workbook_preparation(
  uuid, uuid, text, uuid, text, text, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_class_workbook_check(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_actor_user_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );
  IF p_lease_seconds IS NULL
    OR p_lease_seconds < 30
    OR p_lease_seconds > 600
  THEN
    RAISE EXCEPTION 'Workbook check lease must be between 30 and 600 seconds.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.cohort_id = p_cohort_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_workbook.state IN ('blocked', 'unlinked')
    OR v_workbook.drive_file_id IS NULL
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'blocked');
  END IF;
  IF v_workbook.check_lease_expires_at > pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unchanged');
  END IF;

  UPDATE plugin_data.csf_class_workbooks
  SET check_lease_token = v_token,
      check_lease_expires_at = pg_catalog.now()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = pg_catalog.now()
  WHERE id = v_workbook.id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'leased',
    'workbookId', v_workbook.id,
    'driveFileId', v_workbook.drive_file_id,
    'ownerUserId', v_workbook.drive_owner_user_id,
    'leaseToken', v_token,
    'providerVersion', v_workbook.provider_version,
    'lastPreparedVersion', v_workbook.last_prepared_version
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_claim_class_workbook_check(
  uuid, uuid, uuid, integer
) IS
  'Claims one bounded metadata-check lease. Null or out-of-range durations are refused before workbook state changes.';

REVOKE ALL ON FUNCTION plugin_data.csf_claim_class_workbook_check(
  uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_class_workbook_check(
  uuid, uuid, uuid, integer
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_complete_class_workbook_check(
  p_organization_id uuid,
  p_workbook_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_provider_version text,
  p_provider_modified_at text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_job_id uuid;
BEGIN
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );
  IF p_provider_version IS NULL
    OR p_provider_version !~ '^[1-9][0-9]{0,18}$'
  THEN
    RAISE EXCEPTION 'The workbook version is unavailable.';
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.id = p_workbook_id
  FOR UPDATE;
  IF p_lease_token IS NULL
    OR NOT FOUND
    OR v_workbook.check_lease_token IS NULL
    OR v_workbook.check_lease_token IS DISTINCT FROM p_lease_token
    OR v_workbook.check_lease_expires_at IS NULL
    OR v_workbook.check_lease_expires_at <= pg_catalog.now()
  THEN
    RAISE EXCEPTION 'The workbook check lease is no longer active.';
  END IF;
  IF v_workbook.drive_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'The workbook owner is no longer available.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE plugin_data.csf_class_workbooks
  SET provider_version = p_provider_version,
      provider_modified_at = p_provider_modified_at,
      last_checked_at = pg_catalog.now(),
      check_lease_token = NULL,
      check_lease_expires_at = NULL,
      state = 'linked',
      last_error_code = NULL,
      updated_at = pg_catalog.now()
  WHERE id = p_workbook_id;

  IF v_workbook.last_prepared_version = p_provider_version THEN
    RETURN pg_catalog.jsonb_build_object('status', 'unchanged');
  END IF;

  INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
    organization_id,
    workbook_id,
    drive_file_id,
    provider_version,
    requested_by,
    status,
    updated_at
  ) VALUES (
    p_organization_id,
    p_workbook_id,
    v_workbook.drive_file_id,
    p_provider_version,
    p_actor_user_id,
    'queued',
    pg_catalog.now()
  )
  ON CONFLICT (workbook_id, drive_file_id, provider_version) DO UPDATE
  SET status = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN 'running'
        ELSE 'queued'
      END,
      requested_by = EXCLUDED.requested_by,
      lease_token = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.lease_token
        ELSE NULL
      END,
      lease_expires_at = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
        ELSE NULL
      END,
      claimed_owner_user_id = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.claimed_owner_user_id
        ELSE NULL
      END,
      attempt_count = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.attempt_count
        ELSE 0
      END,
      started_at = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.started_at
        ELSE NULL
      END,
      result_counts = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          AND plugin_data.csf_class_workbook_refresh_jobs.lease_expires_at
            > pg_catalog.now()
          THEN plugin_data.csf_class_workbook_refresh_jobs.result_counts
        ELSE '{}'::jsonb
      END,
      error_code = NULL,
      finished_at = NULL,
      updated_at = pg_catalog.now()
  RETURNING id INTO v_job_id;

  RETURN pg_catalog.jsonb_build_object('status', 'queued', 'jobId', v_job_id);
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_complete_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) IS
  'Completes one metadata check without transferring the workbook OAuth owner. The visiting officer is recorded only as the refresh requester.';

REVOKE ALL ON FUNCTION plugin_data.csf_complete_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_complete_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_fail_class_workbook_check(
  p_organization_id uuid,
  p_workbook_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_state text,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
BEGIN
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );
  IF p_state NOT IN ('needs_reconnect', 'blocked') THEN
    RAISE EXCEPTION 'Choose a supported workbook state.';
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.id = p_workbook_id
  FOR UPDATE;
  IF p_lease_token IS NULL
    OR NOT FOUND
    OR v_workbook.check_lease_token IS DISTINCT FROM p_lease_token
    OR v_workbook.check_lease_expires_at IS NULL
    OR v_workbook.check_lease_expires_at <= pg_catalog.now()
  THEN
    RAISE EXCEPTION 'The workbook check lease is no longer active.';
  END IF;

  UPDATE plugin_data.csf_class_workbooks
  SET state = p_state,
      last_checked_at = pg_catalog.now(),
      check_lease_token = NULL,
      check_lease_expires_at = NULL,
      last_error_code = pg_catalog.left(
        coalesce(p_error_code, 'metadata_check_failed'),
        100
      ),
      updated_at = pg_catalog.now()
  WHERE id = v_workbook.id;

  RETURN pg_catalog.jsonb_build_object('status', p_state);
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_fail_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) IS
  'Settles one metadata-check failure only while its exact workbook lease remains active. An expired caller cannot strand later refresh checks.';

REVOKE ALL ON FUNCTION plugin_data.csf_fail_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fail_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) TO service_role;

CREATE FUNCTION plugin_data.csf_unlink_class_workbook(
  p_organization_id uuid,
  p_cohort_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_cancelled_refresh_jobs integer := 0;
  v_disabled_sources integer := 0;
BEGIN
  IF p_organization_id IS NULL
    OR p_cohort_id IS NULL
    OR p_actor_user_id IS NULL
  THEN
    RAISE EXCEPTION 'Unlinking a class workbook requires an organization, class, and officer.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = p_cohort_id
  ) THEN
    RAISE EXCEPTION 'This class does not belong to the organization.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_class_workbook:'
        || p_organization_id::text || ':' || p_cohort_id::text,
      0
    )
  );

  -- Refresh mutations always lock the workbook before its jobs and sources.
  -- Unlink uses the same order so a worker either finishes before this change or
  -- observes the revoked generation afterward.
  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.cohort_id = p_cohort_id
  FOR UPDATE;

  IF FOUND THEN
    PERFORM job.id
    FROM plugin_data.csf_class_workbook_refresh_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.workbook_id = v_workbook.id
    ORDER BY job.id
    FOR UPDATE;

    UPDATE plugin_data.csf_class_workbook_refresh_jobs AS job
    SET status = 'blocked',
        error_code = 'workbook_unlinked',
        lease_token = NULL,
        lease_expires_at = NULL,
        claimed_owner_user_id = NULL,
        finished_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE job.organization_id = p_organization_id
      AND job.workbook_id = v_workbook.id
      AND job.status IN ('queued', 'running');
    GET DIAGNOSTICS v_cancelled_refresh_jobs = ROW_COUNT;

    UPDATE plugin_data.csf_class_workbooks AS workbook
    SET state = 'unlinked',
        check_lease_token = NULL,
        check_lease_expires_at = NULL,
        last_error_code = NULL,
        updated_at = pg_catalog.now()
    WHERE workbook.organization_id = p_organization_id
      AND workbook.id = v_workbook.id;
  END IF;

  PERFORM source.id
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.cohort_id = p_cohort_id
    AND source.source_type = 'class_history'
    AND source.provider = 'google_sheets'
  ORDER BY source.id
  FOR UPDATE;

  UPDATE plugin_data.csf_sheet_sources AS source
  SET sync_mode = 'disabled',
      sync_status = 'disabled',
      last_sync_status = 'unlinked',
      last_sync_error = NULL,
      updated_at = pg_catalog.now()
  WHERE source.organization_id = p_organization_id
    AND source.cohort_id = p_cohort_id
    AND source.source_type = 'class_history'
    AND source.provider = 'google_sheets';
  GET DIAGNOSTICS v_disabled_sources = ROW_COUNT;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    before_data,
    after_data,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'sheets.class_workbook_unlinked',
    'csf_class_workbooks',
    v_workbook.id,
    pg_catalog.jsonb_build_object(
      'state', v_workbook.state,
      'cohortId', p_cohort_id
    ),
    pg_catalog.jsonb_build_object(
      'state', 'unlinked',
      'disabledSourceCount', v_disabled_sources,
      'cancelledRefreshJobCount', v_cancelled_refresh_jobs
    ),
    'class_history',
    p_cohort_id::text,
    'officer_unlinked'
  );

  RETURN pg_catalog.jsonb_build_object(
    'unlinked', true,
    'status', 'unlinked',
    'workbookId', v_workbook.id,
    'disabledSourceCount', v_disabled_sources,
    'cancelledRefreshJobCount', v_cancelled_refresh_jobs
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_unlink_class_workbook(uuid, uuid, uuid) IS
  'Atomically unlinks one class workbook. It revokes metadata and refresh leases, blocks queued or running generation jobs, disables the class sources, and records a coordinate-only officer audit event.';

REVOKE ALL ON FUNCTION plugin_data.csf_unlink_class_workbook(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_unlink_class_workbook(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_job_id uuid;
  v_workbook_id uuid;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds IS NULL
    OR p_lease_seconds < 30
    OR p_lease_seconds > 300
  THEN
    RAISE EXCEPTION 'Workbook worker lease must be between 30 and 300 seconds.'
      USING ERRCODE = '22023';
  END IF;

  -- Choose without a row lock, then lock the workbook before the job. Metadata
  -- completion already uses that order. Recheck eligibility after both worker
  -- contenders serialize on the workbook row.
  SELECT job.id, job.workbook_id
  INTO v_job_id, v_workbook_id
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.status = 'queued'
     OR (job.status = 'running' AND job.lease_expires_at <= now())
  ORDER BY job.created_at, job.id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.id = v_workbook_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT job.* INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.id = v_job_id
    AND (
      job.status = 'queued'
      OR (job.status = 'running' AND job.lease_expires_at <= now())
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  IF v_workbook.state = 'unlinked' THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_unlinked',
        lease_token = NULL,
        lease_expires_at = NULL,
        claimed_owner_user_id = NULL,
        finished_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_job.id;
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'status', 'blocked',
      'errorCode', 'workbook_unlinked'
    );
  END IF;

  IF v_workbook.drive_owner_user_id IS NULL THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_owner_missing',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = v_job.id;
    UPDATE plugin_data.csf_class_workbooks
    SET state = 'blocked',
        last_error_code = 'workbook_owner_missing',
        updated_at = now()
    WHERE id = v_workbook.id;
    RETURN jsonb_build_object('claimed', false);
  END IF;

  IF v_workbook.drive_file_id IS DISTINCT FROM v_job.drive_file_id
    OR v_workbook.provider_version IS DISTINCT FROM v_job.provider_version
  THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'stale_workbook_generation',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object('claimed', false);
  END IF;

  IF v_job.attempt_count >= 5 THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'refresh_attempts_exhausted',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_job.id;
    UPDATE plugin_data.csf_class_workbooks
    SET state = 'blocked',
        last_error_code = 'refresh_attempts_exhausted',
        updated_at = pg_catalog.now()
    WHERE id = v_workbook.id;
    RETURN pg_catalog.jsonb_build_object(
      'claimed', false,
      'status', 'blocked',
      'errorCode', 'refresh_attempts_exhausted'
    );
  END IF;

  BEGIN
    PERFORM plugin_data.csf_assert_import_actor(
      v_workbook.organization_id,
      v_workbook.drive_owner_user_id,
      'class_history'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_owner_not_authorized',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = v_job.id;
    UPDATE plugin_data.csf_class_workbooks
    SET state = 'blocked',
        last_error_code = 'workbook_owner_not_authorized',
        updated_at = now()
    WHERE id = v_workbook.id;
    RETURN jsonb_build_object('claimed', false);
  END;

  UPDATE plugin_data.csf_class_workbook_refresh_jobs
  SET status = 'running',
      lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      claimed_owner_user_id = v_workbook.drive_owner_user_id,
      attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, now()),
      finished_at = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  RETURN jsonb_build_object(
    'claimed', true,
    'jobId', v_job.id,
    'leaseToken', v_token,
    'organizationId', v_workbook.organization_id,
    'cohortId', v_workbook.cohort_id,
    'workbookId', v_workbook.id,
    'driveFileId', v_job.drive_file_id,
    'ownerUserId', v_workbook.drive_owner_user_id,
    'providerVersion', v_job.provider_version
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(integer) IS
  'Claims one refresh only while its Drive file and provider version still match the class workbook registry. An expired lease is retried at most five times.';

REVOKE ALL ON FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_finish_class_workbook_refresh_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_discovered_tabs jsonb,
  p_prepared_count integer,
  p_template_count integer,
  p_blocked_count integer,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_workbook_id uuid;
  v_workbook_state text;
BEGIN
  IF p_status NOT IN ('completed', 'needs_reconnect', 'blocked', 'failed') THEN
    RAISE EXCEPTION 'Choose a supported workbook job result.';
  END IF;
  IF jsonb_typeof(p_discovered_tabs) <> 'array' THEN
    RAISE EXCEPTION 'Workbook tabs must be an array.';
  END IF;
  IF p_prepared_count IS NULL
    OR p_template_count IS NULL
    OR p_blocked_count IS NULL
    OR LEAST(
      p_prepared_count,
      p_template_count,
      p_blocked_count
    ) < 0
  THEN
    RAISE EXCEPTION 'Workbook result counts cannot be negative.';
  END IF;

  SELECT job.workbook_id
  INTO v_workbook_id
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The workbook worker lease is no longer active.';
  END IF;

  -- Match metadata completion by locking the workbook before its generation
  -- job. The job and lease are revalidated only after this parent lock settles.
  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.id = v_workbook_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The workbook worker lease is no longer active.';
  END IF;

  SELECT * INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.id = p_job_id
    AND job.workbook_id = v_workbook_id
  FOR UPDATE;
  IF p_lease_token IS NULL
    OR NOT FOUND
    OR v_job.status <> 'running'
    OR v_job.lease_token IS NULL
    OR v_job.lease_token IS DISTINCT FROM p_lease_token
    OR v_job.lease_expires_at IS NULL
    OR v_job.lease_expires_at <= pg_catalog.now()
  THEN
    RAISE EXCEPTION 'The workbook worker lease is no longer active.';
  END IF;

  IF v_workbook.state = 'unlinked' THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_unlinked',
        lease_token = NULL,
        lease_expires_at = NULL,
        claimed_owner_user_id = NULL,
        finished_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_job_id;
    RETURN pg_catalog.jsonb_build_object(
      'finished', true,
      'status', 'blocked'
    );
  END IF;

  IF v_workbook.drive_owner_user_id IS NULL
    OR v_job.claimed_owner_user_id IS NULL
    OR v_workbook.drive_owner_user_id IS DISTINCT FROM v_job.claimed_owner_user_id
  THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_owner_missing',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = p_job_id;
    UPDATE plugin_data.csf_class_workbooks
    SET state = 'blocked',
        last_error_code = 'workbook_owner_missing',
        updated_at = now()
    WHERE id = v_workbook.id;
    RETURN jsonb_build_object('finished', true, 'status', 'blocked');
  END IF;

  BEGIN
    PERFORM plugin_data.csf_assert_import_actor(
      v_workbook.organization_id,
      v_workbook.drive_owner_user_id,
      'class_history'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_owner_not_authorized',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = p_job_id;
    UPDATE plugin_data.csf_class_workbooks
    SET state = 'blocked',
        last_error_code = 'workbook_owner_not_authorized',
        updated_at = now()
    WHERE id = v_workbook.id;
    RETURN jsonb_build_object('finished', true, 'status', 'blocked');
  END;

  IF v_workbook.drive_file_id IS DISTINCT FROM v_job.drive_file_id
    OR v_workbook.provider_version IS DISTINCT FROM v_job.provider_version
  THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'stale_workbook_generation',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = p_job_id;
    RETURN jsonb_build_object('finished', true, 'status', 'blocked');
  END IF;

  UPDATE plugin_data.csf_class_workbook_refresh_jobs
  SET status = p_status,
      result_counts = jsonb_build_object(
        'prepared', p_prepared_count,
        'templates', p_template_count,
        'blocked', p_blocked_count
      ),
      error_code = left(p_error_code, 100),
      lease_token = NULL,
      lease_expires_at = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  v_workbook_state := CASE p_status
    WHEN 'completed' THEN 'linked'
    WHEN 'needs_reconnect' THEN 'needs_reconnect'
    ELSE 'blocked'
  END;
  UPDATE plugin_data.csf_class_workbooks
  SET discovered_tabs = CASE
        WHEN p_status = 'completed' THEN p_discovered_tabs
        ELSE discovered_tabs
      END,
      last_prepared_version = CASE
        WHEN p_status = 'completed' THEN v_job.provider_version
        ELSE last_prepared_version
      END,
      state = v_workbook_state,
      last_error_code = CASE
        WHEN p_status = 'completed' THEN NULL
        ELSE left(coalesce(p_error_code, p_status), 100)
      END,
      updated_at = now()
  WHERE id = v_job.workbook_id;

  RETURN jsonb_build_object('finished', true, 'status', p_status);
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_finish_class_workbook_refresh_job(
  uuid, uuid, text, jsonb, integer, integer, integer, text
) IS
  'Settles a refresh only while its Drive file and provider version still match the class workbook registry.';

REVOKE ALL ON FUNCTION plugin_data.csf_finish_class_workbook_refresh_job(
  uuid, uuid, text, jsonb, integer, integer, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_class_workbook_refresh_job(
  uuid, uuid, text, jsonb, integer, integer, integer, text
) TO service_role;

-- Class-workbook coordinates join the system-owned settings namespace. Normal
-- source registration carries this group forward but may neither state nor
-- erase it.
CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_source_attachment_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'stagedUpload',
    'stagingObjectId', 'stagingGeneration', 'stagingContentHash',
    'stagingByteLength', 'stagingReadyAt',
    'stagingRequestDigest', 'stagingAuditEventId', 'stagingAuditCorrelationId',
    'evidenceRevision', 'evidenceDigest',
    'workbookId', 'workbookRefreshJobId', 'workbookProviderVersion',
    'workbookDriveFileId'
  ];
$$;

COMMENT ON FUNCTION plugin_data.csf_sheet_source_attachment_keys() IS
  'The complete system-owned CSF source settings namespace: upload attachment proof, provider evidence, and the exact class-workbook refresh generation. Ordinary registration carries these keys forward but cannot state or erase them.';

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_source_attachment_keys()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_source_attachment_keys()
  TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_class_workbook_refresh_generation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_refresh_job_id uuid,
  p_refresh_lease_token uuid,
  p_workbook_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_provider_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL
    OR p_actor_user_id IS NULL
    OR p_refresh_job_id IS NULL
    OR p_refresh_lease_token IS NULL
    OR p_workbook_id IS NULL
    OR p_cohort_id IS NULL
    OR p_drive_file_id IS NULL
    OR p_drive_file_id = ''
    OR pg_catalog.octet_length(p_drive_file_id) > 512
    OR p_provider_version IS NULL
    OR p_provider_version !~ '^[1-9][0-9]{0,18}$'
  THEN
    RAISE EXCEPTION 'The workbook refresh generation is incomplete.'
      USING ERRCODE = '22023';
  END IF;

  -- Every refresh mutation uses workbook, then job. Source locks come later.
  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.id = p_workbook_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The class workbook is no longer available.'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_refresh_job_id
    AND job.workbook_id = p_workbook_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The workbook refresh job is no longer available.'
      USING ERRCODE = '23503';
  END IF;

  IF v_workbook.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_workbook.state = 'unlinked'
    OR v_workbook.drive_file_id IS DISTINCT FROM p_drive_file_id
    OR v_workbook.provider_version IS DISTINCT FROM p_provider_version
    OR v_workbook.drive_owner_user_id IS DISTINCT FROM p_actor_user_id
    OR v_job.drive_file_id IS DISTINCT FROM p_drive_file_id
    OR v_job.provider_version IS DISTINCT FROM p_provider_version
    OR v_job.claimed_owner_user_id IS DISTINCT FROM p_actor_user_id
    OR v_job.status <> 'running'
    OR v_job.lease_token IS DISTINCT FROM p_refresh_lease_token
    OR v_job.lease_expires_at <= pg_catalog.now()
  THEN
    RAISE EXCEPTION 'The workbook refresh generation is no longer current.'
      USING ERRCODE = '55000';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );

  RETURN pg_catalog.jsonb_build_object(
    'valid', true,
    'jobId', v_job.id,
    'workbookId', v_workbook.id,
    'cohortId', v_workbook.cohort_id,
    'driveFileId', v_workbook.drive_file_id,
    'providerVersion', v_workbook.provider_version,
    'ownerUserId', v_workbook.drive_owner_user_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_assert_class_workbook_refresh_generation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text
) IS
  'Service-only refresh fence. Locks workbook then job and returns valid true only for the exact active owner, class, Drive file, provider version, and unexpired worker lease.';

REVOKE ALL ON FUNCTION plugin_data.csf_assert_class_workbook_refresh_generation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_class_workbook_refresh_generation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text
) TO service_role;

CREATE FUNCTION plugin_data.csf_heartbeat_class_workbook_refresh_generation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_refresh_job_id uuid,
  p_refresh_lease_token uuid,
  p_workbook_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_provider_version text,
  p_lease_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
  v_lease_expires_at timestamptz;
BEGIN
  IF p_lease_seconds IS NULL
    OR p_lease_seconds < 30
    OR p_lease_seconds > 300
  THEN
    RAISE EXCEPTION 'Workbook worker lease must be between 30 and 300 seconds.'
      USING ERRCODE = '22023';
  END IF;
  IF p_organization_id IS NULL
    OR p_actor_user_id IS NULL
    OR p_refresh_job_id IS NULL
    OR p_refresh_lease_token IS NULL
    OR p_workbook_id IS NULL
    OR p_cohort_id IS NULL
    OR p_drive_file_id IS NULL
    OR p_drive_file_id = ''
    OR pg_catalog.octet_length(p_drive_file_id) > 512
    OR p_provider_version IS NULL
    OR p_provider_version !~ '^[1-9][0-9]{0,18}$'
  THEN
    RAISE EXCEPTION 'The workbook refresh generation is incomplete.'
      USING ERRCODE = '22023';
  END IF;

  -- Match every refresh mutation: workbook first, then its generation job.
  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.id = p_workbook_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The class workbook is no longer available.'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_refresh_job_id
    AND job.workbook_id = p_workbook_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The workbook refresh job is no longer available.'
      USING ERRCODE = '23503';
  END IF;

  IF v_workbook.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_workbook.state = 'unlinked'
    OR v_workbook.drive_file_id IS DISTINCT FROM p_drive_file_id
    OR v_workbook.provider_version IS DISTINCT FROM p_provider_version
    OR v_workbook.drive_owner_user_id IS DISTINCT FROM p_actor_user_id
    OR v_job.drive_file_id IS DISTINCT FROM p_drive_file_id
    OR v_job.provider_version IS DISTINCT FROM p_provider_version
    OR v_job.claimed_owner_user_id IS DISTINCT FROM p_actor_user_id
    OR v_job.status <> 'running'
    OR v_job.lease_token IS DISTINCT FROM p_refresh_lease_token
    OR v_job.lease_expires_at <= pg_catalog.now()
  THEN
    RAISE EXCEPTION 'The workbook refresh generation is no longer current.'
      USING ERRCODE = '55000';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );

  UPDATE plugin_data.csf_class_workbook_refresh_jobs AS job
  SET lease_expires_at = GREATEST(
        job.lease_expires_at,
        pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
      ),
      updated_at = pg_catalog.now()
  WHERE job.organization_id = p_organization_id
    AND job.id = p_refresh_job_id
    AND job.workbook_id = p_workbook_id
  RETURNING job.lease_expires_at INTO v_lease_expires_at;

  RETURN pg_catalog.jsonb_build_object(
    'valid', true,
    'leaseExpiresAt', v_lease_expires_at
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_heartbeat_class_workbook_refresh_generation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, integer
) IS
  'Extends only the exact active class-workbook generation lease after rechecking its owner, actor, class, Drive file, provider version, and lease token.';

REVOKE ALL ON FUNCTION plugin_data.csf_heartbeat_class_workbook_refresh_generation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_heartbeat_class_workbook_refresh_generation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, integer
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_source_type text,
  p_registration jsonb,
  p_refresh_job_id uuid,
  p_refresh_lease_token uuid,
  p_workbook_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_provider_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_receipt jsonb;
  v_source_id uuid;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_is_retirement boolean;
BEGIN
  PERFORM plugin_data.csf_assert_class_workbook_refresh_generation(
    p_organization_id,
    p_actor_user_id,
    p_refresh_job_id,
    p_refresh_lease_token,
    p_workbook_id,
    p_cohort_id,
    p_drive_file_id,
    p_provider_version
  );

  IF p_source_type IS DISTINCT FROM 'class_history' THEN
    RAISE EXCEPTION 'A class workbook may register only class history sources.'
      USING ERRCODE = '23514';
  END IF;
  IF p_registration IS NULL
    OR pg_catalog.jsonb_typeof(p_registration) <> 'object'
  THEN
    RAISE EXCEPTION 'A class workbook source registration must be an object.'
      USING ERRCODE = '22023';
  END IF;

  v_is_retirement := p_registration ->> 'syncMode' = 'disabled';
  IF p_source_id IS NOT NULL THEN
    -- A refresh lease belongs to one class. Lock an existing target before the
    -- generic registrar so the wrapper cannot move another class's source and
    -- validate only the already-mutated result afterward. An active same-class
    -- source may still move to a newly linked Drive file for that class.
    SELECT * INTO v_source
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = p_source_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The class workbook source is no longer available.'
        USING ERRCODE = '23503';
    END IF;
    IF v_source.source_type IS DISTINCT FROM 'class_history'
      OR v_source.cohort_id IS DISTINCT FROM p_cohort_id
      OR v_source.provider IS DISTINCT FROM 'google_sheets'
    THEN
      RAISE EXCEPTION 'The source does not belong to the claimed class.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_is_retirement THEN
    IF p_source_id IS NULL THEN
      RAISE EXCEPTION 'Retiring a class workbook source requires its source id.'
        USING ERRCODE = '22023';
    END IF;

    -- A newly linked workbook must retire active sources from the prior file
    -- and duplicate term registrations. The generation fence above proves the
    -- replacement workbook, while the locked source proves the same class.
    -- Keep the retired source's original Drive coordinates as provenance.
    IF (p_registration ? 'cohortId'
        AND p_registration ->> 'cohortId' IS DISTINCT FROM p_cohort_id::text)
      OR (p_registration ? 'spreadsheetId'
        AND p_registration ->> 'spreadsheetId'
          IS DISTINCT FROM v_source.spreadsheet_id)
      OR (p_registration ? 'driveFileId'
        AND p_registration ->> 'driveFileId'
          IS DISTINCT FROM v_source.drive_file_id)
      OR (p_registration ? 'provider'
        AND p_registration ->> 'provider' IS DISTINCT FROM 'google_sheets')
    THEN
      RAISE EXCEPTION 'A retired source must keep its original class and Drive coordinates.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF (
    p_registration ->> 'cohortId' IS DISTINCT FROM p_cohort_id::text
    OR coalesce(p_registration ->> 'spreadsheetId', '')
      IS DISTINCT FROM p_drive_file_id
    OR coalesce(p_registration ->> 'driveFileId', '')
      IS DISTINCT FROM p_drive_file_id
    OR coalesce(p_registration ->> 'provider', 'google_sheets')
      IS DISTINCT FROM 'google_sheets'
  ) THEN
    RAISE EXCEPTION 'The class workbook source does not match the claimed generation.'
      USING ERRCODE = '23514';
  END IF;

  v_receipt := plugin_data.csf_register_sheet_source(
    p_organization_id,
    p_actor_user_id,
    p_source_id,
    p_source_type,
    p_registration
  );

  IF pg_catalog.jsonb_typeof(v_receipt) <> 'object'
    OR pg_catalog.jsonb_typeof(v_receipt -> 'sourceId') <> 'string'
    OR v_receipt ->> 'sourceId' !~ c_uuid_shape
  THEN
    RAISE EXCEPTION 'The class workbook source receipt is invalid.'
      USING ERRCODE = '23514';
  END IF;
  v_source_id := (v_receipt ->> 'sourceId')::uuid;

  IF NOT v_is_retirement THEN
    SELECT * INTO v_source
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = v_source_id
    FOR UPDATE;
    IF NOT FOUND
      OR v_source.source_type IS DISTINCT FROM 'class_history'
      OR v_source.cohort_id IS DISTINCT FROM p_cohort_id
      OR v_source.provider IS DISTINCT FROM 'google_sheets'
      OR v_source.spreadsheet_id IS DISTINCT FROM p_drive_file_id
      OR v_source.drive_file_id IS DISTINCT FROM p_drive_file_id
    THEN
      RAISE EXCEPTION 'The registered source does not match the class workbook.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE plugin_data.csf_sheet_sources AS source
    SET settings = source.settings || pg_catalog.jsonb_build_object(
          'workbookId', p_workbook_id::text,
          'workbookRefreshJobId', p_refresh_job_id::text,
          'workbookProviderVersion', p_provider_version,
          'workbookDriveFileId', p_drive_file_id
        ),
        updated_at = pg_catalog.now()
    WHERE source.organization_id = p_organization_id
      AND source.id = v_source_id;
  END IF;

  RETURN v_receipt || pg_catalog.jsonb_build_object(
    'workbookGenerationBound', NOT v_is_retirement
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) IS
  'Service-only class-workbook source mutation. Holds the exact refresh fence while registering or retiring a source and binds active sources to that generation through system-owned settings.';

REVOKE ALL ON FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_register_class_workbook_sheet_source(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_class_workbook_preview_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_settings jsonb;
  v_mapping_snapshot jsonb;
  v_refresh_job_id uuid;
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
  v_expected_token text;
BEGIN
  IF NEW.mode <> 'preview' OR NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT source.* INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = NEW.organization_id
    AND source.id = NEW.source_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_settings := coalesce(v_source.settings, '{}'::jsonb);
  IF NOT (v_settings ? 'workbookId') THEN
    RETURN NEW;
  END IF;

  v_mapping_snapshot := coalesce(NEW.mapping_snapshot, '{}'::jsonb);
  IF v_source.source_type IS DISTINCT FROM 'class_history'
    OR v_source.provider IS DISTINCT FROM 'google_sheets'
    OR v_source.sync_mode = 'disabled'
    OR pg_catalog.jsonb_typeof(v_settings -> 'workbookRefreshJobId') <> 'string'
    OR pg_catalog.jsonb_typeof(v_mapping_snapshot -> 'workbookRefreshJobId') <> 'string'
    OR v_settings ->> 'workbookRefreshJobId' !~ c_uuid_shape
    OR v_mapping_snapshot ->> 'workbookRefreshJobId' !~ c_uuid_shape
    OR v_mapping_snapshot ->> 'workbookId'
      IS DISTINCT FROM v_settings ->> 'workbookId'
    OR v_mapping_snapshot ->> 'workbookRefreshJobId'
      IS DISTINCT FROM v_settings ->> 'workbookRefreshJobId'
    OR v_mapping_snapshot ->> 'workbookProviderVersion'
      IS DISTINCT FROM v_settings ->> 'workbookProviderVersion'
    OR v_mapping_snapshot ->> 'workbookDriveFileId'
      IS DISTINCT FROM v_settings ->> 'workbookDriveFileId'
  THEN
    RAISE EXCEPTION 'Class workbook previews must be opened by their refresh worker.'
      USING ERRCODE = '42501';
  END IF;

  v_refresh_job_id := (v_settings ->> 'workbookRefreshJobId')::uuid;
  SELECT job.* INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.organization_id = NEW.organization_id
    AND job.id = v_refresh_job_id;
  IF NOT FOUND
    OR v_job.status <> 'running'
    OR v_job.claimed_owner_user_id IS DISTINCT FROM NEW.initiated_by
    OR v_job.lease_token IS NULL
    OR v_job.lease_expires_at <= pg_catalog.now()
  THEN
    RAISE EXCEPTION 'Class workbook previews must be opened by their refresh worker.'
      USING ERRCODE = '42501';
  END IF;

  v_expected_token := pg_catalog.encode(
    extensions.digest(
      NEW.source_id::text || ':' || v_job.id::text || ':'
        || v_job.lease_token::text || ':' || coalesce(NEW.snapshot_hash, ''),
      'sha256'
    ),
    'hex'
  );
  IF pg_catalog.current_setting(
    'plugin_data.csf_workbook_preview_open_token', true
  ) IS DISTINCT FROM v_expected_token THEN
    RAISE EXCEPTION 'Class workbook previews must be opened by their refresh worker.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_class_workbook_preview_open()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_class_workbook_preview_open()
  TO postgres;

DROP TRIGGER IF EXISTS csf_sheet_import_jobs_workbook_open_guard
  ON plugin_data.csf_sheet_import_jobs;
CREATE TRIGGER csf_sheet_import_jobs_workbook_open_guard
BEFORE INSERT ON plugin_data.csf_sheet_import_jobs
FOR EACH ROW
EXECUTE FUNCTION plugin_data.csf_enforce_class_workbook_preview_open();

COMMENT ON TRIGGER csf_sheet_import_jobs_workbook_open_guard
  ON plugin_data.csf_sheet_import_jobs IS
  'Requires the exact refresh-worker transaction token before a generation-bound class workbook preview can be created.';

CREATE FUNCTION plugin_data.csf_open_or_reuse_class_workbook_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_source_type text,
  p_source_file_id text,
  p_source_file_name text,
  p_source_sheet_tab text,
  p_source_range text,
  p_source_modified_at timestamptz,
  p_source_file_metadata jsonb,
  p_mapping_snapshot jsonb,
  p_mapping_version integer,
  p_retry_of_job_id uuid,
  p_source_content_hash text,
  p_snapshot_hash text,
  p_snapshot_row_count integer,
  p_snapshot_contract_version text,
  p_refresh_job_id uuid,
  p_refresh_lease_token uuid,
  p_workbook_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_provider_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_existing plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_receipt jsonb;
  v_open_token text;
BEGIN
  IF p_source_type IS DISTINCT FROM 'class_history'
    OR p_source_file_id IS DISTINCT FROM p_drive_file_id
    OR p_snapshot_hash IS NULL
    OR p_snapshot_hash !~ '^[0-9a-f]{64}$'
    OR p_mapping_snapshot IS NULL
    OR pg_catalog.jsonb_typeof(p_mapping_snapshot) <> 'object'
    OR p_mapping_snapshot ->> 'workbookId' IS DISTINCT FROM p_workbook_id::text
    OR p_mapping_snapshot ->> 'workbookRefreshJobId'
      IS DISTINCT FROM p_refresh_job_id::text
    OR p_mapping_snapshot ->> 'workbookProviderVersion'
      IS DISTINCT FROM p_provider_version
    OR p_mapping_snapshot ->> 'workbookDriveFileId'
      IS DISTINCT FROM p_drive_file_id
  THEN
    RAISE EXCEPTION 'The class workbook preview does not match its generation.'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    PERFORM plugin_data.csf_assert_class_workbook_refresh_generation(
      p_organization_id,
      p_actor_user_id,
      p_refresh_job_id,
      p_refresh_lease_token,
      p_workbook_id,
      p_cohort_id,
      p_drive_file_id,
      p_provider_version
    );
  EXCEPTION
    WHEN SQLSTATE '23503' OR SQLSTATE '55000' THEN
      RETURN pg_catalog.jsonb_build_object(
        'opened', false,
        'reused', false,
        'retryable', true,
        'status', 'generation_lost',
        'reasonCode', 'workbook_refresh_generation_lost'
      );
  END;

  -- The generation assertion holds workbook then refresh job. Source comes
  -- next, matching source registration, unlink, seal, and commit fences.
  SELECT source.* INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_source.source_type IS DISTINCT FROM 'class_history'
    OR v_source.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_source.provider IS DISTINCT FROM 'google_sheets'
    OR v_source.sync_mode = 'disabled'
    OR v_source.spreadsheet_id IS DISTINCT FROM p_drive_file_id
    OR v_source.drive_file_id IS DISTINCT FROM p_drive_file_id
    OR v_source.settings ->> 'workbookId' IS DISTINCT FROM p_workbook_id::text
    OR v_source.settings ->> 'workbookRefreshJobId'
      IS DISTINCT FROM p_refresh_job_id::text
    OR v_source.settings ->> 'workbookProviderVersion'
      IS DISTINCT FROM p_provider_version
    OR v_source.settings ->> 'workbookDriveFileId'
      IS DISTINCT FROM p_drive_file_id
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'opened', false,
      'reused', false,
      'retryable', true,
      'status', 'generation_lost',
      'reasonCode', 'workbook_refresh_generation_lost'
    );
  END IF;

  -- Workbook, job, and source locks serialize this lookup with every other
  -- generation-aware open. A lost response can therefore reuse the running
  -- preview, whose row appender is itself coordinate-idempotent.
  IF p_retry_of_job_id IS NULL THEN
    SELECT preview.* INTO v_existing
    FROM plugin_data.csf_sheet_import_jobs AS preview
    WHERE preview.organization_id = p_organization_id
      AND preview.source_id = p_source_id
      AND preview.mode = 'preview'
      AND preview.initiated_by = p_actor_user_id
      AND preview.snapshot_hash = p_snapshot_hash
      AND preview.snapshot_contract_version = p_snapshot_contract_version
      AND preview.mapping_version = p_mapping_version
      AND preview.status IN ('running', 'completed', 'needs_resolution')
      AND preview.mapping_snapshot ->> 'workbookId' = p_workbook_id::text
      AND preview.mapping_snapshot ->> 'workbookRefreshJobId' = p_refresh_job_id::text
      AND preview.mapping_snapshot ->> 'workbookProviderVersion' = p_provider_version
      AND preview.mapping_snapshot ->> 'workbookDriveFileId' = p_drive_file_id
    ORDER BY preview.created_at DESC, preview.id DESC
    LIMIT 1;
    IF FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'opened', true,
        'reused', true,
        'retryable', false,
        'status', v_existing.status,
        'previewJobId', v_existing.id,
        'correlationId', v_existing.correlation_id,
        'sourceType', v_existing.source_type,
        'snapshotRowCount', v_existing.snapshot_row_count
      );
    END IF;
  END IF;

  v_open_token := pg_catalog.encode(
    extensions.digest(
      p_source_id::text || ':' || p_refresh_job_id::text || ':'
        || p_refresh_lease_token::text || ':' || p_snapshot_hash,
      'sha256'
    ),
    'hex'
  );
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_workbook_preview_open_token',
    v_open_token,
    true
  );

  v_receipt := plugin_data.csf_open_import_preview(
    p_organization_id,
    p_actor_user_id,
    p_source_id,
    p_source_type,
    p_source_file_id,
    p_source_file_name,
    p_source_sheet_tab,
    p_source_range,
    p_source_modified_at,
    p_source_file_metadata,
    p_mapping_snapshot,
    p_mapping_version,
    p_retry_of_job_id,
    p_source_content_hash,
    p_snapshot_hash,
    p_snapshot_row_count,
    p_snapshot_contract_version
  );

  RETURN v_receipt || pg_catalog.jsonb_build_object(
    'opened', true,
    'reused', false,
    'retryable', false,
    'snapshotRowCount', p_snapshot_row_count
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_open_or_reuse_class_workbook_import_preview(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb,
  integer, uuid, text, text, integer, text, uuid, uuid, uuid, uuid, text, text
) IS
  'Atomically validates one active workbook generation, locks its source, reuses an identical preview, or opens it with a transaction-only generation token. Proven generation loss returns a retryable closed receipt.';

REVOKE ALL ON FUNCTION plugin_data.csf_open_or_reuse_class_workbook_import_preview(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb,
  integer, uuid, text, text, integer, text, uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_open_or_reuse_class_workbook_import_preview(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, jsonb, jsonb,
  integer, uuid, text, text, integer, text, uuid, uuid, uuid, uuid, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_lock_import_commit_coordinate(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_lock_rows boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_source_id uuid;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_settings jsonb;
  v_mapping_snapshot jsonb;
  v_workbook_id uuid;
  v_refresh_job_id uuid;
  v_generation_key_count integer;
  v_source_generation_key_count integer;
BEGIN
  IF p_organization_id IS NULL OR p_preview_job_id IS NULL THEN
    RAISE EXCEPTION
      'A CSF import commit coordinate needs both an organization and a preview job.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_import_commit:'
        || p_organization_id::text || ':' || p_preview_job_id::text,
      0
    )
  );

  PERFORM 1
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id
  FOR UPDATE;

  PERFORM 1
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.organization_id = p_organization_id
    AND commit_job.mode = 'commit'
    AND commit_job.preview_job_id = p_preview_job_id
  FOR UPDATE;

  PERFORM 1
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.commit_job_id IN (
      SELECT commit_job.id
      FROM plugin_data.csf_sheet_import_jobs AS commit_job
      WHERE commit_job.organization_id = p_organization_id
        AND commit_job.mode = 'commit'
        AND commit_job.preview_job_id = p_preview_job_id
    )
  ORDER BY attempt.attempt_number
  FOR UPDATE;

  IF coalesce(p_lock_rows, false) THEN
    PERFORM 1
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
    ORDER BY import_row.sheet_tab_name, import_row.row_number, import_row.id
    FOR UPDATE;
  END IF;

  SELECT preview.source_id, coalesce(preview.mapping_snapshot, '{}'::jsonb)
  INTO v_source_id, v_mapping_snapshot
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;

  IF v_source_id IS NOT NULL THEN
    SELECT source.* INTO v_source
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = v_source_id;
    v_settings := coalesce(v_source.settings, '{}'::jsonb);

    SELECT pg_catalog.count(*)::integer INTO v_generation_key_count
    FROM pg_catalog.unnest(ARRAY[
      'workbookId', 'workbookRefreshJobId', 'workbookProviderVersion',
      'workbookDriveFileId'
    ]) AS generation_key(key)
    WHERE v_mapping_snapshot ? generation_key.key;

    SELECT pg_catalog.count(*)::integer INTO v_source_generation_key_count
    FROM pg_catalog.unnest(ARRAY[
      'workbookId', 'workbookRefreshJobId', 'workbookProviderVersion',
      'workbookDriveFileId'
    ]) AS generation_key(key)
    WHERE v_settings ? generation_key.key;

    IF v_generation_key_count = 0
      AND v_source_generation_key_count = 0
      AND v_source.source_type = 'class_history'
      AND v_source.provider = 'google_sheets'
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_class_workbooks AS workbook
        WHERE workbook.organization_id = p_organization_id
          AND workbook.cohort_id = v_source.cohort_id
      )
    THEN
      RAISE EXCEPTION
        'This class workbook must be prepared again before its imports can continue.'
        USING ERRCODE = '55000';
    END IF;

    IF v_generation_key_count > 0 OR v_source_generation_key_count > 0 THEN
      IF v_generation_key_count <> 4
        OR v_source_generation_key_count <> 4
        OR pg_catalog.jsonb_typeof(v_mapping_snapshot -> 'workbookId') <> 'string'
        OR pg_catalog.jsonb_typeof(v_mapping_snapshot -> 'workbookRefreshJobId') <> 'string'
        OR v_mapping_snapshot ->> 'workbookId' !~ c_uuid_shape
        OR v_mapping_snapshot ->> 'workbookRefreshJobId' !~ c_uuid_shape
      THEN
        RAISE EXCEPTION 'This import source has malformed workbook generation evidence.'
          USING ERRCODE = '23514';
      END IF;
      v_workbook_id := (v_mapping_snapshot ->> 'workbookId')::uuid;
      v_refresh_job_id := (v_mapping_snapshot ->> 'workbookRefreshJobId')::uuid;

      -- Class-workbook locks come before the shared source row. This matches
      -- refresh registration and prevents source/workbook cycles.
      PERFORM 1
      FROM plugin_data.csf_class_workbooks AS workbook
      WHERE workbook.organization_id = p_organization_id
        AND workbook.id = v_workbook_id
      FOR SHARE;
      PERFORM 1
      FROM plugin_data.csf_class_workbook_refresh_jobs AS job
      WHERE job.organization_id = p_organization_id
        AND job.id = v_refresh_job_id
        AND job.workbook_id = v_workbook_id
      FOR SHARE;
    END IF;

    PERFORM 1
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = v_source_id
    FOR UPDATE;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_lock_import_commit_coordinate(
  uuid, uuid, boolean
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_lock_import_commit_coordinate(
  uuid, uuid, boolean
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_lock_import_commit_coordinate(
  uuid, uuid, boolean
) IS
  'The canonical import lock order: advisory coordinate, preview, commit, attempts, rows, optional class workbook and refresh job, then source. Class generation rows are locked before the shared source to match refresh workers.';

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_import_preview_workbook_generation_current(
  p_organization_id uuid,
  p_preview_job_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_generation_keys constant text[] := ARRAY[
    'workbookId', 'workbookRefreshJobId', 'workbookProviderVersion',
    'workbookDriveFileId'
  ];
  v_preview_source_id uuid;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_settings jsonb;
  v_mapping_snapshot jsonb;
  v_preview_present integer;
  v_source_present integer;
  v_workbook_id uuid;
  v_refresh_job_id uuid;
  v_provider_version text;
  v_drive_file_id text;
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
BEGIN
  SELECT preview.source_id, coalesce(preview.mapping_snapshot, '{}'::jsonb)
  INTO v_preview_source_id, v_mapping_snapshot
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id
    AND preview.mode = 'preview';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This import preview is no longer available.'
      USING ERRCODE = '23503';
  END IF;
  IF v_preview_source_id IS NULL THEN
    RETURN;
  END IF;

  SELECT source.* INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_preview_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source for this import preview no longer exists.'
      USING ERRCODE = '23503';
  END IF;
  v_settings := coalesce(v_source.settings, '{}'::jsonb);
  IF v_source.sync_mode = 'disabled' THEN
    RAISE EXCEPTION 'This import source is no longer active.'
      USING ERRCODE = '55000';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_preview_present
  FROM pg_catalog.unnest(c_generation_keys) AS generation_key(key)
  WHERE v_mapping_snapshot ? generation_key.key;
  SELECT pg_catalog.count(*)::integer INTO v_source_present
  FROM pg_catalog.unnest(c_generation_keys) AS generation_key(key)
  WHERE v_settings ? generation_key.key;
  IF v_preview_present = 0 AND v_source_present = 0 THEN
    IF v_source.source_type = 'class_history'
      AND v_source.provider = 'google_sheets'
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_class_workbooks AS workbook
        WHERE workbook.organization_id = p_organization_id
          AND workbook.cohort_id = v_source.cohort_id
      )
    THEN
      RAISE EXCEPTION
        'This class workbook must be prepared again before its imports can continue.'
        USING ERRCODE = '55000';
    END IF;
    RETURN;
  END IF;
  IF v_preview_present <> pg_catalog.cardinality(c_generation_keys)
    OR v_source_present <> pg_catalog.cardinality(c_generation_keys)
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(c_generation_keys) AS generation_key(key)
      WHERE pg_catalog.jsonb_typeof(v_mapping_snapshot -> generation_key.key) <> 'string'
        OR pg_catalog.jsonb_typeof(v_settings -> generation_key.key) <> 'string'
    )
    OR v_mapping_snapshot ->> 'workbookId' !~ c_uuid_shape
    OR v_mapping_snapshot ->> 'workbookRefreshJobId' !~ c_uuid_shape
    OR coalesce(v_mapping_snapshot ->> 'workbookProviderVersion', '')
      !~ '^[1-9][0-9]{0,18}$'
    OR coalesce(v_mapping_snapshot ->> 'workbookDriveFileId', '') = ''
    OR pg_catalog.octet_length(
      v_mapping_snapshot ->> 'workbookDriveFileId'
    ) > 512
  THEN
    RAISE EXCEPTION 'This import preview has malformed workbook generation evidence.'
      USING ERRCODE = '23514';
  END IF;

  v_workbook_id := (v_mapping_snapshot ->> 'workbookId')::uuid;
  v_refresh_job_id := (v_mapping_snapshot ->> 'workbookRefreshJobId')::uuid;
  v_provider_version := v_mapping_snapshot ->> 'workbookProviderVersion';
  v_drive_file_id := v_mapping_snapshot ->> 'workbookDriveFileId';

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.id = v_workbook_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The workbook generation for this preview no longer exists.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = v_refresh_job_id
    AND job.workbook_id = v_workbook_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The workbook generation for this preview no longer exists.'
      USING ERRCODE = '55000';
  END IF;

  -- Source last. Reload its coordinates under the lock so a mapping save cannot
  -- alter the generation between this check and queue/claim settlement.
  SELECT source.* INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_preview_source_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source for this import preview no longer exists.'
      USING ERRCODE = '23503';
  END IF;
  v_settings := coalesce(v_source.settings, '{}'::jsonb);

  IF v_source.source_type IS DISTINCT FROM 'class_history'
    OR v_source.cohort_id IS DISTINCT FROM v_workbook.cohort_id
    OR v_source.provider IS DISTINCT FROM 'google_sheets'
    OR v_source.sync_mode = 'disabled'
    OR v_source.spreadsheet_id IS DISTINCT FROM v_drive_file_id
    OR v_source.drive_file_id IS DISTINCT FROM v_drive_file_id
    OR v_settings ->> 'workbookId' IS DISTINCT FROM v_workbook_id::text
    OR v_settings ->> 'workbookRefreshJobId' IS DISTINCT FROM v_refresh_job_id::text
    OR v_settings ->> 'workbookProviderVersion' IS DISTINCT FROM v_provider_version
    OR v_settings ->> 'workbookDriveFileId' IS DISTINCT FROM v_drive_file_id
    OR v_workbook.drive_file_id IS DISTINCT FROM v_drive_file_id
    OR v_workbook.provider_version IS DISTINCT FROM v_provider_version
    OR v_workbook.last_prepared_version IS DISTINCT FROM v_provider_version
    OR v_workbook.state <> 'linked'
    OR v_job.drive_file_id IS DISTINCT FROM v_drive_file_id
    OR v_job.provider_version IS DISTINCT FROM v_provider_version
    OR v_job.status <> 'completed'
  THEN
    RAISE EXCEPTION 'This workbook changed after the preview. Prepare it again.'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_assert_import_preview_workbook_generation_current(
  uuid, uuid
) IS
  'Owner-internal commit fence. Generic previews pass through; class-workbook previews lock workbook, refresh job, and source and require the exact completed Drive generation.';

REVOKE ALL ON FUNCTION plugin_data.csf_assert_import_preview_workbook_generation_current(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_import_preview_workbook_generation_current(
  uuid, uuid
) TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_class_workbook_preview_seal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_settings jsonb;
  v_mapping_snapshot jsonb;
  v_refresh_job_id uuid;
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
  v_expected_token text;
BEGIN
  IF OLD.mode <> 'preview'
    OR OLD.status <> 'running'
    OR NEW.status NOT IN ('completed', 'needs_resolution')
    OR NEW.source_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT source.* INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = NEW.organization_id
    AND source.id = NEW.source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source for this import preview no longer exists.'
      USING ERRCODE = '23503';
  END IF;
  v_settings := coalesce(v_source.settings, '{}'::jsonb);
  v_mapping_snapshot := coalesce(NEW.mapping_snapshot, '{}'::jsonb);
  IF v_source.sync_mode = 'disabled' THEN
    RAISE EXCEPTION 'This class workbook source is no longer active.'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (v_settings ? 'workbookId')
    AND NOT (v_mapping_snapshot ? 'workbookId')
  THEN
    IF v_source.source_type = 'class_history'
      AND v_source.provider = 'google_sheets'
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_class_workbooks AS workbook
        WHERE workbook.organization_id = NEW.organization_id
          AND workbook.cohort_id = v_source.cohort_id
      )
    THEN
      RAISE EXCEPTION
        'This class workbook must be prepared again before its imports can continue.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF pg_catalog.jsonb_typeof(v_settings -> 'workbookRefreshJobId') <> 'string'
    OR pg_catalog.jsonb_typeof(
      v_mapping_snapshot -> 'workbookRefreshJobId'
    ) <> 'string'
    OR v_settings ->> 'workbookRefreshJobId' !~ c_uuid_shape
    OR v_mapping_snapshot ->> 'workbookRefreshJobId' !~ c_uuid_shape
    OR (v_settings ->> 'workbookRefreshJobId')
      IS DISTINCT FROM (v_mapping_snapshot ->> 'workbookRefreshJobId')
  THEN
    RAISE EXCEPTION 'This class workbook preview has no valid refresh generation.'
      USING ERRCODE = '23514';
  END IF;
  v_refresh_job_id := (v_mapping_snapshot ->> 'workbookRefreshJobId')::uuid;
  SELECT job.* INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.organization_id = NEW.organization_id
    AND job.id = v_refresh_job_id;
  IF NOT FOUND
    OR v_job.status <> 'running'
    OR v_job.lease_token IS NULL
    OR v_job.lease_expires_at <= pg_catalog.now()
  THEN
    RAISE EXCEPTION 'This class workbook preview generation is no longer active.'
      USING ERRCODE = '55000';
  END IF;
  v_expected_token := pg_catalog.encode(
    extensions.digest(
      NEW.id::text || ':' || v_job.id::text || ':' || v_job.lease_token::text,
      'sha256'
    ),
    'hex'
  );
  IF pg_catalog.current_setting(
    'plugin_data.csf_workbook_preview_seal_token', true
  ) IS DISTINCT FROM v_expected_token THEN
    RAISE EXCEPTION 'Class workbook previews must be sealed by their refresh worker.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_class_workbook_preview_seal()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_class_workbook_preview_seal()
  TO postgres;

DROP TRIGGER IF EXISTS csf_sheet_import_jobs_workbook_seal_guard
  ON plugin_data.csf_sheet_import_jobs;
CREATE TRIGGER csf_sheet_import_jobs_workbook_seal_guard
BEFORE UPDATE OF status ON plugin_data.csf_sheet_import_jobs
FOR EACH ROW
EXECUTE FUNCTION plugin_data.csf_enforce_class_workbook_preview_seal();

COMMENT ON TRIGGER csf_sheet_import_jobs_workbook_seal_guard
  ON plugin_data.csf_sheet_import_jobs IS
  'Refuses publication of a class-workbook preview unless the exact leased refresh wrapper authorized this transaction.';

CREATE OR REPLACE FUNCTION plugin_data.csf_fail_class_workbook_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid,
  p_reason_code text,
  p_detail text,
  p_refresh_job_id uuid,
  p_refresh_lease_token uuid,
  p_workbook_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_provider_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_receipt jsonb;
BEGIN
  -- Preview first, matching seal and import commit. The generation assertion
  -- then locks workbook and refresh job before this function locks the source.
  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id
    AND preview.mode = 'preview'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'failed', false,
      'retryable', true,
      'status', 'generation_lost',
      'reasonCode', 'workbook_refresh_generation_lost'
    );
  END IF;
  IF v_preview.status <> 'running' THEN
    RETURN pg_catalog.jsonb_build_object(
      'failed', false,
      'retryable', false,
      'status', v_preview.status,
      'previewJobId', v_preview.id
    );
  END IF;

  BEGIN
    PERFORM plugin_data.csf_assert_class_workbook_refresh_generation(
      p_organization_id,
      p_actor_user_id,
      p_refresh_job_id,
      p_refresh_lease_token,
      p_workbook_id,
      p_cohort_id,
      p_drive_file_id,
      p_provider_version
    );
  EXCEPTION
    WHEN SQLSTATE '23503' OR SQLSTATE '55000' THEN
      RETURN pg_catalog.jsonb_build_object(
        'failed', false,
        'retryable', true,
        'status', 'generation_lost',
        'reasonCode', 'workbook_refresh_generation_lost'
      );
  END;

  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_preview.source_id
  FOR SHARE;
  IF NOT FOUND
    OR v_source.source_type IS DISTINCT FROM 'class_history'
    OR v_source.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_source.provider IS DISTINCT FROM 'google_sheets'
    OR v_source.sync_mode = 'disabled'
    OR v_source.spreadsheet_id IS DISTINCT FROM p_drive_file_id
    OR v_source.drive_file_id IS DISTINCT FROM p_drive_file_id
    OR v_source.settings ->> 'workbookId' IS DISTINCT FROM p_workbook_id::text
    OR v_source.settings ->> 'workbookRefreshJobId'
      IS DISTINCT FROM p_refresh_job_id::text
    OR v_source.settings ->> 'workbookProviderVersion'
      IS DISTINCT FROM p_provider_version
    OR v_source.settings ->> 'workbookDriveFileId'
      IS DISTINCT FROM p_drive_file_id
    OR v_preview.mapping_snapshot ->> 'workbookId'
      IS DISTINCT FROM p_workbook_id::text
    OR v_preview.mapping_snapshot ->> 'workbookRefreshJobId'
      IS DISTINCT FROM p_refresh_job_id::text
    OR v_preview.mapping_snapshot ->> 'workbookProviderVersion'
      IS DISTINCT FROM p_provider_version
    OR v_preview.mapping_snapshot ->> 'workbookDriveFileId'
      IS DISTINCT FROM p_drive_file_id
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'failed', false,
      'retryable', true,
      'status', 'generation_lost',
      'reasonCode', 'workbook_refresh_generation_lost'
    );
  END IF;

  v_receipt := plugin_data.csf_fail_import_preview(
    p_organization_id,
    p_actor_user_id,
    p_preview_job_id,
    p_reason_code,
    p_detail
  );
  IF coalesce((v_receipt ->> 'failed')::boolean, false) THEN
    RETURN v_receipt || pg_catalog.jsonb_build_object(
      'retryable', false,
      'status', 'failed',
      'previewJobId', p_preview_job_id
    );
  END IF;
  RETURN v_receipt || pg_catalog.jsonb_build_object(
    'retryable', false,
    'status', coalesce(v_receipt ->> 'status', 'not_found'),
    'previewJobId', p_preview_job_id
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_fail_class_workbook_import_preview(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text
) IS
  'Fails a class-workbook preview only for its exact active refresh lease. Proven generation loss returns a retryable closed receipt and never changes the preview.';

REVOKE ALL ON FUNCTION plugin_data.csf_fail_class_workbook_import_preview(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fail_class_workbook_import_preview(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_seal_class_workbook_import_preview(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_id uuid,
  p_status text,
  p_summary jsonb,
  p_refresh_job_id uuid,
  p_refresh_lease_token uuid,
  p_workbook_id uuid,
  p_cohort_id uuid,
  p_drive_file_id text,
  p_provider_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_token text;
BEGIN
  -- Preview first, matching batch approval and the import commit coordinate.
  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id
    AND preview.mode = 'preview'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This import preview is no longer available.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_class_workbook_refresh_generation(
    p_organization_id,
    p_actor_user_id,
    p_refresh_job_id,
    p_refresh_lease_token,
    p_workbook_id,
    p_cohort_id,
    p_drive_file_id,
    p_provider_version
  );

  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_preview.source_id
  FOR SHARE;
  IF NOT FOUND
    OR v_source.source_type IS DISTINCT FROM 'class_history'
    OR v_source.cohort_id IS DISTINCT FROM p_cohort_id
    OR v_source.provider IS DISTINCT FROM 'google_sheets'
    OR v_source.sync_mode = 'disabled'
    OR v_source.spreadsheet_id IS DISTINCT FROM p_drive_file_id
    OR v_source.drive_file_id IS DISTINCT FROM p_drive_file_id
    OR v_source.settings ->> 'workbookId' IS DISTINCT FROM p_workbook_id::text
    OR v_source.settings ->> 'workbookRefreshJobId'
      IS DISTINCT FROM p_refresh_job_id::text
    OR v_source.settings ->> 'workbookProviderVersion'
      IS DISTINCT FROM p_provider_version
    OR v_source.settings ->> 'workbookDriveFileId'
      IS DISTINCT FROM p_drive_file_id
    OR v_preview.mapping_snapshot ->> 'workbookId'
      IS DISTINCT FROM p_workbook_id::text
    OR v_preview.mapping_snapshot ->> 'workbookRefreshJobId'
      IS DISTINCT FROM p_refresh_job_id::text
    OR v_preview.mapping_snapshot ->> 'workbookProviderVersion'
      IS DISTINCT FROM p_provider_version
    OR v_preview.mapping_snapshot ->> 'workbookDriveFileId'
      IS DISTINCT FROM p_drive_file_id
  THEN
    RAISE EXCEPTION 'The preview source does not match the claimed workbook generation.'
      USING ERRCODE = '55000';
  END IF;

  v_token := pg_catalog.encode(
    extensions.digest(
      p_preview_job_id::text || ':' || p_refresh_job_id::text || ':'
        || p_refresh_lease_token::text,
      'sha256'
    ),
    'hex'
  );
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_workbook_preview_seal_token',
    v_token,
    true
  );

  RETURN plugin_data.csf_seal_import_preview(
    p_organization_id,
    p_actor_user_id,
    p_preview_job_id,
    p_status,
    p_summary
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_seal_class_workbook_import_preview(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) IS
  'Service-only class-workbook preview publication. Locks preview, workbook, refresh job, and source in canonical order, verifies exact generation provenance, and authorizes one normal seal in the same transaction.';

REVOKE ALL ON FUNCTION plugin_data.csf_seal_class_workbook_import_preview(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_seal_class_workbook_import_preview(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, text, text
) TO service_role;

ALTER FUNCTION plugin_data.csf_finalize_import_commit_attempt(uuid, uuid, jsonb)
  RENAME TO csf_finalize_import_commit_attempt_generation_base;
REVOKE ALL ON FUNCTION plugin_data.csf_finalize_import_commit_attempt_generation_base(
  uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_import_commit_attempt_generation_base(
  uuid, uuid, jsonb
) TO postgres;

ALTER FUNCTION plugin_data.csf_abort_import_commit_attempt(uuid, uuid, text, text)
  RENAME TO csf_abort_import_commit_attempt_generation_base;
REVOKE ALL ON FUNCTION plugin_data.csf_abort_import_commit_attempt_generation_base(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_abort_import_commit_attempt_generation_base(
  uuid, uuid, text, text
) TO postgres;

CREATE FUNCTION plugin_data.csf_import_commit_source_generation_current(
  p_organization_id uuid,
  p_preview_job_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_mapping_version_max constant bigint := 2147483647;
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_generation_keys constant text[] := ARRAY[
    'workbookId', 'workbookRefreshJobId', 'workbookProviderVersion',
    'workbookDriveFileId'
  ];
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_workbook plugin_data.csf_class_workbooks%ROWTYPE;
  v_job plugin_data.csf_class_workbook_refresh_jobs%ROWTYPE;
  v_mapping jsonb;
  v_settings jsonb;
  v_source_mapping_version integer := 1;
  v_source_mapping_version_text text;
  v_preview_key_count integer;
  v_source_key_count integer;
  v_workbook_id uuid;
  v_refresh_job_id uuid;
BEGIN
  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id
    AND preview.mode = 'preview'
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_preview.source_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = v_preview.source_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_mapping := coalesce(v_preview.mapping_snapshot, '{}'::jsonb);
  v_settings := coalesce(v_source.settings, '{}'::jsonb);
  IF v_source.sync_mode = 'disabled'
    OR v_preview.mapping_version IS NULL
    OR v_preview.mapping_version < 1
  THEN
    RETURN false;
  END IF;
  IF v_settings ? 'mappingVersion' THEN
    IF pg_catalog.jsonb_typeof(v_settings -> 'mappingVersion') <> 'number' THEN
      RETURN false;
    END IF;
    v_source_mapping_version_text := v_settings ->> 'mappingVersion';
    IF v_source_mapping_version_text IS NULL
      OR v_source_mapping_version_text !~ '^[1-9][0-9]{0,9}$'
    THEN
      RETURN false;
    END IF;
    IF v_source_mapping_version_text::bigint > c_mapping_version_max THEN
      RETURN false;
    END IF;
    v_source_mapping_version := v_source_mapping_version_text::integer;
  END IF;
  IF v_preview.mapping_version IS DISTINCT FROM v_source_mapping_version THEN
    RETURN false;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_preview_key_count
  FROM pg_catalog.unnest(c_generation_keys) AS generation_key(key)
  WHERE v_mapping ? generation_key.key;
  SELECT pg_catalog.count(*)::integer INTO v_source_key_count
  FROM pg_catalog.unnest(c_generation_keys) AS generation_key(key)
  WHERE v_settings ? generation_key.key;

  IF v_preview_key_count = 0 AND v_source_key_count = 0 THEN
    RETURN NOT (
      v_source.source_type = 'class_history'
      AND v_source.provider = 'google_sheets'
      AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_class_workbooks AS workbook
        WHERE workbook.organization_id = p_organization_id
          AND workbook.cohort_id = v_source.cohort_id
      )
    );
  END IF;
  IF v_preview_key_count <> pg_catalog.cardinality(c_generation_keys)
    OR v_source_key_count <> pg_catalog.cardinality(c_generation_keys)
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(c_generation_keys) AS generation_key(key)
      WHERE pg_catalog.jsonb_typeof(v_mapping -> generation_key.key) <> 'string'
        OR pg_catalog.jsonb_typeof(v_settings -> generation_key.key) <> 'string'
    )
    OR v_mapping ->> 'workbookId' !~ c_uuid_shape
    OR v_mapping ->> 'workbookRefreshJobId' !~ c_uuid_shape
  THEN
    RETURN false;
  END IF;

  v_workbook_id := (v_mapping ->> 'workbookId')::uuid;
  v_refresh_job_id := (v_mapping ->> 'workbookRefreshJobId')::uuid;
  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.id = v_workbook_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT * INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = v_refresh_job_id
    AND job.workbook_id = v_workbook_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN v_source.source_type = 'class_history'
    AND v_source.provider = 'google_sheets'
    AND v_source.sync_mode <> 'disabled'
    AND v_source.cohort_id IS NOT DISTINCT FROM v_workbook.cohort_id
    AND v_source.spreadsheet_id IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookDriveFileId')
    AND v_source.drive_file_id IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookDriveFileId')
    AND v_settings ->> 'workbookId' IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookId')
    AND v_settings ->> 'workbookRefreshJobId' IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookRefreshJobId')
    AND v_settings ->> 'workbookProviderVersion' IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookProviderVersion')
    AND v_settings ->> 'workbookDriveFileId' IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookDriveFileId')
    AND v_workbook.state = 'linked'
    AND v_workbook.drive_file_id IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookDriveFileId')
    AND v_workbook.provider_version IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookProviderVersion')
    AND v_workbook.last_prepared_version IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookProviderVersion')
    AND v_job.status = 'completed'
    AND v_job.drive_file_id IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookDriveFileId')
    AND v_job.provider_version IS NOT DISTINCT FROM
      (v_mapping ->> 'workbookProviderVersion');
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_import_commit_source_generation_current(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_commit_source_generation_current(
  uuid, uuid
) TO postgres;

CREATE FUNCTION plugin_data.csf_guard_stale_import_source_health()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.current_setting(
    'plugin_data.csf_skip_import_source_health_id',
    true
  ) = OLD.id::text THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_guard_stale_import_source_health()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_stale_import_source_health()
  TO postgres;

DROP TRIGGER IF EXISTS csf_sheet_sources_stale_import_health_guard
  ON plugin_data.csf_sheet_sources;
CREATE TRIGGER csf_sheet_sources_stale_import_health_guard
BEFORE UPDATE OF sync_status, last_sync_status, last_sync_error,
  last_committed_at, last_synced_at
ON plugin_data.csf_sheet_sources
FOR EACH ROW
EXECUTE FUNCTION plugin_data.csf_guard_stale_import_source_health();

CREATE FUNCTION plugin_data.csf_finalize_import_commit_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_summary jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_preview_job_id uuid;
  v_source_generation_current boolean;
  v_source_settlement text;
  v_receipt jsonb;
BEGIN
  SELECT commit_job.preview_job_id INTO v_preview_job_id
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  JOIN plugin_data.csf_sheet_import_commit_attempts AS attempt
    ON attempt.commit_job_id = commit_job.id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND OR v_preview_job_id IS NULL THEN
    RAISE EXCEPTION 'CSF commit attempt was not found.' USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id,
    v_preview_job_id,
    false
  );
  v_attempt := plugin_data.csf_assert_active_import_commit_attempt(
    p_organization_id,
    p_attempt_id
  );
  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;

  v_source_generation_current :=
    plugin_data.csf_import_commit_source_generation_current(
      p_organization_id,
      v_preview_job_id
    );
  v_source_settlement := CASE
    WHEN v_commit.source_id IS NULL THEN 'not_applicable'
    WHEN v_source_generation_current THEN 'settled'
    ELSE 'stale_source_state'
  END;
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_skip_import_source_health_id',
    CASE
      WHEN v_source_settlement = 'stale_source_state'
        THEN v_commit.source_id::text
      ELSE ''
    END,
    true
  );

  v_receipt := plugin_data.csf_finalize_import_commit_attempt_generation_base(
    p_organization_id,
    p_attempt_id,
    coalesce(p_summary, '{}'::jsonb) || pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
      'sourceSettlement', v_source_settlement,
      'sourceGenerationCurrent', v_source_generation_current,
      'sourceSettlementReasonCode', CASE
        WHEN v_source_settlement = 'stale_source_state'
          THEN 'source_changed_before_settlement'
        ELSE NULL
      END
      )
    )
  );

  IF v_source_settlement = 'stale_source_state' THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      correlation_id, source_type, source_id, after_data
    ) VALUES (
      p_organization_id,
      v_commit.commit_actor_user_id,
      'sheet_import.source_health_settlement_skipped',
      'csf_sheet_import_jobs',
      v_commit.id,
      v_attempt.correlation_id,
      'sheet_import',
      v_commit.source_id::text,
      pg_catalog.jsonb_build_object(
        'sourceSettlement', v_source_settlement,
        'reasonCode', 'source_changed_before_settlement'
      )
    );
  END IF;

  RETURN v_receipt || pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'sourceSettlement', v_source_settlement,
      'sourceGenerationCurrent', v_source_generation_current,
      'sourceSettlementReasonCode', CASE
        WHEN v_source_settlement = 'stale_source_state'
          THEN 'source_changed_before_settlement'
        ELSE NULL
      END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_finalize_import_commit_attempt(
  uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_import_commit_attempt(
  uuid, uuid, jsonb
) TO service_role;

CREATE FUNCTION plugin_data.csf_abort_import_commit_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_reason_code text,
  p_detail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_preview_job_id uuid;
  v_source_generation_current boolean;
  v_source_settlement text;
  v_receipt jsonb;
BEGIN
  SELECT commit_job.preview_job_id INTO v_preview_job_id
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  JOIN plugin_data.csf_sheet_import_commit_attempts AS attempt
    ON attempt.commit_job_id = commit_job.id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND OR v_preview_job_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'aborted', false,
      'reason', 'attempt_not_found',
      'sourceSettlement', 'not_attempted'
    );
  END IF;

  PERFORM plugin_data.csf_lock_import_commit_coordinate(
    p_organization_id,
    v_preview_job_id,
    false
  );
  SELECT * INTO v_attempt
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'aborted', false,
      'reason', 'attempt_not_found',
      'sourceSettlement', 'not_attempted'
    );
  END IF;
  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;

  v_source_generation_current :=
    plugin_data.csf_import_commit_source_generation_current(
      p_organization_id,
      v_preview_job_id
    );
  v_source_settlement := CASE
    WHEN v_commit.source_id IS NULL THEN 'not_applicable'
    WHEN v_source_generation_current THEN 'settled'
    ELSE 'stale_source_state'
  END;
  PERFORM pg_catalog.set_config(
    'plugin_data.csf_skip_import_source_health_id',
    CASE
      WHEN v_source_settlement = 'stale_source_state'
        THEN v_commit.source_id::text
      ELSE ''
    END,
    true
  );

  v_receipt := plugin_data.csf_abort_import_commit_attempt_generation_base(
    p_organization_id,
    p_attempt_id,
    p_reason_code,
    p_detail
  );
  IF NOT coalesce((v_receipt ->> 'aborted')::boolean, false) THEN
    RETURN v_receipt || pg_catalog.jsonb_build_object(
      'sourceSettlement', 'not_attempted',
      'sourceGenerationCurrent', v_source_generation_current
    );
  END IF;

  IF v_source_settlement = 'stale_source_state' THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      correlation_id, source_type, source_id, after_data
    ) VALUES (
      p_organization_id,
      v_commit.commit_actor_user_id,
      'sheet_import.source_health_settlement_skipped',
      'csf_sheet_import_jobs',
      v_commit.id,
      v_attempt.correlation_id,
      'sheet_import',
      v_commit.source_id::text,
      pg_catalog.jsonb_build_object(
        'sourceSettlement', v_source_settlement,
        'reasonCode', 'source_changed_before_settlement'
      )
    );
  END IF;

  RETURN v_receipt || pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'sourceSettlement', v_source_settlement,
      'sourceGenerationCurrent', v_source_generation_current,
      'sourceSettlementReasonCode', CASE
        WHEN v_source_settlement = 'stale_source_state'
          THEN 'source_changed_before_settlement'
        ELSE NULL
      END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_abort_import_commit_attempt(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_abort_import_commit_attempt(
  uuid, uuid, text, text
) TO service_role;

-- Pre-generation releases could mark a workbook version prepared without
-- binding its sources and previews to a refresh job. Invalidate every linked
-- current generation once and requeue it. This also revokes any old worker
-- lease, so only the generation-aware worker can publish the replacement.
WITH workbooks_requiring_generation_reprepare AS (
  UPDATE plugin_data.csf_class_workbooks AS workbook
  SET last_prepared_version = NULL,
      state = 'blocked',
      last_error_code = 'workbook_generation_reprepare_required',
      check_lease_token = NULL,
      check_lease_expires_at = NULL,
      updated_at = pg_catalog.now()
  WHERE workbook.state = 'linked'
    AND workbook.drive_file_id IS NOT NULL
    AND workbook.drive_file_id <> ''
    AND workbook.provider_version IS NOT NULL
  RETURNING
    workbook.id,
    workbook.organization_id,
    workbook.drive_file_id,
    workbook.drive_owner_user_id,
    workbook.provider_version
)
INSERT INTO plugin_data.csf_class_workbook_refresh_jobs (
  organization_id,
  workbook_id,
  drive_file_id,
  provider_version,
  requested_by,
  status,
  lease_token,
  lease_expires_at,
  claimed_owner_user_id,
  attempt_count,
  result_counts,
  error_code,
  started_at,
  finished_at,
  updated_at
)
SELECT
  workbook.organization_id,
  workbook.id,
  workbook.drive_file_id,
  workbook.provider_version,
  workbook.drive_owner_user_id,
  'queued',
  NULL,
  NULL,
  NULL,
  0,
  '{}'::jsonb,
  NULL,
  NULL,
  NULL,
  pg_catalog.now()
FROM workbooks_requiring_generation_reprepare AS workbook
ON CONFLICT (workbook_id, drive_file_id, provider_version) DO UPDATE
SET requested_by = EXCLUDED.requested_by,
    status = 'queued',
    lease_token = NULL,
    lease_expires_at = NULL,
    claimed_owner_user_id = NULL,
    attempt_count = 0,
    result_counts = '{}'::jsonb,
    error_code = NULL,
    started_at = NULL,
    finished_at = NULL,
    updated_at = pg_catalog.now();

COMMIT;
