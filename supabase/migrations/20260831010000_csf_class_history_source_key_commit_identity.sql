-- Reuse one unclaimed profile across semester previews from the same official
-- class workbook. The workbook's normalized FirstLast or LastFirst key is the
-- only targetless class-history identity allowed into the batch queue.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_source_key_value(
  p_normalized_data jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  WITH identity AS (
    SELECT
      pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
        p_normalized_data #>> '{record,identity,sourceStudentKey}',
        p_normalized_data #>> '{identity,sourceStudentKey}',
        ''
      ), '[[:space:]]+', '', 'g')) AS source_key,
      pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
        p_normalized_data #>> '{record,identity,normalizedFirstName}',
        p_normalized_data #>> '{identity,normalizedFirstName}',
        ''
      ), '[[:space:]]+', '', 'g')) AS first_name,
      pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
        p_normalized_data #>> '{record,identity,normalizedLastName}',
        p_normalized_data #>> '{identity,normalizedLastName}',
        ''
      ), '[[:space:]]+', '', 'g')) AS last_name
  )
  SELECT CASE
    WHEN source_key <> ''
      AND first_name <> ''
      AND last_name <> ''
      AND source_key IN (first_name || last_name, last_name || first_name)
      THEN first_name || last_name
    ELSE NULL
  END
  FROM identity;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_has_stable_source_key(
  p_normalized_data jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT plugin_data.csf_class_history_source_key_value(
    p_normalized_data
  ) IS NOT NULL;
$$;

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
  THEN
    RETURN NULL;
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
      OR profile.normalized_school_email IS NULL
      OR profile.normalized_school_email = v_school_email
    )
    AND (
      v_personal_email IS NULL
      OR profile.normalized_personal_email IS NULL
      OR profile.normalized_personal_email = v_personal_email
    );

  IF pg_catalog.cardinality(v_targets) > 1 THEN
    RAISE EXCEPTION
      'This workbook key already points to more than one CSF profile. Merge or resolve those profiles before importing another semester.'
      USING ERRCODE = '23514';
  END IF;
  RETURN v_targets[1];
END;
$$;

ALTER FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
)
  RENAME TO csf_import_class_history_row_v2_source_key_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_class_history_row_v2(
  p_organization_id uuid,
  p_profile_id uuid,
  p_first_name text,
  p_last_name text,
  p_school_email text,
  p_personal_email text,
  p_normalized_first_name text,
  p_normalized_last_name text,
  p_normalized_school_email text,
  p_normalized_personal_email text,
  p_cohort_id uuid,
  p_term_id uuid,
  p_source_id uuid,
  p_import_row_id uuid,
  p_row_hash text,
  p_activities jsonb,
  p_meetings jsonb,
  p_all_requirements_met boolean,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid := p_profile_id;
  v_result jsonb;
  v_reused_source_key boolean := false;
  v_bound integer := 0;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id,
    p_actor_user_id,
    'class_history'
  );

  IF v_profile_id IS NULL THEN
    v_profile_id := plugin_data.csf_class_history_source_key_target(
      p_organization_id,
      p_import_row_id
    );
    v_reused_source_key := v_profile_id IS NOT NULL;
  END IF;

  IF v_reused_source_key THEN
    UPDATE plugin_data.csf_sheet_import_rows AS import_row
    SET matched_profile_id = v_profile_id,
        resolution_status = 'resolved',
        resolution_reason_code = 'commit_reused_source_key',
        resolution_notes =
          'The approved import reused the profile established by this workbook key.',
        resolved_by = p_actor_user_id,
        resolved_at = pg_catalog.now()
    WHERE import_row.organization_id = p_organization_id
      AND import_row.id = p_import_row_id
      AND import_row.import_status = 'pending'
      AND import_row.matched_profile_id IS NULL
      AND (
        import_row.commit_frozen_at IS NULL
        OR (
          import_row.commit_outcome_state = 'in_flight'
          AND import_row.commit_intent_attempt_id IS NOT NULL
          AND import_row.commit_frozen_actor_user_id = p_actor_user_id
        )
      );
    GET DIAGNOSTICS v_bound = ROW_COUNT;
    IF v_bound <> 1 THEN
      RAISE EXCEPTION
        'The class-history row changed before its stable workbook key could be bound.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id,
    ARRAY[v_profile_id]::uuid[]
  );

  v_result := plugin_data.csf_import_class_history_row_v2_source_key_base(
    p_organization_id, v_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_term_id, p_source_id,
    p_import_row_id, p_row_hash, p_activities, p_meetings,
    p_all_requirements_met, p_actor_user_id
  );

  IF v_reused_source_key THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      term_id, source_type, source_id, after_data
    ) VALUES (
      p_organization_id, p_actor_user_id,
      'sheets.class_history_source_key_reused', 'csf_profiles', v_profile_id,
      p_term_id, 'sheet_import', p_source_id::text,
      pg_catalog.jsonb_build_object(
        'importRowId', p_import_row_id,
        'profileId', v_profile_id
      )
    );
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'sourceKeyProfileReused', v_reused_source_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_import_created_profile_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_created_from_row boolean := false;
  v_reused_source_key boolean := false;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.commit_frozen_at IS NOT NULL
    AND OLD.commit_target_profile_id IS NULL
    AND OLD.matched_profile_id IS NULL
    AND NEW.matched_profile_id IS NOT NULL
    AND OLD.commit_outcome_state = 'in_flight'
    AND OLD.commit_intent_attempt_id IS NOT NULL
    AND OLD.import_status = 'pending'
    AND NEW.import_status IN ('created', 'updated')
    AND NEW.resolved_by IS NULL
  THEN
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = OLD.organization_id
        AND profile.id = NEW.matched_profile_id
        AND profile.source_summary ->> 'importRowId' = OLD.id::text
    ) INTO v_created_from_row;

    IF NOT v_created_from_row THEN
      v_reused_source_key :=
        plugin_data.csf_class_history_source_key_target(
          OLD.organization_id,
          OLD.id
        ) = NEW.matched_profile_id;
    END IF;

    IF v_created_from_row OR v_reused_source_key THEN
      NEW.resolution_status := 'resolved';
      NEW.resolution_reason_code := CASE
        WHEN v_reused_source_key THEN 'commit_reused_source_key'
        ELSE 'commit_created_profile'
      END;
      NEW.resolution_notes := CASE
        WHEN v_reused_source_key
          THEN 'The approved import reused the profile established by this workbook key.'
        ELSE 'The approved import commit created this CSF member from the frozen row.'
      END;
      NEW.resolved_by := OLD.commit_frozen_actor_user_id;
      NEW.resolved_at := pg_catalog.now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_attempt plugin_data.csf_sheet_import_commit_attempts%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.commit_frozen_at IS NOT NULL THEN
    IF ROW(
      NEW.commit_frozen_at, NEW.commit_frozen_by_job_id, NEW.commit_frozen_row_hash,
      NEW.commit_frozen_source_id, NEW.commit_frozen_source_revision,
      NEW.commit_frozen_payload_hash, NEW.commit_frozen_actor_user_id,
      NEW.commit_frozen_actor_snapshot, NEW.commit_target_profile_id,
      NEW.commit_resolution_snapshot
    ) IS DISTINCT FROM ROW(
      OLD.commit_frozen_at, OLD.commit_frozen_by_job_id, OLD.commit_frozen_row_hash,
      OLD.commit_frozen_source_id, OLD.commit_frozen_source_revision,
      OLD.commit_frozen_payload_hash, OLD.commit_frozen_actor_user_id,
      OLD.commit_frozen_actor_snapshot, OLD.commit_target_profile_id,
      OLD.commit_resolution_snapshot
    ) THEN
      RAISE EXCEPTION
        'This CSF import row has a frozen commit decision; it cannot be re-frozen while that commit is outstanding.'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.commit_target_profile_id IS NOT NULL
      AND NEW.matched_profile_id IS DISTINCT FROM OLD.commit_target_profile_id
    THEN
      RAISE EXCEPTION
        'This CSF import row is frozen to a reviewed member; it cannot be re-matched to another.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.commit_target_profile_id IS NULL
      AND OLD.matched_profile_id IS NOT NULL
      AND NEW.matched_profile_id IS DISTINCT FROM OLD.matched_profile_id
    THEN
      RAISE EXCEPTION
        'This CSF import row already records the member its commit created; it cannot be re-matched.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.commit_target_profile_id IS NULL
      AND OLD.matched_profile_id IS NULL
      AND NEW.matched_profile_id IS NOT NULL
      AND NOT (
        OLD.commit_outcome_state = 'in_flight'
        AND OLD.commit_intent_attempt_id IS NOT NULL
        AND OLD.import_status = 'pending'
        AND (
          (
            NEW.import_status IN ('created', 'updated')
            AND NEW.resolved_by IS NOT DISTINCT FROM
              OLD.commit_frozen_actor_user_id
          )
          OR (
            NEW.import_status = 'pending'
            AND NEW.resolution_status = 'resolved'
            AND NEW.resolution_reason_code = 'commit_reused_source_key'
            AND NEW.resolved_by IS NOT DISTINCT FROM
              OLD.commit_frozen_actor_user_id
            AND plugin_data.csf_class_history_source_key_target(
              OLD.organization_id,
              OLD.id
            ) = NEW.matched_profile_id
          )
        )
      )
    THEN
      RAISE EXCEPTION
        'This CSF import row has no live write result that may establish its committed member.'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.import_status IS DISTINCT FROM OLD.import_status
      AND NOT (
        (OLD.import_status = 'pending' AND NEW.import_status IN ('created', 'updated', 'error'))
        OR (OLD.import_status = 'error' AND NEW.import_status IN ('pending', 'skipped')
          AND NEW.commit_retry_count > OLD.commit_retry_count
          AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM
            coalesce(OLD.commit_attempt_id, OLD.commit_intent_attempt_id)
          AND NEW.commit_attempt_id IS NULL)
      )
    THEN
      RAISE EXCEPTION
        'This CSF import row has a frozen commit decision; its include or skip decision cannot change while that commit is outstanding.'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.import_status <> 'pending'
      AND NEW.resolution_status IS DISTINCT FROM OLD.resolution_status
      AND NEW.commit_retry_count IS NOT DISTINCT FROM OLD.commit_retry_count
    THEN
      RAISE EXCEPTION
        'This CSF import row is already terminal for its frozen commit; its reconciliation state cannot be rewritten.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.commit_outcome_state IS DISTINCT FROM OLD.commit_outcome_state
  THEN
    IF NOT (
      (OLD.commit_outcome_state = 'not_started' AND NEW.commit_outcome_state IN ('frozen', 'historical_unknown'))
      OR (OLD.commit_outcome_state = 'frozen' AND NEW.commit_outcome_state IN ('in_flight', 'failed'))
      OR (OLD.commit_outcome_state = 'in_flight' AND NEW.commit_outcome_state IN ('succeeded', 'failed', 'unknown'))
      OR (OLD.commit_outcome_state = 'unknown' AND NEW.commit_outcome_state IN ('succeeded', 'failed'))
      OR (OLD.commit_outcome_state = 'historical_unknown' AND NEW.commit_outcome_state = 'succeeded')
      OR (OLD.commit_outcome_state = 'failed' AND NEW.commit_outcome_state = 'frozen'
        AND NEW.commit_retry_count > OLD.commit_retry_count
        AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM
          coalesce(OLD.commit_attempt_id, OLD.commit_intent_attempt_id)
        AND NEW.commit_attempt_id IS NULL)
    ) THEN
      RAISE EXCEPTION
        'A CSF import row cannot move from commit outcome "%" to "%".',
        OLD.commit_outcome_state, NEW.commit_outcome_state
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_outcome_state IN ('succeeded', 'failed')
    AND NEW.commit_outcome_state = OLD.commit_outcome_state
    AND OLD.commit_outcome_resolution IS NOT NULL
    AND NEW.commit_retry_count IS NOT DISTINCT FROM OLD.commit_retry_count
    AND ROW(
      NEW.commit_outcome_resolution,
      NEW.commit_outcome_resolved_by,
      NEW.commit_outcome_resolved_at
    ) IS DISTINCT FROM ROW(
      OLD.commit_outcome_resolution,
      OLD.commit_outcome_resolved_by,
      OLD.commit_outcome_resolved_at
    )
  THEN
    RAISE EXCEPTION
      'A settled CSF import row outcome cannot be re-reconciled.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_attempt_id IS NOT NULL
    AND NEW.commit_attempt_id IS DISTINCT FROM OLD.commit_attempt_id
    AND NOT (
      NEW.commit_attempt_id IS NULL
      AND NEW.commit_last_failed_attempt_id IS NOT DISTINCT FROM
        OLD.commit_attempt_id
      AND NEW.commit_retry_count > OLD.commit_retry_count
    )
  THEN
    RAISE EXCEPTION
      'A CSF import row already records the commit attempt that wrote it; it cannot be cleared or re-pointed.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.commit_attempt_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.commit_attempt_id IS NOT DISTINCT FROM NEW.commit_attempt_id
  THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  WHERE attempt.id = NEW.commit_attempt_id
    AND attempt.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'The CSF commit attempt named by this import row does not exist in this organization.'
      USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS commit_job
  WHERE commit_job.id = v_attempt.commit_job_id;
  IF NOT FOUND OR v_commit.mode <> 'commit' THEN
    RAISE EXCEPTION
      'A CSF import row may only name an attempt of a commit job.'
      USING ERRCODE = '23514';
  END IF;

  IF v_commit.preview_job_id IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION
      'A CSF import row may only be committed by an attempt derived from its own preview.'
      USING ERRCODE = '23514';
  END IF;

  IF v_attempt.status <> 'running'
    OR v_attempt.lease_expires_at IS NULL
    OR v_attempt.lease_expires_at <= pg_catalog.now()
    OR v_commit.active_commit_attempt_id IS DISTINCT FROM v_attempt.id
  THEN
    RAISE EXCEPTION
      'Only the active, unexpired CSF commit attempt may record row lineage.'
      USING ERRCODE = '55P03';
  END IF;

  RETURN NEW;
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
              AND NOT plugin_data.csf_class_history_has_stable_source_key(
                import_row.normalized_data
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

REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_value(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_class_history_has_stable_source_key(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2_source_key_base(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_set_import_created_profile_resolution()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_enforce_import_row_attempt_lineage()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid, uuid) IS
  'Owner-internal lookup for one active profile established by the same stable student key, official workbook, organization, and class. Refuses duplicate targets and conflicting canonical contact data.';
COMMENT ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS
  'Imports one approved class-history row and reuses an existing profile only when the same official workbook and stable name-derived student key prove the identity under the organization identity lock.';
COMMENT ON FUNCTION plugin_data.csf_import_preview_readiness(uuid, uuid) IS
  'Returns exact row-state counts for one preview. A targetless class-history row is batch-ready only when its immutable canonical record has a stable name-derived workbook key.';

COMMIT;
