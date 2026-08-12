-- Merging a genuine duplicate student record was unreachable for the ordinary
-- case, because two rules were jointly exhaustive once both records carried a
-- graduating class:
--
--   * the historical relationship preview treats ANY shared cohort membership
--     row as a conflict, at any status, because the base merge moves the source
--     rows with a bare UPDATE that would violate UNIQUE (profile_id, cohort_id);
--   * `active_cohort_mismatch` (20260809212049) blocks the disjoint case.
--
-- So a pair could never merge while both held a class row, and nothing in the
-- product deletes a membership: `csf_upsert_profile` only marks superseded rows
-- 'transferred'. Officers were left with a dialog that could not complete.
--
-- The overlap is not real evidence against identity -- two records for one
-- student in one class is the single most likely duplicate. It is a write
-- ordering problem. This migration consolidates the exact duplicate rows inside
-- the same locked transaction, before the historical base moves the remainder,
-- and only then lets the merge proceed.
--
-- Nothing here weakens identity safety. `active_cohort_mismatch` is preserved
-- exactly, and a stronger union rule is added beside it: after consolidation
-- the merged record may be active in at most one graduating class. That union
-- is invariant across consolidation, so the preview and the base's own
-- re-check can never disagree. The gate runs BEFORE
-- consolidation on purpose: consolidation deletes the shared source rows, which
-- would otherwise hide a genuine disjoint active class from the base's own
-- re-check. Any blocker still aborts the whole transaction, consolidation
-- included.

BEGIN;

-- The original atomic profile writer and direct-invitation operations already
-- use this organization-scoped key. Keep that deployed key stable and make it
-- the first lock in every identity mutation that can race a merge. The helper
-- is owner-internal so callers cannot manufacture lock contention directly.
CREATE OR REPLACE FUNCTION plugin_data.csf_lock_identity_mutation(
  p_organization_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_upsert_profile:' || p_organization_id::text,
      0
    )
  )
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_lock_identity_mutation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_lock_identity_mutation(uuid) IS
  'Owner-internal first lock for organization-scoped CSF identity mutations. Uses the legacy-stable atomic-profile-write key so profile writes, invitation acceptance, merge, import, claim, and connection operations share one hierarchy.';

-- This is the complete current-schema inventory of references to a CSF
-- profile. Every reference is deliberately classified as an atomic rewrite,
-- immutable historical retention, or an execution blocker. Counts are scoped
-- to the reviewed source record and contain no student attributes.
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
        'scope', 'mutable reconciliation result only',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.matched_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_partner_submission_rows.profile_id',
        'scope', 'all normalized partner-submission ownership rows',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_partner_submission_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id)
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
        'reference', 'plugin_data.csf_partner_club_representatives.profile_id',
        'scope', 'status is invited or active',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_partner_club_representatives AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
            AND referenced_row.status IN ('invited', 'active'))
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
        'reference', 'plugin_data.csf_sheet_import_rows.commit_target_profile_id',
        'scope', 'frozen reviewed import-commit target',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_sheet_import_rows AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.commit_target_profile_id = p_source_profile_id)
      ),
      pg_catalog.jsonb_build_object(
        'reference', 'plugin_data.csf_partner_club_representatives.profile_id',
        'scope', 'status is revoked or expired; terminal representative history',
        'sourceCount', (SELECT pg_catalog.count(*) FROM plugin_data.csf_partner_club_representatives AS referenced_row
          WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
            AND referenced_row.status IN ('revoked', 'expired'))
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
      'open_point_appeal_unique_key'
    )
  )
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_merge_reference_plan(uuid, uuid) IS
  'Owner-internal complete current-schema CSF profile-reference catalog. Classifies atomic rewrites, deliberate immutable-history retention, and canonical preflight blockers with organization-scoped non-PII counts.';

-- ---------------------------------------------------------------------------
-- Canonical preview
-- ---------------------------------------------------------------------------

ALTER FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  RENAME TO csf_profile_merge_preview_identity_base;

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
  v_retained jsonb;
  v_shared_cohorts uuid[];
  v_shared_cohort_texts text[];
  v_post_merge_active_cohorts bigint;
  v_active_cohort_union_conflict boolean;
  v_base_active_cohort_conflict boolean;
  v_point_conflicts jsonb;
  v_staff_conflicts jsonb;
  v_appeal_conflicts jsonb;
  v_reference_plan jsonb;
BEGIN
  v_preview := plugin_data.csf_profile_merge_preview_identity_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id
  );

  -- Fail closed on a malformed projection instead of inferring readiness from
  -- an absent conflict list.
  IF v_preview IS NULL OR pg_catalog.jsonb_typeof(v_preview) <> 'object' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return a canonical object.';
  END IF;
  v_conflicts := v_preview -> 'conflicts';
  IF pg_catalog.jsonb_typeof(v_conflicts) <> 'array' THEN
    RAISE EXCEPTION 'The CSF merge preview did not return canonical conflicts.';
  END IF;

  -- Cohorts both records hold a row in, at any status. These are exactly the
  -- rows the merge transaction consolidates, and the exact set the historical
  -- `class_membership` conflict is built from.
  SELECT
    pg_catalog.array_agg(source_row.cohort_id ORDER BY source_row.cohort_id),
    pg_catalog.array_agg(source_row.cohort_id::text ORDER BY source_row.cohort_id)
  INTO v_shared_cohorts, v_shared_cohort_texts
  FROM plugin_data.csf_profile_cohort_memberships AS source_row
  JOIN plugin_data.csf_profile_cohort_memberships AS target_row
    ON target_row.organization_id = source_row.organization_id
   AND target_row.cohort_id = source_row.cohort_id
   AND target_row.profile_id = p_target_profile_id
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id;
  v_shared_cohorts := COALESCE(v_shared_cohorts, ARRAY[]::uuid[]);
  v_shared_cohort_texts := COALESCE(v_shared_cohort_texts, ARRAY[]::text[]);

  -- Consolidation keeps a shared class active whenever EITHER record held it
  -- active, and touches no unshared row, so the set of active classes across
  -- the pair is invariant across consolidation. The canonical rule is
  -- therefore the union itself: a merged student record may end up active in
  -- at most one graduating class.
  --
  -- Checking the union rather than "does the source keep a class the target
  -- lacks" is what catches the asymmetric case -- source active in A while the
  -- target is active in BOTH A and B -- where a shared active class makes the
  -- pre-existing pairwise conflict false and consolidation removes nothing
  -- from the target. count(DISTINCT ...) is never NULL, so this is closed by
  -- construction.
  SELECT pg_catalog.count(DISTINCT membership.cohort_id)
  INTO v_post_merge_active_cohorts
  FROM plugin_data.csf_profile_cohort_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id IN (p_source_profile_id, p_target_profile_id)
    AND membership.status = 'active';
  v_post_merge_active_cohorts := COALESCE(v_post_merge_active_cohorts, 0);
  v_active_cohort_union_conflict := v_post_merge_active_cohorts > 1;

  -- Drop ONLY a `class_membership` conflict whose cohort is provably in the
  -- consolidation plan. Anything unrecognized is retained, so a malformed or
  -- future conflict shape can never be filtered into readiness.
  SELECT COALESCE(
    pg_catalog.jsonb_agg(entry.conflict ORDER BY entry.ordinal),
    '[]'::jsonb
  )
  INTO v_retained
  FROM pg_catalog.jsonb_array_elements(v_conflicts)
    WITH ORDINALITY AS entry(conflict, ordinal)
  WHERE NOT (
    COALESCE(entry.conflict ->> 'type', '') = 'class_membership'
    AND entry.conflict ->> 'cohortId' IS NOT NULL
    AND entry.conflict ->> 'cohortId' = ANY (v_shared_cohort_texts)
  );

  v_base_active_cohort_conflict := COALESCE(
    (v_preview -> 'identityEvidence' ->> 'activeCohortConflict')::boolean,
    false
  );
  IF v_active_cohort_union_conflict AND NOT v_base_active_cohort_conflict THEN
    v_retained := v_retained || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'type', 'active_cohort_mismatch',
        'label', 'Merging these records would leave one student active in more than one graduating class.'
      )
    );
  END IF;

  -- This is the exact predicate of the partial unique index that owns an
  -- active points claim. Rejected, duplicate, and withdrawn rows are outside
  -- that index and can be rewritten safely; every other status collides when
  -- both records claim the same non-null opportunity in the same semester.
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'type', 'active_point_submission_collision',
        'label', 'Both records hold an active points claim for the same opportunity and semester.',
        'termId', source_row.term_id,
        'opportunityId', source_row.opportunity_id,
        'sourceSubmissionId', source_row.id,
        'sourceStatus', source_row.status,
        'targetSubmissionId', target_row.id,
        'targetStatus', target_row.status
      ) ORDER BY source_row.term_id, source_row.opportunity_id,
        source_row.id, target_row.id
    ),
    '[]'::jsonb
  )
  INTO v_point_conflicts
  FROM plugin_data.csf_point_submissions AS source_row
  JOIN plugin_data.csf_point_submissions AS target_row
    ON target_row.organization_id = source_row.organization_id
   AND target_row.profile_id = p_target_profile_id
   AND target_row.term_id = source_row.term_id
   AND target_row.opportunity_id = source_row.opportunity_id
   AND target_row.status NOT IN ('rejected', 'duplicate', 'withdrawn')
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id
    AND source_row.opportunity_id IS NOT NULL
    AND source_row.status NOT IN ('rejected', 'duplicate', 'withdrawn');
  v_retained := v_retained || v_point_conflicts;

  -- These are the two other partial unique indexes whose keys include the
  -- rewritten profile identifier. Inactive/ended staff positions and decided
  -- appeals are outside their predicates and remain movable evidence.
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'type', 'active_staff_assignment_collision',
        'label', 'Both records hold the same active staff assignment for the same school year.',
        'roleId', source_row.role_id,
        'schoolYear', source_row.school_year,
        'sourcePositionId', source_row.id,
        'targetPositionId', target_row.id
      ) ORDER BY source_row.school_year, source_row.role_id,
        source_row.id, target_row.id
    ),
    '[]'::jsonb
  )
  INTO v_staff_conflicts
  FROM plugin_data.csf_staff_positions AS source_row
  JOIN plugin_data.csf_staff_positions AS target_row
    ON target_row.organization_id = source_row.organization_id
   AND target_row.profile_id = p_target_profile_id
   AND target_row.role_id = source_row.role_id
   AND target_row.school_year = source_row.school_year
   AND target_row.status = 'active'
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id
    AND source_row.status = 'active';
  v_retained := v_retained || v_staff_conflicts;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'type', 'open_point_appeal_collision',
        'label', 'Both records hold an open appeal for the same point submission.',
        'submissionId', source_row.submission_id,
        'sourceAppealId', source_row.id,
        'sourceStatus', source_row.status,
        'targetAppealId', target_row.id,
        'targetStatus', target_row.status
      ) ORDER BY source_row.submission_id, source_row.id, target_row.id
    ),
    '[]'::jsonb
  )
  INTO v_appeal_conflicts
  FROM plugin_data.csf_point_appeals AS source_row
  JOIN plugin_data.csf_point_appeals AS target_row
    ON target_row.organization_id = source_row.organization_id
   AND target_row.profile_id = p_target_profile_id
   AND target_row.submission_id = source_row.submission_id
   AND target_row.status IN ('submitted', 'under_review')
  WHERE source_row.organization_id = p_organization_id
    AND source_row.profile_id = p_source_profile_id
    AND source_row.submission_id IS NOT NULL
    AND source_row.status IN ('submitted', 'under_review');
  v_retained := v_retained || v_appeal_conflicts;

  v_reference_plan := plugin_data.csf_profile_merge_reference_plan(
    p_organization_id,
    p_source_profile_id
  );

  -- The UI derives both its evidence copy and identity-confidence label from
  -- this canonical field. Keep it aligned with the stronger union rule so a
  -- refused asymmetric merge never renders a contradictory green signal.
  v_preview := pg_catalog.jsonb_set(
    v_preview,
    '{identityEvidence,activeCohortConflict}',
    pg_catalog.to_jsonb(
      v_base_active_cohort_conflict OR v_active_cohort_union_conflict
    ),
    true
  );

  RETURN v_preview || pg_catalog.jsonb_build_object(
    'conflicts', v_retained,
    'canMerge', pg_catalog.jsonb_array_length(v_retained) = 0,
    'cohortConsolidation', pg_catalog.jsonb_build_object(
      'plannedCohortIds', pg_catalog.to_jsonb(v_shared_cohorts),
      'plannedCount', pg_catalog.cardinality(v_shared_cohorts),
      'postMergeActiveCohortCount', v_post_merge_active_cohorts,
      'activeCohortUnionConflict', v_active_cohort_union_conflict
    ),
    'profileReferencePlan', v_reference_plan
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Locked owner-internal merge implementation
-- ---------------------------------------------------------------------------

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
  v_live_representatives integer := 0;
  v_preferences integer := 0;
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
      HINT = 'Review the duplicate semester, attendance, signup, class, point claim, appeal, staff assignment, or verified-account records.';
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

  UPDATE plugin_data.csf_partner_club_representatives
  SET profile_id = p_target_profile_id,
      updated_at = v_now
  WHERE organization_id = p_organization_id
    AND profile_id = p_source_profile_id
    AND status IN ('invited', 'active');
  GET DIAGNOSTICS v_live_representatives = ROW_COUNT;

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
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.matched_profile_id = p_source_profile_id
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_partner_submission_rows AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
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
    UNION ALL SELECT pg_catalog.count(*) FROM plugin_data.csf_partner_club_representatives AS referenced_row
      WHERE referenced_row.organization_id = p_organization_id AND referenced_row.profile_id = p_source_profile_id
        AND referenced_row.status IN ('invited', 'active')
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
    'directInvitations', v_direct_invitations,
    'applicationCorrectionRequests', v_correction_requests,
    'livePartnerRepresentatives', v_live_representatives,
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
      + v_prior_tombstones + v_candidate_arrays + v_direct_invitations
      + v_correction_requests + v_live_representatives + v_preferences,
    'referenceRewriteCounts', v_reference_rewrites,
    'retainedHistory', v_retained_history,
    'zeroLiveSourceReferences', true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Shared organization lock across conflicting identity mutations
-- ---------------------------------------------------------------------------

-- The request-aware merge used to acquire its request lock before delegating
-- to the five-argument merge. Wrap it so the organization identity lock is
-- always first, then request, then ordered profile rows.
ALTER FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  RENAME TO csf_merge_profiles_request_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_merge_profiles(
  p_organization_id uuid,
  p_source_profile_id uuid,
  p_target_profile_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  RETURN plugin_data.csf_merge_profiles_request_identity_base(
    p_organization_id, p_source_profile_id, p_target_profile_id, p_reason,
    p_actor_user_id, p_request_id
  );
END;
$$;

-- A reusable-link request can add matched/candidate references. Acquire the
-- same organization lock before its older per-account lock and row locks.
ALTER FUNCTION plugin_data.csf_submit_profile_link_request(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text
)
  RENAME TO csf_submit_profile_link_request_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_submit_profile_link_request(
  p_organization_id uuid,
  p_code text,
  p_user_id uuid,
  p_verified_email text,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_preferred_name text,
  p_school_email text,
  p_personal_email text,
  p_normalized_first_name text,
  p_normalized_last_name text,
  p_cohort_year integer,
  p_term_code text,
  p_current_grade_level integer DEFAULT NULL,
  p_returning_status text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  RETURN plugin_data.csf_submit_profile_link_request_identity_base(
    p_organization_id, p_code, p_user_id, p_verified_email, p_first_name,
    p_middle_name, p_last_name, p_preferred_name, p_school_email,
    p_personal_email, p_normalized_first_name, p_normalized_last_name,
    p_cohort_year, p_term_code, p_current_grade_level, p_returning_status
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_confirm_profile_claim(uuid, text, uuid, uuid, text)
  RENAME TO csf_confirm_profile_claim_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_confirm_profile_claim(
  p_organization_id uuid,
  p_code text,
  p_profile_id uuid,
  p_user_id uuid,
  p_verified_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  RETURN plugin_data.csf_confirm_profile_claim_identity_base(
    p_organization_id, p_code, p_profile_id, p_user_id, p_verified_email
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_decline_profile_claim(uuid, text, uuid, uuid, text, text)
  RENAME TO csf_decline_profile_claim_identity_base;

CREATE OR REPLACE FUNCTION plugin_data.csf_decline_profile_claim(
  p_organization_id uuid,
  p_code text,
  p_profile_id uuid,
  p_user_id uuid,
  p_verified_email text,
  p_reason text DEFAULT 'Student indicated that the exact email match is not their record.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  RETURN plugin_data.csf_decline_profile_claim_identity_base(
    p_organization_id, p_code, p_profile_id, p_user_id, p_verified_email,
    p_reason
  );
END;
$$;

-- Import primitives can create or edit the same profiles as the ordinary
-- atomic writer. Wrappers preserve their exact signatures while moving the
-- organization identity lock ahead of their import-row/profile locks.
ALTER FUNCTION plugin_data.csf_import_class_history_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
)
  RENAME TO csf_import_class_history_row_identity_base;

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

ALTER FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
)
  RENAME TO csf_import_class_history_row_v2_identity_base;

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

ALTER FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, text, uuid
)
  RENAME TO csf_import_student_roster_row_identity_base;

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
BEGIN
  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);
  RETURN plugin_data.csf_import_student_roster_row_identity_base(
    p_organization_id, p_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_source_id, p_import_row_id,
    p_row_hash, p_actor_user_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, uuid
)
  RENAME TO csf_import_application_response_row_identity_base;

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
  RETURN plugin_data.csf_import_application_response_row_identity_base(
    p_organization_id, p_profile_id, p_first_name, p_last_name,
    p_school_email, p_personal_email, p_normalized_first_name,
    p_normalized_last_name, p_normalized_school_email,
    p_normalized_personal_email, p_cohort_id, p_term_id, p_source_id,
    p_import_row_id, p_row_hash, p_application_data, p_actor_user_id
  );
END;
$$;

-- Replace the current connection resolver so it uses the organization lock
-- instead of global account/cohort/profile table locks. Its corroboration and
-- idempotent-replay contract is otherwise unchanged.
CREATE OR REPLACE FUNCTION plugin_data.csf_resolve_profile_link_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_profile_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_evidence jsonb;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_result jsonb;
  v_original_correlation_id uuid;
  v_original_membership_granted boolean := false;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to resolve CSF profile connections.';
  END IF;

  PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);

  IF p_decision IS DISTINCT FROM 'connect' THEN
    RETURN plugin_data.csf_resolve_profile_link_request_corroboration_base(
      p_organization_id, p_request_id, p_profile_id, p_decision, p_reason,
      p_actor_user_id
    );
  END IF;

  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) < 4 THEN
    RAISE EXCEPTION 'A reason of at least four characters is required.';
  END IF;

  SELECT request.*
  INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This connection request has already been resolved.';
  END IF;

  IF v_request.match_status NOT IN ('pending', 'needs_review') THEN
    IF v_request.match_status = 'resolved'
      AND v_request.matched_profile_id IS NOT DISTINCT FROM p_profile_id
      AND v_request.resolved_by IS NOT DISTINCT FROM p_actor_user_id
      AND nullif(pg_catalog.btrim(v_request.resolution_notes), '') IS NOT DISTINCT FROM v_reason
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = p_organization_id
          AND profile.id = p_profile_id AND profile.record_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM plugin_data.csf_profile_accounts AS account
        WHERE account.organization_id = p_organization_id
          AND account.profile_id = p_profile_id
          AND account.user_id = v_request.user_id
          AND account.status = 'verified'
      )
      AND EXISTS (
        SELECT 1 FROM public.organization_members AS member
        WHERE member.organization_id = p_organization_id
          AND member.user_id = v_request.user_id AND member.status = 'active'
      )
      AND (
        SELECT pg_catalog.count(*) = 1
          AND (pg_catalog.array_agg(membership.cohort_id ORDER BY membership.cohort_id))[1]
            IS NOT DISTINCT FROM v_request.cohort_id
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = p_profile_id
          AND membership.status = 'active'
      )
    THEN
      SELECT audit.correlation_id,
        coalesce((audit.after_data->>'membershipGranted')::boolean, false)
      INTO v_original_correlation_id, v_original_membership_granted
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.actor_user_id = p_actor_user_id
        AND audit.action = 'profile.link_request_resolved'
        AND audit.target_type = 'csf_profile_link_requests'
        AND audit.target_id = p_request_id
        AND audit.after_data->>'decision' = 'connect'
        AND audit.after_data->>'profileId' = p_profile_id::text
        AND audit.after_data->>'reason' = v_reason
      ORDER BY audit.created_at DESC
      LIMIT 1;
      IF v_original_correlation_id IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
          'requestId', p_request_id, 'decision', 'connect',
          'profileId', p_profile_id,
          'membershipGranted', v_original_membership_granted,
          'correlationId', v_original_correlation_id,
          'idempotentReplay', true
        );
      END IF;
    END IF;
    RAISE EXCEPTION 'This connection request has already been resolved.';
  END IF;

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'Choose the student record to connect.';
  END IF;
  IF v_request.user_id IS NULL THEN
    RAISE EXCEPTION 'The student account is no longer available.';
  END IF;

  PERFORM 1
  FROM auth.users AS account
  WHERE account.id = v_request.user_id
  FOR SHARE;

  v_evidence := plugin_data.csf_profile_link_connect_evidence(
    p_organization_id, p_request_id, p_profile_id
  );
  IF NOT coalesce((v_evidence->>'canConnect')::boolean, false) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'This CSF account connection is not supported by corroborating identity evidence.',
      DETAIL = (v_evidence->'blockers')::text,
      HINT = 'Record the account''s confirmed email on the correct student profile, or reject this request and invite the student directly.';
  END IF;

  v_result := plugin_data.csf_resolve_profile_link_request_corroboration_base(
    p_organization_id, p_request_id, p_profile_id, p_decision, p_reason,
    p_actor_user_id
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id,
    'profile.link_request_identity_evidence', 'csf_profile_link_requests',
    p_request_id, v_request.term_id, '{}'::jsonb,
    pg_catalog.jsonb_build_object(
      'profileId', p_profile_id,
      'corroboration', v_evidence->'corroboration',
      'exactEmailOverlap', v_evidence->'evidence'->'exactEmailOverlap',
      'exactEmailUnique', v_evidence->'evidence'->'exactEmailUnique',
      'confirmedEmailMatchesRequestSnapshot',
        v_evidence->'evidence'->'confirmedEmailMatchesRequestSnapshot',
      'exactNameMatch', v_evidence->'evidence'->'exactNameMatch',
      'profileInRequestCohort', v_evidence->'evidence'->'profileInRequestCohort',
      'activeProfileCohortCount',
        v_evidence->'evidence'->'activeProfileCohortCount'
    ),
    (v_result->>'correlationId')::uuid, 'staff_action', p_request_id::text,
    'profile_connection_identity_corroborated'
  );

  RETURN v_result || pg_catalog.jsonb_build_object('idempotentReplay', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Execution privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview_identity_base(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles_request_identity_base(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_submit_profile_link_request_identity_base(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_submit_profile_link_request(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_confirm_profile_claim_identity_base(uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_confirm_profile_claim(uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_decline_profile_claim_identity_base(uuid, text, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_decline_profile_claim(uuid, text, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_identity_base(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2_identity_base(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_import_student_roster_row_identity_base(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_import_application_response_row_identity_base(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_submit_profile_link_request(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_profile_claim(uuid, text, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_decline_profile_claim(uuid, text, uuid, uuid, text, text)
  TO service_role;
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
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview_identity_base(uuid, uuid, uuid) IS
  'Owner-internal identity preview (20260809212049): relationship conflicts plus exact identity corroboration, before cohort consolidation is accounted for.';
COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Canonical merge preview: identity corroboration is unchanged, exact shared cohorts are consolidatable, the active-cohort union and every profile-key uniqueness rule (including active point claims, active staff assignments, and open point appeals) are canonical blockers, and the complete current-schema profile-reference plan is disclosed.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) IS
  'Owner-internal compatibility implementation: revalidates authority, acquires the organization identity lock before ordered profile rows, rechecks the canonical preview, consolidates exact cohort duplicates, rewrites every current ownership reference, retains classified immutable history, and aborts unless zero unintended live source references remain. Service callers use the request-aware overload.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid) IS
  'Request-aware profile merge with organization identity lock first, request replay lock second, and the canonical locked merge last. Signature and replay semantics are preserved.';
COMMENT ON FUNCTION plugin_data.csf_submit_profile_link_request(
  uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  integer, text, integer, text
) IS 'Atomic profile-link request submission under the organization identity lock before its per-account and row locks.';
COMMENT ON FUNCTION plugin_data.csf_confirm_profile_claim(uuid, text, uuid, uuid, text) IS
  'Atomic verified profile claim under the organization identity lock before invitation, account, membership, and profile row locks.';
COMMENT ON FUNCTION plugin_data.csf_decline_profile_claim(uuid, text, uuid, uuid, text, text) IS
  'Atomic profile-claim refusal under the organization identity lock so candidate references cannot race a profile merge.';
COMMENT ON FUNCTION plugin_data.csf_import_class_history_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS 'Atomic reviewed class-history import under the organization identity lock.';
COMMENT ON FUNCTION plugin_data.csf_import_class_history_row_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, jsonb, boolean, uuid
) IS 'Atomic numeric-credit class-history import under the organization identity lock.';
COMMENT ON FUNCTION plugin_data.csf_import_student_roster_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, text, uuid
) IS 'Atomic reviewed student-roster import under the organization identity lock.';
COMMENT ON FUNCTION plugin_data.csf_import_application_response_row(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid,
  uuid, uuid, text, jsonb, uuid
) IS 'Atomic reviewed application-response import under the organization identity lock.';
COMMENT ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid) IS
  'Identity-corroborated connection resolution under the organization identity lock. Same-organization identity changes serialize; unrelated organizations do not take global table locks.';

COMMIT;
