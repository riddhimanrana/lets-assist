-- Follow only an organization-scoped, approved profile-merge lineage when
-- reusing immutable class-history source identity.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_reviewed_merge_survivor(
  p_organization_id uuid,
  p_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_reachable_survivors uuid[];
  v_has_cycle boolean := false;
  v_has_truncated_path boolean := false;
  v_has_invalid_terminal boolean := false;
BEGIN
  IF p_organization_id IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'The historical CSF profile lineage is incomplete.'
      USING ERRCODE = '23514';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The historical CSF profile lineage leaves this organization.'
      USING ERRCODE = '23514';
  END IF;

  IF v_profile.record_status = 'active' THEN
    IF v_profile.merged_into_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'The active CSF profile has an invalid merge target.'
        USING ERRCODE = '23514';
    END IF;
    RETURN v_profile.id;
  END IF;

  IF v_profile.record_status <> 'merged'
    OR v_profile.merged_into_profile_id IS NULL
  THEN
    RAISE EXCEPTION 'The historical CSF profile has no active reviewed merge survivor.'
      USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE reviewed_lineage AS (
    SELECT
      review.target_profile_id AS profile_id,
      ARRAY[p_profile_id, review.target_profile_id]::uuid[] AS path,
      1 AS depth,
      review.target_profile_id = p_profile_id AS cycle
    FROM plugin_data.csf_profile_merge_reviews AS review
    WHERE review.organization_id = p_organization_id
      AND review.source_profile_id = p_profile_id
      AND review.status = 'approved'
    UNION ALL
    SELECT
      review.target_profile_id,
      lineage.path || review.target_profile_id,
      lineage.depth + 1,
      review.target_profile_id = ANY(lineage.path)
    FROM reviewed_lineage AS lineage
    JOIN plugin_data.csf_profile_merge_reviews AS review
      ON review.organization_id = p_organization_id
     AND review.source_profile_id = lineage.profile_id
     AND review.status = 'approved'
    WHERE lineage.depth < 32
      AND NOT lineage.cycle
  ),
  lineage_summary AS (
    SELECT
      coalesce(
        pg_catalog.array_agg(DISTINCT profile.id ORDER BY profile.id)
          FILTER (WHERE profile.id IS NOT NULL),
        ARRAY[]::uuid[]
      ) AS survivors,
      coalesce(pg_catalog.bool_or(lineage.cycle), false) AS has_cycle,
      coalesce(pg_catalog.bool_or(
        lineage.depth = 32
        AND NOT lineage.cycle
        AND EXISTS (
          SELECT 1
          FROM plugin_data.csf_profile_merge_reviews AS next_review
          WHERE next_review.organization_id = p_organization_id
            AND next_review.source_profile_id = lineage.profile_id
            AND next_review.status = 'approved'
        )
      ), false) AS has_truncated_path,
      coalesce(pg_catalog.bool_or(
        profile.id IS NULL
        AND NOT lineage.cycle
        AND NOT EXISTS (
          SELECT 1
          FROM plugin_data.csf_profile_merge_reviews AS next_review
          WHERE next_review.organization_id = p_organization_id
            AND next_review.source_profile_id = lineage.profile_id
            AND next_review.status = 'approved'
        )
      ), false) AS has_invalid_terminal
    FROM reviewed_lineage AS lineage
    LEFT JOIN plugin_data.csf_profiles AS profile
      ON profile.organization_id = p_organization_id
     AND profile.id = lineage.profile_id
     AND profile.record_status = 'active'
     AND profile.merged_into_profile_id IS NULL
  )
  SELECT survivors, has_cycle, has_truncated_path, has_invalid_terminal
  INTO v_reachable_survivors, v_has_cycle, v_has_truncated_path, v_has_invalid_terminal
  FROM lineage_summary;

  IF v_has_cycle
    OR v_has_truncated_path
    OR v_has_invalid_terminal
    OR pg_catalog.cardinality(v_reachable_survivors) <> 1
    OR v_reachable_survivors[1] IS DISTINCT FROM v_profile.merged_into_profile_id
  THEN
    RAISE EXCEPTION 'The historical CSF profile merge lineage is missing, cyclic, or ambiguous.'
      USING ERRCODE = '23514';
  END IF;

  RETURN v_reachable_survivors[1];
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reviewed_merge_survivor(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reviewed_merge_survivor(uuid, uuid)
  TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_source_key_target_name_only_v1(
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
  CROSS JOIN LATERAL (
    SELECT plugin_data.csf_reviewed_merge_survivor(
      prior_row.organization_id, prior_row.matched_profile_id
    ) AS profile_id
  ) AS canonical
  JOIN plugin_data.csf_profiles AS profile
    ON profile.organization_id = prior_row.organization_id
   AND profile.id = canonical.profile_id
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
  CROSS JOIN LATERAL (
    SELECT plugin_data.csf_reviewed_merge_survivor(
      prior_row.organization_id, prior_row.matched_profile_id
    ) AS profile_id
  ) AS canonical
  JOIN plugin_data.csf_profiles AS profile
    ON profile.organization_id = prior_row.organization_id
   AND profile.id = canonical.profile_id
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

REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_target_name_only_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_history_source_key_target_name_only_v1(uuid, uuid)
  TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_class_history_source_key_requires_review(
  p_organization_id uuid,
  p_import_row_id uuid
)
RETURNS boolean
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

  SELECT pg_catalog.count(DISTINCT prior_row.matched_profile_id)::integer
  INTO v_prior_profiles
  FROM plugin_data.csf_sheet_import_rows AS prior_row
  JOIN plugin_data.csf_sheet_import_jobs AS prior_job
    ON prior_job.organization_id = prior_row.organization_id
   AND prior_job.id = prior_row.job_id
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

REVOKE ALL ON FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_class_history_source_key_requires_review(uuid, uuid)
  TO postgres, service_role;

COMMIT;
