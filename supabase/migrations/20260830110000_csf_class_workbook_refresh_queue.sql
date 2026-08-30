-- Register one workbook per class and prepare changed versions in a worker.

CREATE TABLE plugin_data.csf_class_workbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES plugin_data.csf_cohorts(id) ON DELETE CASCADE,
  drive_file_id text,
  drive_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_version text,
  provider_modified_at text,
  discovered_tabs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(discovered_tabs) = 'array'),
  source_candidates jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_candidates) = 'array'),
  last_checked_at timestamptz,
  last_prepared_version text,
  state text NOT NULL DEFAULT 'linked'
    CHECK (state IN ('linked', 'needs_reconnect', 'blocked', 'unlinked')),
  check_lease_token uuid,
  check_lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, cohort_id),
  CHECK (drive_file_id IS NOT NULL OR state IN ('blocked', 'unlinked')),
  CHECK (provider_version IS NULL OR provider_version ~ '^[1-9][0-9]{0,18}$'),
  CHECK (
    last_prepared_version IS NULL
    OR last_prepared_version ~ '^[1-9][0-9]{0,18}$'
  )
);

CREATE TABLE plugin_data.csf_class_workbook_refresh_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workbook_id uuid NOT NULL REFERENCES plugin_data.csf_class_workbooks(id) ON DELETE CASCADE,
  provider_version text NOT NULL
    CHECK (provider_version ~ '^[1-9][0-9]{0,18}$'),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'needs_reconnect', 'blocked', 'failed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result_counts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(result_counts) = 'object'),
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workbook_id, provider_version)
);

CREATE INDEX csf_class_workbook_refresh_jobs_claim_idx
  ON plugin_data.csf_class_workbook_refresh_jobs (created_at, id)
  WHERE status = 'queued';
CREATE INDEX csf_class_workbook_refresh_jobs_running_lease_idx
  ON plugin_data.csf_class_workbook_refresh_jobs (lease_expires_at)
  WHERE status = 'running';

ALTER TABLE plugin_data.csf_class_workbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_class_workbook_refresh_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_class_workbooks
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_class_workbook_refresh_jobs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_class_workbooks
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE plugin_data.csf_class_workbook_refresh_jobs
  TO service_role;

WITH source_groups AS (
  SELECT
    source.organization_id,
    source.cohort_id,
    array_agg(DISTINCT source.spreadsheet_id ORDER BY source.spreadsheet_id)
      FILTER (WHERE source.spreadsheet_id IS NOT NULL) AS file_ids,
    min(source.sync_owner_user_id::text)::uuid AS owner_user_id
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.provider = 'google_sheets'
    AND source.cohort_id IS NOT NULL
    AND coalesce(
      source.source_type,
      source.settings ->> 'sourceKind'
    ) = 'class_history'
    AND source.sync_mode <> 'disabled'
  GROUP BY source.organization_id, source.cohort_id
)
INSERT INTO plugin_data.csf_class_workbooks (
  organization_id,
  cohort_id,
  drive_file_id,
  drive_owner_user_id,
  source_candidates,
  state,
  last_error_code
)
SELECT
  source_groups.organization_id,
  source_groups.cohort_id,
  CASE WHEN cardinality(source_groups.file_ids) = 1
    THEN source_groups.file_ids[1]
    ELSE NULL
  END,
  source_groups.owner_user_id,
  to_jsonb(coalesce(source_groups.file_ids, ARRAY[]::text[])),
  CASE WHEN cardinality(source_groups.file_ids) = 1
    THEN 'linked'
    ELSE 'blocked'
  END,
  CASE WHEN cardinality(source_groups.file_ids) = 1
    THEN NULL
    ELSE 'multiple_workbooks_require_review'
  END
FROM source_groups
ON CONFLICT (organization_id, cohort_id) DO NOTHING;

CREATE FUNCTION plugin_data.csf_register_class_workbook(
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
    p_provider_version,
    'linked',
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
      last_prepared_version = EXCLUDED.last_prepared_version,
      state = 'linked',
      check_lease_token = NULL,
      check_lease_expires_at = NULL,
      last_error_code = NULL,
      updated_at = now()
  RETURNING * INTO v_workbook;

  RETURN jsonb_build_object(
    'workbookId', v_workbook.id,
    'state', v_workbook.state,
    'providerVersion', v_workbook.provider_version
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_claim_class_workbook_check(
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
  IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'Workbook check lease must be between 30 and 600 seconds.';
  END IF;

  SELECT * INTO v_workbook
  FROM plugin_data.csf_class_workbooks AS workbook
  WHERE workbook.organization_id = p_organization_id
    AND workbook.cohort_id = p_cohort_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  IF v_workbook.state = 'blocked' OR v_workbook.drive_file_id IS NULL THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  IF v_workbook.state = 'unlinked' THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  IF v_workbook.check_lease_expires_at > now() THEN
    RETURN jsonb_build_object('status', 'unchanged');
  END IF;

  UPDATE plugin_data.csf_class_workbooks
  SET check_lease_token = v_token,
      check_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id = v_workbook.id;

  RETURN jsonb_build_object(
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

CREATE FUNCTION plugin_data.csf_complete_class_workbook_check(
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
    provider_version,
    requested_by,
    status,
    updated_at
  ) VALUES (
    p_organization_id,
    p_workbook_id,
    p_provider_version,
    p_actor_user_id,
    'queued',
    now()
  )
  ON CONFLICT (workbook_id, provider_version) DO UPDATE
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

CREATE FUNCTION plugin_data.csf_fail_class_workbook_check(
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
BEGIN
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );
  IF p_state NOT IN ('needs_reconnect', 'blocked') THEN
    RAISE EXCEPTION 'Choose a supported workbook state.';
  END IF;

  UPDATE plugin_data.csf_class_workbooks
  SET state = p_state,
      last_checked_at = now(),
      check_lease_token = NULL,
      check_lease_expires_at = NULL,
      last_error_code = left(coalesce(p_error_code, 'metadata_check_failed'), 100),
      updated_at = now()
  WHERE organization_id = p_organization_id
    AND id = p_workbook_id
    AND check_lease_token = p_lease_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The workbook check lease is no longer active.';
  END IF;

  RETURN jsonb_build_object('status', p_state);
END;
$$;

CREATE FUNCTION plugin_data.csf_claim_class_workbook_refresh_job(
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
  IF NOT FOUND OR v_workbook.drive_owner_user_id IS NULL THEN
    UPDATE plugin_data.csf_class_workbook_refresh_jobs
    SET status = 'blocked',
        error_code = 'workbook_owner_missing',
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
    'driveFileId', v_workbook.drive_file_id,
    'ownerUserId', v_workbook.drive_owner_user_id,
    'providerVersion', v_job.provider_version
  );
END;
$$;

CREATE FUNCTION plugin_data.csf_finish_class_workbook_refresh_job(
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

REVOKE ALL ON FUNCTION plugin_data.csf_register_class_workbook(
  uuid, uuid, text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_register_class_workbook(
  uuid, uuid, text, uuid, text, text, jsonb
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_class_workbook_check(
  uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_class_workbook_check(
  uuid, uuid, uuid, integer
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_complete_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_complete_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_fail_class_workbook_check(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_fail_class_workbook_check(
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

COMMENT ON TABLE plugin_data.csf_class_workbooks IS
  'One provider workbook per CSF graduating class, with checked and prepared version coordinates.';
COMMENT ON TABLE plugin_data.csf_class_workbook_refresh_jobs IS
  'Leased work for preparing changed CSF workbook versions outside a request.';
