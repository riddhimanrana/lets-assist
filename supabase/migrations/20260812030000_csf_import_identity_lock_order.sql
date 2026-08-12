-- Close the remaining profile-merge/import lock inversions.
--
-- Every import path that can freeze a profile target, change a match, or create
-- profile-owned records now takes the organization identity advisory lock
-- first. Later locks are deterministic: active profile rows by id, then each
-- historical function's existing attempt/job/import/batch order. All actor,
-- tenant, active-profile, and workflow-state checks run after the common first
-- lock, so a writer queued behind a merge cannot recreate ownership on the
-- merged tombstone.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_lock_active_import_profiles(
  p_organization_id uuid,
  p_profile_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_ids uuid[];
BEGIN
  SELECT pg_catalog.coalesce(
    pg_catalog.array_agg(DISTINCT requested.profile_id ORDER BY requested.profile_id),
    ARRAY[]::uuid[]
  )
  INTO v_profile_ids
  FROM pg_catalog.unnest(
    pg_catalog.coalesce(p_profile_ids, ARRAY[]::uuid[])
  ) AS requested(profile_id)
  WHERE requested.profile_id IS NOT NULL;

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = ANY (v_profile_ids)
    AND profile.record_status = 'active'
  ORDER BY profile.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(v_profile_ids) AS requested(profile_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.id = requested.profile_id
        AND profile.record_status = 'active'
    )
  ) THEN
    RAISE EXCEPTION
      'An import target is no longer an active CSF member. Reload the import after resolving the profile merge.'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_lock_active_import_profiles(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_lock_active_import_profiles(uuid, uuid[]) IS
  'Owner-internal second lock for import identity mutations. After the organization identity lock, holds distinct active profile targets in UUID order and rejects missing or merged targets.';

-- Direct reviewed-row primitives remain service-callable compatibility
-- boundaries. They therefore need the same actor and active-target checks as
-- the central commit that normally reaches them.
CREATE OR REPLACE FUNCTION plugin_data.csf_import_class_history_row(
  p_organization_id uuid, p_profile_id uuid,
  p_first_name text, p_last_name text, p_school_email text, p_personal_email text,
  p_normalized_first_name text, p_normalized_last_name text,
  p_normalized_school_email text, p_normalized_personal_email text,
  p_cohort_id uuid, p_term_id uuid, p_source_id uuid, p_import_row_id uuid,
  p_row_hash text, p_activities jsonb, p_meetings jsonb,
  p_all_requirements_met boolean, p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'class_history'
  );
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[p_profile_id]::uuid[]
  );
  RETURN plugin_data.csf_import_class_history_row_identity_base(
    p_organization_id, p_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_term_id, p_source_id,
    p_import_row_id, p_row_hash, p_activities, p_meetings,
    p_all_requirements_met, p_actor_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_class_history_row_v2(
  p_organization_id uuid, p_profile_id uuid,
  p_first_name text, p_last_name text, p_school_email text, p_personal_email text,
  p_normalized_first_name text, p_normalized_last_name text,
  p_normalized_school_email text, p_normalized_personal_email text,
  p_cohort_id uuid, p_term_id uuid, p_source_id uuid, p_import_row_id uuid,
  p_row_hash text, p_activities jsonb, p_meetings jsonb,
  p_all_requirements_met boolean, p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'class_history'
  );
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[p_profile_id]::uuid[]
  );
  RETURN plugin_data.csf_import_class_history_row_v2_identity_base(
    p_organization_id, p_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_term_id, p_source_id,
    p_import_row_id, p_row_hash, p_activities, p_meetings,
    p_all_requirements_met, p_actor_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_student_roster_row(
  p_organization_id uuid, p_profile_id uuid,
  p_first_name text, p_last_name text, p_school_email text, p_personal_email text,
  p_normalized_first_name text, p_normalized_last_name text,
  p_normalized_school_email text, p_normalized_personal_email text,
  p_cohort_id uuid, p_source_id uuid, p_import_row_id uuid, p_row_hash text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email_targets uuid[];
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'student_roster'
  );

  IF p_profile_id IS NULL THEN
    SELECT pg_catalog.coalesce(
      pg_catalog.array_agg(profile.id ORDER BY profile.id),
      ARRAY[]::uuid[]
    )
    INTO v_email_targets
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND (
        (
          nullif(pg_catalog.btrim(p_normalized_school_email), '') IS NOT NULL
          AND profile.normalized_school_email =
            nullif(pg_catalog.btrim(p_normalized_school_email), '')
        )
        OR (
          nullif(pg_catalog.btrim(p_normalized_personal_email), '') IS NOT NULL
          AND profile.normalized_personal_email =
            nullif(pg_catalog.btrim(p_normalized_personal_email), '')
        )
      );
  ELSE
    v_email_targets := ARRAY[p_profile_id]::uuid[];
  END IF;

  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, v_email_targets
  );
  RETURN plugin_data.csf_import_student_roster_row_identity_base(
    p_organization_id, p_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_source_id, p_import_row_id,
    p_row_hash, p_actor_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_import_application_response_row(
  p_organization_id uuid, p_profile_id uuid,
  p_first_name text, p_last_name text, p_school_email text, p_personal_email text,
  p_normalized_first_name text, p_normalized_last_name text,
  p_normalized_school_email text, p_normalized_personal_email text,
  p_cohort_id uuid, p_term_id uuid, p_source_id uuid, p_import_row_id uuid,
  p_row_hash text, p_application_data jsonb, p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'application_responses'
  );
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION
      'An application import must name the reviewed active CSF member.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[p_profile_id]::uuid[]
  );
  RETURN plugin_data.csf_import_application_response_row_identity_base(
    p_organization_id, p_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_term_id, p_source_id,
    p_import_row_id, p_row_hash, p_application_data, p_actor_user_id
  );
END;
$$;

-- Claim takes identity first, then current actor authority, then every active
-- target profile by id. The historical base retains its coordinate order after
-- those shared identity locks.
CREATE OR REPLACE FUNCTION plugin_data.csf_claim_import_commit_attempt(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_lease_seconds integer,
  p_evidence_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_ids uuid[];
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, p_preview_job_id
  );
  SELECT pg_catalog.coalesce(
    pg_catalog.array_agg(
      DISTINCT import_row.matched_profile_id
      ORDER BY import_row.matched_profile_id
    ) FILTER (WHERE import_row.matched_profile_id IS NOT NULL),
    ARRAY[]::uuid[]
  )
  INTO v_profile_ids
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = p_preview_job_id
    AND import_row.import_status = 'pending';
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, v_profile_ids
  );
  RETURN plugin_data.csf_claim_import_commit_attempt_identity_base(
    p_organization_id, p_preview_job_id, p_actor_user_id, p_lease_seconds,
    p_evidence_token
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_commit_import_row_for_attempt(uuid, uuid, uuid)
  RENAME TO csf_commit_import_row_for_attempt_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_import_row_for_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_import_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_preview_job_id uuid;
  v_target_profile_id uuid;
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  SELECT
    pg_catalog.coalesce(
      nullif(attempt.actor_snapshot->>'claimedBy', '')::uuid,
      attempt.actor_user_id
    ),
    commit_job.preview_job_id,
    import_row.commit_target_profile_id
  INTO v_actor_user_id, v_preview_job_id, v_target_profile_id
  FROM plugin_data.csf_sheet_import_commit_attempts AS attempt
  JOIN plugin_data.csf_sheet_import_jobs AS commit_job
    ON commit_job.organization_id = attempt.organization_id
   AND commit_job.id = attempt.commit_job_id
  JOIN plugin_data.csf_sheet_import_rows AS import_row
    ON import_row.organization_id = attempt.organization_id
   AND import_row.job_id = commit_job.preview_job_id
   AND import_row.id = p_import_row_id
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF import row was not found for this commit.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, v_actor_user_id, v_preview_job_id
  );
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, ARRAY[v_target_profile_id]::uuid[]
  );
  RETURN plugin_data.csf_commit_import_row_for_attempt_identity_base(
    p_organization_id, p_attempt_id, p_import_row_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  uuid, uuid, uuid, text, text, uuid, uuid
) RENAME TO csf_reconcile_sheet_import_row_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  p_organization_id uuid,
  p_row_id uuid,
  p_profile_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id, p_actor_user_id, p_row_id
  );
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id,
    CASE
      WHEN p_decision = 'match' THEN ARRAY[p_profile_id]::uuid[]
      ELSE ARRAY[]::uuid[]
    END
  );
  RETURN plugin_data.csf_reconcile_sheet_import_row_identity_base(
    p_organization_id, p_row_id, p_profile_id, p_decision, p_reason,
    p_actor_user_id, p_correlation_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) RENAME TO csf_commit_meeting_attendance_import_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid,
  p_evidence_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_ids uuid[];
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor_for_job(
    p_organization_id, p_actor_user_id, p_preview_job_id
  );
  SELECT pg_catalog.coalesce(
    pg_catalog.array_agg(
      DISTINCT import_row.matched_profile_id
      ORDER BY import_row.matched_profile_id
    ) FILTER (WHERE import_row.matched_profile_id IS NOT NULL),
    ARRAY[]::uuid[]
  )
  INTO v_profile_ids
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = p_preview_job_id
    AND import_row.import_status = 'pending';
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, v_profile_ids
  );
  RETURN plugin_data.csf_commit_meeting_attendance_import_identity_base(
    p_organization_id, p_preview_job_id, p_actor_user_id, p_reason,
    p_correlation_id, p_evidence_token
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid, uuid
) RENAME TO csf_commit_partner_audit_import_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_partner_audit_import(
  p_organization_id uuid,
  p_batch_id uuid,
  p_approval_mode text,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid,
  p_evidence_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_ids uuid[];
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, 'partner_club_audit'
  );
  SELECT pg_catalog.coalesce(
    pg_catalog.array_agg(
      DISTINCT partner_row.profile_id
      ORDER BY partner_row.profile_id
    ) FILTER (WHERE partner_row.profile_id IS NOT NULL),
    ARRAY[]::uuid[]
  )
  INTO v_profile_ids
  FROM plugin_data.csf_partner_submission_rows AS partner_row
  WHERE partner_row.organization_id = p_organization_id
    AND partner_row.batch_id = p_batch_id
    AND partner_row.matched_status = 'matched'
    AND partner_row.generated_submission_id IS NULL;
  PERFORM plugin_data.csf_lock_active_import_profiles(
    p_organization_id, v_profile_ids
  );
  RETURN plugin_data.csf_commit_partner_audit_import_identity_base(
    p_organization_id, p_batch_id, p_approval_mode, p_actor_user_id,
    p_reason, p_correlation_id, p_evidence_token
  );
END;
$$;

-- Historical bodies are owner-internal. Only the canonical, revalidating
-- signatures remain service-callable.
REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_for_attempt_identity_base(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_import_row_identity_base(
  uuid, uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_meeting_attendance_import_identity_base(
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_partner_audit_import_identity_base(
  uuid, uuid, text, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_claim_import_commit_attempt(
  uuid, uuid, uuid, integer, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  uuid, uuid, uuid, text, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_claim_import_commit_attempt(
  uuid, uuid, uuid, integer, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(
  uuid, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  uuid, uuid, uuid, text, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_claim_import_commit_attempt(
  uuid, uuid, uuid, integer, uuid
) IS 'Import claim with organization identity lock first, current actor reauthorization second, ordered active profile targets third, and the historical commit coordinate afterwards.';
COMMENT ON FUNCTION plugin_data.csf_commit_import_row_for_attempt(
  uuid, uuid, uuid
) IS 'Central import-row commit with organization identity lock first and post-lock current claimant, tenant, active target, attempt, frozen row, and payload-state revalidation.';
COMMENT ON FUNCTION plugin_data.csf_reconcile_sheet_import_row(
  uuid, uuid, uuid, text, text, uuid, uuid
) IS 'Import-row match/skip decision with organization identity lock first, post-lock current actor authorization, active selected-profile lock, and historical row/partner state revalidation.';
COMMENT ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) IS 'Meeting attendance import with organization identity lock first, post-lock actor authorization and ordered active-profile locks before the historical preview/population/source/write sequence.';
COMMENT ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid, uuid
) IS 'Partner audit import with organization identity lock first, post-lock actor authorization and ordered active-profile locks before the historical batch/preview/population/source/write sequence.';

COMMIT;
