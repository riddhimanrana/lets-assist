-- Commit partner-club identity, form-review facts, and the semester point
-- policy as one replay-safe transaction. The lifecycle event is the durable
-- receipt; the club and club-term rows remain current projections.

BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_upsert_partner_club_policy(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_request jsonb
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
  v_club plugin_data.csf_partner_clubs%ROWTYPE;
  v_term_record plugin_data.csf_partner_club_terms%ROWTYPE;
  v_term_record_before plugin_data.csf_partner_club_terms%ROWTYPE;
  v_partner_club_id uuid;
  v_requested_partner_club_id uuid;
  v_returning_club_id uuid;
  v_term_id uuid;
  v_term_code text;
  v_term_status text;
  v_requested_name text;
  v_name text;
  v_contact_name text;
  v_contact_email text;
  v_president_name text;
  v_advisor_name text;
  v_continuation_status text;
  v_club_type text;
  v_recruiting_choice text;
  v_recruiting_new_members boolean;
  v_public_description text;
  v_instagram_url text;
  v_allocation_choice text;
  v_allocation_satisfied boolean;
  v_allocation_notes text;
  v_communication_method text;
  v_point_types text[];
  v_non_drive_points numeric(6,2);
  v_drive_points numeric(6,2);
  v_proof_required boolean;
  v_notes text;
  v_alias_value text;
  v_normalized_alias text;
  v_alias_owner uuid;
  v_batch_id uuid;
  v_partner_club_term_id uuid;
  v_previous_workflow_status text;
  v_club_before jsonb;
  v_club_after jsonb;
  v_term_before jsonb;
  v_term_after jsonb;
  v_summary jsonb;
  v_changed boolean;
  v_term_exists boolean := false;
  v_rows integer;
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable partner-club policy request identifier is required.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The partner-club policy request must be an object.';
  END IF;

  BEGIN
    v_requested_partner_club_id := NULLIF(p_request ->> 'partnerClubId', '')::uuid;
    v_returning_club_id := NULLIF(p_request ->> 'returningClubId', '')::uuid;
    v_term_id := NULLIF(p_request ->> 'termId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Choose valid partner-club and semester records.';
  END;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'A semester is required.';
  END IF;

  v_term_status := NULLIF(pg_catalog.btrim(p_request ->> 'termStatus'), '');
  IF v_term_status NOT IN ('new', 'returning') THEN
    RAISE EXCEPTION 'Choose whether this club is new or returning.';
  END IF;
  IF v_term_status = 'returning' AND v_returning_club_id IS NULL THEN
    RAISE EXCEPTION 'Choose the returning club from the previous term.';
  END IF;
  IF v_term_status = 'returning'
    AND v_requested_partner_club_id IS NOT NULL
    AND v_requested_partner_club_id <> v_returning_club_id THEN
    RAISE EXCEPTION 'The edited club and returning-club record must match.';
  END IF;

  v_requested_name := NULLIF(pg_catalog.btrim(p_request ->> 'name'), '');
  IF v_term_status = 'new' AND v_requested_name IS NULL THEN
    RAISE EXCEPTION 'Partner club name is required.';
  END IF;

  IF pg_catalog.jsonb_typeof(p_request -> 'approvedPointTypes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Approved point types must be an array.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements_text(p_request -> 'approvedPointTypes') AS point_type(value)
    WHERE point_type.value NOT IN ('non_drive', 'drive')
  ) THEN
    RAISE EXCEPTION 'Choose valid partner-club point types.';
  END IF;
  SELECT coalesce(
    pg_catalog.array_agg(DISTINCT point_type.value ORDER BY point_type.value),
    ARRAY[]::text[]
  )
  INTO v_point_types
  FROM pg_catalog.jsonb_array_elements_text(p_request -> 'approvedPointTypes') AS point_type(value);
  IF pg_catalog.cardinality(v_point_types) = 0 THEN
    RAISE EXCEPTION 'Choose at least one point type for this partner club.';
  END IF;

  BEGIN
    v_non_drive_points := coalesce(NULLIF(p_request ->> 'nonDrivePoints', '')::numeric, 0);
    v_drive_points := coalesce(NULLIF(p_request ->> 'drivePoints', '')::numeric, 0);
    v_proof_required := coalesce(NULLIF(p_request ->> 'proofRequired', '')::boolean, false);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Partner-club caps and proof policy are invalid.';
  END;
  IF v_non_drive_points < 0 OR v_drive_points < 0 THEN
    RAISE EXCEPTION 'Partner-club point caps cannot be negative.';
  END IF;

  v_contact_name := NULLIF(pg_catalog.btrim(p_request ->> 'contactName'), '');
  v_contact_email := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_request ->> 'contactEmail')), '');
  v_president_name := NULLIF(pg_catalog.btrim(p_request ->> 'presidentName'), '');
  v_advisor_name := NULLIF(pg_catalog.btrim(p_request ->> 'advisorName'), '');
  v_continuation_status := NULLIF(pg_catalog.btrim(p_request ->> 'continuationStatus'), '');
  v_club_type := NULLIF(pg_catalog.btrim(p_request ->> 'clubType'), '');
  v_public_description := NULLIF(pg_catalog.btrim(p_request ->> 'publicDescription'), '');
  v_instagram_url := NULLIF(pg_catalog.btrim(p_request ->> 'instagramUrl'), '');
  v_allocation_notes := NULLIF(pg_catalog.btrim(p_request ->> 'allocationNotes'), '');
  v_communication_method := NULLIF(pg_catalog.btrim(p_request ->> 'communicationMethod'), '');
  v_notes := NULLIF(pg_catalog.btrim(p_request ->> 'notes'), '');

  v_recruiting_choice := coalesce(NULLIF(p_request ->> 'recruitingNewMembers', ''), 'unknown');
  IF v_recruiting_choice NOT IN ('unknown', 'yes', 'no') THEN
    RAISE EXCEPTION 'Choose a valid recruiting status.';
  END IF;
  v_recruiting_new_members := CASE v_recruiting_choice
    WHEN 'yes' THEN true
    WHEN 'no' THEN false
    ELSE NULL
  END;

  v_allocation_choice := coalesce(NULLIF(p_request ->> 'allocationSatisfied', ''), 'unknown');
  IF v_allocation_choice NOT IN ('unknown', 'yes', 'no') THEN
    RAISE EXCEPTION 'Choose a valid point-policy review status.';
  END IF;
  v_allocation_satisfied := CASE v_allocation_choice
    WHEN 'yes' THEN true
    WHEN 'no' THEN false
    ELSE NULL
  END;

  IF pg_catalog.length(coalesce(v_requested_name, '')) > 500
    OR pg_catalog.length(coalesce(v_contact_email, '')) > 320
    OR pg_catalog.length(coalesce(v_notes, '')) > 4000
    OR pg_catalog.length(coalesce(v_allocation_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'Partner-club policy text is too long.';
  END IF;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'partnerClubId', v_requested_partner_club_id,
          'returningClubId', v_returning_club_id,
          'termId', v_term_id,
          'termStatus', v_term_status,
          'name', v_requested_name,
          'contactName', v_contact_name,
          'contactEmail', v_contact_email,
          'presidentName', v_president_name,
          'advisorName', v_advisor_name,
          'continuationStatus', v_continuation_status,
          'clubType', v_club_type,
          'recruitingNewMembers', v_recruiting_choice,
          'publicDescription', v_public_description,
          'instagramUrl', v_instagram_url,
          'allocationSatisfied', v_allocation_choice,
          'allocationNotes', v_allocation_notes,
          'communicationMethod', v_communication_method,
          'approvedPointTypes', pg_catalog.to_jsonb(v_point_types),
          'nonDrivePoints', v_non_drive_points,
          'drivePoints', v_drive_points,
          'proofRequired', v_proof_required,
          'notes', v_notes
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_idempotency_key := 'policy-request:' || p_request_id::text;

  -- Serializing partner-policy review at the organization boundary protects
  -- canonical names/aliases. Exact term and club rows are locked below.
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
      OR v_existing_event.event_type <> 'point_policy_published'
      OR v_existing_event.metadata ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That partner-club policy request identifier is already bound to a different review.';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'partnerClubId', v_existing_event.metadata ->> 'partnerClubId',
      'partnerClubTermId', v_existing_event.partner_club_term_id,
      'batchId', v_existing_event.metadata ->> 'batchId',
      'changed', coalesce((v_existing_event.metadata ->> 'changed')::boolean, true),
      'idempotent', true,
      'requestId', p_request_id
    );
  END IF;

  SELECT term.code
  INTO v_term_code
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_term_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semester was not found.';
  END IF;

  v_partner_club_id := CASE
    WHEN v_term_status = 'returning' THEN v_returning_club_id
    ELSE v_requested_partner_club_id
  END;

  IF v_partner_club_id IS NOT NULL THEN
    SELECT club.*
    INTO v_club
    FROM plugin_data.csf_partner_clubs AS club
    WHERE club.organization_id = p_organization_id
      AND club.id = v_partner_club_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Partner club was not found.';
    END IF;
    v_club_before := pg_catalog.jsonb_build_object(
      'name', v_club.name,
      'status', v_club.status,
      'approvedPointTypes', pg_catalog.to_jsonb(v_club.approved_point_types),
      'allocationSatisfied', v_club.allocation_satisfied
    );
  END IF;

  IF v_term_status = 'returning' THEN
    v_name := v_club.name;
    v_contact_name := coalesce(v_contact_name, v_club.contact_name);
    v_contact_email := coalesce(v_contact_email, v_club.contact_email);
    v_president_name := coalesce(v_president_name, v_club.president_name);
    v_advisor_name := coalesce(v_advisor_name, v_club.advisor_name);
    v_continuation_status := coalesce(v_continuation_status, v_club.continuation_status, 'returning');
    v_club_type := coalesce(v_club_type, v_club.club_type);
    IF v_recruiting_choice = 'unknown' THEN
      v_recruiting_new_members := v_club.recruiting_new_members;
    END IF;
    v_public_description := coalesce(v_public_description, v_club.public_description);
    v_instagram_url := coalesce(v_instagram_url, v_club.instagram_url);
    IF v_allocation_choice = 'unknown' THEN
      v_allocation_satisfied := v_club.allocation_satisfied;
    END IF;
    v_allocation_notes := coalesce(v_allocation_notes, v_club.allocation_notes);
    v_communication_method := coalesce(v_communication_method, v_club.communication_method);
    v_notes := coalesce(v_notes, v_club.notes);
  ELSE
    v_name := v_requested_name;
    v_continuation_status := coalesce(v_continuation_status, 'new');
  END IF;

  -- The normalized alias is the cross-form canonical identity. It is checked
  -- before a new club is inserted so name collisions cannot leave orphans.
  FOR v_alias_value IN
    SELECT DISTINCT candidate.alias_value
    FROM pg_catalog.unnest(ARRAY[v_name, v_requested_name]) AS candidate(alias_value)
    WHERE NULLIF(pg_catalog.btrim(candidate.alias_value), '') IS NOT NULL
  LOOP
    v_normalized_alias := pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(v_alias_value), '\s+', ' ', 'g')
    );
    SELECT alias.partner_club_id
    INTO v_alias_owner
    FROM plugin_data.csf_partner_club_aliases AS alias
    WHERE alias.organization_id = p_organization_id
      AND alias.normalized_alias = v_normalized_alias
    FOR UPDATE;
    IF FOUND
      AND (v_partner_club_id IS NULL OR v_alias_owner <> v_partner_club_id) THEN
      RAISE EXCEPTION 'That club name or alias already belongs to another canonical partner club.';
    END IF;
  END LOOP;

  IF v_partner_club_id IS NULL THEN
    INSERT INTO plugin_data.csf_partner_clubs (
      organization_id, name, contact_name, contact_email, president_name,
      advisor_name, continuation_status, club_type, recruiting_new_members,
      public_description, instagram_url, allocation_satisfied,
      allocation_notes, communication_method, approved_point_types, notes,
      status, created_by, created_at, updated_at
    ) VALUES (
      p_organization_id, v_name, v_contact_name, v_contact_email, v_president_name,
      v_advisor_name, v_continuation_status, v_club_type, v_recruiting_new_members,
      v_public_description, v_instagram_url, v_allocation_satisfied,
      v_allocation_notes, v_communication_method, v_point_types, v_notes,
      'active', p_actor_user_id, v_now, v_now
    )
    RETURNING * INTO v_club;
    v_partner_club_id := v_club.id;
    v_club_before := NULL;
  ELSE
    UPDATE plugin_data.csf_partner_clubs
    SET
      name = v_name,
      contact_name = v_contact_name,
      contact_email = v_contact_email,
      president_name = v_president_name,
      advisor_name = v_advisor_name,
      continuation_status = v_continuation_status,
      club_type = v_club_type,
      recruiting_new_members = v_recruiting_new_members,
      public_description = v_public_description,
      instagram_url = v_instagram_url,
      allocation_satisfied = v_allocation_satisfied,
      allocation_notes = v_allocation_notes,
      communication_method = v_communication_method,
      approved_point_types = v_point_types,
      notes = v_notes,
      status = 'active',
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_partner_club_id
    RETURNING * INTO v_club;
  END IF;

  v_club_after := pg_catalog.jsonb_build_object(
    'name', v_club.name,
    'status', v_club.status,
    'approvedPointTypes', pg_catalog.to_jsonb(v_club.approved_point_types),
    'allocationSatisfied', v_club.allocation_satisfied
  );

  FOR v_alias_value IN
    SELECT DISTINCT candidate.alias_value
    FROM pg_catalog.unnest(ARRAY[v_name, v_requested_name]) AS candidate(alias_value)
    WHERE NULLIF(pg_catalog.btrim(candidate.alias_value), '') IS NOT NULL
  LOOP
    v_normalized_alias := pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(v_alias_value), '\s+', ' ', 'g')
    );
    INSERT INTO plugin_data.csf_partner_club_aliases (
      organization_id, partner_club_id, alias, normalized_alias, source,
      first_seen_term_id, last_seen_term_id, created_by
    ) VALUES (
      p_organization_id, v_partner_club_id, pg_catalog.btrim(v_alias_value),
      v_normalized_alias, 'staff', v_term_id, v_term_id, p_actor_user_id
    )
    ON CONFLICT (organization_id, normalized_alias) DO UPDATE
    SET
      alias = EXCLUDED.alias,
      last_seen_term_id = EXCLUDED.last_seen_term_id
    WHERE plugin_data.csf_partner_club_aliases.partner_club_id = EXCLUDED.partner_club_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'That club name or alias already belongs to another canonical partner club.';
    END IF;
  END LOOP;

  v_summary := pg_catalog.jsonb_build_object(
    'termStatus', v_term_status,
    'returningClubId', v_returning_club_id,
    'contactEmail', v_contact_email,
    'contactName', v_contact_name,
    'presidentName', v_president_name,
    'advisorName', v_advisor_name,
    'continuationStatus', v_continuation_status,
    'clubType', v_club_type,
    'recruitingNewMembers', v_recruiting_choice,
    'publicDescription', v_public_description,
    'instagramUrl', v_instagram_url,
    'allocationSatisfied', v_allocation_choice,
    'allocationNotes', v_allocation_notes,
    'communicationMethod', v_communication_method,
    'nonDrivePoints', v_non_drive_points,
    'drivePoints', v_drive_points,
    'proofRequired', v_proof_required,
    'approvedPointTypes', pg_catalog.to_jsonb(v_point_types),
    'notes', v_notes,
    'requestId', p_request_id
  );

  INSERT INTO plugin_data.csf_partner_submission_batches (
    organization_id, partner_club_id, term_id, title, source, status,
    submitted_by, reviewed_by, reviewed_at, summary, created_at, updated_at
  ) VALUES (
    p_organization_id, v_partner_club_id, v_term_id,
    v_name || ' ' || v_term_code || ' ' || v_term_status,
    'form', 'verified', p_actor_user_id, p_actor_user_id, v_now, v_summary,
    v_now, v_now
  )
  RETURNING id INTO v_batch_id;

  SELECT record.*
  INTO v_term_record_before
  FROM plugin_data.csf_partner_club_terms AS record
  WHERE record.organization_id = p_organization_id
    AND record.partner_club_id = v_partner_club_id
    AND record.term_id = v_term_id
  FOR UPDATE;
  v_term_exists := FOUND;

  IF v_term_exists THEN
    v_previous_workflow_status := v_term_record_before.workflow_status;
    v_term_before := pg_catalog.jsonb_build_object(
      'relationshipStatus', v_term_record_before.relationship_status,
      'workflowStatus', v_term_record_before.workflow_status,
      'approvedPointTypes', pg_catalog.to_jsonb(v_term_record_before.approved_point_types),
      'nonDrivePoints', v_term_record_before.non_drive_points,
      'drivePoints', v_term_record_before.drive_points,
      'proofRequired', v_term_record_before.proof_required,
      'allocationSatisfied', v_term_record_before.allocation_satisfied,
      'policyNotes', v_term_record_before.policy_notes
    );

    UPDATE plugin_data.csf_partner_club_terms
    SET
      relationship_status = v_term_status,
      workflow_status = 'active',
      approved_point_types = v_point_types,
      non_drive_points = v_non_drive_points,
      drive_points = v_drive_points,
      proof_required = v_proof_required,
      allocation_satisfied = v_allocation_satisfied,
      policy_notes = v_allocation_notes,
      source_batch_id = v_batch_id,
      reviewed_by = p_actor_user_id,
      reviewed_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_term_record_before.id
    RETURNING * INTO v_term_record;
  ELSE
    v_previous_workflow_status := NULL;
    v_term_before := NULL;
    INSERT INTO plugin_data.csf_partner_club_terms (
      organization_id, partner_club_id, term_id, relationship_status,
      workflow_status, approved_point_types, non_drive_points, drive_points,
      proof_required, allocation_satisfied, policy_notes, source_batch_id,
      reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES (
      p_organization_id, v_partner_club_id, v_term_id, v_term_status,
      'active', v_point_types, v_non_drive_points, v_drive_points,
      v_proof_required, v_allocation_satisfied, v_allocation_notes, v_batch_id,
      p_actor_user_id, v_now, v_now, v_now
    )
    RETURNING * INTO v_term_record;
  END IF;

  v_partner_club_term_id := v_term_record.id;
  v_term_after := pg_catalog.jsonb_build_object(
    'relationshipStatus', v_term_record.relationship_status,
    'workflowStatus', v_term_record.workflow_status,
    'approvedPointTypes', pg_catalog.to_jsonb(v_term_record.approved_point_types),
    'nonDrivePoints', v_term_record.non_drive_points,
    'drivePoints', v_term_record.drive_points,
    'proofRequired', v_term_record.proof_required,
    'allocationSatisfied', v_term_record.allocation_satisfied,
    'policyNotes', v_term_record.policy_notes
  );
  v_changed := v_club_before IS DISTINCT FROM v_club_after
    OR v_term_before IS DISTINCT FROM v_term_after;

  INSERT INTO plugin_data.csf_partner_club_term_events (
    organization_id, partner_club_term_id, event_type,
    previous_workflow_status, next_workflow_status, actor_user_id, reason,
    occurred_at, metadata, idempotency_key, correlation_id
  ) VALUES (
    p_organization_id, v_partner_club_term_id, 'point_policy_published',
    v_previous_workflow_status, 'active', p_actor_user_id,
    CASE v_allocation_choice
      WHEN 'yes' THEN 'Partner-club point policy approved through the officer review form.'
      WHEN 'no' THEN 'Partner-club point policy recorded as needing changes through the officer review form.'
      ELSE 'Partner-club point policy saved pending a completed allocation review.'
    END,
    v_now,
    pg_catalog.jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'requestId', p_request_id,
      'partnerClubId', v_partner_club_id,
      'termId', v_term_id,
      'batchId', v_batch_id,
      'relationshipStatus', v_term_status,
      'approvedPointTypes', pg_catalog.to_jsonb(v_point_types),
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
    'csf_partner_club_terms', v_partner_club_term_id, v_term_id,
    pg_catalog.jsonb_build_object('club', v_club_before, 'policy', v_term_before),
    pg_catalog.jsonb_build_object(
      'club', v_club_after,
      'policy', v_term_after,
      'batchId', v_batch_id,
      'changed', v_changed
    ),
    p_request_id, 'officer_decision', v_batch_id::text,
    CASE v_allocation_choice
      WHEN 'yes' THEN 'partner_club_policy_approved'
      WHEN 'no' THEN 'partner_club_policy_needs_changes'
      ELSE 'partner_club_policy_saved'
    END
  );

  RETURN pg_catalog.jsonb_build_object(
    'partnerClubId', v_partner_club_id,
    'partnerClubTermId', v_partner_club_term_id,
    'batchId', v_batch_id,
    'changed', v_changed,
    'idempotent', false,
    'requestId', p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_upsert_partner_club_policy(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_upsert_partner_club_policy(
  uuid, uuid, uuid, jsonb
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_upsert_partner_club_policy(
  uuid, uuid, uuid, jsonb
) IS 'Service-only, permission-checked, replay-safe partner-club policy review that atomically commits canonical club identity, aliases, source facts, current term policy, immutable lifecycle history, and staff audit.';

COMMIT;
