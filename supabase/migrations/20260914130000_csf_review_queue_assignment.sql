-- Application review: assign the filtered pending queue to reviewers by
-- stable record, and read per-term application counts in one grouped call.
--
-- `csf_review_assignments` stores contiguous positional bands over a roster.
-- That fits point verification, where every member is reviewed once, but an
-- application split is a subset: the pending, still-unassigned applications
-- the officer is looking at. A positional band cannot describe that subset
-- without also claiming the decided and already-assigned records between
-- them. Applications already carry a stable per-record assignment
-- (`assigned_to`, written by `csf_assign_application`), so the split extends
-- that model instead of adding a second one: every selected application is
-- revalidated under lock against the semester, class, pending status, and
-- current assignment the officer saw, then assigned through the canonical
-- per-application function. Nothing else is touched, deleted, or widened.
--
-- A split carries an optional stable request identifier. Its receipt is the
-- summary audit event itself, keyed by `correlation_id`, in the same way the
-- point-action and import-review receipts already work: an exact replay by the
-- same actor returns the recorded result without writing again, and a reused
-- identifier with a different payload or actor is refused. Bands written
-- before this migration are left in place as historical context; nothing here
-- converts or deletes them.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Receipt uniqueness
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX csf_review_queue_assign_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action = 'review_period.assign_queue';

-- ---------------------------------------------------------------------------
-- B. Batch queue assignment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_assign_review_queue(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_period_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_assignments jsonb,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_correlation_id uuid := coalesce(p_request_id, gen_random_uuid());
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_request_fingerprint text;
  v_entry jsonb;
  v_application_id uuid;
  v_reviewer_user_id uuid;
  v_seen uuid[] := '{}';
  v_reviewers uuid[] := '{}';
  v_assigned integer := 0;
  v_result jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to assign CSF review work.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_review_periods') THEN
    RAISE EXCEPTION 'Not authorized to assign CSF review work.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_assignments IS NULL OR pg_catalog.jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Assignments must be an array.' USING ERRCODE = 'check_violation';
  END IF;
  IF pg_catalog.jsonb_array_length(p_assignments) = 0 THEN
    RAISE EXCEPTION 'Nothing to assign.' USING ERRCODE = 'check_violation';
  END IF;

  -- Staff authority is rechecked under the shared staff lock so a role edit
  -- or revocation that committed first cannot be outrun by a queued split.
  PERFORM pg_catalog.pg_advisory_xact_lock(plugin_data.csf_staff_access_lock_key(p_organization_id));
  PERFORM 1
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to assign CSF review work.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_review_periods') THEN
    RAISE EXCEPTION 'Not authorized to assign CSF review work.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The receipt is consulted only after current authority is proven, and the
  -- fingerprint covers the whole intent: period, semester, class, and the
  -- normalized record-to-reviewer list.
  IF p_request_id IS NOT NULL THEN
    v_request_fingerprint := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'periodId', p_period_id,
            'termId', p_term_id,
            'cohortId', p_cohort_id,
            'assignments', (
              SELECT coalesce(pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'applicationId', entries.value->>'applicationId',
                  'reviewerUserId', entries.value->>'reviewerUserId'
                )
                ORDER BY entries.value->>'applicationId', entries.value->>'reviewerUserId'
              ), '[]'::jsonb)
              FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(value)
            )
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'plugin_data.csf_assign_review_queue:' || p_organization_id::text || ':' || p_request_id::text,
        0
      )
    );

    SELECT audit.* INTO v_receipt
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_request_id
      AND audit.action = 'review_period.assign_queue';
    IF FOUND THEN
      IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
         OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint
         OR pg_catalog.jsonb_typeof(v_receipt.after_data -> 'result') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'That split request identifier is already bound to a different split.'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN (v_receipt.after_data -> 'result')
        || pg_catalog.jsonb_build_object('idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND id = p_period_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review period not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_period.kind <> 'membership_applications' THEN
    RAISE EXCEPTION 'Only an application review period assigns applications.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_period.status = 'closed' THEN
    RAISE EXCEPTION 'This review period is closed.' USING ERRCODE = 'check_violation';
  END IF;

  -- The scope the officer split must still be the period's scope.
  IF p_term_id IS NULL OR v_period.term_id <> p_term_id THEN
    RAISE EXCEPTION 'The review scope changed. Reload the roster and split again.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_cohort_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_cohorts AS cohort
    WHERE cohort.organization_id = p_organization_id
      AND cohort.id = p_cohort_id
      AND cohort.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The review scope changed. Reload the roster and split again.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validate every selected application under a row lock before writing any
  -- of them. Rows are locked in id order so two concurrent splits cannot
  -- deadlock; a stale record fails the whole split with nothing written.
  FOR v_entry IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(value)
    ORDER BY value->>'applicationId'
  LOOP
    IF pg_catalog.jsonb_typeof(v_entry) <> 'object'
       OR nullif(v_entry->>'applicationId', '') IS NULL
       OR nullif(v_entry->>'reviewerUserId', '') IS NULL THEN
      RAISE EXCEPTION 'Each assignment needs an application and a reviewer.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_application_id := (v_entry->>'applicationId')::uuid;
    v_reviewer_user_id := (v_entry->>'reviewerUserId')::uuid;

    IF v_application_id = ANY (v_seen) THEN
      RAISE EXCEPTION 'An application can only be assigned once per split.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen := pg_catalog.array_append(v_seen, v_application_id);

    SELECT * INTO v_application
    FROM plugin_data.csf_term_applications
    WHERE organization_id = p_organization_id AND id = v_application_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected application is outside the selected semester or class. Reload the roster and split again.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_application.term_id <> p_term_id
       OR (p_cohort_id IS NOT NULL AND v_application.cohort_id IS DISTINCT FROM p_cohort_id) THEN
      RAISE EXCEPTION 'A selected application is outside the selected semester or class. Reload the roster and split again.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_application.decision_status <> 'pending' THEN
      RAISE EXCEPTION 'A selected application already has a decision. Reload the roster and split again.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_application.assigned_to IS NOT NULL THEN
      RAISE EXCEPTION 'A selected application is already assigned. Reload the roster and split again.'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Apply through the canonical per-application assignment, which validates
  -- the reviewer's current staff standing and writes its own audit row.
  FOR v_entry IN
    SELECT value
    FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(value)
    ORDER BY value->>'applicationId'
  LOOP
    v_application_id := (v_entry->>'applicationId')::uuid;
    v_reviewer_user_id := (v_entry->>'reviewerUserId')::uuid;
    PERFORM plugin_data.csf_assign_application(
      p_organization_id, v_application_id, v_reviewer_user_id, p_actor_user_id
    );
    v_assigned := v_assigned + 1;
    IF NOT (v_reviewer_user_id = ANY (v_reviewers)) THEN
      v_reviewers := pg_catalog.array_append(v_reviewers, v_reviewer_user_id);
    END IF;
  END LOOP;

  v_result := pg_catalog.jsonb_build_object(
    'periodId', p_period_id,
    'termId', v_period.term_id,
    'cohortId', p_cohort_id,
    'assigned', v_assigned,
    'reviewers', pg_catalog.cardinality(v_reviewers),
    'applicationIds', pg_catalog.to_jsonb(v_seen),
    'correlationId', v_correlation_id,
    'updatedAt', v_now
  );

  -- The summary audit event doubles as the request receipt.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'review_period.assign_queue',
    'csf_review_period', p_period_id, v_period.term_id,
    pg_catalog.jsonb_build_object(
      'cohortId', p_cohort_id,
      'assigned', v_assigned,
      'reviewers', pg_catalog.cardinality(v_reviewers),
      'applicationIds', pg_catalog.to_jsonb(v_seen),
      'requestFingerprint', v_request_fingerprint,
      'result', v_result
    ),
    v_correlation_id, 'application_review', p_period_id::text, 'assigned'
  );

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Grouped per-term application counts
--
-- One bounded read (one row per term) replaces a head count per term. It
-- returns counts only, scoped to the organization, for the semester selector.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_review_application_counts(
  p_organization_id uuid
)
RETURNS TABLE (term_id uuid, application_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT application.term_id, pg_catalog.count(*)::bigint
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
  GROUP BY application.term_id;
$$;

-- ---------------------------------------------------------------------------
-- D. Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION plugin_data.csf_assign_review_queue(uuid, uuid, uuid, uuid, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assign_review_queue(uuid, uuid, uuid, uuid, uuid, jsonb, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_review_application_counts(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_application_counts(uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_assign_review_queue(uuid, uuid, uuid, uuid, uuid, jsonb, uuid) IS
  'Assigns a selected set of pending, unassigned applications in one application review period to reviewers. Rechecks manage_review_periods under the staff lock, then honors an optional stable request identifier whose receipt is the summary audit event: an exact replay by the same actor returns the recorded result without writing, a reused identifier with another payload or actor is refused. Otherwise revalidates every application against the period semester, optional class, pending status, and current assignment under row locks and applies each through csf_assign_application. A stale record fails the whole split; no other assignment or positional band is touched.';

COMMENT ON FUNCTION plugin_data.csf_review_application_counts(uuid) IS
  'Per-term application counts for one organization, one row per term, for the review semester selector.';

COMMIT;
