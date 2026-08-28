-- Let one exact official-workbook roster key resolve legacy name variations
-- while retaining cohort, email-conflict, and relationship safeguards.

CREATE OR REPLACE FUNCTION plugin_data.csf_profiles_share_class_source_key(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH source_profile AS (
    SELECT profile.*
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_source_profile_id
      AND profile.record_status = 'active'
  ),
  target_profile AS (
    SELECT profile.*
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_target_profile_id
      AND profile.record_status = 'active'
  ),
  source_evidence AS (
    SELECT import_row.sheet_tab_name, import_row.row_number,
      import_row.normalized_data, import_job.source_file_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    JOIN plugin_data.csf_sheet_import_jobs AS import_job
      ON import_job.organization_id = import_row.organization_id
     AND import_job.id = import_row.job_id
    CROSS JOIN source_profile AS profile
    WHERE import_row.organization_id = p_organization_id
      AND import_row.import_status IN ('created', 'updated')
      AND import_job.mode = 'preview'
      AND import_job.source_type = 'class_history'
      AND NULLIF(import_job.source_file_id, '') IS NOT NULL
      AND (
        import_row.matched_profile_id = profile.id
        OR import_row.id = CASE
          WHEN profile.source_summary ->> 'importRowId'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (profile.source_summary ->> 'importRowId')::uuid
          ELSE NULL
        END
      )
  ),
  target_evidence AS (
    SELECT import_row.sheet_tab_name, import_row.row_number,
      import_row.normalized_data, import_job.source_file_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    JOIN plugin_data.csf_sheet_import_jobs AS import_job
      ON import_job.organization_id = import_row.organization_id
     AND import_job.id = import_row.job_id
    CROSS JOIN target_profile AS profile
    WHERE import_row.organization_id = p_organization_id
      AND import_row.import_status IN ('created', 'updated')
      AND import_job.mode = 'preview'
      AND import_job.source_type = 'class_history'
      AND NULLIF(import_job.source_file_id, '') IS NOT NULL
      AND (
        import_row.matched_profile_id = profile.id
        OR import_row.id = CASE
          WHEN profile.source_summary ->> 'importRowId'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (profile.source_summary ->> 'importRowId')::uuid
          ELSE NULL
        END
      )
  )
  SELECT EXISTS (
    SELECT 1
    FROM source_profile AS source
    JOIN target_profile AS target
      ON target.organization_id = source.organization_id
    JOIN source_evidence ON true
    JOIN target_evidence
      ON target_evidence.source_file_id = source_evidence.source_file_id
    CROSS JOIN LATERAL (
      SELECT
        pg_catalog.lower(pg_catalog.regexp_replace(
          COALESCE(
            source_evidence.normalized_data #>> '{record,identity,sourceStudentKey}',
            source_evidence.normalized_data #>> '{identity,sourceStudentKey}'
          ), '[[:space:]]+', '', 'g'
        )) AS source_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          COALESCE(
            target_evidence.normalized_data #>> '{record,identity,sourceStudentKey}',
            target_evidence.normalized_data #>> '{identity,sourceStudentKey}'
          ), '[[:space:]]+', '', 'g'
        )) AS target_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_first_name || source.normalized_last_name,
          '[[:space:]]+', '', 'g'
        )) AS source_first_last_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_last_name || source.normalized_first_name,
          '[[:space:]]+', '', 'g'
        )) AS source_last_first_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          target.normalized_first_name || target.normalized_last_name,
          '[[:space:]]+', '', 'g'
        )) AS target_first_last_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          target.normalized_last_name || target.normalized_first_name,
          '[[:space:]]+', '', 'g'
        )) AS target_last_first_key
    ) AS keys
    WHERE keys.source_key IS NOT NULL
      AND keys.source_key <> ''
      AND keys.target_key IS NOT NULL
      AND keys.target_key <> ''
      AND keys.source_key IN (
        keys.source_first_last_key,
        keys.source_last_first_key,
        keys.target_first_last_key,
        keys.target_last_first_key
      )
      AND keys.target_key IN (
        keys.source_first_last_key,
        keys.source_last_first_key,
        keys.target_first_last_key,
        keys.target_last_first_key
      )
      AND (
        source_evidence.sheet_tab_name IS DISTINCT FROM target_evidence.sheet_tab_name
        OR source_evidence.row_number = target_evidence.row_number
      )
  );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_preview(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_conflicts jsonb;
  v_exact_source_key_identity boolean := false;
  v_term_conflict_count integer := 0;
  v_other_conflict_count integer := 0;
  v_overlap_count integer := 0;
  v_unsafe_overlap_count integer := 0;
  v_can_consolidate boolean := false;
BEGIN
  v_preview := plugin_data.csf_profile_merge_preview_term_membership_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );
  IF v_preview IS NULL OR pg_catalog.jsonb_typeof(v_preview) <> 'object' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return a canonical object.';
  END IF;
  v_conflicts := v_preview -> 'conflicts';
  IF pg_catalog.jsonb_typeof(v_conflicts) <> 'array' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return canonical conflicts.';
  END IF;

  v_exact_source_key_identity := plugin_data.csf_profiles_share_class_source_key(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  ) OR
    COALESCE(
      (v_preview #>> '{identityEvidence,committedSourceStudentKeyMatch}')::boolean,
      false
    )
    OR COALESCE(
      (v_preview #>> '{identityEvidence,exactSourceStudentKeyMatch}')::boolean,
      false
    );

  SELECT
    pg_catalog.count(*) FILTER (
      WHERE entry.conflict ->> 'type' = 'term_membership'
    )::integer,
    pg_catalog.count(*) FILTER (
      WHERE entry.conflict ->> 'type' NOT IN (
        'term_membership',
        'identity_email_missing',
        'identity_name_mismatch'
      )
    )::integer
  INTO v_term_conflict_count, v_other_conflict_count
  FROM pg_catalog.jsonb_array_elements(v_conflicts) AS entry(conflict);

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE source_membership.status IS DISTINCT FROM target_membership.status
        OR source_membership.override_status IS DISTINCT FROM target_membership.override_status
        OR (
          source_membership.override_status IS NOT NULL
          AND (
            source_membership.override_reason IS DISTINCT FROM target_membership.override_reason
            OR source_membership.overridden_by IS DISTINCT FROM target_membership.overridden_by
            OR source_membership.overridden_at IS DISTINCT FROM target_membership.overridden_at
          )
        )
        OR (
          source_membership.cohort_id IS NOT NULL
          AND target_membership.cohort_id IS NOT NULL
          AND source_membership.cohort_id <> target_membership.cohort_id
        )
        OR (
          source_membership.application_id IS NOT NULL
          AND target_membership.application_id IS NOT NULL
          AND source_membership.application_id <> target_membership.application_id
        )
    )::integer
  INTO v_overlap_count, v_unsafe_overlap_count
  FROM plugin_data.csf_term_memberships AS source_membership
  JOIN plugin_data.csf_term_memberships AS target_membership
    ON target_membership.organization_id = source_membership.organization_id
   AND target_membership.term_id = source_membership.term_id
   AND target_membership.profile_id = p_target_profile_id
  WHERE source_membership.organization_id = p_organization_id
    AND source_membership.profile_id = p_source_profile_id;

  v_can_consolidate :=
    v_exact_source_key_identity
    AND v_term_conflict_count > 0
    AND v_other_conflict_count = 0
    AND v_overlap_count = v_term_conflict_count
    AND v_unsafe_overlap_count = 0;

  IF v_exact_source_key_identity OR v_can_consolidate THEN
    SELECT COALESCE(
      pg_catalog.jsonb_agg(entry.conflict ORDER BY entry.ordinal),
      '[]'::jsonb
    )
    INTO v_conflicts
    FROM pg_catalog.jsonb_array_elements(v_conflicts)
      WITH ORDINALITY AS entry(conflict, ordinal)
    WHERE NOT (
      v_exact_source_key_identity
      AND entry.conflict ->> 'type' IN (
        'identity_email_missing',
        'identity_name_mismatch'
      )
    )
      AND NOT (
        v_can_consolidate
        AND entry.conflict ->> 'type' = 'term_membership'
      );
  END IF;

  v_preview := pg_catalog.jsonb_set(
    v_preview,
    '{identityEvidence,termMembershipConsolidationCount}',
    pg_catalog.to_jsonb(CASE WHEN v_can_consolidate THEN v_overlap_count ELSE 0 END),
    true
  );
  RETURN v_preview || pg_catalog.jsonb_build_object(
    'conflicts', v_conflicts,
    'canMerge', pg_catalog.jsonb_array_length(v_conflicts) = 0
  );
END;
$$;

-- Recompile the internal merge layers so their bound preview reference uses
-- the current exact-key name-variation policy during the locked write.
DO $refresh_source_key_merge_chain$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(procedure.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'plugin_data'
    AND procedure.proname = 'csf_merge_profiles_account_order_base'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
      'p_organization_id uuid, p_source_profile_id uuid, p_target_profile_id uuid, p_reason text, p_actor_user_id uuid';
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'The canonical CSF account-order merge implementation is missing.';
  END IF;
  EXECUTE pg_catalog.replace(
    v_definition,
    'FUNCTION plugin_data.csf_merge_profiles_account_order_base(',
    'FUNCTION plugin_data.csf_merge_profiles_name_variation_account_base('
  );

  SELECT pg_catalog.pg_get_functiondef(procedure.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'plugin_data'
    AND procedure.proname = 'csf_merge_profiles_identity_base'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
      'p_organization_id uuid, p_source_profile_id uuid, p_target_profile_id uuid, p_reason text, p_actor_user_id uuid';
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'The canonical CSF identity merge implementation is missing.';
  END IF;
  v_definition := pg_catalog.replace(
    v_definition,
    'FUNCTION plugin_data.csf_merge_profiles_identity_base(',
    'FUNCTION plugin_data.csf_merge_profiles_name_variation_identity_base('
  );
  EXECUTE pg_catalog.replace(
    v_definition,
    'plugin_data.csf_merge_profiles_account_order_base(',
    'plugin_data.csf_merge_profiles_name_variation_account_base('
  );

  SELECT pg_catalog.pg_get_functiondef(procedure.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'plugin_data'
    AND procedure.proname = 'csf_merge_profiles_term_membership_base'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
      'p_organization_id uuid, p_source_profile_id uuid, p_target_profile_id uuid, p_reason text, p_actor_user_id uuid';
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'The canonical CSF reference-rewrite merge implementation is missing.';
  END IF;
  v_definition := pg_catalog.replace(
    v_definition,
    'FUNCTION plugin_data.csf_merge_profiles_term_membership_base(',
    'FUNCTION plugin_data.csf_merge_profiles_name_variation_reference_base('
  );
  EXECUTE pg_catalog.replace(
    v_definition,
    'plugin_data.csf_merge_profiles_identity_base(',
    'plugin_data.csf_merge_profiles_name_variation_identity_base('
  );

  SELECT pg_catalog.pg_get_functiondef(procedure.oid)
  INTO v_definition
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'plugin_data'
    AND procedure.proname = 'csf_merge_profiles'
    AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
      'p_organization_id uuid, p_source_profile_id uuid, p_target_profile_id uuid, p_reason text, p_actor_user_id uuid';
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'The canonical CSF merge entry point is missing.';
  END IF;
  EXECUTE pg_catalog.replace(
    v_definition,
    'plugin_data.csf_merge_profiles_source_key_reference_base(',
    'plugin_data.csf_merge_profiles_name_variation_reference_base('
  );
END;
$refresh_source_key_merge_chain$;

REVOKE ALL ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_name_variation_account_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_name_variation_identity_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_name_variation_reference_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_name_variation_account_base(uuid, uuid, uuid, text, uuid)
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_name_variation_identity_base(uuid, uuid, uuid, text, uuid)
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_name_variation_reference_base(uuid, uuid, uuid, text, uuid)
  TO postgres;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid) IS
  'Returns true when two active profiles have exact name-derived roster keys in committed rows from one official class workbook. Either canonical profile name may corroborate a legacy name variation; the canonical preview retains class conflicts.';
COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Returns the canonical CSF profile merge preview. An exact official-workbook roster key within one active class may resolve a missing email or legacy name variation; concrete email and relationship conflicts remain authoritative.';
