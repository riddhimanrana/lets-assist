-- Release, the officer read projections, the member-side state, and the guard
-- that stops the in-app decision path from publishing behind the release gate.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Release
--
-- Publishes every releasable staged row of a term together. A held row never
-- aborts the release; it is reported. Unreviewed rows stay pending, which is
-- not an error — the chapter simply has not decided them yet.
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_release_sheet_application_decisions(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_request_id uuid,
  p_application_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_existing plugin_data.csf_application_decision_releases%ROWTYPE;
  v_release_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_plan record;
  v_held jsonb;
  v_pending integer;
  v_accepted integer;
  v_rejected integer;
  v_held_count integer;
  v_fingerprint text;
BEGIN
  PERFORM plugin_data.csf_assert_sheet_decision_authority(
    p_organization_id, p_actor_user_id, 'decide_applications',
    'Not authorized to release CSF application decisions.'
  );

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A stable release request identifier is required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_decision_release_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'termId', p_term_id,
          'applicationIds', pg_catalog.to_jsonb(p_application_ids)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT release.* INTO v_existing
  FROM plugin_data.csf_application_decision_releases AS release
  WHERE release.organization_id = p_organization_id
    AND release.request_id = p_request_id;
  IF FOUND THEN
    -- Same request asked again is a replay. Same id aimed at another term or
    -- another subset is a different intent and must not read this receipt.
    IF v_existing.term_id IS DISTINCT FROM p_term_id
      OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That release request identifier is already bound to a different release.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    SELECT term.* INTO v_term
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id AND term.id = v_existing.term_id;
    RETURN pg_catalog.jsonb_build_object(
      'releaseId', v_existing.id,
      'termId', v_existing.term_id,
      'released', v_existing.released_count,
      'accepted', v_existing.accepted_count,
      'rejected', v_existing.rejected_count,
      'pending', v_existing.pending_count,
      'held', v_existing.held,
      'heldCount', v_existing.held_count,
      'firstReleasedAt', v_term.decisions_first_released_at,
      'lastReleasedAt', v_term.decisions_last_released_at,
      'releaseCount', v_term.decisions_release_count,
      'replay', true
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_sheet_decision_term_lock_key(p_organization_id, p_term_id)
  );

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found', MESSAGE = 'CSF term not found.';
  END IF;
  IF v_term.application_review_source <> 'sheet' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This term does not review applications in a Sheet.',
      DETAIL = 'CSF_SHEET_REVIEW_MODE=not_enabled';
  END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A closed term keeps its published outcomes.',
      DETAIL = 'CSF_RELEASE_BLOCKER=term_closed';
  END IF;

  -- Plan first, with every row locked, so the receipt can be written with its
  -- final counts before any publication happens.
  CREATE TEMP TABLE IF NOT EXISTS csf_decision_release_plan (
    application_id uuid,
    staged_decision text,
    staged_reason text,
    block_reason text,
    disposition text
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.csf_decision_release_plan;

  INSERT INTO pg_temp.csf_decision_release_plan
  SELECT
    stage.application_id,
    stage.staged_decision,
    stage.staged_reason,
    CASE
      WHEN stage.block_reason IS NOT NULL THEN stage.block_reason
      WHEN stage.staged_decision = 'conflict' THEN 'unmapped_color'
      WHEN stage.staged_decision = 'rejected_with_explanation'
        AND nullif(pg_catalog.btrim(coalesce(stage.staged_reason, '')), '') IS NULL
        THEN 'missing_yellow_reason'
      WHEN stage.staged_decision IN ('rejected', 'rejected_with_explanation')
        AND membership.status IN ('completed', 'not_completed')
        THEN 'historical_outcome'
      ELSE NULL
    END,
    CASE
      WHEN stage.staged_decision = 'unreviewed' THEN 'pending'
      WHEN stage.blocks_release THEN 'held'
      WHEN stage.staged_decision IN ('rejected', 'rejected_with_explanation')
        AND membership.status IN ('completed', 'not_completed')
        THEN 'held'
      ELSE 'release'
    END
  FROM plugin_data.csf_application_decision_stages AS stage
  LEFT JOIN plugin_data.csf_term_memberships AS membership
    ON membership.organization_id = stage.organization_id
   AND membership.profile_id = stage.profile_id
   AND membership.term_id = stage.term_id
  WHERE stage.organization_id = p_organization_id
    AND stage.term_id = p_term_id
    AND stage.release_state = 'staged'
    AND (p_application_ids IS NULL OR stage.application_id = ANY(p_application_ids));

  SELECT
    pg_catalog.count(*) FILTER (WHERE disposition = 'pending'),
    pg_catalog.count(*) FILTER (WHERE disposition = 'held'),
    pg_catalog.count(*) FILTER (WHERE disposition = 'release' AND staged_decision = 'accepted'),
    pg_catalog.count(*) FILTER (
      WHERE disposition = 'release'
        AND staged_decision IN ('rejected', 'rejected_with_explanation')
    ),
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'applicationId', application_id,
          'blockReason', coalesce(block_reason, 'unmapped_color')
        )
        ORDER BY application_id
      ) FILTER (WHERE disposition = 'held'),
      '[]'::jsonb
    )
  INTO v_pending, v_held_count, v_accepted, v_rejected, v_held
  FROM pg_temp.csf_decision_release_plan;

  INSERT INTO plugin_data.csf_application_decision_releases (
    organization_id, term_id, actor_user_id, request_id, request_fingerprint,
    released_count, accepted_count, rejected_count, held_count, pending_count, held
  )
  VALUES (
    p_organization_id, p_term_id, p_actor_user_id, p_request_id, v_fingerprint,
    v_accepted + v_rejected, v_accepted, v_rejected, v_held_count, v_pending, v_held
  )
  RETURNING id INTO v_release_id;

  FOR v_plan IN
    SELECT * FROM pg_temp.csf_decision_release_plan
    WHERE disposition = 'release'
    ORDER BY application_id
  LOOP
    PERFORM plugin_data.csf_publish_sheet_application_decision(
      p_organization_id,
      v_plan.application_id,
      CASE WHEN v_plan.staged_decision = 'accepted' THEN 'accepted' ELSE 'rejected' END,
      v_plan.staged_reason,
      p_actor_user_id,
      pg_catalog.jsonb_build_object(
        'releaseId', v_release_id,
        'termId', p_term_id,
        'stagedDecision', v_plan.staged_decision,
        'trigger', 'term_release'
      )
    );

    UPDATE plugin_data.csf_application_decision_stages
    SET
      release_state = 'released',
      released_decision =
        CASE WHEN v_plan.staged_decision = 'accepted' THEN 'accepted' ELSE 'rejected' END,
      released_reason = v_plan.staged_reason,
      released_at = v_now,
      released_by = p_actor_user_id,
      release_id = v_release_id,
      last_applied_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND application_id = v_plan.application_id;
  END LOOP;

  UPDATE plugin_data.csf_terms
  SET
    decisions_first_released_at = coalesce(decisions_first_released_at, v_now),
    decisions_last_released_at = v_now,
    decisions_release_count = decisions_release_count + 1,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_term_id
  RETURNING * INTO v_term;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, source_type, source_id
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'application_decisions.released',
    'csf_application_decision_releases', v_release_id, p_term_id,
    pg_catalog.jsonb_build_object(
      'decisionBasis', 'officer_external_sheet_review',
      'released', v_accepted + v_rejected,
      'accepted', v_accepted,
      'rejected', v_rejected,
      'pending', v_pending,
      'held', v_held
    ),
    p_request_id, 'sheet_application_review', v_release_id::text
  );

  RETURN pg_catalog.jsonb_build_object(
    'releaseId', v_release_id,
    'termId', p_term_id,
    'released', v_accepted + v_rejected,
    'accepted', v_accepted,
    'rejected', v_rejected,
    'pending', v_pending,
    'held', v_held,
    'heldCount', v_held_count,
    'firstReleasedAt', v_term.decisions_first_released_at,
    'lastReleasedAt', v_term.decisions_last_released_at,
    'releaseCount', v_term.decisions_release_count,
    'replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_release_sheet_application_decisions(uuid, uuid, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_release_sheet_application_decisions(uuid, uuid, uuid, uuid, uuid[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- B. Officer read projections
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_list_sheet_application_decisions(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid,
  p_decision text DEFAULT NULL,
  p_release_state text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := pg_catalog.least(pg_catalog.greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(pg_catalog.btrim(coalesce(p_search, '')), '');
  v_decision text := nullif(pg_catalog.btrim(coalesce(p_decision, '')), '');
  v_release_state text := nullif(pg_catalog.btrim(coalesce(p_release_state, '')), '');
  v_cursor uuid := CASE
    WHEN nullif(pg_catalog.btrim(coalesce(p_cursor, '')), '') IS NULL THEN NULL
    ELSE p_cursor::uuid
  END;
  v_cursor_key text;
  v_rows jsonb;
  v_next uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'view_applications'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Not authorized to read CSF application decisions.';
  END IF;

  IF v_cursor IS NOT NULL THEN
    SELECT pg_catalog.lower(profile.last_name || ' ' || profile.first_name)
    INTO v_cursor_key
    FROM plugin_data.csf_application_decision_stages AS stage
    JOIN plugin_data.csf_profiles AS profile
      ON profile.id = stage.profile_id
     AND profile.organization_id = stage.organization_id
    WHERE stage.organization_id = p_organization_id
      AND stage.application_id = v_cursor;
  END IF;

  WITH page AS (
    SELECT
      stage.*,
      pg_catalog.lower(profile.last_name || ' ' || profile.first_name) AS sort_key,
      pg_catalog.btrim(profile.first_name || ' ' || profile.last_name) AS display_name
    FROM plugin_data.csf_application_decision_stages AS stage
    JOIN plugin_data.csf_profiles AS profile
      ON profile.id = stage.profile_id
     AND profile.organization_id = stage.organization_id
    WHERE stage.organization_id = p_organization_id
      AND stage.term_id = p_term_id
      AND (
        v_decision IS NULL
        OR (v_decision = 'done' AND stage.is_done)
        OR (v_decision = 'not_done' AND NOT stage.is_done)
        OR stage.staged_decision = v_decision
      )
      AND (v_release_state IS NULL OR stage.release_state = v_release_state)
      AND (
        v_search IS NULL
        OR profile.normalized_first_name ILIKE '%' || pg_catalog.lower(v_search) || '%'
        OR profile.normalized_last_name ILIKE '%' || pg_catalog.lower(v_search) || '%'
      )
      AND (
        v_cursor_key IS NULL
        OR (
          pg_catalog.lower(profile.last_name || ' ' || profile.first_name),
          stage.application_id
        ) > (v_cursor_key, v_cursor)
      )
    ORDER BY sort_key, stage.application_id
    LIMIT v_limit
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'applicationId', page.application_id,
        'profileId', page.profile_id,
        'displayName', page.display_name,
        'decision', page.staged_decision,
        'reason', page.staged_reason,
        'observedColor', page.observed_color,
        'isDone', page.is_done,
        'blocksRelease', page.blocks_release,
        'blockReason', page.block_reason,
        'released', page.release_state = 'released',
        'releasedDecision', page.released_decision,
        'releasedAt', page.released_at,
        'lastSyncedAt', page.last_staged_at,
        'lastAppliedAt', page.last_applied_at,
        'sourceId', page.source_id,
        'importRowId', page.import_row_id,
        'observedRowNumber', page.observed_row_number
      ) ORDER BY page.sort_key, page.application_id),
      '[]'::jsonb
    ),
    (
      SELECT application_id
      FROM page
      ORDER BY sort_key DESC, application_id DESC
      LIMIT 1
    )
  INTO v_rows, v_next
  FROM page;

  RETURN pg_catalog.jsonb_build_object(
    'rows', v_rows,
    'nextCursor', CASE
      WHEN pg_catalog.jsonb_array_length(v_rows) < v_limit THEN NULL
      ELSE v_next::text
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_list_sheet_application_decisions(uuid, uuid, uuid, text, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_sheet_application_decisions(uuid, uuid, uuid, text, text, text, integer, text)
  TO service_role;

CREATE FUNCTION plugin_data.csf_sheet_application_decision_term_state(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_term_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_counts jsonb;
  v_last_run uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'view_applications'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Not authorized to read CSF application decisions.';
  END IF;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id AND term.id = p_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found', MESSAGE = 'CSF term not found.';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'staged', pg_catalog.count(*),
    'unreviewed', pg_catalog.count(*) FILTER (WHERE staged_decision = 'unreviewed'),
    'accepted', pg_catalog.count(*) FILTER (WHERE staged_decision = 'accepted'),
    'rejected', pg_catalog.count(*) FILTER (WHERE staged_decision = 'rejected'),
    'rejectedWithExplanation',
      pg_catalog.count(*) FILTER (WHERE staged_decision = 'rejected_with_explanation'),
    'conflict', pg_catalog.count(*) FILTER (WHERE staged_decision = 'conflict'),
    'released', pg_catalog.count(*) FILTER (WHERE release_state = 'released'),
    'releasable', pg_catalog.count(*) FILTER (
      WHERE release_state = 'staged' AND NOT blocks_release AND staged_decision <> 'unreviewed'
    ),
    'blocked', pg_catalog.count(*) FILTER (WHERE release_state = 'staged' AND blocks_release)
  )
  INTO v_counts
  FROM plugin_data.csf_application_decision_stages
  WHERE organization_id = p_organization_id AND term_id = p_term_id;

  SELECT run.id INTO v_last_run
  FROM plugin_data.csf_application_decision_sync_runs AS run
  WHERE run.organization_id = p_organization_id AND run.term_id = p_term_id
  ORDER BY run.created_at DESC, run.id DESC
  LIMIT 1;

  RETURN pg_catalog.jsonb_build_object(
    'reviewSource', v_term.application_review_source,
    'firstReleasedAt', v_term.decisions_first_released_at,
    'lastReleasedAt', v_term.decisions_last_released_at,
    'releaseCount', v_term.decisions_release_count,
    'counts', v_counts,
    'lastRun', CASE
      WHEN v_last_run IS NULL THEN NULL
      ELSE plugin_data.csf_sheet_application_decision_run_receipt(p_organization_id, v_last_run)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_application_decision_term_state(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_application_decision_term_state(uuid, uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- C. What the member is allowed to know
--
-- A staged decision is invisible here by construction: this function reads the
-- application's persisted decision state and the term membership, and never
-- opens a staging table. Before release an accepted applicant looks exactly
-- like an undecided one, because that is what the chapter has published.
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_member_term_review_state(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_id uuid;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership_status text;
  v_pending boolean := false;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CSF member access denied.';
  END IF;

  SELECT account.profile_id
  INTO v_profile_id
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_actor_user_id
    AND account.status = 'verified'
    AND account.revoked_at IS NULL
  ORDER BY account.is_primary DESC, account.linked_at DESC
  LIMIT 1;

  SELECT term.* INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.is_current
  LIMIT 1;

  IF v_profile_id IS NULL OR v_term.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'termId', v_term.id,
      'reviewSource', v_term.application_review_source,
      'applicationPending', false,
      'memberToolsAvailable', false
    );
  END IF;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_profile_id
    AND membership.term_id = v_term.id;

  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_applications AS application
    WHERE application.organization_id = p_organization_id
      AND application.profile_id = v_profile_id
      AND application.term_id = v_term.id
      AND application.decision_status = 'pending'
  )
  INTO v_pending;

  RETURN pg_catalog.jsonb_build_object(
    'termId', v_term.id,
    'reviewSource', v_term.application_review_source,
    'applicationPending', v_pending,
    'memberToolsAvailable', coalesce(v_membership_status, '') IN ('accepted', 'active')
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_member_term_review_state(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_term_review_state(uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- D. The in-app decision path must not publish behind the release gate
--
-- Without this, an officer reviewing in the Applications workspace of a
-- Sheets-review term would approve an applicant, grant the membership, and
-- activate the platform member — all before the chapter released anything.
-- Both `csf_decide_term_application` overloads funnel through the five-argument
-- one, and the campaign verdict calls the base directly, so both get the guard.
--
-- An `'app'` term is completely unaffected, and recording a *pending* campaign
-- verdict still works in a `'sheet'` term because that is assignment
-- bookkeeping, not a publication.
-- ---------------------------------------------------------------------------

CREATE FUNCTION plugin_data.csf_reject_native_decision_in_sheet_review(
  p_organization_id uuid,
  p_application_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term_id uuid;
BEGIN
  SELECT application.term_id
  INTO v_term_id
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id;

  IF v_term_id IS NOT NULL
    AND plugin_data.csf_term_is_sheet_review(p_organization_id, v_term_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This term reviews applications in the source Sheet. Record the decision there and release the term.',
      DETAIL = 'CSF_SHEET_REVIEW_MODE=decisions_staged',
      HINT = 'Release the staged Sheet decisions to publish outcomes.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_reject_native_decision_in_sheet_review(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_decide_term_application(
  p_organization_id uuid,
  p_application_id uuid,
  p_decision text,
  p_review_notes text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'decide_applications'
  ) THEN
    RAISE EXCEPTION 'Not authorized to decide CSF applications.';
  END IF;

  PERFORM plugin_data.csf_reject_native_decision_in_sheet_review(
    p_organization_id, p_application_id
  );

  RETURN plugin_data.csf_decide_term_application_policy_base(
    p_organization_id,
    p_application_id,
    p_decision,
    p_review_notes,
    p_actor_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_decide_term_application(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Same body as 20260817100000 section E, with the review-source guard added
-- before the application branch publishes anything.
CREATE OR REPLACE FUNCTION plugin_data.csf_record_review_decision(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_period_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_row plugin_data.csf_review_decisions%ROWTYPE;
  v_kind plugin_data.csf_review_subject_kind := p_subject_kind::plugin_data.csf_review_subject_kind;
  v_decision plugin_data.csf_review_decision_state := p_decision::plugin_data.csf_review_decision_state;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_expected plugin_data.csf_review_subject_kind;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions') THEN
    RAISE EXCEPTION 'Not authorized to record CSF review decisions.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review period not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION 'This review period is not open.' USING ERRCODE = 'check_violation';
  END IF;

  v_expected := plugin_data.csf_review_subject_kind_for(v_period.kind);
  IF v_kind <> v_expected THEN
    RAISE EXCEPTION 'A % period reviews % subjects, not %.', v_period.kind, v_expected, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_decision = 'rejected' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A rejection needs a reason.' USING ERRCODE = 'check_violation';
  END IF;

  -- A non-pending application verdict publishes below. In a Sheets-review term
  -- that would bypass the release gate entirely.
  IF v_kind = 'application' AND v_decision <> 'pending' THEN
    PERFORM plugin_data.csf_reject_native_decision_in_sheet_review(
      p_organization_id, p_subject_id
    );
  END IF;

  INSERT INTO plugin_data.csf_review_decisions (
    organization_id, period_id, subject_kind, subject_id, decision, reason,
    decided_by, decided_at
  )
  VALUES (
    p_organization_id, p_period_id, v_kind, p_subject_id, v_decision, v_reason,
    CASE WHEN v_decision = 'pending' THEN NULL ELSE p_actor_user_id END,
    CASE WHEN v_decision = 'pending' THEN NULL ELSE v_now END
  )
  ON CONFLICT (organization_id, period_id, subject_kind, subject_id)
  DO UPDATE SET
    decision = EXCLUDED.decision,
    reason = EXCLUDED.reason,
    decided_by = EXCLUDED.decided_by,
    decided_at = EXCLUDED.decided_at,
    updated_at = v_now
  RETURNING * INTO v_row;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, after_data, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id, 'review_decision.' || v_decision::text,
    'csf_review_decision', v_row.id, v_period.term_id, pg_catalog.to_jsonb(v_row), v_reason
  );

  -- The campaign verdict IS the application decision. Applying it here keeps
  -- verdict, application state, membership, and the write-back queue in one
  -- transaction; a failure in any of them rolls the verdict back too.
  IF v_kind = 'application' AND v_decision <> 'pending' THEN
    PERFORM plugin_data.csf_decide_term_application_policy_base(
      p_organization_id,
      p_subject_id,
      CASE v_decision WHEN 'approved' THEN 'accepted' ELSE 'rejected' END,
      coalesce(v_reason, CASE WHEN v_decision = 'approved' THEN 'Approved in application review.' ELSE NULL END),
      p_actor_user_id
    );

    PERFORM plugin_data.csf_queue_application_sheet_writeback(
      p_organization_id,
      p_subject_id,
      v_decision::text,
      v_reason
    );
  END IF;

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_record_review_decision(uuid, uuid, uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_review_decision(uuid, uuid, uuid, text, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_release_sheet_application_decisions(uuid, uuid, uuid, uuid, uuid[]) IS
  'Publishes a term''s releasable staged Sheet decisions together. Held rows are reported, never silently released; unreviewed rows stay pending.';
COMMENT ON FUNCTION plugin_data.csf_member_term_review_state(uuid, uuid) IS
  'Self-only member view of the current term: whether a decision is still pending and whether member tools are available. Never exposes a staged decision.';

COMMIT;
