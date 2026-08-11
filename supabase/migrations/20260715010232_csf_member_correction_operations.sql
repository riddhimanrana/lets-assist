-- Add auditable officer corrections for an incorrect account connection and
-- duplicate CSF student identities. Merged source rows remain as provenance
-- records while all non-conflicting operational history moves to the chosen
-- canonical profile in one transaction.

BEGIN;

ALTER TABLE plugin_data.csf_profiles
  ADD COLUMN record_status text NOT NULL DEFAULT 'active'
    CHECK (record_status IN ('active', 'merged')),
  ADD COLUMN merged_into_profile_id uuid,
  ADD COLUMN merged_at timestamptz,
  ADD COLUMN merged_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN merge_reason text;

ALTER TABLE plugin_data.csf_profiles
  ADD CONSTRAINT csf_profiles_merged_into_organization_fkey
    FOREIGN KEY (merged_into_profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE RESTRICT,
  ADD CONSTRAINT csf_profiles_merge_state_check CHECK (
    (
      record_status = 'active'
      AND merged_into_profile_id IS NULL
      AND merged_at IS NULL
      AND merged_by IS NULL
      AND merge_reason IS NULL
    )
    OR
    (
      record_status = 'merged'
      AND merged_into_profile_id IS NOT NULL
      AND merged_into_profile_id <> id
      AND merged_at IS NOT NULL
      AND merged_by IS NOT NULL
      AND nullif(btrim(merge_reason), '') IS NOT NULL
    )
  );

CREATE INDEX csf_profiles_org_record_status_idx
  ON plugin_data.csf_profiles (organization_id, record_status, merged_into_profile_id);

ALTER TABLE plugin_data.csf_profile_accounts
  ADD CONSTRAINT csf_profile_accounts_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE;

UPDATE plugin_data.csf_profile_merge_reviews
SET reason = 'Legacy merge review: no reason was captured.'
WHERE nullif(btrim(reason), '') IS NULL;

ALTER TABLE plugin_data.csf_profile_merge_reviews
  ALTER COLUMN reason SET NOT NULL,
  ADD COLUMN correlation_id uuid,
  ADD COLUMN source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
  ADD COLUMN target_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(target_snapshot) = 'object'),
  ADD COLUMN conflict_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(conflict_snapshot) = 'array');

ALTER TABLE plugin_data.csf_profile_merge_reviews
  ADD CONSTRAINT csf_profile_merge_reviews_source_organization_fkey
    FOREIGN KEY (source_profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_profile_merge_reviews_target_organization_fkey
    FOREIGN KEY (target_profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE;

CREATE UNIQUE INDEX csf_profile_merge_reviews_correlation_idx
  ON plugin_data.csf_profile_merge_reviews (correlation_id)
  WHERE correlation_id IS NOT NULL;

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
  v_source plugin_data.csf_profiles%ROWTYPE;
  v_target plugin_data.csf_profiles%ROWTYPE;
  v_conflicts jsonb := '[]'::jsonb;
  v_items jsonb;
  v_source_counts jsonb;
  v_target_counts jsonb;
BEGIN
  IF p_source_profile_id = p_target_profile_id THEN
    RAISE EXCEPTION 'Choose two different CSF student records.';
  END IF;

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

  IF v_source.record_status <> 'active' THEN
    RAISE EXCEPTION 'The source CSF student record has already been merged.';
  END IF;
  IF v_target.record_status <> 'active' THEN
    RAISE EXCEPTION 'The target CSF student record is not active.';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'term_application',
    'termId', source_row.term_id,
    'sourceId', source_row.id,
    'targetId', target_row.id,
    'label', 'Both records have an application for the same semester.'
  )), '[]'::jsonb)
  INTO v_items
  FROM plugin_data.csf_term_applications AS source_row
  JOIN plugin_data.csf_term_applications AS target_row
    ON target_row.organization_id = source_row.organization_id
    AND target_row.term_id = source_row.term_id
    AND target_row.profile_id = p_target_profile_id
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id;
  v_conflicts := v_conflicts || v_items;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'term_membership',
    'termId', source_row.term_id,
    'sourceId', source_row.id,
    'targetId', target_row.id,
    'label', 'Both records have a membership outcome for the same semester.'
  )), '[]'::jsonb)
  INTO v_items
  FROM plugin_data.csf_term_memberships AS source_row
  JOIN plugin_data.csf_term_memberships AS target_row
    ON target_row.organization_id = source_row.organization_id
    AND target_row.term_id = source_row.term_id
    AND target_row.profile_id = p_target_profile_id
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id;
  v_conflicts := v_conflicts || v_items;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'class_membership',
    'cohortId', source_row.cohort_id,
    'sourceId', source_row.id,
    'targetId', target_row.id,
    'label', 'Both records belong to the same graduating class.'
  )), '[]'::jsonb)
  INTO v_items
  FROM plugin_data.csf_profile_cohort_memberships AS source_row
  JOIN plugin_data.csf_profile_cohort_memberships AS target_row
    ON target_row.organization_id = source_row.organization_id
    AND target_row.cohort_id = source_row.cohort_id
    AND target_row.profile_id = p_target_profile_id
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id;
  v_conflicts := v_conflicts || v_items;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'meeting_attendance',
    'termId', source_row.term_id,
    'meetingKey', source_row.meeting_key,
    'sourceId', source_row.id,
    'targetId', target_row.id,
    'label', 'Both records have attendance for the same meeting.'
  )), '[]'::jsonb)
  INTO v_items
  FROM plugin_data.csf_meeting_attendance AS source_row
  JOIN plugin_data.csf_meeting_attendance AS target_row
    ON target_row.organization_id = source_row.organization_id
    AND target_row.term_id = source_row.term_id
    AND target_row.meeting_key = source_row.meeting_key
    AND target_row.profile_id = p_target_profile_id
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id;
  v_conflicts := v_conflicts || v_items;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'activity_signup',
    'opportunityId', source_row.opportunity_id,
    'sourceId', source_row.id,
    'targetId', target_row.id,
    'label', 'Both records are signed up for the same activity.'
  )), '[]'::jsonb)
  INTO v_items
  FROM plugin_data.csf_opportunity_signups AS source_row
  JOIN plugin_data.csf_opportunity_signups AS target_row
    ON target_row.organization_id = source_row.organization_id
    AND target_row.opportunity_id = source_row.opportunity_id
    AND target_row.profile_id = p_target_profile_id
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id;
  v_conflicts := v_conflicts || v_items;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'verified_account',
    'sourceAccountId', source_account.id,
    'sourceUserId', source_account.user_id,
    'targetAccountId', target_account.id,
    'targetUserId', target_account.user_id,
    'label', 'The records are connected to different verified Let''s Assist accounts.'
  )), '[]'::jsonb)
  INTO v_items
  FROM plugin_data.csf_profile_accounts AS source_account
  JOIN plugin_data.csf_profile_accounts AS target_account
    ON target_account.organization_id = source_account.organization_id
    AND target_account.profile_id = p_target_profile_id
    AND target_account.status = 'verified'
    AND target_account.user_id <> source_account.user_id
  WHERE source_account.organization_id = p_organization_id
    AND source_account.profile_id = p_source_profile_id
    AND source_account.status = 'verified';
  v_conflicts := v_conflicts || v_items;

  SELECT jsonb_build_object(
    'accounts', (SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id),
    'applications', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id),
    'memberships', (SELECT count(*) FROM plugin_data.csf_term_memberships WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id),
    'credits', (SELECT count(*) FROM plugin_data.csf_credit_records WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id),
    'pointSubmissions', (SELECT count(*) FROM plugin_data.csf_point_submissions WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id),
    'meetingAttendance', (SELECT count(*) FROM plugin_data.csf_meeting_attendance WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id),
    'activitySignups', (SELECT count(*) FROM plugin_data.csf_opportunity_signups WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id)
  ) INTO v_source_counts;

  SELECT jsonb_build_object(
    'accounts', (SELECT count(*) FROM plugin_data.csf_profile_accounts WHERE organization_id = p_organization_id AND profile_id = p_target_profile_id),
    'applications', (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND profile_id = p_target_profile_id),
    'memberships', (SELECT count(*) FROM plugin_data.csf_term_memberships WHERE organization_id = p_organization_id AND profile_id = p_target_profile_id),
    'credits', (SELECT count(*) FROM plugin_data.csf_credit_records WHERE organization_id = p_organization_id AND profile_id = p_target_profile_id),
    'pointSubmissions', (SELECT count(*) FROM plugin_data.csf_point_submissions WHERE organization_id = p_organization_id AND profile_id = p_target_profile_id),
    'meetingAttendance', (SELECT count(*) FROM plugin_data.csf_meeting_attendance WHERE organization_id = p_organization_id AND profile_id = p_target_profile_id),
    'activitySignups', (SELECT count(*) FROM plugin_data.csf_opportunity_signups WHERE organization_id = p_organization_id AND profile_id = p_target_profile_id)
  ) INTO v_target_counts;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'source', jsonb_build_object(
      'id', v_source.id,
      'firstName', v_source.first_name,
      'middleName', v_source.middle_name,
      'lastName', v_source.last_name,
      'preferredName', v_source.preferred_name,
      'schoolEmail', v_source.school_email,
      'personalEmail', v_source.personal_email,
      'sourceSummary', v_source.source_summary,
      'counts', v_source_counts
    ),
    'target', jsonb_build_object(
      'id', v_target.id,
      'firstName', v_target.first_name,
      'middleName', v_target.middle_name,
      'lastName', v_target.last_name,
      'preferredName', v_target.preferred_name,
      'schoolEmail', v_target.school_email,
      'personalEmail', v_target.personal_email,
      'sourceSummary', v_target.source_summary,
      'counts', v_target_counts
    ),
    'conflicts', v_conflicts,
    'canMerge', jsonb_array_length(v_conflicts) = 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_unlink_profile_account(
  p_organization_id uuid,
  p_profile_id uuid,
  p_account_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_profile_accounts%ROWTYPE;
  v_after plugin_data.csf_profile_accounts%ROWTYPE;
  v_now timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'Explain why this Let''s Assist account connection is incorrect.';
  END IF;

  PERFORM 1
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active CSF student record not found.'; END IF;

  SELECT account.* INTO v_before
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.profile_id = p_profile_id
    AND account.id = p_account_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Let''s Assist account connection not found.'; END IF;
  IF v_before.status <> 'verified' THEN
    RAISE EXCEPTION 'Only a verified account connection can be unlinked here.';
  END IF;

  UPDATE plugin_data.csf_profile_accounts
  SET status = 'revoked',
      is_primary = false,
      revoked_at = v_now,
      notes = concat_ws(E'\n', nullif(notes, ''), 'Unlinked by a CSF officer: ' || btrim(p_reason))
  WHERE id = p_account_id
    AND organization_id = p_organization_id
  RETURNING * INTO v_after;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'profile.account_unlinked',
    'csf_profile_accounts',
    p_account_id,
    jsonb_build_object(
      'profileId', v_before.profile_id,
      'userId', v_before.user_id,
      'status', v_before.status,
      'isPrimary', v_before.is_primary
    ),
    jsonb_build_object(
      'profileId', v_after.profile_id,
      'userId', v_after.user_id,
      'status', v_after.status,
      'isPrimary', v_after.is_primary,
      'reason', btrim(p_reason)
    ),
    v_correlation_id,
    'incorrect_account_unlinked'
  );

  RETURN jsonb_build_object(
    'profileId', p_profile_id,
    'accountId', p_account_id,
    'status', v_after.status,
    'correlationId', v_correlation_id
  );
END;
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
  v_source plugin_data.csf_profiles%ROWTYPE;
  v_target plugin_data.csf_profiles%ROWTYPE;
  v_preview jsonb;
  v_review_id uuid := gen_random_uuid();
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_moved_accounts integer := 0;
  v_moved_records integer := 0;
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

  -- Collapse duplicate account rows for the same user into the target row,
  -- retaining the source row as revoked evidence rather than deleting it.
  UPDATE plugin_data.csf_profile_accounts AS target_account
  SET status = CASE
        WHEN source_account.status = 'verified' THEN 'verified'
        WHEN target_account.status = 'verified' THEN 'verified'
        WHEN source_account.status = 'pending' THEN 'pending'
        ELSE target_account.status
      END,
      is_primary = CASE
        WHEN source_account.status = 'verified' AND source_account.is_primary THEN true
        ELSE target_account.is_primary
      END,
      linked_by = coalesce(target_account.linked_by, source_account.linked_by),
      linked_at = least(target_account.linked_at, source_account.linked_at),
      revoked_at = CASE
        WHEN source_account.status = 'verified' OR target_account.status = 'verified' THEN NULL
        ELSE target_account.revoked_at
      END,
      notes = concat_ws(E'\n', nullif(target_account.notes, ''), 'Duplicate account row consolidated during profile merge ' || v_correlation_id::text || '.')
  FROM plugin_data.csf_profile_accounts AS source_account
  WHERE source_account.organization_id = p_organization_id
    AND source_account.profile_id = p_source_profile_id
    AND target_account.organization_id = p_organization_id
    AND target_account.profile_id = p_target_profile_id
    AND target_account.user_id = source_account.user_id;

  UPDATE plugin_data.csf_profile_accounts AS source_account
  SET status = 'revoked',
      is_primary = false,
      revoked_at = v_now,
      notes = concat_ws(E'\n', nullif(source_account.notes, ''), 'Superseded by profile merge ' || v_correlation_id::text || '.')
  WHERE source_account.organization_id = p_organization_id
    AND source_account.profile_id = p_source_profile_id
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS target_account
      WHERE target_account.organization_id = p_organization_id
        AND target_account.profile_id = p_target_profile_id
        AND target_account.user_id = source_account.user_id
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

  UPDATE plugin_data.csf_submission_files SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_meeting_attendance SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_opportunity_signups SET profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND profile_id = p_source_profile_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT; v_moved_records := v_moved_records + v_row_count;

  UPDATE plugin_data.csf_partner_submission_rows SET profile_id = p_target_profile_id
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

  UPDATE plugin_data.csf_sheet_import_rows SET matched_profile_id = p_target_profile_id
  WHERE organization_id = p_organization_id AND matched_profile_id = p_source_profile_id;

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
    v_preview->'target',
    jsonb_build_object(
      'sourceProfileId', p_source_profile_id,
      'targetProfileId', p_target_profile_id,
      'reason', btrim(p_reason),
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
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_unlink_profile_account(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_unlink_profile_account(uuid, uuid, uuid, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  TO service_role;

COMMENT ON COLUMN plugin_data.csf_profiles.record_status IS
  'Active rows appear in the directory; merged rows remain hidden provenance records pointing to the canonical profile.';
COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Returns source/target identity, record counts, and conflicts from the same rules enforced by the atomic merge.';
COMMENT ON FUNCTION plugin_data.csf_unlink_profile_account(uuid, uuid, uuid, text, uuid) IS
  'Revokes one incorrect verified account connection with a required reason and correlated immutable audit event.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) IS
  'Atomically moves a conflict-free duplicate profile into its canonical target while preserving the source row, review evidence, and immutable audit history.';

COMMIT;
