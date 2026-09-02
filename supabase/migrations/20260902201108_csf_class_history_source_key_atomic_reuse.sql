-- Reuse one profile when separately prepared class-history tabs carry the
-- same stable workbook key and the same immutable normalized student name.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_source_key_target(
  p_organization_id uuid,
  p_import_row_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_file_id text;
  v_cohort_id uuid;
  v_normalized_data jsonb;
  v_source_key text;
  v_normalized_first_name text;
  v_normalized_last_name text;
  v_school_email text;
  v_personal_email text;
  v_prior_profiles integer := 0;
  v_divergent_names integer := 0;
  v_targets uuid[];
BEGIN
  SELECT
    job.source_file_id,
    import_row.cohort_id,
    import_row.normalized_data,
    plugin_data.csf_class_history_source_key_value(import_row.normalized_data),
    nullif(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
      import_row.normalized_data #>> '{record,identity,normalizedFirstName}',
      import_row.normalized_data #>> '{identity,normalizedFirstName}',
      ''
    ), '[[:space:]]+', '', 'g')), ''),
    nullif(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
      import_row.normalized_data #>> '{record,identity,normalizedLastName}',
      import_row.normalized_data #>> '{identity,normalizedLastName}',
      ''
    ), '[[:space:]]+', '', 'g')), ''),
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
    v_normalized_first_name,
    v_normalized_last_name,
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
    OR v_source_key IS NULL
    OR v_normalized_first_name IS NULL
    OR v_normalized_last_name IS NULL
  THEN
    RETURN NULL;
  END IF;

  SELECT
    pg_catalog.count(DISTINCT profile.id)::integer,
    pg_catalog.count(*) FILTER (
      WHERE nullif(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
        prior_row.normalized_data #>> '{record,identity,normalizedFirstName}',
        prior_row.normalized_data #>> '{identity,normalizedFirstName}',
        ''
      ), '[[:space:]]+', '', 'g')), '')
        IS DISTINCT FROM v_normalized_first_name
      OR nullif(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
        prior_row.normalized_data #>> '{record,identity,normalizedLastName}',
        prior_row.normalized_data #>> '{identity,normalizedLastName}',
        ''
      ), '[[:space:]]+', '', 'g')), '')
        IS DISTINCT FROM v_normalized_last_name
    )::integer
  INTO v_prior_profiles, v_divergent_names
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

  IF v_prior_profiles > 1 THEN
    RAISE EXCEPTION
      'This workbook key already points to more than one CSF profile. Merge or resolve those profiles before importing another semester.'
      USING ERRCODE = '23514';
  END IF;

  IF v_divergent_names > 0 THEN
    RAISE EXCEPTION
      'This workbook key has conflicting immutable student names. Resolve the source rows before importing another semester.'
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
    AND plugin_data.csf_class_history_source_key_value(
      prior_row.normalized_data
    ) = v_source_key
    AND nullif(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
      prior_row.normalized_data #>> '{record,identity,normalizedFirstName}',
      prior_row.normalized_data #>> '{identity,normalizedFirstName}',
      ''
    ), '[[:space:]]+', '', 'g')), '') = v_normalized_first_name
    AND nullif(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(
      prior_row.normalized_data #>> '{record,identity,normalizedLastName}',
      prior_row.normalized_data #>> '{identity,normalizedLastName}',
      ''
    ), '[[:space:]]+', '', 'g')), '') = v_normalized_last_name
    AND (
      (v_school_email IS NULL AND v_personal_email IS NULL)
      OR (
        (v_school_email IS NULL
          OR profile.normalized_school_email = v_school_email)
        AND (v_personal_email IS NULL
          OR profile.normalized_personal_email = v_personal_email)
        AND (
          (v_school_email IS NOT NULL
            AND profile.normalized_school_email = v_school_email)
          OR (v_personal_email IS NOT NULL
            AND profile.normalized_personal_email = v_personal_email)
        )
      )
    );

  RETURN v_targets[1];
END;
$$;

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

    IF v_profile_id IS NULL
      AND plugin_data.csf_class_history_source_key_requires_review(
        p_organization_id,
        p_import_row_id
      )
    THEN
      RAISE EXCEPTION
        'This workbook key needs officer review before another profile can be created.'
        USING ERRCODE = '23514';
    END IF;
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

-- This helper is called after the target lookup when a row has no safe match.
-- It must observe rows written earlier by the same bounded batch statement.
ALTER FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid)
  VOLATILE;

REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid, uuid)
  TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_class_history_source_key_target(uuid, uuid) IS
  'Owner-internal lookup for one active profile established by the same organization, official workbook file, class, stable source key, and exact immutable normalized student name. Refuses multiple or divergent mappings.';
COMMENT ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid,
  text, text, text, text, text, text, text, text,
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS
  'Imports one approved class-history row under the organization identity lock. It reuses one exact stable-key profile across terms and refuses unresolved prior mappings before profile creation.';
COMMENT ON FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid) IS
  'Returns true when a prior same-workbook key cannot resolve to one safe profile. Volatile reads observe rows written earlier in the same bounded import batch.';

COMMIT;
