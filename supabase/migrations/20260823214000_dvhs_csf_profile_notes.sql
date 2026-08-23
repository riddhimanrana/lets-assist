-- Officer notes on CSF member profiles.
--
-- Appeals intake stays outside the app (Google Form); officers resolve an
-- appeal by correcting the member's records directly and leaving a tagged
-- note ("appealed") on the profile as the durable paper trail. Notes are
-- officer-only, additive, and redactable rather than deletable, matching
-- csf_review_notes.

BEGIN;

CREATE TABLE plugin_data.csf_profile_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid REFERENCES plugin_data.csf_terms(id) ON DELETE SET NULL,
  tag text CHECK (tag IN ('appealed', 'correction', 'info')),
  body text NOT NULL CHECK (nullif(btrim(body), '') IS NOT NULL),
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  redacted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  redacted_at timestamptz,
  redaction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_profile_notes_redaction_check CHECK (
    (redacted_at IS NULL AND redacted_by IS NULL AND redaction_reason IS NULL)
    OR
    (redacted_at IS NOT NULL AND redacted_by IS NOT NULL AND nullif(btrim(redaction_reason), '') IS NOT NULL)
  )
);

CREATE INDEX csf_profile_notes_profile_idx
  ON plugin_data.csf_profile_notes (organization_id, profile_id, created_at DESC);

ALTER TABLE plugin_data.csf_profile_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_profile_notes FROM anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_profile_notes TO service_role;

COMMENT ON TABLE plugin_data.csf_profile_notes IS
  'Officer-only annotations on a CSF member profile; the appeal paper trail.';

-- ---------------------------------------------------------------------------
-- Writing a note
--
-- Members-workspace officers hold manage_profiles; verification officers hold
-- verify_submissions. Either may annotate a member, because both kinds of
-- officer resolve appeals.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_add_profile_note(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_tag text,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_profile_notes%ROWTYPE;
  v_body text := nullif(pg_catalog.btrim(coalesce(p_body, '')), '');
  v_tag text := nullif(pg_catalog.btrim(coalesce(p_tag, '')), '');
BEGIN
  IF NOT (
    plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles')
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions')
  ) THEN
    RAISE EXCEPTION 'Not authorized to write CSF member notes.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'A note needs a body.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles
    WHERE organization_id = p_organization_id
      AND id = p_profile_id
      AND record_status = 'active'
  ) THEN
    RAISE EXCEPTION 'CSF member not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_terms
    WHERE organization_id = p_organization_id AND id = p_term_id
  ) THEN
    RAISE EXCEPTION 'Term not found.' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO plugin_data.csf_profile_notes (
    organization_id, profile_id, term_id, tag, body, author_user_id
  )
  VALUES (
    p_organization_id, p_profile_id, p_term_id, v_tag, v_body, p_actor_user_id
  )
  RETURNING * INTO v_row;

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_add_profile_note(uuid, uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_add_profile_note(uuid, uuid, uuid, uuid, text, text)
  TO service_role;


-- ---------------------------------------------------------------------------
-- Profile-merge integration
--
-- csf_profile_notes.profile_id is a new FK into csf_profiles, so the merge
-- machinery must move note ownership to the surviving record and account for
-- it in the canonical reference plan and the zero-live-references
-- postcondition. The three functions below are restated verbatim from
-- 20260817121000 with only the csf_profile_notes handling added.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_merge_reference_plan(
  p_organization_id uuid,
  p_source_profile_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'sameTransactionRewrites', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profiles.merged_into_profile_id',
        'scope', 'prior merge tombstones pointing at the source',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profiles AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.id <> p_source_profile_id
            AND referenced_row.merged_into_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_accounts.profile_id',
        'scope', 'status is not revoked',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_accounts AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.profile_id = p_source_profile_id
            AND referenced_row.status <> 'revoked')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_cohort_memberships.profile_id',
        'scope', 'all current membership rows; exact duplicates consolidate first',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_cohort_memberships AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_term_applications.profile_id',
        'scope', 'all application ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_term_applications AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_application_files.profile_id',
        'scope', 'all application evidence ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_application_files AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_staff_positions.profile_id',
        'scope', 'all staff-position ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_staff_positions AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_restrictions.profile_id',
        'scope', 'all current restriction rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_restrictions AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_point_submissions.profile_id',
        'scope', 'all submissions after the active-claim collision preflight',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_point_submissions AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_submission_files.profile_id',
        'scope', 'all submission evidence ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_submission_files AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_credit_records.profile_id',
        'scope', 'all awarded-credit ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_credit_records AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_meeting_attendance.profile_id',
        'scope', 'all attendance ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_meeting_attendance AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.matched_profile_id',
        'scope', 'unfrozen not-started reconciliation result with no frozen target',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.matched_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'live_rewrite')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_link_requests.matched_profile_id',
        'scope', 'all current match bindings',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_link_requests AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.matched_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_link_requests.candidate_profile_ids',
        'scope', 'all candidate arrays, rewritten and de-duplicated in ordinal order',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_link_requests AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND p_source_profile_id = ANY (referenced_row.candidate_profile_ids))
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_activity_events.profile_id',
        'scope', 'all current activity ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_activity_events AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_opportunity_signups.profile_id',
        'scope', 'all signup ownership rows after unique-key preflight',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_opportunity_signups AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_term_memberships.profile_id',
        'scope', 'all current semester-membership rows after unique-key preflight',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_term_memberships AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_point_appeals.profile_id',
        'scope', 'all point-appeal ownership rows after the open-appeal collision preflight',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_point_appeals AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_dues_records.profile_id',
        'scope', 'all dues ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_dues_records AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_onboarding_links.recipient_profile_id',
        'scope', 'all direct invitations; open delivery, acceptance, expiry, and cancellation state is preserved',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_onboarding_links AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.recipient_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_application_correction_requests.profile_id',
        'scope', 'all correction-request ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_application_correction_requests AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_communication_broadcast_preferences.profile_id',
        'scope', 'all current communication preferences',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_communication_broadcast_preferences AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_notes.profile_id',
        'scope', 'all officer note ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_notes AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      )
    ),
    'immutableHistoryRetentions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_accounts.profile_id',
        'scope', 'status is revoked; immutable account-binding history',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_accounts AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
            AND referenced_row.status = 'revoked')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_merge_reviews.source_profile_id',
        'scope', 'immutable merge decision history',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_merge_reviews AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.source_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_profile_merge_reviews.target_profile_id',
        'scope', 'immutable prior merge decision history',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_merge_reviews AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.target_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_admin_audit_events.actor_profile_id',
        'scope', 'immutable actor snapshot',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_admin_audit_events AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.actor_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_term_membership_outcomes.profile_id',
        'scope', 'immutable semester-close snapshot',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_term_membership_outcomes AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_communication_recipient_snapshots.profile_id',
        'scope', 'immutable broadcast audience snapshot',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_communication_recipient_snapshots AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.matched_profile_id',
        'scope', 'settled successful or terminally skipped import evidence',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.matched_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'immutable_history')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.commit_target_profile_id',
        'scope', 'settled successful or terminally skipped frozen target evidence',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.commit_target_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'immutable_history')
      )
    ),
    'preflightBlockedReferences', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.matched_profile_id',
        'scope', 'frozen, retryable, in-flight, ambiguous, or malformed import target',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.matched_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'preflight_blocker')
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_sheet_import_rows.commit_target_profile_id',
        'scope', 'frozen, retryable, in-flight, ambiguous, or malformed import target',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id
            AND referenced_row.commit_target_profile_id = p_source_profile_id
            AND plugin_data.csf_profile_merge_import_row_disposition(
              referenced_row.commit_frozen_at,
              referenced_row.commit_target_profile_id,
              referenced_row.matched_profile_id,
              referenced_row.commit_attempt_id,
              referenced_row.commit_retry_count,
              referenced_row.commit_outcome_state,
              referenced_row.import_status,
              referenced_row.commit_outcome_resolution
            ) = 'preflight_blocker')
      )
    ),
    'preflightBlockers', pg_catalog.jsonb_build_array(
      'term_application_unique_key',
      'term_membership_unique_key',
      'cohort_active_union',
      'meeting_attendance_unique_key',
      'opportunity_signup_unique_key',
      'verified_account_binding',
      'active_point_submission_claim_unique_key',
      'active_staff_assignment_unique_key',
      'open_point_appeal_unique_key',
      'outstanding_import_commit_target'
    )
  )
$$;

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
  v_duplicate record;
  v_now timestamptz := pg_catalog.now();
  v_resolved_status text;
  v_resolved_created_at timestamptz;
  v_consolidated jsonb := '[]'::jsonb;
  v_result jsonb;
  v_review_id uuid;
  v_correlation_id uuid;
  v_prior_tombstones integer := 0;
  v_candidate_arrays integer := 0;
  v_direct_invitations integer := 0;
  v_correction_requests integer := 0;
  v_preferences integer := 0;
  v_import_live_matches integer := 0;
  v_live_source_references bigint := 0;
  v_reference_rewrites jsonb;
  v_retained_history jsonb;
BEGIN
  -- A service-role call is not actor authority. Recheck the named officer
  -- before taking identity locks or revealing whether either profile exists.
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

  -- First lock in the shared hierarchy. It serializes only identity mutations
  -- in this organization; unrelated organizations remain independent.
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY profile.id
  FOR UPDATE;

  -- Stabilize the exact import evidence set before preview. Claim now takes the
  -- same organization lock before its coordinate/row locks; this row order then
  -- agrees with the commit worklist. If claim won first, preview sees a blocker.
  -- If merge won first, claim freezes the rewritten target after merge commits.
  PERFORM 1
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND (
      import_row.matched_profile_id = p_source_profile_id
      OR import_row.commit_target_profile_id = p_source_profile_id
    )
  ORDER BY import_row.job_id, import_row.sheet_tab_name,
    import_row.row_number, import_row.id
  FOR UPDATE;

  SELECT pg_catalog.count(*)::integer
  INTO v_import_live_matches
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.matched_profile_id = p_source_profile_id
    AND plugin_data.csf_profile_merge_import_row_disposition(
      import_row.commit_frozen_at,
      import_row.commit_target_profile_id,
      import_row.matched_profile_id,
      import_row.commit_attempt_id,
      import_row.commit_retry_count,
      import_row.commit_outcome_state,
      import_row.import_status,
      import_row.commit_outcome_resolution
    ) = 'live_rewrite';

  -- Gate on the canonical preview BEFORE consolidating. Consolidation deletes
  -- the shared source rows; running this check afterwards would let a source
  -- that is active in a class the target only archived slip past both this
  -- function and the base's own re-check.
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

  -- Consolidate exact duplicates deterministically. The target keeps the
  -- canonical row; only the duplicate source row is removed, so the historical
  -- base's bare profile_id move cannot hit UNIQUE (profile_id, cohort_id).
  FOR v_duplicate IN
    SELECT
      source_row.id AS source_id,
      target_row.id AS target_id,
      source_row.cohort_id AS cohort_id,
      source_row.status AS source_status,
      target_row.status AS target_status,
      source_row.created_at AS source_created_at,
      target_row.created_at AS target_created_at,
      source_row.updated_at AS source_updated_at,
      target_row.updated_at AS target_updated_at
    FROM plugin_data.csf_profile_cohort_memberships AS source_row
    JOIN plugin_data.csf_profile_cohort_memberships AS target_row
      ON target_row.organization_id = source_row.organization_id
     AND target_row.cohort_id = source_row.cohort_id
     AND target_row.profile_id = p_target_profile_id
    WHERE source_row.organization_id = p_organization_id
      AND source_row.profile_id = p_source_profile_id
    ORDER BY source_row.cohort_id
  LOOP
    -- Status precedence: active > transferred > archived.
    v_resolved_status := CASE
      WHEN v_duplicate.source_status = 'active'
        OR v_duplicate.target_status = 'active' THEN 'active'
      WHEN v_duplicate.source_status = 'transferred'
        OR v_duplicate.target_status = 'transferred' THEN 'transferred'
      ELSE 'archived'
    END;
    v_resolved_created_at := LEAST(
      v_duplicate.source_created_at,
      v_duplicate.target_created_at
    );

    UPDATE plugin_data.csf_profile_cohort_memberships
    SET status = v_resolved_status,
        created_at = v_resolved_created_at,
        updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_duplicate.target_id
      AND profile_id = p_target_profile_id;

    DELETE FROM plugin_data.csf_profile_cohort_memberships
    WHERE organization_id = p_organization_id
      AND id = v_duplicate.source_id
      AND profile_id = p_source_profile_id;

    v_consolidated := v_consolidated || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'cohortId', v_duplicate.cohort_id,
        'retainedMembershipId', v_duplicate.target_id,
        'removedMembershipId', v_duplicate.source_id,
        'resolvedStatus', v_resolved_status,
        'before', pg_catalog.jsonb_build_object(
          'source', pg_catalog.jsonb_build_object(
            'membershipId', v_duplicate.source_id,
            'profileId', p_source_profile_id,
            'status', v_duplicate.source_status,
            'createdAt', v_duplicate.source_created_at,
            'updatedAt', v_duplicate.source_updated_at
          ),
          'target', pg_catalog.jsonb_build_object(
            'membershipId', v_duplicate.target_id,
            'profileId', p_target_profile_id,
            'status', v_duplicate.target_status,
            'createdAt', v_duplicate.target_created_at,
            'updatedAt', v_duplicate.target_updated_at
          )
        ),
        'after', pg_catalog.jsonb_build_object(
          'membershipId', v_duplicate.target_id,
          'profileId', p_target_profile_id,
          'status', v_resolved_status,
          'createdAt', v_resolved_created_at,
          'updatedAt', v_now
        )
      )
    );
  END LOOP;

  -- Flatten older tombstones before the source itself becomes a tombstone, so
  -- canonical resolution never has to follow a source -> source -> target
  -- chain. The source row is deliberately excluded and is finalized by the
  -- historical merge implementation below.
  UPDATE plugin_data.csf_profiles
  SET merged_into_profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id <> p_source_profile_id
    AND merged_into_profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_prior_tombstones = ROW_COUNT;

  -- Candidate arrays are a non-FK profile reference. Rewrite the source and
  -- collapse any resulting duplicate target while preserving first ordinal.
  UPDATE plugin_data.csf_profile_link_requests AS request
  SET candidate_profile_ids = (
        SELECT pg_catalog.array_agg(candidate.profile_id ORDER BY candidate.first_ordinal)
        FROM (
          SELECT
            rewritten.profile_id,
            pg_catalog.min(rewritten.ordinality) AS first_ordinal
          FROM (
            SELECT
              CASE
                WHEN entry.profile_id = p_source_profile_id THEN p_target_profile_id
                ELSE entry.profile_id
              END AS profile_id,
              entry.ordinality
            FROM pg_catalog.unnest(request.candidate_profile_ids)
              WITH ORDINALITY AS entry(profile_id, ordinality)
          ) AS rewritten
          GROUP BY rewritten.profile_id
        ) AS candidate
      ),
      updated_at = v_now
  WHERE request.organization_id = p_organization_id
    AND p_source_profile_id = ANY (request.candidate_profile_ids);
  GET DIAGNOSTICS v_candidate_arrays = ROW_COUNT;

  v_result := plugin_data.csf_merge_profiles_identity_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    p_reason,
    p_actor_user_id
  );
  IF NULLIF(v_result ->> 'importRowLiveMatches', '')::integer
    IS DISTINCT FROM v_import_live_matches THEN
    RAISE EXCEPTION
      'Profile merge planned % live import match rewrite(s) but executed %.',
      v_import_live_matches,
      COALESCE(NULLIF(v_result ->> 'importRowLiveMatches', '')::integer, -1);
  END IF;

  -- These later schema references did not exist when the historical merge
  -- implementation was written. They are current ownership projections, so
  -- move them in this same transaction without changing delivery, acceptance,
  -- correction, representative, or consent state.
  UPDATE plugin_data.csf_onboarding_links
  SET recipient_profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND recipient_profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_direct_invitations = ROW_COUNT;

  UPDATE plugin_data.csf_application_correction_requests
  SET profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_correction_requests = ROW_COUNT;

  UPDATE plugin_data.csf_communication_broadcast_preferences
  SET profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_preferences = ROW_COUNT;

  -- Deliberate history references are excluded here. Any current/live source
  -- ownership left behind is an implementation defect and aborts atomically.
  SELECT COALESCE(pg_catalog.sum(reference_count), 0)
  INTO v_live_source_references
  FROM (
    SELECT pg_catalog.count(*) AS reference_count
    FROM plugin_data.csf_profiles AS referenced_row
    WHERE referenced_row.organization_id = p_organization_id
      AND referenced_row.id <> p_source_profile_id
      AND referenced_row.merged_into_profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_accounts AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
        AND referenced_row.status <> 'revoked'
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_cohort_memberships AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_term_applications AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_application_files AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_staff_positions AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_restrictions AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_point_submissions AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_submission_files AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_credit_records AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_meeting_attendance AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id
        AND referenced_row.matched_profile_id = p_source_profile_id
        AND plugin_data.csf_profile_merge_import_row_disposition(
          referenced_row.commit_frozen_at,
          referenced_row.commit_target_profile_id,
          referenced_row.matched_profile_id,
          referenced_row.commit_attempt_id,
          referenced_row.commit_retry_count,
          referenced_row.commit_outcome_state,
          referenced_row.import_status,
          referenced_row.commit_outcome_resolution
        ) <> 'immutable_history'
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id
        AND referenced_row.commit_target_profile_id = p_source_profile_id
        AND plugin_data.csf_profile_merge_import_row_disposition(
          referenced_row.commit_frozen_at,
          referenced_row.commit_target_profile_id,
          referenced_row.matched_profile_id,
          referenced_row.commit_attempt_id,
          referenced_row.commit_retry_count,
          referenced_row.commit_outcome_state,
          referenced_row.import_status,
          referenced_row.commit_outcome_resolution
        ) <> 'immutable_history'
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_link_requests AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.matched_profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_link_requests AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id
        AND p_source_profile_id = ANY (referenced_row.candidate_profile_ids)
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_activity_events AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_opportunity_signups AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_term_memberships AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_point_appeals AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_dues_records AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_onboarding_links AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.recipient_profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_application_correction_requests AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_communication_broadcast_preferences AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_profile_notes AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
  ) AS live_references;
  IF v_live_source_references <> 0 THEN
    RAISE EXCEPTION 'Profile merge left % unintended live references on the source record.',
      v_live_source_references;
  END IF;

  v_review_id := NULLIF(v_result ->> 'reviewId', '')::uuid;
  v_correlation_id := NULLIF(v_result ->> 'correlationId', '')::uuid;
  IF v_review_id IS NULL OR v_correlation_id IS NULL THEN
    RAISE EXCEPTION 'The profile merge did not return the evidence identifiers its reference record requires.';
  END IF;

  v_reference_rewrites := pg_catalog.jsonb_build_object(
    'priorMergeTombstones', v_prior_tombstones,
    'profileLinkCandidateArrays', v_candidate_arrays,
    'importRowLiveMatches', v_import_live_matches,
    'directInvitations', v_direct_invitations,
    'applicationCorrectionRequests', v_correction_requests,
    'communicationPreferences', v_preferences
  );
  v_retained_history := plugin_data.csf_profile_merge_reference_plan(
    p_organization_id,
    p_source_profile_id
  ) -> 'immutableHistoryRetentions';

  -- Provenance beside the approved review. Identifiers, states, timestamps,
  -- and counts only: no name, email, or other student attribute.
  UPDATE plugin_data.csf_profile_merge_reviews
  SET evidence = COALESCE(evidence, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'cohortConsolidation', v_consolidated,
          'profileReferencePlan', v_preview -> 'profileReferencePlan',
          'referenceRewriteCounts', v_reference_rewrites,
          'retainedHistoryAfterMerge', v_retained_history,
          'zeroLiveSourceReferences', true
        ),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The profile merge review that must carry reference evidence is missing.';
  END IF;

  -- Immutable audit, scoped to the merge correlation. This receipt proves the
  -- later-schema rewrite set and postcondition without altering the historical
  -- canonical merge audit referenced_row.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'profile.merge',
    'csf_profile_reference_rewrites',
    p_target_profile_id,
    pg_catalog.jsonb_build_object('sourceProfileId', p_source_profile_id),
    pg_catalog.jsonb_build_object(
      'targetProfileId', p_target_profile_id,
      'reviewId', v_review_id,
      'referenceRewriteCounts', v_reference_rewrites,
      'retainedHistory', v_retained_history,
      'zeroLiveSourceReferences', true
    ),
    v_correlation_id,
    'profile_merge_reference_rewrite',
    p_source_profile_id::text,
    'duplicate_profile_references_reconciled'
  );

  IF pg_catalog.jsonb_array_length(v_consolidated) > 0 THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      before_data,
      after_data,
      correlation_id,
      source_type,
      source_id,
      reason_code
    )
    SELECT
      p_organization_id,
      p_actor_user_id,
      'profile.merge',
      'csf_profile_cohort_memberships',
      (entry.payload ->> 'retainedMembershipId')::uuid,
      entry.payload -> 'before',
      (entry.payload -> 'after') || pg_catalog.jsonb_build_object(
        'cohortId', entry.payload -> 'cohortId',
        'removedMembershipId', entry.payload -> 'removedMembershipId',
        'sourceProfileId', p_source_profile_id,
        'targetProfileId', p_target_profile_id,
        'reviewId', v_review_id
      ),
      v_correlation_id,
      'profile_merge_cohort_consolidation',
      p_source_profile_id::text,
      'duplicate_profile_cohort_consolidated'
    FROM pg_catalog.jsonb_array_elements(v_consolidated) AS entry(payload);
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'movedRecords', COALESCE((v_result ->> 'movedRecords')::integer, 0)
      + v_prior_tombstones + v_candidate_arrays + v_import_live_matches
      + v_direct_invitations
      + v_correction_requests + v_preferences,
    'referenceRewriteCounts', v_reference_rewrites,
    'retainedHistory', v_retained_history,
    'zeroLiveSourceReferences', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles_account_order_base(p_organization_id uuid, p_source_profile_id uuid, p_target_profile_id uuid, p_reason text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_source plugin_data.csf_profiles%ROWTYPE;
  v_target plugin_data.csf_profiles%ROWTYPE;
  v_preview jsonb;
  v_review_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_moved_accounts integer := 0;
  v_moved_records integer := 0;
  v_moved_import_matches integer := 0;
  v_row_count integer := 0;
BEGIN
  IF p_source_profile_id = p_target_profile_id THEN
    RAISE EXCEPTION 'Choose two different CSF student records.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'Explain why these two CSF student records are duplicates.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id IN (p_source_profile_id, p_target_profile_id)
  ORDER BY profile.id
  FOR UPDATE;

  SELECT profile.* INTO v_source
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_source_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source CSF student record not found.'; END IF;

  SELECT profile.* INTO v_target
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_target_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target CSF student record not found.'; END IF;
  IF v_source.record_status <> 'active' THEN RAISE EXCEPTION 'The source CSF student record has already been merged.'; END IF;
  IF v_target.record_status <> 'active' THEN RAISE EXCEPTION 'The target CSF student record is not active.'; END IF;

  v_preview := plugin_data.csf_profile_merge_preview(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );
  IF coalesce((v_preview->>'canMerge')::boolean, false) = false THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These CSF student records have conflicts that must be resolved before merging.',
      DETAIL = (v_preview->'conflicts')::text,
      HINT = 'Review the duplicate semester, attendance, signup, class, or verified-account records.';
  END IF;

  INSERT INTO plugin_data.csf_profile_merge_reviews (
    id, organization_id, source_profile_id, target_profile_id, reason,
    evidence, status, requested_by, reviewed_by, reviewed_at, notes,
    correlation_id, source_snapshot, target_snapshot, conflict_snapshot,
    created_at, updated_at
  ) VALUES (
    v_review_id,
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    btrim(p_reason),
    jsonb_build_object('preview', v_preview),
    'approved',
    p_actor_user_id,
    p_actor_user_id,
    v_now,
    'Completed through the audited member correction workflow.',
    v_correlation_id,
    v_preview->'source',
    v_preview->'target',
    v_preview->'conflicts',
    v_now,
    v_now
  );

  -- Revoke duplicate source accounts before promoting the matching target.
  -- The data-modifying CTE preserves the source values while ensuring the
  -- partial verified-account unique index never observes two verified rows.
  WITH source_snapshot AS MATERIALIZED (
    SELECT
      source_account.id AS source_account_id,
      source_account.status AS source_status,
      source_account.is_primary AS source_is_primary,
      source_account.linked_by AS source_linked_by,
      source_account.linked_at AS source_linked_at,
      target_account.id AS target_account_id
    FROM plugin_data.csf_profile_accounts AS source_account
    JOIN plugin_data.csf_profile_accounts AS target_account
      ON target_account.organization_id = source_account.organization_id
     AND target_account.profile_id = p_target_profile_id
     AND target_account.user_id = source_account.user_id
    WHERE source_account.organization_id = p_organization_id
      AND source_account.profile_id = p_source_profile_id
    FOR UPDATE OF source_account, target_account
  ),
  revoked_source AS (
    UPDATE plugin_data.csf_profile_accounts AS source_account
    SET status = 'revoked',
        is_primary = false,
        revoked_at = v_now,
        notes = concat_ws(E'\n', nullif(source_account.notes, ''), 'Superseded by profile merge ' || v_correlation_id::text || '.')
    FROM source_snapshot
    WHERE source_account.id = source_snapshot.source_account_id
    RETURNING source_account.id
  )
  UPDATE plugin_data.csf_profile_accounts AS target_account
  SET status = CASE
        WHEN source_snapshot.source_status = 'verified' THEN 'verified'
        WHEN target_account.status = 'verified' THEN 'verified'
        WHEN source_snapshot.source_status = 'pending' THEN 'pending'
        ELSE target_account.status
      END,
      is_primary = CASE
        WHEN source_snapshot.source_status = 'verified'
          AND source_snapshot.source_is_primary THEN true
        ELSE target_account.is_primary
      END,
      linked_by = coalesce(target_account.linked_by, source_snapshot.source_linked_by),
      linked_at = least(target_account.linked_at, source_snapshot.source_linked_at),
      revoked_at = CASE
        WHEN source_snapshot.source_status = 'verified'
          OR target_account.status = 'verified' THEN NULL
        ELSE target_account.revoked_at
      END,
      notes = concat_ws(E'\n', nullif(target_account.notes, ''), 'Duplicate account row consolidated during profile merge ' || v_correlation_id::text || '.')
  FROM source_snapshot
  WHERE target_account.id = source_snapshot.target_account_id
    AND EXISTS (
      SELECT 1
      FROM revoked_source
      WHERE revoked_source.id = source_snapshot.source_account_id
    );

  UPDATE plugin_data.csf_profile_accounts
  SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id
    AND status <> 'revoked';
  GET DIAGNOSTICS v_moved_accounts = ROW_COUNT;

  UPDATE plugin_data.csf_term_applications SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_term_memberships SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_cohort_memberships SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_point_submissions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_credit_records SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_point_appeals SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_notes SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_submission_files SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_meeting_attendance SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_opportunity_signups SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_activity_events SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_profile_restrictions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_staff_positions SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_application_files SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_dues_records SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_sheet_import_rows AS import_row
  SET matched_profile_id = p_target_profile_id
  WHERE import_row.organization_id = p_organization_id
    AND import_row.matched_profile_id = p_source_profile_id
    AND plugin_data.csf_profile_merge_import_row_disposition(
      import_row.commit_frozen_at,
      import_row.commit_target_profile_id,
      import_row.matched_profile_id,
      import_row.commit_attempt_id,
      import_row.commit_retry_count,
      import_row.commit_outcome_state,
      import_row.import_status,
      import_row.commit_outcome_resolution
    ) = 'live_rewrite';
  GET DIAGNOSTICS v_moved_import_matches = ROW_COUNT;

  UPDATE plugin_data.csf_profile_link_requests
  SET matched_profile_id = CASE WHEN matched_profile_id = p_source_profile_id THEN p_target_profile_id ELSE matched_profile_id END,
      candidate_profile_ids = array_replace(candidate_profile_ids, p_source_profile_id, p_target_profile_id),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND (
      matched_profile_id = p_source_profile_id
      OR p_source_profile_id = ANY(candidate_profile_ids)
    );

  UPDATE plugin_data.csf_profile_merge_reviews
  SET status = 'cancelled',
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelled because the source profile was merged by review ' || v_review_id::text || '.'),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id <> v_review_id
    AND status = 'pending'
    AND (source_profile_id = p_source_profile_id OR target_profile_id = p_source_profile_id);

  UPDATE plugin_data.csf_profiles
  SET source_summary = coalesce(source_summary, '{}'::jsonb) || jsonb_build_object(
        'mergedProfiles',
        coalesce(source_summary->'mergedProfiles', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'profileId', v_source.id,
          'mergedAt', v_now,
          'correlationId', v_correlation_id,
          'sourceSummary', v_source.source_summary
        ))
      ),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_target_profile_id;

  UPDATE plugin_data.csf_profiles
  SET record_status = 'merged',
      merged_into_profile_id = p_target_profile_id,
      merged_at = v_now,
      merged_by = p_actor_user_id,
      merge_reason = btrim(p_reason),
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_source_profile_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'profile.merge',
    'csf_profiles',
    p_target_profile_id,
    jsonb_build_object(
      'targetProfileId', p_target_profile_id,
      'targetRecordStatus', v_target.record_status
    ),
    jsonb_build_object(
      'sourceProfileId', p_source_profile_id,
      'targetProfileId', p_target_profile_id,
      'reasonRecorded', true,
      'reviewId', v_review_id,
      'movedAccounts', v_moved_accounts,
      'movedRecords', v_moved_records,
      'sourceProvenancePreserved', true
    ),
    v_correlation_id,
    'duplicate_profile_merged'
  );

  RETURN jsonb_build_object(
    'sourceProfileId', p_source_profile_id,
    'targetProfileId', p_target_profile_id,
    'reviewId', v_review_id,
    'movedAccounts', v_moved_accounts,
    'movedRecords', v_moved_records,
    'importRowLiveMatches', v_moved_import_matches,
    'correlationId', v_correlation_id
  );
END;
$function$;

ALTER FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION plugin_data.csf_merge_profiles_account_order_base(uuid, uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_account_order_base(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles_account_order_base(uuid, uuid, uuid, text, uuid) TO postgres;

COMMIT;
