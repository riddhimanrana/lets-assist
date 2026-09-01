-- Block name-only class-history reuse, serialize batch receipt creation, and
-- preserve one unambiguous legacy webhook key identity in application code.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_source_key_target(
  p_organization_id uuid,
  p_import_row_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_file_id text;
  v_cohort_id uuid;
  v_normalized_data jsonb;
  v_source_key text;
  v_school_email text;
  v_personal_email text;
  v_prior_profiles integer := 0;
  v_targets uuid[];
BEGIN
  SELECT
    job.source_file_id,
    import_row.cohort_id,
    import_row.normalized_data,
    plugin_data.csf_class_history_source_key_value(import_row.normalized_data),
    pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(
      import_row.normalized_data #>> '{record,contact,schoolEmail}',
      import_row.normalized_data #>> '{contact,schoolEmail}',
      ''
    )), '')),
    pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(
      import_row.normalized_data #>> '{record,contact,personalEmail}',
      import_row.normalized_data #>> '{contact,personalEmail}',
      ''
    )), ''))
  INTO
    v_source_file_id,
    v_cohort_id,
    v_normalized_data,
    v_source_key,
    v_school_email,
    v_personal_email
  FROM plugin_data.csf_sheet_import_rows AS import_row
  JOIN plugin_data.csf_sheet_import_jobs AS job
    ON job.organization_id = import_row.organization_id
   AND job.id = import_row.job_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND job.mode = 'preview'
    AND job.source_type = 'class_history';

  IF NOT FOUND
    OR nullif(v_source_file_id, '') IS NULL
    OR v_cohort_id IS NULL
    OR NOT plugin_data.csf_class_history_has_stable_source_key(v_normalized_data)
    OR (v_school_email IS NULL AND v_personal_email IS NULL)
  THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.count(DISTINCT profile.id)::integer
  INTO v_prior_profiles
  FROM plugin_data.csf_sheet_import_rows AS prior_row
  JOIN plugin_data.csf_sheet_import_jobs AS prior_job
    ON prior_job.organization_id = prior_row.organization_id
   AND prior_job.id = prior_row.job_id
  JOIN plugin_data.csf_profiles AS profile
    ON profile.organization_id = prior_row.organization_id
   AND profile.id = prior_row.matched_profile_id
   AND profile.record_status = 'active'
  WHERE prior_row.organization_id = p_organization_id
    AND prior_row.id <> p_import_row_id
    AND prior_row.cohort_id = v_cohort_id
    AND prior_row.import_status IN ('created', 'updated')
    AND prior_job.mode = 'preview'
    AND prior_job.source_type = 'class_history'
    AND prior_job.source_file_id = v_source_file_id
    AND plugin_data.csf_class_history_has_stable_source_key(
      prior_row.normalized_data
    )
    AND plugin_data.csf_class_history_source_key_value(
      prior_row.normalized_data
    ) = v_source_key;

  IF v_prior_profiles > 1 THEN
    RAISE EXCEPTION
      'This workbook key already points to more than one CSF profile. Merge or resolve those profiles before importing another semester.'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT profile.id ORDER BY profile.id),
    ARRAY[]::uuid[]
  )
  INTO v_targets
  FROM plugin_data.csf_sheet_import_rows AS prior_row
  JOIN plugin_data.csf_sheet_import_jobs AS prior_job
    ON prior_job.organization_id = prior_row.organization_id
   AND prior_job.id = prior_row.job_id
  JOIN plugin_data.csf_profiles AS profile
    ON profile.organization_id = prior_row.organization_id
   AND profile.id = prior_row.matched_profile_id
   AND profile.record_status = 'active'
  WHERE prior_row.organization_id = p_organization_id
    AND prior_row.id <> p_import_row_id
    AND prior_row.cohort_id = v_cohort_id
    AND prior_row.import_status IN ('created', 'updated')
    AND prior_job.mode = 'preview'
    AND prior_job.source_type = 'class_history'
    AND prior_job.source_file_id = v_source_file_id
    AND plugin_data.csf_class_history_has_stable_source_key(
      prior_row.normalized_data
    )
    AND plugin_data.csf_class_history_source_key_value(
      prior_row.normalized_data
    ) = v_source_key
    AND (
      v_school_email IS NULL
      OR profile.normalized_school_email = v_school_email
    )
    AND (
      v_personal_email IS NULL
      OR profile.normalized_personal_email = v_personal_email
    )
    AND (
      (
        v_school_email IS NOT NULL
        AND profile.normalized_school_email = v_school_email
      )
      OR (
        v_personal_email IS NOT NULL
        AND profile.normalized_personal_email = v_personal_email
      )
    );

  RETURN v_targets[1];
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_source_key_requires_review(
  p_organization_id uuid,
  p_import_row_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_file_id text;
  v_cohort_id uuid;
  v_normalized_data jsonb;
  v_source_key text;
  v_prior_profiles integer := 0;
  v_corroborated_profiles integer := 0;
BEGIN
  SELECT
    job.source_file_id,
    import_row.cohort_id,
    import_row.normalized_data,
    plugin_data.csf_class_history_source_key_value(import_row.normalized_data)
  INTO
    v_source_file_id,
    v_cohort_id,
    v_normalized_data,
    v_source_key
  FROM plugin_data.csf_sheet_import_rows AS import_row
  JOIN plugin_data.csf_sheet_import_jobs AS job
    ON job.organization_id = import_row.organization_id
   AND job.id = import_row.job_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.id = p_import_row_id
    AND job.mode = 'preview'
    AND job.source_type = 'class_history';

  IF NOT FOUND
    OR nullif(v_source_file_id, '') IS NULL
    OR v_cohort_id IS NULL
    OR NOT plugin_data.csf_class_history_has_stable_source_key(v_normalized_data)
  THEN
    RETURN false;
  END IF;

  SELECT pg_catalog.count(DISTINCT profile.id)::integer
  INTO v_prior_profiles
  FROM plugin_data.csf_sheet_import_rows AS prior_row
  JOIN plugin_data.csf_sheet_import_jobs AS prior_job
    ON prior_job.organization_id = prior_row.organization_id
   AND prior_job.id = prior_row.job_id
  JOIN plugin_data.csf_profiles AS profile
    ON profile.organization_id = prior_row.organization_id
   AND profile.id = prior_row.matched_profile_id
   AND profile.record_status = 'active'
  WHERE prior_row.organization_id = p_organization_id
    AND prior_row.id <> p_import_row_id
    AND prior_row.cohort_id = v_cohort_id
    AND prior_row.import_status IN ('created', 'updated')
    AND prior_job.mode = 'preview'
    AND prior_job.source_type = 'class_history'
    AND prior_job.source_file_id = v_source_file_id
    AND plugin_data.csf_class_history_source_key_value(
      prior_row.normalized_data
    ) = v_source_key;

  IF v_prior_profiles = 0 THEN
    RETURN false;
  END IF;

  BEGIN
    v_corroborated_profiles := CASE
      WHEN plugin_data.csf_class_history_source_key_target(
        p_organization_id,
        p_import_row_id
      ) IS NULL THEN 0
      ELSE 1
    END;
  EXCEPTION WHEN check_violation THEN
    RETURN true;
  END;

  RETURN v_corroborated_profiles <> 1;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_preview_readiness(
  p_organization_id uuid,
  p_preview_job_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH preview AS (
    SELECT job.source_type
    FROM plugin_data.csf_sheet_import_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.id = p_preview_job_id
      AND job.mode = 'preview'
  ),
  row_counts AS (
    SELECT
      pg_catalog.count(*) AS total,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'pending') AS pending,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'ambiguous') AS ambiguous,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'conflict') AS conflict,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'duplicate') AS duplicate,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'error') AS error,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'superseded') AS superseded,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status IN ('created', 'updated')
      ) AS committed,
      pg_catalog.count(*) FILTER (WHERE import_row.import_status = 'skipped') AS skipped,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.cohort_id IS NULL
      ) AS pending_missing_cohort,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.term_id IS NULL
      ) AS pending_missing_term,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.matched_profile_id IS NULL
          AND (
            preview.source_type = 'application_responses'
            OR (
              preview.source_type = 'class_history'
              AND (
                NOT plugin_data.csf_class_history_has_stable_source_key(
                  import_row.normalized_data
                )
                OR plugin_data.csf_class_history_source_key_requires_review(
                  import_row.organization_id,
                  import_row.id
                )
              )
            )
          )
      ) AS pending_missing_match,
      pg_catalog.count(*) FILTER (
        WHERE import_row.import_status = 'pending'
          AND import_row.matched_profile_id IS NULL
          AND preview.source_type = 'class_history'
          AND NOT plugin_data.csf_class_history_has_stable_source_key(
            import_row.normalized_data
          )
      ) AS pending_missing_source_key,
      pg_catalog.count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'in_flight'
      ) AS in_flight,
      pg_catalog.count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'unknown'
      ) AS unknown_outcome,
      pg_catalog.count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'historical_unknown'
      ) AS historical_unknown,
      pg_catalog.count(*) FILTER (
        WHERE import_row.commit_outcome_state = 'failed'
          AND import_row.import_status = 'error'
      ) AS failed_awaiting_decision
    FROM plugin_data.csf_sheet_import_rows AS import_row
    CROSS JOIN preview
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
  ),
  commit_state AS (
    SELECT
      commit_job.id,
      CASE
        WHEN commit_job.status = 'completed' THEN 'completed'
        WHEN commit_job.status = 'cancelled' THEN 'cancelled'
        WHEN commit_job.status = 'partially_completed' THEN 'partially_completed'
        WHEN commit_job.status = 'failed' THEN 'failed'
        WHEN attempt.status = 'running'
          AND attempt.lease_expires_at > pg_catalog.now() THEN 'running'
        ELSE 'recoverable'
      END AS state
    FROM plugin_data.csf_sheet_import_jobs AS commit_job
    LEFT JOIN plugin_data.csf_sheet_import_commit_attempts AS attempt
      ON attempt.organization_id = commit_job.organization_id
     AND attempt.id = commit_job.active_commit_attempt_id
    WHERE commit_job.organization_id = p_organization_id
      AND commit_job.mode = 'commit'
      AND commit_job.preview_job_id = p_preview_job_id
    LIMIT 1
  )
  SELECT pg_catalog.jsonb_build_object(
    'previewJobId', p_preview_job_id,
    'total', counts.total,
    'pending', counts.pending,
    'ambiguous', counts.ambiguous,
    'conflict', counts.conflict,
    'duplicate', counts.duplicate,
    'error', counts.error,
    'superseded', counts.superseded,
    'committed', counts.committed,
    'skipped', counts.skipped,
    'pendingMissingCohort', counts.pending_missing_cohort,
    'pendingMissingTerm', counts.pending_missing_term,
    'pendingMissingMatch', counts.pending_missing_match,
    'pendingMissingSourceKey', counts.pending_missing_source_key,
    'inFlight', counts.in_flight,
    'unknownOutcome', counts.unknown_outcome,
    'historicalUnknown', counts.historical_unknown,
    'failedAwaitingDecision', counts.failed_awaiting_decision,
    'commitState', coalesce(commit.state, 'none'),
    'commitJobId', commit.id
  )
  FROM row_counts AS counts
  LEFT JOIN commit_state AS commit ON true;
$function$;

ALTER FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
)
  RENAME TO csf_queue_import_preview_batch_unserialized;

CREATE FUNCTION plugin_data.csf_queue_import_preview_batch(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_preview_job_ids uuid[],
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A batch request ID is required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf_import_approval_batch:'
        || p_organization_id::text
        || ':'
        || p_request_id::text,
      0
    )
  );

  RETURN plugin_data.csf_queue_import_preview_batch_unserialized(
    p_organization_id,
    p_actor_user_id,
    p_preview_job_ids,
    p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_import_preview_batch_unserialized(
  uuid, uuid, uuid[], uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_queue_import_preview_batch(
  uuid, uuid, uuid[], uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid, uuid) IS
  'Returns one same-workbook class-history profile only when a supplied email corroborates the source key.';
COMMENT ON FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid) IS
  'Returns true when a prior same-workbook key exists but the current row cannot prove which profile it belongs to.';
COMMENT ON FUNCTION plugin_data.csf_queue_import_preview_batch(uuid, uuid, uuid[], uuid) IS
  'Serializes one organization-scoped request receipt before freezing and queueing approved previews.';

COMMIT;
