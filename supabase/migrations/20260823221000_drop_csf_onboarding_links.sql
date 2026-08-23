-- The reusable onboarding-link and student-specific direct-invitation systems
-- are retired: permanent class join codes (csf_class_join_codes +
-- csf_join_class_by_code) are the only student onboarding path, and officer
-- review of ambiguous joins moves into each class's Members tab, reading
-- csf_profile_link_requests by cohort. This drops the csf_onboarding_links
-- table, every RPC that wrote to it or served the claim flow built on it, and
-- the link-request column that pointed at it, then recreates the two profile
-- merge functions without their onboarding-link reference arms.
-- csf_resolve_profile_link_request survives unchanged: it powers the
-- relocated review queue. Historical csf_admin_audit_events rows that
-- reference onboarding links remain as immutable audit history (see
-- docs/development/cleanup-register.md).

-- 0. The public "Apply with Google Forms" call to action was the one real
-- feature riding on onboarding links. It moves to the term row, which already
-- owns the application window and every eligibility input the public
-- projection reads. Backfill BEFORE the table drops. The CHECK mirrors the
-- TypeScript normalizer's host allowlist so a non-Forms URL can never be
-- stored, and the renderer still re-normalizes on the way out.
ALTER TABLE plugin_data.csf_terms
  ADD COLUMN application_form_url text
  CONSTRAINT csf_terms_application_form_url_check CHECK (
    application_form_url IS NULL
    OR (
      char_length(application_form_url) <= 2048
      AND (
        application_form_url ~ '^https://docs\.google\.com/forms/'
        OR application_form_url ~ '^https://forms\.gle/.'
      )
    )
  );

COMMENT ON COLUMN plugin_data.csf_terms.application_form_url IS
  'Google Forms application URL for this semester. The only public application call to action; render-side normalization re-validates host and path.';

UPDATE plugin_data.csf_terms AS term
SET application_form_url = source.google_form_url
FROM (
  SELECT DISTINCT ON (link.organization_id, link.term_id)
    link.organization_id, link.term_id, link.google_form_url
  FROM plugin_data.csf_onboarding_links AS link
  WHERE link.is_active = true
    AND link.invitation_scope = 'cohort'
    AND link.link_type IN ('application_google_form', 'combined')
    AND (
      link.google_form_url ~ '^https://docs\.google\.com/forms/'
      OR link.google_form_url ~ '^https://forms\.gle/.'
    )
  ORDER BY link.organization_id, link.term_id, link.created_at DESC
) AS source
WHERE term.id = source.term_id
  AND term.organization_id = source.organization_id
  AND term.application_form_url IS NULL;

-- 1. The claim/submit flow built on onboarding links. Wrappers first, then the
-- renamed *_base / *_identity_base implementations they delegated to.
DROP FUNCTION IF EXISTS plugin_data.csf_mutate_onboarding_link(
  uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS plugin_data.csf_create_direct_invitation(
  uuid, uuid, uuid, text, text, integer, text, uuid, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_create_direct_invitation(
  uuid, uuid, uuid, text, text, timestamptz, text, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_create_direct_invitation_engine(
  uuid, uuid, uuid, text, text, timestamptz, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_update_direct_invitation(
  uuid, uuid, text, text, integer, uuid, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_update_direct_invitation(
  uuid, uuid, text, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_update_direct_invitation_engine(
  uuid, uuid, text, text, timestamptz, text, uuid, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_accept_direct_invitation(
  uuid, text, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_accept_direct_invitation_base(
  uuid, text, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_submit_profile_link_request(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text);
DROP FUNCTION IF EXISTS plugin_data.csf_submit_profile_link_request_identity_base(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text);
DROP FUNCTION IF EXISTS plugin_data.csf_profile_claim_candidate(
  uuid, text, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_confirm_profile_claim(
  uuid, text, uuid, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_confirm_profile_claim_identity_base(
  uuid, text, uuid, uuid, text);
DROP FUNCTION IF EXISTS plugin_data.csf_decline_profile_claim(
  uuid, text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS plugin_data.csf_decline_profile_claim_identity_base(
  uuid, text, uuid, uuid, text, text);

-- Fail loud if any overload of the dropped families survived: a signature this
-- migration missed would keep a write path to a table that no longer exists.
DO $$
DECLARE
  v_survivor text;
BEGIN
  SELECT string_agg(proc.proname || '(' || pg_get_function_identity_arguments(proc.oid) || ')', ', ')
  INTO v_survivor
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'plugin_data'
    AND (
      proc.proname LIKE '%onboarding_link%'
      OR proc.proname LIKE '%direct_invitation%'
      OR proc.proname LIKE 'csf_submit_profile_link_request%'
      OR proc.proname IN (
        'csf_profile_claim_candidate',
        'csf_confirm_profile_claim',
        'csf_confirm_profile_claim_identity_base',
        'csf_decline_profile_claim',
        'csf_decline_profile_claim_identity_base'
      )
    );
  IF v_survivor IS NOT NULL THEN
    RAISE EXCEPTION 'Onboarding-link teardown left function(s) behind: %', v_survivor;
  END IF;
END;
$$;

-- 2. Settle link requests that could only be resumed through the dropped
-- submission flow. Requests created by csf_join_class_by_code carry
-- class_join_code_id and keep their officer review path.
UPDATE plugin_data.csf_profile_link_requests
SET match_status = 'rejected',
    resolution_notes = 'Closed by migration: the onboarding-link submission flow this request arrived through was removed. Students join with their class code instead.',
    resolved_at = now(),
    updated_at = now()
WHERE match_status IN ('pending', 'needs_review')
  AND class_join_code_id IS NULL;

-- 3. The pointer column (both its foundation FK and the composite
-- tenant-scoped FK from 20260721071359 go with it), then the table.
ALTER TABLE plugin_data.csf_profile_link_requests
  DROP COLUMN onboarding_link_id;
DROP TABLE plugin_data.csf_onboarding_links;

-- 4. The per-class review queue reads pending work cohort-first.
CREATE INDEX csf_profile_link_requests_cohort_review_idx
  ON plugin_data.csf_profile_link_requests
    (organization_id, cohort_id, match_status, created_at DESC)
  WHERE match_status IN ('pending', 'needs_review');

-- 5. csf_profile_merge_reference_plan: onboarding-link reference arm removed.
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

-- 6. csf_merge_profiles: onboarding-link rewrite, count arm, and evidence key removed.
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
  -- move them in this same transaction without changing correction or
  -- consent state.
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
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_application_correction_requests AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_communication_broadcast_preferences AS referenced_row
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
      + v_correction_requests + v_preferences,
    'referenceRewriteCounts', v_reference_rewrites,
    'retainedHistory', v_retained_history,
    'zeroLiveSourceReferences', true
  );
END;
$$;


-- Restate the reviewed ACL posture for the recreated functions
-- (20260818180000): the request-aware wrapper is the only service-role entry
-- point to a merge, so the 5-arg merge and the reference plan stay
-- postgres-only.
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  TO postgres;
