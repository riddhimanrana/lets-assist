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
    )
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

  -- Profile merges are rare. Blocking concurrent account/cohort writes during
  -- the short transaction makes the reviewed identity evidence authoritative.
  -- The order is accounts -> cohort memberships -> profiles, matching
  -- csf_resolve_profile_link_request so the two consequential identity
  -- operations cannot deadlock each other.
  LOCK TABLE plugin_data.csf_profile_accounts IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE plugin_data.csf_profile_cohort_memberships IN SHARE ROW EXCLUSIVE MODE;

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
      HINT = 'Review the duplicate semester, attendance, signup, class, or verified-account records.';
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

  v_result := plugin_data.csf_merge_profiles_identity_base(
    p_organization_id,
    p_source_profile_id,
    p_target_profile_id,
    p_reason,
    p_actor_user_id
  );

  IF pg_catalog.jsonb_array_length(v_consolidated) > 0 THEN
    v_review_id := NULLIF(v_result ->> 'reviewId', '')::uuid;
    v_correlation_id := NULLIF(v_result ->> 'correlationId', '')::uuid;
    IF v_review_id IS NULL OR v_correlation_id IS NULL THEN
      RAISE EXCEPTION 'The profile merge did not return the evidence identifiers its consolidation record requires.';
    END IF;

    -- Provenance beside the approved review. Identifiers, statuses, and
    -- timestamps only: no name, email, or other student attribute.
    UPDATE plugin_data.csf_profile_merge_reviews
    SET evidence = COALESCE(evidence, '{}'::jsonb)
          || pg_catalog.jsonb_build_object('cohortConsolidation', v_consolidated),
        updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_review_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The profile merge review that must carry consolidation evidence is missing.';
    END IF;

    -- Immutable audit, scoped to the merge correlation. `profile.merge` is an
    -- already reviewed action value; the membership target_type keeps these
    -- rows unambiguous against the canonical csf_profiles merge receipt the
    -- request-aware overload looks up.
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

  RETURN v_result;
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
REVOKE ALL ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview_identity_base(uuid, uuid, uuid) IS
  'Owner-internal identity preview (20260809212049): relationship conflicts plus exact identity corroboration, before cohort consolidation is accounted for.';
COMMENT ON FUNCTION plugin_data.csf_profile_merge_preview(uuid, uuid, uuid) IS
  'Canonical merge preview: identity corroboration is unchanged, an exact shared cohort membership is reported as consolidatable rather than blocking, and the merged record must still end up active in at most one graduating class.';
COMMENT ON FUNCTION plugin_data.csf_merge_profiles(uuid, uuid, uuid, text, uuid) IS
  'Owner-internal compatibility implementation: revalidates authority, locks accounts then cohort memberships then profiles, refuses on the canonical preview before touching data, consolidates exact duplicate cohort rows, then performs the locked identity-safe merge and records non-PII consolidation provenance. Service callers must use the request-aware overload.';

COMMIT;
