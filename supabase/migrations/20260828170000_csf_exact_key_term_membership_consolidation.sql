-- Exact roster keys can identify duplicate imported profiles created in the
-- same semester. Consolidate only equivalent membership outcomes, keep a full
-- private audit snapshot, and leave every other merge conflict authoritative.

CREATE TABLE plugin_data.csf_profile_merge_term_membership_consolidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  consolidation_id uuid NOT NULL,
  merge_review_id uuid REFERENCES plugin_data.csf_profile_merge_reviews(id) ON DELETE SET NULL,
  source_profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE RESTRICT,
  target_profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE RESTRICT,
  source_membership_id uuid NOT NULL,
  target_membership_id uuid NOT NULL,
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  target_snapshot jsonb NOT NULL CHECK (jsonb_typeof(target_snapshot) = 'object'),
  resolved_snapshot jsonb NOT NULL CHECK (jsonb_typeof(resolved_snapshot) = 'object'),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consolidation_id, term_id)
);

CREATE INDEX csf_term_membership_merge_audit_org_created_idx
  ON plugin_data.csf_profile_merge_term_membership_consolidations (
    organization_id, created_at DESC
  );

ALTER TABLE plugin_data.csf_profile_merge_term_membership_consolidations
  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_profile_merge_term_membership_consolidations
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_profile_merge_term_membership_consolidations
  TO service_role;

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
      AND profile.source_summary ->> 'importedFrom' = 'csf_sheet_sync'
  ),
  target_profile AS (
    SELECT profile.*
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_target_profile_id
      AND profile.record_status = 'active'
      AND profile.source_summary ->> 'importedFrom' = 'csf_sheet_sync'
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
     AND target.normalized_first_name = source.normalized_first_name
     AND target.normalized_last_name = source.normalized_last_name
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
        )) AS first_last_key,
        pg_catalog.lower(pg_catalog.regexp_replace(
          source.normalized_last_name || source.normalized_first_name,
          '[[:space:]]+', '', 'g'
        )) AS last_first_key
    ) AS keys
    WHERE keys.source_key IS NOT NULL
      AND keys.source_key <> ''
      AND keys.target_key IS NOT NULL
      AND keys.target_key <> ''
      AND keys.source_key IN (keys.first_last_key, keys.last_first_key)
      AND keys.target_key IN (keys.first_last_key, keys.last_first_key)
      AND (
        source_evidence.sheet_tab_name IS DISTINCT FROM target_evidence.sheet_tab_name
        OR source_evidence.row_number = target_evidence.row_number
      )
  )
$$;

ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  RENAME TO csf_profile_merge_reference_plan_term_membership_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_reference_plan(
  p_organization_id uuid,
  p_source_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
  v_history jsonb;
BEGIN
  v_plan := plugin_data.csf_profile_merge_reference_plan_term_membership_base(
    p_organization_id,
    p_source_profile_id
  );
  v_history := COALESCE(v_plan -> 'immutableHistoryRetentions', '[]'::jsonb)
    || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_merge_term_membership_consolidations.source_profile_id',
        'scope', 'immutable same-term consolidation source snapshot',
        'sourceCount', (
          SELECT pg_catalog.count(*)
          FROM plugin_data.csf_profile_merge_term_membership_consolidations AS evidence
          WHERE evidence.organization_id = p_organization_id
            AND evidence.source_profile_id = p_source_profile_id
        )
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_merge_term_membership_consolidations.target_profile_id',
        'scope', 'immutable same-term consolidation target snapshot',
        'sourceCount', (
          SELECT pg_catalog.count(*)
          FROM plugin_data.csf_profile_merge_term_membership_consolidations AS evidence
          WHERE evidence.organization_id = p_organization_id
            AND evidence.target_profile_id = p_source_profile_id
        )
      )
    );
  RETURN pg_catalog.jsonb_set(
    v_plan,
    '{immutableHistoryRetentions}',
    v_history,
    true
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  RENAME TO csf_profile_merge_preview_term_membership_base;

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
        'identity_email_missing'
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
      AND entry.conflict ->> 'type' = 'identity_email_missing'
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

ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  RENAME TO csf_merge_profiles_term_membership_base;

-- Older merge layers were compiled before source-key preview wrappers existed,
-- so their function references retain the prior preview OID. Clone the exact
-- reviewed implementations under new internal names after the canonical
-- preview exists, then point each layer at the newly compiled layer below it.
DO $compile_source_key_merge_chain$
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
    'FUNCTION plugin_data.csf_merge_profiles_source_key_account_base('
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
    'FUNCTION plugin_data.csf_merge_profiles_source_key_identity_base('
  );
  EXECUTE pg_catalog.replace(
    v_definition,
    'plugin_data.csf_merge_profiles_account_order_base(',
    'plugin_data.csf_merge_profiles_source_key_account_base('
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
    'FUNCTION plugin_data.csf_merge_profiles_source_key_reference_base('
  );
  EXECUTE pg_catalog.replace(
    v_definition,
    'plugin_data.csf_merge_profiles_identity_base(',
    'plugin_data.csf_merge_profiles_source_key_identity_base('
  );
END;
$compile_source_key_merge_chain$;

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_pair record;
  v_result jsonb;
  v_consolidation_id uuid := gen_random_uuid();
  v_consolidation_count integer := 0;
  v_now timestamptz := pg_catalog.now();
  v_review_id uuid;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to merge CSF profiles.';
  END IF;
  IF p_source_profile_id = p_target_profile_id THEN
    RAISE EXCEPTION 'Choose two different CSF student records.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'Explain why these two CSF student records are duplicates.';
  END IF;

  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY profile.id
  FOR UPDATE;

  PERFORM 1
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY membership.term_id, membership.profile_id, membership.id
  FOR UPDATE;

  v_preview := plugin_data.csf_profile_merge_preview(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );
  IF COALESCE((v_preview ->> 'canMerge')::boolean, false) = false THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These CSF student records have conflicts that must be resolved before merging.',
      DETAIL = (v_preview -> 'conflicts')::text,
      HINT = 'Review the duplicate semester, attendance, signup, class, point claim, appeal, staff assignment, verified-account, or outstanding import recovery records.';
  END IF;

  v_consolidation_count := COALESCE(
    (v_preview #>> '{identityEvidence,termMembershipConsolidationCount}')::integer,
    0
  );

  IF v_consolidation_count > 0 THEN
    FOR v_pair IN
      SELECT
        source_membership.*,
        target_membership.id AS target_id,
        target_membership.cohort_id AS target_cohort_id,
        target_membership.application_id AS target_application_id,
        target_membership.status_reason AS target_status_reason,
        target_membership.eligibility_snapshot AS target_eligibility_snapshot,
        target_membership.override_reason AS target_override_reason,
        target_membership.overridden_by AS target_overridden_by,
        target_membership.overridden_at AS target_overridden_at,
        target_membership.accepted_at AS target_accepted_at,
        target_membership.activated_at AS target_activated_at,
        target_membership.completed_at AS target_completed_at,
        target_membership.created_at AS target_created_at,
        pg_catalog.to_jsonb(source_membership) AS source_snapshot,
        pg_catalog.to_jsonb(target_membership) AS target_snapshot
      FROM plugin_data.csf_term_memberships AS source_membership
      JOIN plugin_data.csf_term_memberships AS target_membership
        ON target_membership.organization_id = source_membership.organization_id
       AND target_membership.term_id = source_membership.term_id
       AND target_membership.profile_id = p_target_profile_id
      WHERE source_membership.organization_id = p_organization_id
        AND source_membership.profile_id = p_source_profile_id
      ORDER BY source_membership.term_id, source_membership.id, target_membership.id
    LOOP
      INSERT INTO plugin_data.csf_profile_merge_term_membership_consolidations (
        organization_id,
        consolidation_id,
        source_profile_id,
        target_profile_id,
        term_id,
        source_membership_id,
        target_membership_id,
        source_snapshot,
        target_snapshot,
        resolved_snapshot,
        actor_user_id,
        created_at
      ) VALUES (
        p_organization_id,
        v_consolidation_id,
        p_source_profile_id,
        p_target_profile_id,
        v_pair.term_id,
        v_pair.id,
        v_pair.target_id,
        v_pair.source_snapshot,
        v_pair.target_snapshot,
        pg_catalog.jsonb_build_object(
          'status', v_pair.status,
          'cohortId', COALESCE(v_pair.target_cohort_id, v_pair.cohort_id),
          'applicationId', COALESCE(v_pair.target_application_id, v_pair.application_id),
          'eligibilitySnapshot', v_pair.eligibility_snapshot || v_pair.target_eligibility_snapshot
        ),
        p_actor_user_id,
        v_now
      );

      UPDATE plugin_data.csf_term_memberships
      SET cohort_id = COALESCE(v_pair.target_cohort_id, v_pair.cohort_id),
          application_id = COALESCE(v_pair.target_application_id, v_pair.application_id),
          status_reason = COALESCE(v_pair.target_status_reason, v_pair.status_reason),
          eligibility_snapshot = v_pair.eligibility_snapshot || v_pair.target_eligibility_snapshot,
          override_reason = COALESCE(v_pair.target_override_reason, v_pair.override_reason),
          overridden_by = COALESCE(v_pair.target_overridden_by, v_pair.overridden_by),
          overridden_at = COALESCE(v_pair.target_overridden_at, v_pair.overridden_at),
          accepted_at = CASE
            WHEN v_pair.target_accepted_at IS NULL THEN v_pair.accepted_at
            WHEN v_pair.accepted_at IS NULL THEN v_pair.target_accepted_at
            ELSE LEAST(v_pair.target_accepted_at, v_pair.accepted_at)
          END,
          activated_at = CASE
            WHEN v_pair.target_activated_at IS NULL THEN v_pair.activated_at
            WHEN v_pair.activated_at IS NULL THEN v_pair.target_activated_at
            ELSE LEAST(v_pair.target_activated_at, v_pair.activated_at)
          END,
          completed_at = CASE
            WHEN v_pair.target_completed_at IS NULL THEN v_pair.completed_at
            WHEN v_pair.completed_at IS NULL THEN v_pair.target_completed_at
            ELSE GREATEST(v_pair.target_completed_at, v_pair.completed_at)
          END,
          created_at = LEAST(v_pair.target_created_at, v_pair.created_at),
          updated_at = v_now
      WHERE organization_id = p_organization_id
        AND id = v_pair.target_id
        AND profile_id = p_target_profile_id;

      DELETE FROM plugin_data.csf_term_memberships
      WHERE organization_id = p_organization_id
        AND id = v_pair.id
        AND profile_id = p_source_profile_id;
    END LOOP;
  END IF;

  v_result := plugin_data.csf_merge_profiles_source_key_reference_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    p_reason,
    p_actor_user_id
  );

  IF v_consolidation_count > 0
    AND v_result ->> 'reviewId'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_review_id := (v_result ->> 'reviewId')::uuid;
    UPDATE plugin_data.csf_profile_merge_term_membership_consolidations
    SET merge_review_id = v_review_id
    WHERE organization_id = p_organization_id
      AND consolidation_id = v_consolidation_id;
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'consolidatedTermMemberships', v_consolidation_count
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview_term_membership_base(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profiles_share_class_source_key(uuid, uuid, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan_term_membership_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_term_membership_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_source_key_account_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_source_key_identity_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_source_key_reference_base(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_source_key_account_base(uuid, uuid, uuid, text, uuid)
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_source_key_identity_base(uuid, uuid, uuid, text, uuid)
  TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_source_key_reference_base(uuid, uuid, uuid, text, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  TO postgres;

ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  SET search_path = '';
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE plugin_data.csf_profile_merge_term_membership_consolidations IS
  'Private immutable evidence for equivalent same-semester membership rows consolidated during an exact roster-key profile merge.';
COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Returns the canonical merge preview. Exact roster-key duplicates may consolidate same-term membership rows only when their outcomes and overrides agree.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) IS
  'Owner-internal profile merge that audits and consolidates equivalent same-term membership rows before the canonical reference rewrite.';
