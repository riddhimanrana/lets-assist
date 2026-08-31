-- Queue initial CSF class workbook preparation outside the linking request.

ALTER TABLE plugin_data.csf_class_workbook_refresh_jobs
  ADD COLUMN drive_file_id text;

UPDATE plugin_data.csf_class_workbook_refresh_jobs AS job
SET drive_file_id = workbook.drive_file_id
FROM plugin_data.csf_class_workbooks AS workbook
WHERE workbook.id = job.workbook_id;

ALTER TABLE plugin_data.csf_class_workbook_refresh_jobs
  ALTER COLUMN drive_file_id SET NOT NULL;

DO $migration$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT constraint_row.conname
  INTO v_constraint_name
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS relation_row
    ON relation_row.oid = constraint_row.conrelid
  JOIN pg_namespace AS namespace_row
    ON namespace_row.oid = relation_row.relnamespace
  WHERE namespace_row.nspname = 'plugin_data'
    AND relation_row.relname = 'csf_class_workbook_refresh_jobs'
    AND constraint_row.contype = 'u'
    AND pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (workbook_id, provider_version)';

  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION 'Expected workbook refresh job version constraint was not found.';
  END IF;

  EXECUTE format(
    'ALTER TABLE plugin_data.csf_class_workbook_refresh_jobs DROP CONSTRAINT %I',
    v_constraint_name
  );
END
$migration$;

ALTER TABLE plugin_data.csf_class_workbook_refresh_jobs
  ADD CONSTRAINT csf_class_workbook_refresh_jobs_source_version_key
  UNIQUE (workbook_id, drive_file_id, provider_version);

CREATE INDEX csf_workbook_refresh_jobs_tenant_state_idx
  ON plugin_data.csf_class_workbook_refresh_jobs (
    organization_id, status, created_at, id
  );
CREATE INDEX csf_import_approval_items_tenant_batch_idx
  ON plugin_data.csf_import_approval_batch_items (
    organization_id, batch_id, state, id
  );
CREATE INDEX csf_import_row_outcomes_tenant_batch_idx
  ON plugin_data.csf_import_row_batch_outcomes (
    organization_id, batch_id, created_at, id
  );

CREATE FUNCTION plugin_data.csf_queue_class_workbook_preparation(
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
  IF p_drive_file_id IS NULL OR btrim(p_drive_file_id) = '' THEN
    RAISE EXCEPTION 'Choose a class workbook.';
  END IF;
  IF p_provider_version IS NULL
    OR p_provider_version !~ '^[1-9][0-9]{0,18}$'
  THEN
    RAISE EXCEPTION 'The workbook version is unavailable.';
  END IF;
  IF jsonb_typeof(p_discovered_tabs) <> 'array' THEN
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
    jsonb_build_array(p_drive_file_id),
    now(),
    NULL,
    'linked',
    NULL,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (organization_id, cohort_id) DO UPDATE
  SET drive_file_id = EXCLUDED.drive_file_id,
      drive_owner_user_id = EXCLUDED.drive_owner_user_id,
      provider_version = EXCLUDED.provider_version,
      provider_modified_at = EXCLUDED.provider_modified_at,
      discovered_tabs = EXCLUDED.discovered_tabs,
      source_candidates = EXCLUDED.source_candidates,
      last_checked_at = EXCLUDED.last_checked_at,
      last_prepared_version = CASE
        WHEN plugin_data.csf_class_workbooks.drive_file_id = EXCLUDED.drive_file_id
          AND plugin_data.csf_class_workbooks.last_prepared_version = EXCLUDED.provider_version
        THEN plugin_data.csf_class_workbooks.last_prepared_version
        ELSE NULL
      END,
      state = 'linked',
      last_error_code = NULL,
      check_lease_token = NULL,
      check_lease_expires_at = NULL,
      updated_at = now()
  RETURNING * INTO v_workbook;

  IF v_workbook.last_prepared_version = p_provider_version THEN
    RETURN jsonb_build_object(
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
    now()
  )
  ON CONFLICT (workbook_id, drive_file_id, provider_version) DO UPDATE
  SET status = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          THEN 'running'
        ELSE 'queued'
      END,
      requested_by = EXCLUDED.requested_by,
      error_code = NULL,
      finished_at = NULL,
      updated_at = now()
  RETURNING id INTO v_job_id;

  RETURN jsonb_build_object(
    'status', 'queued',
    'workbookId', v_workbook.id,
    'jobId', v_job_id
  );
END;
$$;

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
  IF NOT FOUND
    OR v_workbook.check_lease_token IS DISTINCT FROM p_lease_token
    OR v_workbook.check_lease_expires_at <= now()
  THEN
    RAISE EXCEPTION 'The workbook check lease is no longer active.';
  END IF;

  UPDATE plugin_data.csf_class_workbooks
  SET provider_version = p_provider_version,
      provider_modified_at = p_provider_modified_at,
      drive_owner_user_id = p_actor_user_id,
      last_checked_at = now(),
      check_lease_token = NULL,
      check_lease_expires_at = NULL,
      state = 'linked',
      last_error_code = NULL,
      updated_at = now()
  WHERE id = p_workbook_id;

  IF v_workbook.last_prepared_version = p_provider_version THEN
    RETURN jsonb_build_object('status', 'unchanged');
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
    now()
  )
  ON CONFLICT (workbook_id, drive_file_id, provider_version) DO UPDATE
  SET status = CASE
        WHEN plugin_data.csf_class_workbook_refresh_jobs.status = 'running'
          THEN 'running'
        ELSE 'queued'
      END,
      requested_by = EXCLUDED.requested_by,
      error_code = NULL,
      finished_at = NULL,
      updated_at = now()
  RETURNING id INTO v_job_id;

  RETURN jsonb_build_object('status', 'queued', 'jobId', v_job_id);
END;
$$;

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
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'Workbook worker lease must be between 30 and 300 seconds.';
  END IF;

  SELECT job.* INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.status = 'queued'
     OR (job.status = 'running' AND job.lease_expires_at <= now())
  ORDER BY job.created_at, job.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.id = v_job.workbook_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_workbook.drive_owner_user_id IS NULL
    OR v_workbook.drive_file_id IS DISTINCT FROM v_job.drive_file_id
  THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = CASE
          WHEN v_workbook.drive_file_id IS DISTINCT FROM v_job.drive_file_id
            THEN 'stale_workbook_generation'
          ELSE 'workbook_owner_missing'
        END,
        finished_at = now(),
        updated_at = now()
    WHERE id = v_job.id;
    RETURN jsonb_build_object('claimed', false);
  END IF;

  BEGIN
    PERFORM plugin_data.csf_assert_import_actor(
      v_workbook.organization_id,
      v_workbook.drive_owner_user_id,
      'class_history'
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_owner_not_authorized',
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
  v_workbook_state text;
BEGIN
  IF p_status NOT IN ('completed', 'needs_reconnect', 'blocked', 'failed') THEN
    RAISE EXCEPTION 'Choose a supported workbook job result.';
  END IF;
  IF jsonb_typeof(p_discovered_tabs) <> 'array' THEN
    RAISE EXCEPTION 'Workbook tabs must be an array.';
  END IF;
  IF least(p_prepared_count, p_template_count, p_blocked_count) < 0 THEN
    RAISE EXCEPTION 'Workbook result counts cannot be negative.';
  END IF;

  SELECT * INTO v_job
  FROM plugin_data.csf_class_workbook_refresh_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_job.status <> 'running'
    OR v_job.lease_token IS DISTINCT FROM p_lease_token
    OR v_job.lease_expires_at <= now()
  THEN
    RAISE EXCEPTION 'The workbook worker lease is no longer active.';
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.id = v_job.workbook_id
  FOR UPDATE;
  IF NOT FOUND OR v_workbook.drive_file_id IS DISTINCT FROM v_job.drive_file_id THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'stale_workbook_generation',
        lease_token = NULL,
        lease_expires_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = p_job_id;
    RETURN jsonb_build_object('finished', false, 'status', 'blocked');
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

REVOKE ALL ON FUNCTION plugin_data.csf_queue_class_workbook_preparation(
  uuid, uuid, text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_class_workbook_preparation(
  uuid, uuid, text, uuid, text, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_complete_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_complete_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(integer)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_finish_class_workbook_refresh_job(
  uuid, uuid, text, jsonb, integer, integer, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finish_class_workbook_refresh_job(
  uuid, uuid, text, jsonb, integer, integer, integer, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_queue_class_workbook_preparation(
  uuid, uuid, text, uuid, text, text, jsonb
) IS 'Registers one exact class workbook generation and queues its initial preview work.';
