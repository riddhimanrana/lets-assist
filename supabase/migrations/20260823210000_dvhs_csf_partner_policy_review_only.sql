-- Record a partner club's policy-review verdict WITHOUT rewriting the record.
--
-- csf_upsert_partner_club_policy is a full-replace upsert: it writes every
-- identity, contact, policy and spreadsheet field from its request, and it
-- forces workflow_status to 'active'. That is correct for the Add/Edit club
-- form, which submits the whole record, and wrong for an approve control that
-- knows only a verdict. Reusing it from a one-click Approve would blank
-- policy_notes and spreadsheet_url and quietly reinstate a suspended club.
--
-- This function is the narrow counterpart. It touches allocation_satisfied,
-- policy_notes, reviewed_by and reviewed_at, and nothing else. Standing stays
-- where csf_set_partner_club_term_status left it; the two decisions are
-- separate and stay separate.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_set_partner_club_policy_review(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_partner_club_term_id uuid,
  p_allocation_satisfied text,
  p_policy_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_idempotency_key text;
  v_request_fingerprint text;
  v_existing_event plugin_data.csf_partner_club_term_events%ROWTYPE;
  v_term_record plugin_data.csf_partner_club_terms%ROWTYPE;
  v_term_before jsonb;
  v_term_after jsonb;
  v_allocation_choice text;
  v_allocation_satisfied boolean;
  v_policy_notes text;
  v_changed boolean;
  v_actor_membership_user_id uuid;
BEGIN
  -- Auth first, before any caller-controlled input is inspected. Matches the
  -- recheck-under-lock shape AUD-036 established for every other transaction
  -- carrying manage_partner_clubs authority: a staff actor whose permission is
  -- revoked mid-transaction must not complete the write.
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  SELECT member.user_id
  INTO v_actor_membership_user_id
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_actor_user_id
    AND member.status = 'active'
  FOR SHARE;

  IF NOT FOUND OR v_actor_membership_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  -- Authorization is mutable state. Re-read it now that this request owns the
  -- shared staff-access lock and the actor's membership row.
  IF plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_partner_clubs'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;

  IF p_organization_id IS NULL OR p_request_id IS NULL
    OR p_partner_club_term_id IS NULL THEN
    RAISE EXCEPTION 'A partner-club policy review requires an organization, request id and term record.';
  END IF;

  v_allocation_choice := coalesce(NULLIF(pg_catalog.btrim(p_allocation_satisfied), ''), 'unknown');
  IF v_allocation_choice NOT IN ('unknown', 'yes', 'no') THEN
    RAISE EXCEPTION 'Choose a valid point-policy review status.';
  END IF;
  v_allocation_satisfied := CASE v_allocation_choice
    WHEN 'yes' THEN true
    WHEN 'no' THEN false
    ELSE NULL
  END;

  v_policy_notes := NULLIF(pg_catalog.btrim(p_policy_notes), '');
  IF pg_catalog.length(coalesce(v_policy_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'Partner-club reviewer notes are too long.';
  END IF;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'partnerClubTermId', p_partner_club_term_id,
          'allocationSatisfied', v_allocation_choice,
          'policyNotes', v_policy_notes
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_idempotency_key := 'policy-review:' || p_request_id::text;

  -- Same organization boundary the full upsert serializes on, so a review and
  -- an edit of the same club cannot interleave their reads and writes.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_upsert_partner_club_policy:' || p_organization_id::text,
      0
    )
  );

  SELECT event.*
  INTO v_existing_event
  FROM plugin_data.csf_partner_club_term_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_event.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing_event.event_type <> 'decision_recorded'
      OR v_existing_event.metadata ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That review request identifier is already bound to a different review.';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'partnerClubTermId', v_existing_event.partner_club_term_id,
      'changed', coalesce((v_existing_event.metadata ->> 'changed')::boolean, true),
      'idempotent', true,
      'requestId', p_request_id
    );
  END IF;

  SELECT record.*
  INTO v_term_record
  FROM plugin_data.csf_partner_club_terms AS record
  WHERE record.organization_id = p_organization_id
    AND record.id = p_partner_club_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That club semester record was not found.';
  END IF;

  v_term_before := pg_catalog.jsonb_build_object(
    'allocationSatisfied', v_term_record.allocation_satisfied,
    'policyNotes', v_term_record.policy_notes
  );

  -- A NULL p_policy_notes means "leave the notes alone", which is what a
  -- one-click verdict from the directory table sends. Passing an empty string
  -- is the explicit clear.
  UPDATE plugin_data.csf_partner_club_terms
  SET
    allocation_satisfied = v_allocation_satisfied,
    policy_notes = CASE
      WHEN p_policy_notes IS NULL THEN plugin_data.csf_partner_club_terms.policy_notes
      ELSE v_policy_notes
    END,
    reviewed_by = p_actor_user_id,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_partner_club_term_id
  RETURNING * INTO v_term_record;

  v_term_after := pg_catalog.jsonb_build_object(
    'allocationSatisfied', v_term_record.allocation_satisfied,
    'policyNotes', v_term_record.policy_notes
  );
  v_changed := v_term_before IS DISTINCT FROM v_term_after;

  -- previous and next standing are deliberately the SAME value: this records
  -- that the review happened without claiming the club's standing moved.
  INSERT INTO plugin_data.csf_partner_club_term_events (
    organization_id, partner_club_term_id, event_type,
    previous_workflow_status, next_workflow_status, actor_user_id, reason,
    occurred_at, metadata, idempotency_key, correlation_id
  ) VALUES (
    p_organization_id, p_partner_club_term_id, 'decision_recorded',
    v_term_record.workflow_status, v_term_record.workflow_status,
    p_actor_user_id,
    CASE v_allocation_choice
      WHEN 'yes' THEN 'Officer approved the club''s point policy.'
      WHEN 'no' THEN 'Officer marked the club''s point policy as needing changes.'
      ELSE 'Officer cleared the club''s point-policy review.'
    END,
    v_now,
    pg_catalog.jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'requestId', p_request_id,
      'partnerClubId', v_term_record.partner_club_id,
      'termId', v_term_record.term_id,
      'allocationReview', v_allocation_choice,
      'changed', v_changed
    ),
    v_idempotency_key,
    p_request_id
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'partner_club.policy_review',
    'csf_partner_club_terms', p_partner_club_term_id, v_term_record.term_id,
    pg_catalog.jsonb_build_object('policy', v_term_before),
    pg_catalog.jsonb_build_object('policy', v_term_after, 'changed', v_changed),
    p_request_id, 'officer_decision', p_partner_club_term_id::text,
    CASE v_allocation_choice
      WHEN 'yes' THEN 'partner_club_policy_approved'
      WHEN 'no' THEN 'partner_club_policy_needs_changes'
      ELSE 'partner_club_policy_saved'
    END
  );

  RETURN pg_catalog.jsonb_build_object(
    'partnerClubTermId', p_partner_club_term_id,
    'changed', v_changed,
    'idempotent', false,
    'requestId', p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_policy_review(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_partner_club_policy_review(
  uuid, uuid, uuid, uuid, text, text
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_set_partner_club_policy_review(
  uuid, uuid, uuid, uuid, text, text
) IS 'Service-only, replay-safe partner-club policy-review verdict. Writes ONLY allocation_satisfied, policy_notes, reviewed_by and reviewed_at; never workflow_status, spreadsheet_url or relationship_status. A NULL p_policy_notes leaves existing notes unchanged.';

COMMIT;

NOTIFY pgrst, 'reload schema';
