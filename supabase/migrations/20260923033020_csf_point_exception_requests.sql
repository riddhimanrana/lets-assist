-- Stage unlisted point requests in the existing submission and proof workflow.
BEGIN;
ALTER TABLE plugin_data.csf_point_submissions ADD COLUMN request_kind text NOT NULL DEFAULT 'standard'
 CHECK(request_kind IN ('standard','exception'));
ALTER TABLE plugin_data.csf_point_submissions ADD CONSTRAINT csf_point_exception_shape CHECK(
 request_kind<>'exception' OR (source='student' AND opportunity_id IS NULL AND partner_club_term_id IS NULL
 AND activity_date IS NOT NULL AND description IS NOT NULL AND char_length(btrim(description))>=8));


CREATE OR REPLACE FUNCTION plugin_data.csf_assert_point_exception_eligibility(p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_points numeric, p_point_type text, p_has_proof boolean, p_allow_closed_activity boolean, p_allow_legacy_manual boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership plugin_data.csf_term_memberships%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_opportunity plugin_data.csf_opportunities%ROWTYPE;
  v_partner_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_source_cap numeric(6,2);
  v_effective_cap numeric(6,2);
  v_proof_required boolean := false;
BEGIN
 IF p_opportunity_id IS NOT NULL OR p_partner_club_term_id IS NOT NULL OR p_source IS DISTINCT FROM 'student' THEN
   RAISE EXCEPTION 'An exception request must retain its unstructured student source.';
 END IF;
 IF p_has_proof IS DISTINCT FROM true THEN RAISE EXCEPTION 'Proof is required for an exception request.'; END IF;
  IF p_opportunity_id IS NOT NULL AND p_partner_club_term_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose one structured point source.';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Points must be greater than zero.';
  END IF;
  IF p_point_type IS NULL OR p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF p_source IS NULL OR (p_source NOT IN ('student', 'staff')
    AND NOT (coalesce(p_allow_legacy_manual, false) AND p_source = 'manual')) THEN
    RAISE EXCEPTION 'This point source must use its dedicated reconciliation workflow.';
  END IF;
  IF p_source = 'manual'
    AND (p_opportunity_id IS NOT NULL OR p_partner_club_term_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A manual award cannot use a structured point source.';
  END IF;

  -- Match the canonical semester-close/evidence-writer lock before taking
  -- term-scoped row locks. This prevents a close from racing a validated
  -- point transition after its authority snapshot.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_term_id::text,
    0
  ));

  SELECT profile.*
  INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile.record_status <> 'active' THEN
    RAISE EXCEPTION 'An active CSF profile is required for this point action.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point actions are only available for the current open semester.';
  END IF;

  SELECT membership.*
  INTO v_membership
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_membership.status NOT IN ('accepted', 'active') THEN
    RAISE EXCEPTION 'An accepted or active semester membership is required for this point action.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND OR v_policy.published_at IS NULL THEN
    RAISE EXCEPTION 'A published semester policy is required for this point action.';
  END IF;
  IF p_points > v_policy.max_points_per_activity THEN
    RAISE EXCEPTION 'Points exceed the semester activity limit of %.',
      v_policy.max_points_per_activity;
  END IF;

  IF p_opportunity_id IS NOT NULL THEN
    SELECT opportunity.*
    INTO v_opportunity
    FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.id = p_opportunity_id
      AND opportunity.term_id = p_term_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CSF activity belongs to a different organization or semester.';
    END IF;
    IF (coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status NOT IN ('published', 'closed'))
      OR (NOT coalesce(p_allow_closed_activity, false)
        AND v_opportunity.status <> 'published') THEN
      RAISE EXCEPTION 'This CSF activity is not available for this point action.';
    END IF;
    IF v_opportunity.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded outside member point submissions.';
    END IF;
    -- Rule-driven activities resolve the category from the selected
    -- components; the stored point_type is only the lead category there.
    IF v_opportunity.point_type NOT IN ('non_drive', 'drive')
      OR (v_opportunity.earning_rules IS NULL
        AND v_opportunity.point_type <> p_point_type) THEN
      RAISE EXCEPTION 'Point type does not match the selected CSF activity.';
    END IF;
    IF v_opportunity.cohort_id IS NOT NULL
      AND v_membership.cohort_id IS DISTINCT FROM v_opportunity.cohort_id THEN
      RAISE EXCEPTION 'This CSF activity is assigned to a different class.';
    END IF;

    v_source_cap := coalesce(
      v_opportunity.point_cap,
      CASE WHEN v_opportunity.point_value > 0 THEN v_opportunity.point_value END,
      v_policy.max_points_per_activity
    );
    v_effective_cap := least(v_policy.max_points_per_activity, v_source_cap);
    IF p_points > v_effective_cap THEN
      RAISE EXCEPTION 'Points exceed the selected activity limit of %.', v_effective_cap;
    END IF;
    v_proof_required := v_opportunity.evidence_policy = 'required';
  ELSIF p_partner_club_term_id IS NOT NULL THEN
    SELECT club_term.*
    INTO v_partner_term
    FROM plugin_data.csf_partner_club_terms AS club_term
    JOIN plugin_data.csf_partner_clubs AS club
      ON club.organization_id = club_term.organization_id
     AND club.id = club_term.partner_club_id
    WHERE club_term.organization_id = p_organization_id
      AND club_term.id = p_partner_club_term_id
      AND club_term.term_id = p_term_id
      AND club.status = 'active'
    FOR UPDATE OF club_term, club;
    IF NOT FOUND OR v_partner_term.workflow_status <> 'active' THEN
      RAISE EXCEPTION 'This partner club is not active for the current semester.';
    END IF;
    -- Per-club point-type approvals and caps were removed with the partner
    -- policy simplification; officers vet points manually at approval time.
    -- Only active standing is enforced here, bounded by the semester policy
    -- cap already checked above.
    v_proof_required := p_source = 'student';
  ELSE
    IF p_source = 'student' THEN
      v_proof_required := true;
    ELSE
      -- An authorized staff/manual entry is the only unstructured source that
      -- may intentionally waive a proof file.
      v_proof_required := false;
    END IF;
  END IF;

  IF v_proof_required AND p_has_proof IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A proof file is required for this point action.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_point_submission_row_eligibility(p_submission_id uuid, p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_points numeric, p_point_type text, p_has_proof boolean, p_allow_closed_activity boolean, p_allow_legacy_manual boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM plugin_data.csf_point_submissions WHERE id=p_submission_id AND organization_id=p_organization_id AND request_kind='exception') THEN
 PERFORM plugin_data.csf_assert_point_exception_eligibility(p_organization_id,p_profile_id,p_term_id,p_opportunity_id,p_partner_club_term_id,p_source,p_points,p_point_type,p_has_proof,p_allow_closed_activity,p_allow_legacy_manual);
 ELSE
 PERFORM plugin_data.csf_assert_point_submission_eligibility(p_organization_id,p_profile_id,p_term_id,p_opportunity_id,p_partner_club_term_id,p_source,p_points,p_point_type,p_has_proof,p_allow_closed_activity,p_allow_legacy_manual);
 END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_point_exception_base(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_has_proof boolean := p_file_object_path IS NOT NULL;
  v_status text := CASE WHEN p_file_object_path IS NULL THEN 'submitted' ELSE 'draft' END;
  v_now timestamptz := now();
BEGIN
  IF p_submission_id IS NULL OR p_profile_id IS NULL OR p_term_id IS NULL
    OR p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Point-submission identity is incomplete.';
  END IF;
  IF p_claimed_points IS NULL OR p_claimed_points <= 0 THEN
    RAISE EXCEPTION 'Claimed points must be greater than zero.';
  END IF;
  IF p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF p_opportunity_id IS NOT NULL AND p_partner_club_term_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose one structured point source.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'Point-submission actor is not an organization member.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles AS profile
    WHERE profile.id = p_profile_id
      AND profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
  ) THEN
    RAISE EXCEPTION 'CSF profile was not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_terms AS term
    WHERE term.id = p_term_id
      AND term.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'CSF term was not found.';
  END IF;
  IF p_opportunity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.id = p_opportunity_id
      AND opportunity.organization_id = p_organization_id
      AND opportunity.term_id = p_term_id
  ) THEN
    RAISE EXCEPTION 'CSF activity belongs to a different organization or term.';
  END IF;
  IF p_partner_club_term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_partner_club_terms AS club_term
    WHERE club_term.id = p_partner_club_term_id
      AND club_term.organization_id = p_organization_id
      AND club_term.term_id = p_term_id
  ) THEN
    RAISE EXCEPTION 'Partner-club policy belongs to a different organization or term.';
  END IF;

  IF v_has_proof THEN
    IF p_file_id IS NULL OR p_upload_token IS NULL
      OR nullif(btrim(coalesce(p_file_bucket, '')), '') IS NULL
      OR nullif(btrim(coalesce(p_file_original_filename, '')), '') IS NULL
      OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 THEN
      RAISE EXCEPTION 'Pending proof metadata is incomplete.';
    END IF;
    IF p_file_bucket <> 'plugins' THEN
      RAISE EXCEPTION 'CSF proof must use the private CSF bucket.';
    END IF;
  ELSIF p_file_id IS NOT NULL OR p_upload_token IS NOT NULL OR p_file_bucket IS NOT NULL
    OR p_file_original_filename IS NOT NULL OR p_file_mime_type IS NOT NULL
    OR p_file_size_bytes IS NOT NULL THEN
    RAISE EXCEPTION 'Proof metadata was provided without an object path.';
  END IF;

  INSERT INTO plugin_data.csf_point_submissions (
    id, organization_id, profile_id, term_id, opportunity_id, partner_club_term_id,
    source, request_kind, description, claimed_points, point_type, activity_date, status,
    submitted_by, submitted_at, created_at, updated_at
  ) VALUES (
    p_submission_id, p_organization_id, p_profile_id, p_term_id, p_opportunity_id,
    p_partner_club_term_id, p_source, 'exception', p_description, p_claimed_points, p_point_type,
    p_activity_date, v_status, p_actor_user_id, v_now, v_now, v_now
  );

  IF v_has_proof THEN
    INSERT INTO plugin_data.csf_submission_files (
      id, organization_id, submission_id, profile_id, term_id, bucket, object_path,
      original_filename, mime_type, size_bytes, uploaded_by, upload_status,
      upload_token, upload_correlation_id, created_at, updated_at
    ) VALUES (
      p_file_id, p_organization_id, p_submission_id, p_profile_id, p_term_id,
      p_file_bucket, p_file_object_path, p_file_original_filename, p_file_mime_type,
      p_file_size_bytes, p_actor_user_id, 'pending', p_upload_token, p_correlation_id,
      v_now, v_now
    );
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    term_id, before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, p_profile_id,
    CASE WHEN v_has_proof THEN 'point_submission.proof_pending' ELSE 'point_submission.create' END,
    'csf_point_submissions', p_submission_id, p_term_id, NULL,
    jsonb_build_object(
      'status', v_status,
      'claimedPoints', p_claimed_points,
      'pointType', p_point_type,
      'hasProof', v_has_proof,
      'proofStatus', CASE WHEN v_has_proof THEN 'pending' ELSE NULL END,
      'opportunityId', p_opportunity_id,
      'partnerClubTermId', p_partner_club_term_id
    ),
    p_correlation_id, 'point_submission', p_submission_id::text,
    CASE WHEN v_has_proof THEN 'point_proof_upload_started' ELSE 'point_submission_created' END
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'fileId', p_file_id,
    'status', v_status,
    'correlationId', p_correlation_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_point_exception(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_has_proof boolean := nullif(
    pg_catalog.btrim(coalesce(p_file_object_path, '')),
    ''
  ) IS NOT NULL;
BEGIN
  IF v_description IS NULL OR pg_catalog.length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must contain between 1 and 4000 characters.';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'Interactive point submissions must use a student or staff source.';
  END IF;
  IF p_file_object_path IS NOT NULL AND NOT v_has_proof THEN
    RAISE EXCEPTION 'Proof object path cannot be blank.';
  END IF;

  IF p_source = 'staff' THEN
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY['process_points', 'verify_submissions']::text[]
    );
  ELSE
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY[]::text[]
    );
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the connected member may submit this point claim.';
    END IF;
  END IF;

  PERFORM plugin_data.csf_assert_point_exception_eligibility(
    p_organization_id,
    p_profile_id,
    p_term_id,
    p_opportunity_id,
    p_partner_club_term_id,
    p_source,
    p_claimed_points,
    p_point_type,
    v_has_proof,
    false,
    false
  );

  -- The eligibility helper now holds the canonical semester lock. Revalidate
  -- and lock student ownership only after that lock so begin/finalize/withdraw
  -- all use one deadlock-safe ordering.
  IF p_source = 'student' THEN
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the connected member may submit this point claim.';
    END IF;
  END IF;

  RETURN plugin_data.csf_begin_point_exception_base(
    p_organization_id,
    p_submission_id,
    p_profile_id,
    p_term_id,
    p_opportunity_id,
    p_partner_club_term_id,
    p_source,
    v_description,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    p_actor_user_id,
    p_file_id,
    p_file_bucket,
    p_file_object_path,
    p_file_original_filename,
    p_file_mime_type,
    p_file_size_bytes,
    p_upload_token,
    p_correlation_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_begin_point_exception_request(p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_proof_sha256 text, p_request_id uuid, p_earning_selection jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_source, '')));
  v_original_filename text := nullif(
    pg_catalog.btrim(coalesce(p_file_original_filename, '')),
    ''
  );
  v_mime_type text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_file_mime_type, ''))
  );
  v_proof_sha256 text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_proof_sha256, ''))
  );
  v_has_proof boolean;
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_finalize_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_fail_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_proof plugin_data.csf_submission_files%ROWTYPE;
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_submission_id uuid;
  v_file_id uuid;
  v_upload_token uuid;
  v_object_path text;
  v_begin_state jsonb;
  v_current_state jsonb;
  v_canonical_audit_id uuid;
  v_rules jsonb;
  v_selection jsonb;
  v_calculation jsonb;
  v_earning jsonb;
BEGIN
 IF p_source IS DISTINCT FROM 'student' OR p_opportunity_id IS NOT NULL OR p_partner_club_term_id IS NOT NULL
 OR p_earning_selection IS NOT NULL OR p_activity_date IS NULL OR char_length(btrim(coalesce(p_description,'')))<8
 OR p_file_size_bytes IS NULL OR p_file_size_bytes<=0 THEN
   RAISE EXCEPTION 'An exception request needs a date, explanation, requested points and proof.';
 END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-submission request identifier is required.';
  END IF;
  IF v_description IS NULL OR pg_catalog.length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must contain between 1 and 4000 characters.';
  END IF;
  IF v_source NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'Interactive point submissions must use a student or staff source.';
  END IF;
  IF p_earning_selection IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_earning_selection) <> 'object' THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;

  v_has_proof := v_original_filename IS NOT NULL
    OR v_mime_type <> ''
    OR p_file_size_bytes IS NOT NULL
    OR v_proof_sha256 <> '';
  IF v_has_proof THEN
    IF v_original_filename IS NULL
      OR pg_catalog.length(v_original_filename) > 255
      OR v_mime_type NOT IN (
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'
      )
      OR p_file_size_bytes IS NULL
      OR p_file_size_bytes <= 0
      OR p_file_size_bytes > 10485760
      OR v_proof_sha256 !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Validated proof metadata and digest are required together.';
    END IF;
  ELSE
    v_original_filename := NULL;
    v_mime_type := NULL;
    v_proof_sha256 := NULL;
  END IF;

  -- Current authorization is required before any request receipt is read.
  IF v_source = 'staff' THEN
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY['process_points', 'verify_submissions']::text[]
    );
  ELSE
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY[]::text[]
    );
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only the connected member may submit this point submission.';
    END IF;
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'profileId', p_profile_id,
    'termId', p_term_id,
    'opportunityId', p_opportunity_id,
    'partnerClubTermId', p_partner_club_term_id,
    'source', v_source,
    'requestKind','exception',
    'description', v_description,
    'claimedPoints', p_claimed_points,
    'pointType', p_point_type,
    'activityDate', p_activity_date,
    'hasProof', v_has_proof,
    'proofFilename', v_original_filename,
    'proofMimeType', v_mime_type,
    'proofSizeBytes', p_file_size_bytes,
    'proofSha256', v_proof_sha256
  );
  -- Fingerprints of pre-rules requests stay byte-identical: the selection key
  -- joins the intent only when a caller supplies one.
  IF p_earning_selection IS NOT NULL THEN
    v_intent := v_intent || pg_catalog.jsonb_build_object('earningSelection', p_earning_selection);
  END IF;
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'begin_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.begin_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_point_submissions'
      OR v_receipt.target_id IS NULL
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;

    SELECT submission.*
    INTO v_submission
    FROM plugin_data.csf_point_submissions AS submission
    WHERE submission.organization_id = p_organization_id
      AND submission.id = v_receipt.target_id
      AND submission.profile_id = p_profile_id
      AND submission.term_id = p_term_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The committed point-submission receipt no longer resolves to its submission.';
    END IF;

    v_current_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      v_submission.id
    );
    IF v_has_proof THEN
      BEGIN
        v_file_id := (v_receipt.after_data ->> 'fileId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'The committed point-proof receipt is invalid.';
      END;
      SELECT proof.*
      INTO v_proof
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.id = v_file_id
        AND proof.uploaded_by = p_actor_user_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The committed point-proof receipt no longer resolves to its proof.';
      END IF;

      IF v_submission.status = 'draft' AND v_proof.upload_status = 'pending' THEN
        IF v_receipt.after_data -> 'beginState' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The pending point submission changed. Ask a CSF officer to reconcile it before retrying.';
        END IF;
        PERFORM plugin_data.csf_assert_point_exception_eligibility(
          p_organization_id,
          v_submission.profile_id,
          v_submission.term_id,
          v_submission.opportunity_id,
          v_submission.partner_club_term_id,
          v_submission.source,
          v_submission.claimed_points,
          v_submission.point_type,
          true,
          false,
          false
        );
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'pending',
          'objectPath', v_proof.object_path,
          'uploadToken', v_proof.upload_token,
          'proofSha256', v_proof_sha256,
          'idempotent', true
        );
      END IF;

      SELECT audit.*
      INTO v_finalize_receipt
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.correlation_id = p_request_id
        AND audit.source_type = 'point_proof_finalize_request'
        AND audit.action = 'point_submission.proof_finalize_request_committed'
      LIMIT 1;
      IF v_submission.status = 'submitted'
        AND v_proof.upload_status = 'finalized'
        AND FOUND THEN
        IF v_finalize_receipt.target_id IS DISTINCT FROM v_submission.id
          OR v_finalize_receipt.after_data ->> 'fileId' IS DISTINCT FROM v_proof.id::text
          OR v_finalize_receipt.after_data -> 'state' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The finalized point submission changed. Reload Point submissions.';
        END IF;
        PERFORM plugin_data.csf_assert_point_exception_eligibility(
          p_organization_id,
          v_submission.profile_id,
          v_submission.term_id,
          v_submission.opportunity_id,
          v_submission.partner_club_term_id,
          v_submission.source,
          v_submission.claimed_points,
          v_submission.point_type,
          true,
          false,
          false
        );
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'submitted',
          'idempotent', true
        );
      END IF;

      SELECT audit.*
      INTO v_fail_receipt
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.correlation_id = p_request_id
        AND audit.source_type = 'point_proof_fail_request'
        AND audit.action = 'point_submission.proof_fail_request_committed'
      LIMIT 1;
      IF v_submission.status = 'withdrawn'
        AND v_proof.upload_status = 'failed'
        AND FOUND THEN
        IF v_fail_receipt.target_id IS DISTINCT FROM v_submission.id
          OR v_fail_receipt.after_data ->> 'fileId' IS DISTINCT FROM v_proof.id::text
          OR v_fail_receipt.after_data -> 'state' IS DISTINCT FROM v_current_state THEN
          RAISE EXCEPTION 'The failed point submission changed. Ask a CSF officer to reconcile it.';
        END IF;
        RETURN pg_catalog.jsonb_build_object(
          'submissionId', v_submission.id,
          'fileId', v_proof.id,
          'status', 'failed',
          'idempotent', true
        );
      END IF;
      RAISE EXCEPTION 'The committed point-proof request has a stale lifecycle state.';
    END IF;

    IF v_submission.status IS DISTINCT FROM 'submitted'
      OR v_receipt.after_data -> 'beginState' IS DISTINCT FROM v_current_state THEN
      RAISE EXCEPTION 'The committed point submission is no longer current. Reload Point submissions.';
    END IF;
    PERFORM plugin_data.csf_assert_point_exception_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_submission.claimed_points,
      v_submission.point_type,
      false,
      false,
      false
    );
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', v_submission.id,
      'status', 'submitted',
      'idempotent', true
    );
  END IF;

  -- Internal coordinates are generated only after proving this request has no
  -- prior receipt. A retry can therefore never fork a second proof path.
  v_submission_id := pg_catalog.gen_random_uuid();
  IF v_has_proof THEN
    v_file_id := pg_catalog.gen_random_uuid();
    v_upload_token := pg_catalog.gen_random_uuid();
    v_object_path := p_organization_id::text || '/dvhs-csf'
      || '/profiles/' || p_profile_id::text
      || '/terms/' || p_term_id::text
      || '/submissions/' || v_submission_id::text
      || '/' || pg_catalog.gen_random_uuid()::text || '-proof';
  END IF;

  PERFORM plugin_data.csf_begin_point_exception(
    p_organization_id,
    v_submission_id,
    p_profile_id,
    p_term_id,
    p_opportunity_id,
    p_partner_club_term_id,
    v_source,
    v_description,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    p_actor_user_id,
    v_file_id,
    CASE WHEN v_has_proof THEN 'plugins' ELSE NULL END,
    v_object_path,
    v_original_filename,
    v_mime_type,
    p_file_size_bytes,
    v_upload_token,
    p_request_id
  );

  -- The eligibility helper above locked the activity under the semester lock.
  -- Evaluate the selection against those locked rules, snapshot them onto the
  -- submission, and enforce the per-person cap before the receipt is written.
  IF p_opportunity_id IS NOT NULL THEN
    SELECT activity.*
    INTO v_activity
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.organization_id = p_organization_id
      AND activity.id = p_opportunity_id;
    v_rules := plugin_data.csf_effective_earning_rules(
      v_activity.earning_rules,
      v_activity.point_value,
      v_activity.point_type
    );
    IF v_rules IS NOT NULL THEN
      v_selection := coalesce(
        p_earning_selection,
        plugin_data.csf_default_earning_selection(v_rules)
      );
      IF v_selection IS NULL THEN
        RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
      END IF;
      v_calculation := plugin_data.csf_calculate_earning(v_rules, v_selection);
      IF (v_rules -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
        IF pg_catalog.round(p_claimed_points, 2) <> (v_calculation ->> 'points')::numeric THEN
          RAISE EXCEPTION 'Requested points must match the calculated % for this selection.',
            pg_catalog.trim_scale((v_calculation ->> 'points')::numeric);
        END IF;
        IF p_point_type IS DISTINCT FROM (v_calculation ->> 'pointType') THEN
          RAISE EXCEPTION 'Point type does not match the selected earning components.';
        END IF;
      END IF;
      UPDATE plugin_data.csf_point_submissions
      SET earning_rules_version = v_activity.earning_rules_version,
          earning_rules_snapshot = v_rules,
          earning_selection = v_selection,
          suggested_points = (v_calculation ->> 'suggestedPoints')::numeric
      WHERE organization_id = p_organization_id
        AND id = v_submission_id;
      PERFORM plugin_data.csf_assert_activity_earning_award(
        p_organization_id,
        p_profile_id,
        p_opportunity_id,
        v_submission_id,
        p_claimed_points,
        v_rules,
        v_selection
      );
      v_earning := pg_catalog.jsonb_build_object(
        'rulesVersion', v_activity.earning_rules_version,
        'selection', v_selection,
        'suggestedPoints', v_calculation -> 'suggestedPoints',
        'assessment', v_calculation -> 'assessment'
      );
    END IF;
  END IF;

  v_begin_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    v_submission_id
  );
  IF v_begin_state IS NULL THEN
    RAISE EXCEPTION 'Point-submission begin did not create a canonical submission.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.target_id = v_submission_id
    AND audit.source_type = 'point_submission'
    AND audit.action IN ('point_submission.create', 'point_submission.proof_pending')
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point-submission begin did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    p_profile_id,
    'point_submission.begin_request_committed',
    'csf_point_submissions',
    v_submission_id,
    p_term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'begin_submission',
      'requestFingerprint', v_request_fingerprint,
      'proofDigest', v_proof_sha256,
      'fileId', v_file_id,
      'canonicalAuditId', v_canonical_audit_id,
      'beginState', v_begin_state,
      'earning', v_earning
    ),
    p_request_id,
    'point_action_request',
    v_submission_id::text,
    'point_submission_begin_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', v_submission_id,
    'fileId', v_file_id,
    'status', CASE WHEN v_has_proof THEN 'pending' ELSE 'submitted' END,
    'objectPath', v_object_path,
    'uploadToken', v_upload_token,
    'proofSha256', v_proof_sha256,
    'suggestedPoints', v_calculation -> 'suggestedPoints',
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_point_submission_receipt_state(p_organization_id uuid, p_submission_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'submissionId', submission.id,
    'organizationId', submission.organization_id,
    'profileId', submission.profile_id,
    'termId', submission.term_id,
    'opportunityId', submission.opportunity_id,
    'partnerClubTermId', submission.partner_club_term_id,
    'source', submission.source,
    'descriptionDigest', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(coalesce(submission.description, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'claimedPoints', submission.claimed_points,
    'pointType', submission.point_type,
    'activityDate', submission.activity_date,
    'status', submission.status,
    'submittedBy', submission.submitted_by,
    'submittedAtEpoch', extract(epoch FROM submission.submitted_at),
    'reviewedBy', submission.reviewed_by,
    'reviewedAtEpoch', CASE
      WHEN submission.reviewed_at IS NULL THEN NULL
      ELSE extract(epoch FROM submission.reviewed_at)
    END,
    'reviewNotesDigest', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(coalesce(submission.review_notes, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'createdAtEpoch', extract(epoch FROM submission.created_at),
    'updatedAtEpoch', extract(epoch FROM submission.updated_at),
    'supportingEvidence', pg_catalog.jsonb_build_object(
      'profile', (
        SELECT pg_catalog.jsonb_build_object(
          'recordStatus', profile.record_status,
          'updatedAtEpoch', extract(epoch FROM profile.updated_at)
        )
        FROM plugin_data.csf_profiles AS profile
        WHERE profile.organization_id = submission.organization_id
          AND profile.id = submission.profile_id
      ),
      'term', (
        SELECT pg_catalog.jsonb_build_object(
          'isCurrent', term.is_current,
          'lifecycleStatus', term.lifecycle_status,
          'updatedAtEpoch', extract(epoch FROM term.updated_at)
        )
        FROM plugin_data.csf_terms AS term
        WHERE term.organization_id = submission.organization_id
          AND term.id = submission.term_id
      ),
      'membership', (
        SELECT pg_catalog.jsonb_build_object(
          'membershipId', membership.id,
          'status', membership.status,
          'cohortId', membership.cohort_id,
          'updatedAtEpoch', extract(epoch FROM membership.updated_at)
        )
        FROM plugin_data.csf_term_memberships AS membership
        WHERE membership.organization_id = submission.organization_id
          AND membership.profile_id = submission.profile_id
          AND membership.term_id = submission.term_id
      ),
      'policy', (
        SELECT pg_catalog.jsonb_build_object(
          'publishedAtEpoch', CASE
            WHEN policy.published_at IS NULL THEN NULL
            ELSE extract(epoch FROM policy.published_at)
          END,
          'maxPointsPerActivity', policy.max_points_per_activity,
          'outsideVolunteeringAllowed', policy.outside_volunteering_allowed,
          'updatedAtEpoch', extract(epoch FROM policy.updated_at)
        )
        FROM plugin_data.csf_term_policies AS policy
        WHERE policy.organization_id = submission.organization_id
          AND policy.term_id = submission.term_id
      ),
      'opportunity', (
        SELECT pg_catalog.jsonb_build_object(
          'opportunityId', opportunity.id,
          'termId', opportunity.term_id,
          'cohortId', opportunity.cohort_id,
          'status', opportunity.status,
          'pointValue', opportunity.point_value,
          'pointCap', opportunity.point_cap,
          'pointType', opportunity.point_type,
          'requiresPointSubmission', opportunity.requires_point_submission,
          'evidencePolicy', opportunity.evidence_policy,
          'updatedAtEpoch', extract(epoch FROM opportunity.updated_at)
        )
        FROM plugin_data.csf_opportunities AS opportunity
        WHERE opportunity.organization_id = submission.organization_id
          AND opportunity.id = submission.opportunity_id
      ),
      'partnerClubTerm', (
        SELECT pg_catalog.jsonb_build_object(
          'partnerClubTermId', club_term.id,
          'partnerClubId', club_term.partner_club_id,
          'termId', club_term.term_id,
          'workflowStatus', club_term.workflow_status,
          'updatedAtEpoch', extract(epoch FROM club_term.updated_at),
          'clubStatus', club.status,
          'clubUpdatedAtEpoch', extract(epoch FROM club.updated_at)
        )
        FROM plugin_data.csf_partner_club_terms AS club_term
        JOIN plugin_data.csf_partner_clubs AS club
          ON club.organization_id = club_term.organization_id
         AND club.id = club_term.partner_club_id
        WHERE club_term.organization_id = submission.organization_id
          AND club_term.id = submission.partner_club_term_id
      )
    ),
    'proofs', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'fileId', proof.id,
          'status', proof.upload_status,
          'uploaderId', proof.uploaded_by,
          'uploadCorrelationId', proof.upload_correlation_id,
          'sizeBytes', proof.size_bytes,
          'mimeType', proof.mime_type,
          'finalizedAtEpoch', CASE
            WHEN proof.finalized_at IS NULL THEN NULL
            ELSE extract(epoch FROM proof.finalized_at)
          END,
          'failedAtEpoch', CASE
            WHEN proof.failed_at IS NULL THEN NULL
            ELSE extract(epoch FROM proof.failed_at)
          END,
          'createdAtEpoch', extract(epoch FROM proof.created_at),
          'updatedAtEpoch', extract(epoch FROM proof.updated_at)
        ) ORDER BY proof.created_at, proof.id
      )
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = submission.organization_id
        AND proof.submission_id = submission.id
    ), '[]'::jsonb),
    'reviews', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'reviewId', review.id,
          'actorUserId', review.actor_user_id,
          'action', review.action,
          'previousStatus', review.previous_status,
          'nextStatus', review.next_status,
          'notesDigest', pg_catalog.encode(
            extensions.digest(
              pg_catalog.convert_to(coalesce(review.notes, ''), 'UTF8'),
              'sha256'
            ),
            'hex'
          ),
          'detailsDigest', pg_catalog.encode(
            extensions.digest(
              pg_catalog.convert_to(coalesce(review.details, '{}'::jsonb)::text, 'UTF8'),
              'sha256'
            ),
            'hex'
          ),
          'createdAtEpoch', extract(epoch FROM review.created_at)
        ) ORDER BY review.created_at, review.id
      )
      FROM plugin_data.csf_submission_reviews AS review
      WHERE review.organization_id = submission.organization_id
        AND review.submission_id = submission.id
    ), '[]'::jsonb),
    'credit', (
      SELECT pg_catalog.jsonb_build_object(
        'creditId', credit.id,
        'points', credit.points,
        'pointType', credit.point_type,
        'status', credit.status,
        'verifiedBy', credit.verified_by,
        'verifiedAtEpoch', CASE
          WHEN credit.verified_at IS NULL THEN NULL
          ELSE extract(epoch FROM credit.verified_at)
        END,
        'evidenceDigest', pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(coalesce(credit.evidence, '{}'::jsonb)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        'updatedAtEpoch', extract(epoch FROM credit.updated_at)
      )
      FROM plugin_data.csf_credit_records AS credit
      WHERE credit.organization_id = submission.organization_id
        AND credit.submission_id = submission.id
      ORDER BY credit.created_at DESC, credit.id DESC
      LIMIT 1
    ),
    'appeals', coalesce((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'appealId', appeal.id,
          'status', appeal.status,
          'requestedPoints', appeal.requested_points,
          'submittedBy', appeal.submitted_by,
          'reviewedBy', appeal.reviewed_by,
          'reviewedAtEpoch', CASE
            WHEN appeal.reviewed_at IS NULL THEN NULL
            ELSE extract(epoch FROM appeal.reviewed_at)
          END,
          'correlationId', appeal.correlation_id,
          'decisionCorrelationId', appeal.decision_correlation_id,
          'updatedAtEpoch', extract(epoch FROM appeal.updated_at)
        ) ORDER BY appeal.created_at, appeal.id
      )
      FROM plugin_data.csf_point_appeals AS appeal
      WHERE appeal.organization_id = submission.organization_id
        AND appeal.submission_id = submission.id
    ), '[]'::jsonb)
  )
  || CASE WHEN submission.request_kind='exception' THEN jsonb_build_object('requestKind','exception') ELSE '{}'::jsonb END
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_finalize_point_submission_proof(p_organization_id uuid, p_submission_id uuid, p_file_id uuid, p_upload_token uuid, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_file plugin_data.csf_submission_files%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_lock_term_id uuid;
  v_lock_profile_id uuid;
  v_lock_source text;
BEGIN
  -- Authenticate before looking up private proof or submission evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );

  -- Resolve the semester from the opaque upload identity without exposing any
  -- proof metadata, then serialize with semester close before taking proof or
  -- submission row locks. The locked rows below must still match this snapshot.
  SELECT submission.term_id, submission.profile_id, submission.source
  INTO v_lock_term_id, v_lock_profile_id, v_lock_source
  FROM plugin_data.csf_submission_files AS proof
  JOIN plugin_data.csf_point_submissions AS submission
    ON submission.organization_id = proof.organization_id
   AND submission.id = proof.submission_id
  WHERE proof.organization_id = p_organization_id
    AND proof.submission_id = p_submission_id
    AND proof.id = p_file_id
    AND proof.upload_status = 'pending'
    AND proof.upload_token = p_upload_token
    AND proof.uploaded_by = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending proof identity is invalid or no longer finalizable.';
  END IF;

  IF v_lock_source = 'student' THEN
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_lock_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The connected member may no longer finalize this proof.';
    END IF;
  ELSIF v_lock_source = 'staff' THEN
    -- Lock staff RBAC before the semester lock, matching begin/review ordering.
    PERFORM plugin_data.csf_assert_point_actor_authority(
      p_organization_id,
      p_actor_user_id,
      ARRAY['process_points', 'verify_submissions']::text[]
    );
  ELSE
    RAISE EXCEPTION 'This point source cannot use interactive proof finalization.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  IF v_lock_source = 'student' THEN
    PERFORM 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_lock_profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The connected member may no longer finalize this proof.';
    END IF;
  END IF;

  SELECT proof.*
  INTO v_file
  FROM plugin_data.csf_submission_files AS proof
  WHERE proof.organization_id = p_organization_id
    AND proof.submission_id = p_submission_id
    AND proof.id = p_file_id
  FOR UPDATE;
  IF NOT FOUND OR v_file.upload_status <> 'pending'
    OR v_file.upload_token IS DISTINCT FROM p_upload_token
    OR v_file.uploaded_by IS DISTINCT FROM p_actor_user_id
    OR v_file.bucket <> 'plugins'
    OR nullif(pg_catalog.btrim(v_file.object_path), '') IS NULL
    OR v_file.size_bytes IS NULL OR v_file.size_bytes <= 0 THEN
    RAISE EXCEPTION 'Pending proof identity is invalid or no longer finalizable.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'draft'
    OR v_submission.profile_id IS DISTINCT FROM v_file.profile_id
    OR v_submission.term_id IS DISTINCT FROM v_file.term_id
    OR v_submission.term_id IS DISTINCT FROM v_lock_term_id
    OR v_submission.profile_id IS DISTINCT FROM v_lock_profile_id
    OR v_submission.source IS DISTINCT FROM v_lock_source THEN
    RAISE EXCEPTION 'Point submission is not awaiting this proof finalization.';
  END IF;

  PERFORM plugin_data.csf_assert_point_submission_row_eligibility(p_submission_id,
    p_organization_id,
    v_submission.profile_id,
    v_submission.term_id,
    v_submission.opportunity_id,
    v_submission.partner_club_term_id,
    v_submission.source,
    v_submission.claimed_points,
    v_submission.point_type,
    true,
    false,
    false
  );

  RETURN plugin_data.csf_finalize_point_submission_proof_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    p_file_id,
    p_upload_token,
    p_actor_user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_resubmit_point_submission_request_v2(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_request_id uuid, p_earning_selection jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_activity plugin_data.csf_opportunities%ROWTYPE;
  v_result jsonb;
  v_state jsonb;
  v_canonical_audit_id uuid;
  v_has_finalized_proof boolean := false;
  v_rules jsonb;
  v_selection jsonb;
  v_calculation jsonb;
  v_earning jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-resubmission request identifier is required.';
  END IF;
  IF v_description IS NULL OR pg_catalog.length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must contain between 1 and 4000 characters.';
  END IF;
  IF p_earning_selection IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_earning_selection) <> 'object' THEN
    RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
  END IF;

  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY[]::text[]
  );
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
    AND submission.source = 'student'
    AND EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = submission.organization_id
        AND account.profile_id = submission.profile_id
        AND account.user_id = p_actor_user_id
        AND account.status = 'verified'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the connected member may correct and resubmit this point submission.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'claimedPoints', p_claimed_points,
    'pointType', p_point_type,
    'activityDate', p_activity_date,
    'description', v_description
  );
  IF p_earning_selection IS NOT NULL THEN
    v_intent := v_intent || pg_catalog.jsonb_build_object('earningSelection', p_earning_selection);
  END IF;
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'resubmit_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.resubmit_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_submission_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    v_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      p_submission_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'The resubmitted point submission is no longer current. Reload Point submissions.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = (v_receipt.after_data ->> 'canonicalAuditId')::uuid
        AND audit.correlation_id = p_request_id
        AND audit.action = 'point_submission.resubmit'
        AND audit.target_id = p_submission_id
    ) THEN
      RAISE EXCEPTION 'The resubmission receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', p_submission_id,
      'status', 'submitted',
      'idempotent', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.upload_status <> 'finalized'
  ) THEN
    RAISE EXCEPTION 'Point-submission proof must be finalized before resubmission.';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.upload_status = 'finalized'
      AND proof.bucket = 'plugins'
      AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
  ) INTO v_has_finalized_proof;
  PERFORM plugin_data.csf_assert_point_submission_row_eligibility(p_submission_id,
    p_organization_id,
    v_submission.profile_id,
    v_submission.term_id,
    v_submission.opportunity_id,
    v_submission.partner_club_term_id,
    v_submission.source,
    p_claimed_points,
    p_point_type,
    v_has_finalized_proof,
    false,
    false
  );

  -- A correction is re-evaluated under the activity's current rules, which the
  -- eligibility helper has just locked. The submission keeps its earlier review
  -- history; only its snapshot and suggested points move forward.
  IF v_submission.opportunity_id IS NOT NULL THEN
    SELECT activity.*
    INTO v_activity
    FROM plugin_data.csf_opportunities AS activity
    WHERE activity.organization_id = p_organization_id
      AND activity.id = v_submission.opportunity_id;
    v_rules := plugin_data.csf_effective_earning_rules(
      v_activity.earning_rules,
      v_activity.point_value,
      v_activity.point_type
    );
    IF v_rules IS NOT NULL THEN
      v_selection := coalesce(
        p_earning_selection,
        CASE
          WHEN v_submission.earning_rules_version IS NOT DISTINCT FROM v_activity.earning_rules_version
            THEN v_submission.earning_selection
          ELSE NULL
        END,
        plugin_data.csf_default_earning_selection(v_rules)
      );
      IF v_selection IS NULL THEN
        RAISE EXCEPTION 'Choose what you did for this activity before submitting.';
      END IF;
      v_calculation := plugin_data.csf_calculate_earning(v_rules, v_selection);
      IF (v_rules -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
        IF pg_catalog.round(p_claimed_points, 2) <> (v_calculation ->> 'points')::numeric THEN
          RAISE EXCEPTION 'Requested points must match the calculated % for this selection.',
            pg_catalog.trim_scale((v_calculation ->> 'points')::numeric);
        END IF;
        IF p_point_type IS DISTINCT FROM (v_calculation ->> 'pointType') THEN
          RAISE EXCEPTION 'Point type does not match the selected earning components.';
        END IF;
      END IF;
    END IF;
  END IF;

  v_result := plugin_data.csf_resubmit_point_submission(
    p_organization_id,
    p_submission_id,
    p_claimed_points,
    p_point_type,
    p_activity_date,
    v_description,
    p_actor_user_id,
    p_request_id
  );

  IF v_rules IS NOT NULL THEN
    UPDATE plugin_data.csf_point_submissions
    SET earning_rules_version = v_activity.earning_rules_version,
        earning_rules_snapshot = v_rules,
        earning_selection = v_selection,
        suggested_points = (v_calculation ->> 'suggestedPoints')::numeric
    WHERE organization_id = p_organization_id
      AND id = p_submission_id;
    PERFORM plugin_data.csf_assert_activity_earning_award(
      p_organization_id,
      v_submission.profile_id,
      v_submission.opportunity_id,
      p_submission_id,
      p_claimed_points,
      v_rules,
      v_selection
    );
    v_earning := pg_catalog.jsonb_build_object(
      'previousRulesVersion', v_submission.earning_rules_version,
      'rulesVersion', v_activity.earning_rules_version,
      'selection', v_selection,
      'suggestedPoints', v_calculation -> 'suggestedPoints',
      'assessment', v_calculation -> 'assessment'
    );
  END IF;

  v_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    p_submission_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Point resubmission did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'point_submission.resubmit'
    AND audit.target_id = p_submission_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point resubmission did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_submission.profile_id,
    'point_submission.resubmit_request_committed',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'resubmit_submission',
      'requestFingerprint', v_request_fingerprint,
      'canonicalAuditId', v_canonical_audit_id,
      'state', v_state,
      'earning', v_earning
    ),
    p_request_id,
    'point_action_request',
    p_submission_id::text,
    'point_submission_resubmit_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'status', 'submitted',
    'suggestedPoints', v_calculation -> 'suggestedPoints',
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_resubmit_point_submission(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_correlation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_opportunity plugin_data.csf_opportunities%ROWTYPE;
  v_partner_term plugin_data.csf_partner_club_terms%ROWTYPE;
  v_partner_status text;
  v_has_finalized_proof boolean := false;
  v_proof_required boolean := false;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_now timestamptz := now();
BEGIN
  IF p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Point-resubmission actor and correlation are required.';
  END IF;
  IF p_claimed_points IS NULL OR p_claimed_points <= 0 THEN
    RAISE EXCEPTION 'Claimed points must be greater than zero.';
  END IF;
  IF p_point_type NOT IN ('non_drive', 'drive') THEN
    RAISE EXCEPTION 'Point type is invalid.';
  END IF;
  IF v_description IS NULL THEN
    RAISE EXCEPTION 'Description is required.';
  END IF;
  IF length(v_description) > 4000 THEN
    RAISE EXCEPTION 'Description must be 4000 characters or fewer.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
      AND member.status = 'active'
  ) OR NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_submission.profile_id
      AND account.user_id = p_actor_user_id
      AND account.status = 'verified'
  ) THEN
    RAISE EXCEPTION 'Only the connected member may correct and resubmit this point submission.';
  END IF;
  IF v_submission.source <> 'student' THEN
    RAISE EXCEPTION 'Only a member-created point submission can be corrected and resubmitted.';
  END IF;
  IF v_submission.status <> 'needs_action' THEN
    RAISE EXCEPTION 'Only a correction-requested point submission can be resubmitted.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_submission.term_id
      AND term.is_current = true
      AND term.lifecycle_status = 'open'
  ) THEN
    RAISE EXCEPTION 'Point corrections are only available for the current open semester.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = v_submission.profile_id
      AND membership.term_id = v_submission.term_id
      AND membership.status IN ('accepted', 'active')
  ) THEN
    RAISE EXCEPTION 'Your CSF membership must remain approved before resubmitting points.';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = v_submission.term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The semester policy must be published before point corrections can be accepted.';
  END IF;
  IF p_claimed_points > v_policy.max_points_per_activity THEN
    RAISE EXCEPTION 'Claimed points must be between 0 and %.', v_policy.max_points_per_activity;
  END IF;

  IF v_submission.opportunity_id IS NOT NULL THEN
    SELECT opportunity.*
    INTO v_opportunity
    FROM plugin_data.csf_opportunities AS opportunity
    WHERE opportunity.organization_id = p_organization_id
      AND opportunity.id = v_submission.opportunity_id
      AND opportunity.term_id = v_submission.term_id;
    IF NOT FOUND OR v_opportunity.status <> 'published' THEN
      RAISE EXCEPTION 'This CSF activity is not open for member point submissions.';
    END IF;
    IF v_opportunity.requires_point_submission IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Credit for this activity is recorded by an officer; member resubmission is not allowed.';
    END IF;
    IF v_opportunity.point_type NOT IN ('non_drive', 'drive') THEN
      RAISE EXCEPTION 'This activity is not configured for CSF service points.';
    END IF;
    IF v_opportunity.earning_rules IS NULL
      AND v_opportunity.point_type <> p_point_type THEN
      RAISE EXCEPTION 'Point type does not match the selected activity.';
    END IF;
    IF v_opportunity.point_value > 0 AND p_claimed_points > v_opportunity.point_value THEN
      RAISE EXCEPTION 'Claimed points exceed the selected activity limit of %.', v_opportunity.point_value;
    END IF;
    v_proof_required := v_opportunity.evidence_policy = 'required';
  ELSIF v_submission.partner_club_term_id IS NOT NULL THEN
    SELECT club_term.*
    INTO v_partner_term
    FROM plugin_data.csf_partner_club_terms AS club_term
    WHERE club_term.organization_id = p_organization_id
      AND club_term.id = v_submission.partner_club_term_id
      AND club_term.term_id = v_submission.term_id;
    IF NOT FOUND OR v_partner_term.workflow_status <> 'active' THEN
      RAISE EXCEPTION 'This partner club is not approved for the current semester.';
    END IF;
    SELECT club.status
    INTO v_partner_status
    FROM plugin_data.csf_partner_clubs AS club
    WHERE club.organization_id = p_organization_id
      AND club.id = v_partner_term.partner_club_id;
    IF NOT FOUND OR v_partner_status <> 'active' THEN
      RAISE EXCEPTION 'This partner club is not approved for the current semester.';
    END IF;
    -- Per-club point-type approvals and caps were removed with the partner
    -- policy simplification; officers vet points manually at approval time.
    v_proof_required := true;
  ELSE
    IF v_submission.request_kind<>'exception' AND v_policy.outside_volunteering_allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Outside volunteering is not allowed by the published semester policy.';
    END IF;
    v_proof_required := true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.upload_status <> 'finalized'
  ) THEN
    RAISE EXCEPTION 'Point-submission proof must be finalized before resubmission.';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = p_submission_id
      AND proof.upload_status = 'finalized'
  ) INTO v_has_finalized_proof;
  IF v_proof_required AND NOT v_has_finalized_proof THEN
    RAISE EXCEPTION 'A finalized proof file is required before resubmission.';
  END IF;

  UPDATE plugin_data.csf_point_submissions
  SET
    claimed_points = p_claimed_points,
    point_type = p_point_type,
    activity_date = p_activity_date,
    description = v_description,
    status = 'submitted',
    submitted_by = p_actor_user_id,
    submitted_at = v_now,
    reviewed_by = NULL,
    reviewed_at = NULL,
    review_notes = NULL,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = p_submission_id;

  INSERT INTO plugin_data.csf_submission_reviews (
    organization_id, submission_id, actor_user_id, action, previous_status,
    next_status, notes, details
  ) VALUES (
    p_organization_id, p_submission_id, p_actor_user_id, 'resubmitted',
    v_submission.status, 'submitted', NULL,
    jsonb_build_object(
      'correlationId', p_correlation_id,
      'previousClaimedPoints', v_submission.claimed_points,
      'claimedPoints', p_claimed_points,
      'previousPointType', v_submission.point_type,
      'pointType', p_point_type,
      'previousActivityDate', v_submission.activity_date,
      'activityDate', p_activity_date,
      'previousDescription', v_submission.description,
      'description', v_description,
      'proofRetained', v_has_finalized_proof
    )
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, term_id, before_data, after_data, correlation_id, source_type,
    source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_submission.profile_id,
    'point_submission.resubmit', 'csf_point_submissions', p_submission_id,
    v_submission.term_id,
    jsonb_build_object(
      'status', v_submission.status,
      'claimedPoints', v_submission.claimed_points,
      'pointType', v_submission.point_type,
      'activityDate', v_submission.activity_date,
      'description', v_submission.description,
      'reviewedBy', v_submission.reviewed_by,
      'reviewedAt', v_submission.reviewed_at,
      'reviewNotes', v_submission.review_notes
    ),
    jsonb_build_object(
      'status', 'submitted',
      'claimedPoints', p_claimed_points,
      'pointType', p_point_type,
      'activityDate', p_activity_date,
      'description', v_description,
      'proofRetained', v_has_finalized_proof
    ),
    p_correlation_id, 'point_submission', p_submission_id::text,
    'point_submission_corrected_by_member'
  );

  RETURN jsonb_build_object(
    'submissionId', p_submission_id,
    'previousStatus', v_submission.status,
    'status', 'submitted',
    'correlationId', p_correlation_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_exception(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid, p_awarded_point_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_lock_term_id uuid;
  v_review_notes text := nullif(pg_catalog.btrim(coalesce(p_review_notes, '')), '');
BEGIN
  IF p_action IS NULL
    OR p_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
  END IF;

  -- Permission is resolved and locked before any private submission evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['verify_submissions']::text[]
  );

  SELECT submission.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF v_submission.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point submission semester changed; refresh and try again.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point submissions can only be reviewed in the current open semester.';
  END IF;

  IF v_submission.request_kind IS DISTINCT FROM 'exception' THEN RAISE EXCEPTION 'An exception request is required.'; END IF;
  IF p_action = 'approved' THEN
    IF v_review_notes IS NULL OR p_awarded_points IS NULL THEN RAISE EXCEPTION 'Explain the exception and enter the officer award.'; END IF;
    SELECT policy.*
    INTO v_policy
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_policy.published_at IS NULL THEN
      RAISE EXCEPTION 'A published semester policy is required before approving points.';
    END IF;

    IF p_awarded_point_type NOT IN ('non_drive','drive') OR p_awarded_point_type IS NULL THEN RAISE EXCEPTION 'Choose the awarded point type.'; END IF;
    v_submission.point_type:=p_awarded_point_type;
    v_awarded_points := coalesce(p_awarded_points, v_submission.claimed_points);
    IF v_awarded_points IS NULL OR v_awarded_points <= 0
      OR v_awarded_points > v_policy.max_points_per_activity THEN
      RAISE EXCEPTION 'Awarded points must be between 0 and %.',
        v_policy.max_points_per_activity;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status <> 'finalized'
    ) THEN
      RAISE EXCEPTION 'Point-submission proof must be finalized before approval.';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status = 'finalized'
        AND proof.bucket = 'plugins'
        AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
    ) INTO v_has_finalized_proof;

    PERFORM plugin_data.csf_assert_point_exception_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_awarded_points,
      v_submission.point_type,
      v_has_finalized_proof,
      true,
      true
    );

    -- Rule-driven submissions: an award that departs from the calculated value, or
    -- any officer-assessed award, carries a written reason into the audit.
    IF v_submission.earning_rules_snapshot IS NOT NULL
      AND (v_submission.earning_rules_snapshot -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
      IF v_submission.earning_rules_snapshot ->> 'mode' = 'assessment'
        AND v_review_notes IS NULL THEN
        RAISE EXCEPTION 'Officer assessment requires review notes that explain the awarded points.';
      END IF;
      IF v_submission.suggested_points IS NOT NULL
        AND v_awarded_points <> v_submission.suggested_points
        AND v_review_notes IS NULL THEN
        RAISE EXCEPTION 'Explain why the awarded points differ from the calculated %.',
          v_submission.suggested_points;
      END IF;
    END IF;
    IF v_submission.opportunity_id IS NOT NULL THEN
      PERFORM plugin_data.csf_assert_activity_earning_award(
        p_organization_id,
        v_submission.profile_id,
        v_submission.opportunity_id,
        v_submission.id,
        v_awarded_points,
        v_submission.earning_rules_snapshot,
        v_submission.earning_selection
      );
    END IF;
  END IF;

  v_result := plugin_data.csf_review_point_submission_v2_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    p_action,
    p_awarded_points,
    p_review_notes,
    p_actor_user_id
  );
  IF p_action='approved' THEN
    UPDATE plugin_data.csf_credit_records SET point_type=p_awarded_point_type WHERE organization_id=p_organization_id AND submission_id=p_submission_id AND status='verified' AND point_type IS DISTINCT FROM p_awarded_point_type;
  END IF;
  RETURN v_result || jsonb_build_object('awardedPointType',p_awarded_point_type);
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_exception_request(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid, p_request_id uuid, p_awarded_point_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_lock_term_id uuid;
  v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_review_notes text := nullif(
    pg_catalog.btrim(coalesce(p_review_notes, '')),
    ''
  );
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_result jsonb;
  v_state jsonb;
  v_canonical_correlation_id uuid;
  v_canonical_audit_id uuid;
  v_review_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-review request identifier is required.';
  END IF;
  IF v_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
  END IF;
  IF pg_catalog.length(coalesce(v_review_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'Point-review notes must be 4000 characters or fewer.';
  END IF;

  -- Reviewer authority is resolved before private submission or receipt data.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['verify_submissions']::text[]
  );
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;

  v_lock_term_id:=v_submission.term_id;
  v_intent := pg_catalog.jsonb_build_object(
    'requestKind','exception',
    'submissionId', p_submission_id,
    'action', v_action,
    'awardedPoints', p_awarded_points, 'awardedPointType',p_awarded_point_type,
    'reviewNotes', v_review_notes
  );
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'review_submission',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_submission.review_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_submission_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    v_state := plugin_data.csf_point_submission_receipt_state(
      p_organization_id,
      p_submission_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM v_action THEN
      RAISE EXCEPTION 'The reviewed point submission is no longer current. Reload Point submissions.';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = (v_receipt.after_data ->> 'canonicalAuditId')::uuid
        AND audit.correlation_id = (v_receipt.after_data ->> 'canonicalCorrelationId')::uuid
        AND audit.action = 'point_submission.review'
        AND audit.target_id = p_submission_id
    ) OR NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_reviews AS review
      WHERE review.organization_id = p_organization_id
        AND review.id = (v_receipt.after_data ->> 'reviewId')::uuid
        AND review.submission_id = p_submission_id
        AND review.action = v_action
    ) THEN
      RAISE EXCEPTION 'The point-review receipt is missing canonical review evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'submissionId', p_submission_id,
      'status', v_action,
      'awardedPoints', v_receipt.after_data -> 'awardedPoints',
      'idempotent', true
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || v_lock_term_id::text,0));
  -- A correction-requested claim is member-owned until resubmission. It must
  -- never be reviewed a second time while still needs_action.
  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'submitted' OR v_submission.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Only a submitted point claim can be reviewed. A correction-requested claim must be resubmitted by the member first.';
  END IF;

  PERFORM set_config('plugin_data.csf_point_exception_review',jsonb_build_object('organizationId',p_organization_id,'submissionId',p_submission_id,'actorUserId',p_actor_user_id)::text,true);
  v_result := plugin_data.csf_review_point_exception(
    p_organization_id,
    p_submission_id,
    v_action,
    p_awarded_points,
    v_review_notes,
    p_actor_user_id,
    p_awarded_point_type
  );
  BEGIN
    v_canonical_correlation_id := (v_result ->> 'correlationId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Point review returned invalid canonical evidence.';
  END;
  PERFORM set_config('plugin_data.csf_point_exception_review','',true);
  v_state := plugin_data.csf_point_submission_receipt_state(
    p_organization_id,
    p_submission_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM v_action THEN
    RAISE EXCEPTION 'Point review did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = v_canonical_correlation_id
    AND audit.action = 'point_submission.review'
    AND audit.target_id = p_submission_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  SELECT review.id
  INTO v_review_id
  FROM plugin_data.csf_submission_reviews AS review
  WHERE review.organization_id = p_organization_id
    AND review.submission_id = p_submission_id
    AND review.action = v_action
    AND review.details ->> 'correlationId' = v_canonical_correlation_id::text
  ORDER BY review.created_at DESC, review.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL OR v_review_id IS NULL THEN
    RAISE EXCEPTION 'Point review did not create canonical review evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_submission.profile_id,
    'point_submission.review_request_committed',
    'csf_point_submissions',
    p_submission_id,
    v_submission.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'review_submission',
      'requestFingerprint', v_request_fingerprint,
      'canonicalCorrelationId', v_canonical_correlation_id,
      'canonicalAuditId', v_canonical_audit_id,
      'reviewId', v_review_id,
      'awardedPoints', v_result -> 'awardedPoints',
      'state', v_state
    ),
    p_request_id,
    'point_action_request',
    p_submission_id::text,
    'point_submission_review_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'submissionId', p_submission_id,
    'status', v_action,
    'awardedPoints', v_result -> 'awardedPoints',
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_exception_appeal_base(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_correlation_id uuid, p_awarded_points numeric, p_awarded_point_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_appeal plugin_data.csf_point_appeals%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_existing_credit plugin_data.csf_credit_records%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_max_points numeric(6,2);
  v_proof jsonb := '{}'::jsonb;
  v_reason_code text;
  v_now timestamptz := now();
BEGIN
  IF p_decision NOT IN ('approved', 'rejected', 'under_review') THEN
    RAISE EXCEPTION 'Invalid point-appeal decision.';
  END IF;
  IF nullif(btrim(coalesce(p_resolution_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A point-appeal resolution note is required.';
  END IF;
  IF p_actor_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Point-appeal reviewer and correlation are required.';
  END IF;

  SELECT appeal.* INTO v_appeal
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Point appeal was not found.'; END IF;
  IF v_appeal.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'This point appeal has already been decided.';
  END IF;

  SELECT submission.* INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = v_appeal.submission_id
    AND submission.profile_id = v_appeal.profile_id
    AND submission.term_id = v_appeal.term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The appealed point submission was not found.'; END IF;

  IF p_decision = 'approved' THEN
    SELECT policy.max_points_per_activity INTO v_max_points
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id;
    IF v_max_points IS NULL THEN
      RAISE EXCEPTION 'Configure the semester policy before approving an appeal.';
    END IF;
    v_awarded_points := p_awarded_points;
    IF v_awarded_points <= 0 OR v_awarded_points > v_max_points THEN
      RAISE EXCEPTION 'Appeal award must be between 0 and %.', v_max_points;
    END IF;

    SELECT credit.* INTO v_existing_credit
    FROM plugin_data.csf_credit_records AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.submission_id = v_submission.id
    ORDER BY credit.created_at DESC
    LIMIT 1
    FOR UPDATE;

    SELECT jsonb_build_object(
      'proofFileId', proof.id,
      'proofObjectPath', proof.object_path,
      'originalFilename', proof.original_filename
    ) INTO v_proof
    FROM plugin_data.csf_submission_files AS proof
    WHERE proof.organization_id = p_organization_id
      AND proof.submission_id = v_submission.id
      AND proof.upload_status = 'finalized'
    ORDER BY proof.created_at DESC
    LIMIT 1;
    v_proof := coalesce(v_proof, '{}'::jsonb);

    INSERT INTO plugin_data.csf_credit_records (
      organization_id, profile_id, term_id, submission_id, opportunity_id,
      source, points, point_type, status, verified_by, verified_at, evidence, updated_at
    ) VALUES (
      p_organization_id, v_submission.profile_id, v_submission.term_id,
      v_submission.id, v_submission.opportunity_id, 'submission', v_awarded_points,
      p_awarded_point_type, 'verified', p_actor_user_id, v_now,
      jsonb_build_object(
        'description', v_submission.description,
        'appealId', v_appeal.id,
        'appealReason', v_appeal.reason,
        'appealResolution', btrim(p_resolution_notes),
        'previousAward', v_existing_credit.points
      ) || v_proof,
      v_now
    )
    ON CONFLICT (submission_id) WHERE submission_id IS NOT NULL
    DO UPDATE SET
      points = EXCLUDED.points,
      point_type = EXCLUDED.point_type,
      status = 'verified',
      verified_by = EXCLUDED.verified_by,
      verified_at = EXCLUDED.verified_at,
      evidence = EXCLUDED.evidence,
      updated_at = EXCLUDED.updated_at;

    UPDATE plugin_data.csf_point_submissions
    SET status = 'approved', reviewed_by = p_actor_user_id, reviewed_at = v_now,
        review_notes = btrim(p_resolution_notes), updated_at = v_now
    WHERE organization_id = p_organization_id AND id = v_submission.id;

    INSERT INTO plugin_data.csf_submission_reviews (
      organization_id, submission_id, actor_user_id, action, previous_status,
      next_status, notes, details
    ) VALUES (
      p_organization_id, v_submission.id, p_actor_user_id, 'appeal_approved',
      v_submission.status, 'approved', btrim(p_resolution_notes),
      jsonb_build_object(
        'appealId', v_appeal.id,
        'previousAward', v_existing_credit.points,
        'awardedPointType',p_awarded_point_type, 'awardedPoints', v_awarded_points
      )
    );
  END IF;

  v_reason_code := CASE p_decision
    WHEN 'approved' THEN CASE
      WHEN v_appeal.requested_points IS DISTINCT FROM v_submission.claimed_points
        THEN 'point_appeal_adjusted'
      ELSE 'point_appeal_approved'
    END
    WHEN 'rejected' THEN 'point_appeal_rejected'
    ELSE 'point_appeal_under_review'
  END;

  UPDATE plugin_data.csf_point_appeals
  SET status = p_decision, reviewed_by = p_actor_user_id,
      reviewed_at = CASE WHEN p_decision = 'under_review' THEN NULL ELSE v_now END,
      resolution_notes = btrim(p_resolution_notes), updated_at = v_now,
      decision_correlation_id = p_correlation_id,
      decision_reason_code = v_reason_code,
      credit_record_id = CASE
        WHEN p_decision = 'approved' THEN (
          SELECT credit.id FROM plugin_data.csf_credit_records AS credit
          WHERE credit.organization_id = p_organization_id
            AND credit.submission_id = v_submission.id
          ORDER BY credit.created_at DESC LIMIT 1
        )
        ELSE credit_record_id
      END
  WHERE organization_id = p_organization_id AND id = p_appeal_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type, target_id,
    term_id, before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_appeal.profile_id,
    'point_appeal.' || p_decision, 'csf_point_appeals', p_appeal_id, v_appeal.term_id,
    jsonb_build_object(
      'appealStatus', v_appeal.status,
      'submissionStatus', v_submission.status,
      'previousAward', v_existing_credit.points
    ),
    jsonb_build_object(
      'appealStatus', p_decision,
      'submissionStatus', CASE WHEN p_decision = 'approved' THEN 'approved' ELSE v_submission.status END,
      'awardedPointType',p_awarded_point_type, 'awardedPoints', CASE WHEN p_decision = 'approved' THEN v_awarded_points ELSE NULL END,
      'resolutionNotes', btrim(p_resolution_notes)
    ),
    p_correlation_id, 'point_appeal', p_appeal_id::text, v_reason_code
  );

  RETURN jsonb_build_object(
    'appealId', p_appeal_id,
    'submissionId', v_submission.id,
    'status', p_decision,
    'awardedPointType',p_awarded_point_type, 'awardedPoints', CASE WHEN p_decision = 'approved' THEN v_awarded_points ELSE NULL END,
    'correlationId', p_correlation_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_exception_appeal(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_correlation_id uuid, p_awarded_points numeric, p_awarded_point_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_appeal plugin_data.csf_point_appeals%ROWTYPE;
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_credit plugin_data.csf_credit_records%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_resolution_notes text := nullif(pg_catalog.btrim(coalesce(p_resolution_notes, '')), '');
  v_lock_term_id uuid;
BEGIN
  IF p_decision IS NULL
    OR p_decision NOT IN ('approved', 'rejected', 'under_review') THEN
    RAISE EXCEPTION 'Invalid point-appeal decision.';
  END IF;
  IF v_resolution_notes IS NULL OR pg_catalog.length(v_resolution_notes) > 2000 THEN
    RAISE EXCEPTION 'Point-appeal resolution notes must contain between 1 and 2000 characters.';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'A point-appeal decision correlation identifier is required.';
  END IF;

  -- Permission is resolved and locked before any private appeal evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['process_points']::text[]
  );

  SELECT appeal.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point appeal was not found or has already been decided.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  SELECT appeal.*
  INTO v_appeal
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id
  FOR UPDATE;
  IF NOT FOUND OR v_appeal.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'Point appeal was not found or has already been decided.';
  END IF;
  IF v_appeal.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point appeal semester changed; refresh and try again.';
  END IF;

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = v_appeal.submission_id
    AND submission.profile_id = v_appeal.profile_id
    AND submission.term_id = v_appeal.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'The appealed point submission is no longer reviewable.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point appeals can only be reviewed in the current open semester.';
  END IF;

  IF v_submission.request_kind IS DISTINCT FROM 'exception' THEN RAISE EXCEPTION 'An exception appeal is required.'; END IF;
  IF p_decision = 'approved' THEN
    IF p_awarded_point_type IS NULL OR p_awarded_point_type NOT IN ('drive','non_drive') THEN RAISE EXCEPTION 'Choose the awarded point type.'; END IF;
    SELECT policy.*
    INTO v_policy
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_policy.published_at IS NULL THEN
      RAISE EXCEPTION 'A published semester policy is required before approving an appeal.';
    END IF;

    v_awarded_points := p_awarded_points;
    IF v_awarded_points IS NULL OR v_awarded_points <= 0
      OR v_awarded_points > v_policy.max_points_per_activity THEN
      RAISE EXCEPTION 'Appeal award must be between 0 and %.',
        v_policy.max_points_per_activity;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.upload_status <> 'finalized'
    ) THEN
      RAISE EXCEPTION 'Point-submission proof must be finalized before appeal approval.';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = v_submission.id
        AND proof.upload_status = 'finalized'
        AND proof.bucket = 'plugins'
        AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
    ) INTO v_has_finalized_proof;

    PERFORM plugin_data.csf_assert_point_exception_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_awarded_points,
      p_awarded_point_type,
      v_has_finalized_proof,
      true,
      true
    );
    IF v_submission.opportunity_id IS NOT NULL THEN
      PERFORM plugin_data.csf_assert_activity_earning_award(
        p_organization_id,
        v_submission.profile_id,
        v_submission.opportunity_id,
        v_submission.id,
        v_awarded_points,
        v_submission.earning_rules_snapshot,
        v_submission.earning_selection
      );
    END IF;
  END IF;

  SELECT credit.*
  INTO v_credit
  FROM plugin_data.csf_credit_records AS credit
  WHERE credit.organization_id = p_organization_id
    AND credit.submission_id = v_submission.id
  ORDER BY credit.created_at DESC, credit.id DESC
  LIMIT 1
  FOR UPDATE;

  RETURN plugin_data.csf_review_point_exception_appeal_base(
    p_organization_id,
    p_appeal_id,
    p_decision,
    v_resolution_notes,
    p_actor_user_id,
    p_correlation_id,p_awarded_points,p_awarded_point_type
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_exception_appeal_request(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_request_id uuid, p_awarded_points numeric, p_awarded_point_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_decision text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_decision, '')));
  v_resolution_notes text := nullif(
    pg_catalog.btrim(coalesce(p_resolution_notes, '')),
    ''
  );
  v_appeal plugin_data.csf_point_appeals%ROWTYPE;
  v_intent jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
  v_state jsonb;
  v_canonical_audit_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable point-appeal review request identifier is required.';
  END IF;
  IF v_decision NOT IN ('approved', 'rejected', 'under_review') THEN
    RAISE EXCEPTION 'Invalid point-appeal decision.';
  END IF;
  IF v_resolution_notes IS NULL
    OR pg_catalog.length(v_resolution_notes) > 2000 THEN
    RAISE EXCEPTION 'Point-appeal resolution notes must contain between 1 and 2000 characters.';
  END IF;

  -- Reviewer permission is locked before private appeal or receipt data.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['process_points']::text[]
  );
  SELECT appeal.*
  INTO v_appeal
  FROM plugin_data.csf_point_appeals AS appeal
  WHERE appeal.organization_id = p_organization_id
    AND appeal.id = p_appeal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point appeal was not found.';
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'requestKind','exception','awardedPoints',p_awarded_points,'awardedPointType',p_awarded_point_type,
    'appealId', p_appeal_id,
    'decision', v_decision,
    'resolutionNotes', v_resolution_notes
  );
  v_request_fingerprint := plugin_data.csf_point_request_fingerprint(
    'review_appeal',
    p_organization_id,
    p_actor_user_id,
    v_intent
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'plugin_data.csf_point_action_request:'
      || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'point_action_request'
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'point_appeal.review_request_committed'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_id IS DISTINCT FROM p_appeal_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'That point request identifier is already bound to a different change.';
    END IF;
    v_state := plugin_data.csf_point_appeal_receipt_state(
      p_organization_id,
      p_appeal_id
    );
    IF v_receipt.after_data -> 'state' IS DISTINCT FROM v_state
      OR v_state ->> 'status' IS DISTINCT FROM v_decision THEN
      RAISE EXCEPTION 'The reviewed point appeal is no longer current. Reload Point submissions.';
    END IF;
    BEGIN
      v_canonical_audit_id := (v_receipt.after_data ->> 'canonicalAuditId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The point-appeal review receipt is malformed.';
    END;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_admin_audit_events AS audit
      WHERE audit.organization_id = p_organization_id
        AND audit.id = v_canonical_audit_id
        AND audit.correlation_id = p_request_id
        AND audit.action = 'point_appeal.' || v_decision
        AND audit.target_id = p_appeal_id
    ) THEN
      RAISE EXCEPTION 'The point-appeal review receipt is missing canonical audit evidence.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'appealId', p_appeal_id,
      'submissionId', v_state ->> 'submissionId',
      'status', v_decision,
      'awardedPoints', v_receipt.after_data -> 'awardedPoints',
      'idempotent', true
    );
  END IF;

  PERFORM set_config('plugin_data.csf_point_exception_review',jsonb_build_object('organizationId',p_organization_id,'submissionId',v_appeal.submission_id,'actorUserId',p_actor_user_id,'reviewKind','appeal','appealId',p_appeal_id)::text,true);
  v_result := plugin_data.csf_review_point_exception_appeal(
    p_organization_id,
    p_appeal_id,
    v_decision,
    v_resolution_notes,
    p_actor_user_id,
    p_request_id,p_awarded_points,p_awarded_point_type
  );
  PERFORM set_config('plugin_data.csf_point_exception_review','',true);
  v_state := plugin_data.csf_point_appeal_receipt_state(
    p_organization_id,
    p_appeal_id
  );
  IF v_state ->> 'status' IS DISTINCT FROM v_decision THEN
    RAISE EXCEPTION 'Point-appeal review did not commit the requested state.';
  END IF;
  SELECT audit.id
  INTO v_canonical_audit_id
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'point_appeal.' || v_decision
    AND audit.target_id = p_appeal_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1;
  IF v_canonical_audit_id IS NULL THEN
    RAISE EXCEPTION 'Point-appeal review did not create canonical audit evidence.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    actor_profile_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    v_appeal.profile_id,
    'point_appeal.review_request_committed',
    'csf_point_appeals',
    p_appeal_id,
    v_appeal.term_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'operation', 'review_appeal',
      'requestFingerprint', v_request_fingerprint,
      'canonicalAuditId', v_canonical_audit_id,
      'awardedPoints', v_result -> 'awardedPoints',
      'state', v_state
    ),
    p_request_id,
    'point_action_request',
    p_appeal_id::text,
    'point_appeal_review_request_committed'
  );

  RETURN pg_catalog.jsonb_build_object(
    'appealId', p_appeal_id,
    'submissionId', v_state ->> 'submissionId',
    'status', v_decision,
    'awardedPoints', v_result -> 'awardedPoints',
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_point_submission_v2(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_submission plugin_data.csf_point_submissions%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_policy plugin_data.csf_term_policies%ROWTYPE;
  v_awarded_points numeric(6,2);
  v_has_finalized_proof boolean := false;
  v_lock_term_id uuid;
  v_review_notes text := nullif(pg_catalog.btrim(coalesce(p_review_notes, '')), '');
BEGIN
  IF p_action IS NULL
    OR p_action NOT IN ('approved', 'rejected', 'needs_action', 'duplicate') THEN
    RAISE EXCEPTION 'Invalid point-submission review action.';
  END IF;

  -- Permission is resolved and locked before any private submission evidence.
  PERFORM plugin_data.csf_assert_point_actor_authority(
    p_organization_id,
    p_actor_user_id,
    ARRAY['verify_submissions']::text[]
  );

  SELECT submission.term_id
  INTO v_lock_term_id
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || v_lock_term_id::text,
    0
  ));

  SELECT submission.*
  INTO v_submission
  FROM plugin_data.csf_point_submissions AS submission
  WHERE submission.organization_id = p_organization_id
    AND submission.id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Point submission was not found.';
  END IF;
  IF v_submission.term_id IS DISTINCT FROM v_lock_term_id THEN
    RAISE EXCEPTION 'Point submission semester changed; refresh and try again.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_submission.term_id
  FOR UPDATE;
  IF NOT FOUND OR v_term.is_current IS DISTINCT FROM true
    OR v_term.lifecycle_status <> 'open' THEN
    RAISE EXCEPTION 'Point submissions can only be reviewed in the current open semester.';
  END IF;

  IF p_action='approved' AND v_submission.request_kind='exception' THEN RAISE EXCEPTION 'Explicit exception review is required before awarding points.'; END IF;
  IF p_action = 'approved' THEN
    SELECT policy.*
    INTO v_policy
    FROM plugin_data.csf_term_policies AS policy
    WHERE policy.organization_id = p_organization_id
      AND policy.term_id = v_submission.term_id
    FOR UPDATE;
    IF NOT FOUND OR v_policy.published_at IS NULL THEN
      RAISE EXCEPTION 'A published semester policy is required before approving points.';
    END IF;

    v_awarded_points := coalesce(p_awarded_points, v_submission.claimed_points);
    IF v_awarded_points IS NULL OR v_awarded_points <= 0
      OR v_awarded_points > v_policy.max_points_per_activity THEN
      RAISE EXCEPTION 'Awarded points must be between 0 and %.',
        v_policy.max_points_per_activity;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status <> 'finalized'
    ) THEN
      RAISE EXCEPTION 'Point-submission proof must be finalized before approval.';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM plugin_data.csf_submission_files AS proof
      WHERE proof.organization_id = p_organization_id
        AND proof.submission_id = p_submission_id
        AND proof.upload_status = 'finalized'
        AND proof.bucket = 'plugins'
        AND nullif(pg_catalog.btrim(proof.object_path), '') IS NOT NULL
    ) INTO v_has_finalized_proof;

    PERFORM plugin_data.csf_assert_point_submission_eligibility(
      p_organization_id,
      v_submission.profile_id,
      v_submission.term_id,
      v_submission.opportunity_id,
      v_submission.partner_club_term_id,
      v_submission.source,
      v_awarded_points,
      v_submission.point_type,
      v_has_finalized_proof,
      true,
      true
    );

    -- Rule-driven submissions: an award that departs from the calculated value, or
    -- any officer-assessed award, carries a written reason into the audit.
    IF v_submission.earning_rules_snapshot IS NOT NULL
      AND (v_submission.earning_rules_snapshot -> 'legacy') IS DISTINCT FROM 'true'::jsonb THEN
      IF v_submission.earning_rules_snapshot ->> 'mode' = 'assessment'
        AND v_review_notes IS NULL THEN
        RAISE EXCEPTION 'Officer assessment requires review notes that explain the awarded points.';
      END IF;
      IF v_submission.suggested_points IS NOT NULL
        AND v_awarded_points <> v_submission.suggested_points
        AND v_review_notes IS NULL THEN
        RAISE EXCEPTION 'Explain why the awarded points differ from the calculated %.',
          v_submission.suggested_points;
      END IF;
    END IF;
    IF v_submission.opportunity_id IS NOT NULL THEN
      PERFORM plugin_data.csf_assert_activity_earning_award(
        p_organization_id,
        v_submission.profile_id,
        v_submission.opportunity_id,
        v_submission.id,
        v_awarded_points,
        v_submission.earning_rules_snapshot,
        v_submission.earning_selection
      );
    END IF;
  END IF;

  RETURN plugin_data.csf_review_point_submission_v2_authority_base_20260810(
    p_organization_id,
    p_submission_id,
    p_action,
    p_awarded_points,
    p_review_notes,
    p_actor_user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION plugin_data.csf_guard_point_exception_review()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_submission plugin_data.csf_point_submissions%ROWTYPE; v_fence jsonb; v_actor uuid; v_permission text;
BEGIN
 IF TG_TABLE_NAME='csf_point_submissions' THEN
   IF TG_OP='UPDATE' AND NEW.request_kind IS DISTINCT FROM OLD.request_kind THEN RAISE EXCEPTION 'A submission request kind cannot be changed.' USING ERRCODE='55000'; END IF;
   IF NEW.request_kind<>'exception' OR NEW.status<>'approved' OR (TG_OP='UPDATE' AND OLD.status='approved') THEN RETURN NEW; END IF;
   v_submission:=NEW; v_actor:=NEW.reviewed_by;
 ELSE
   v_actor:=NEW.verified_by;
   SELECT * INTO v_submission FROM plugin_data.csf_point_submissions WHERE id=NEW.submission_id AND organization_id=NEW.organization_id;
   IF NOT FOUND OR v_submission.request_kind<>'exception' OR NEW.status<>'verified' THEN RETURN NEW; END IF;
   IF TG_OP='UPDATE' AND ROW(NEW.points,NEW.point_type,NEW.status,NEW.submission_id) IS NOT DISTINCT FROM ROW(OLD.points,OLD.point_type,OLD.status,OLD.submission_id) THEN RETURN NEW; END IF;
 END IF;
 BEGIN v_fence:=nullif(current_setting('plugin_data.csf_point_exception_review',true),'')::jsonb; EXCEPTION WHEN OTHERS THEN v_fence:=NULL; END;
 IF v_fence IS NULL OR v_fence->>'organizationId' IS DISTINCT FROM v_submission.organization_id::text
 OR v_fence->>'submissionId' IS DISTINCT FROM v_submission.id::text
 OR v_fence->>'actorUserId' IS DISTINCT FROM v_actor::text THEN
   RAISE EXCEPTION 'Explicit exception review is required before awarding points.' USING ERRCODE='55000';
 END IF;
 IF v_fence->>'reviewKind'='appeal' THEN
   IF NOT EXISTS(SELECT 1 FROM plugin_data.csf_point_appeals WHERE id::text=v_fence->>'appealId' AND organization_id=v_submission.organization_id AND submission_id=v_submission.id AND status IN('submitted','under_review')) THEN RAISE EXCEPTION 'A current exception appeal is required.' USING ERRCODE='55000'; END IF;
   v_permission:='process_points';
 ELSE v_permission:='verify_submissions'; END IF;
 IF plugin_data.csf_actor_has_permission(v_submission.organization_id,v_actor,v_permission) IS DISTINCT FROM true THEN RAISE EXCEPTION 'The exception reviewer is no longer authorized.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION plugin_data.csf_guard_point_exception_review() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_guard_point_exception_review() TO postgres;
CREATE TRIGGER csf_point_exception_review_guard BEFORE INSERT OR UPDATE ON plugin_data.csf_point_submissions FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_point_exception_review();
CREATE TRIGGER csf_point_exception_credit_guard BEFORE INSERT OR UPDATE ON plugin_data.csf_credit_records FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_point_exception_review();


REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_exception_eligibility(p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_points numeric, p_point_type text, p_has_proof boolean, p_allow_closed_activity boolean, p_allow_legacy_manual boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_point_exception_eligibility(p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_points numeric, p_point_type text, p_has_proof boolean, p_allow_closed_activity boolean, p_allow_legacy_manual boolean) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_point_submission_row_eligibility(p_submission_id uuid, p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_points numeric, p_point_type text, p_has_proof boolean, p_allow_closed_activity boolean, p_allow_legacy_manual boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_point_submission_row_eligibility(p_submission_id uuid, p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_points numeric, p_point_type text, p_has_proof boolean, p_allow_closed_activity boolean, p_allow_legacy_manual boolean) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_exception_base(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_exception_base(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_exception(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_exception(p_organization_id uuid, p_submission_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_id uuid, p_file_bucket text, p_file_object_path text, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_upload_token uuid, p_correlation_id uuid) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_begin_point_exception_request(p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_proof_sha256 text, p_request_id uuid, p_earning_selection jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_begin_point_exception_request(p_organization_id uuid, p_profile_id uuid, p_term_id uuid, p_opportunity_id uuid, p_partner_club_term_id uuid, p_source text, p_description text, p_claimed_points numeric, p_point_type text, p_activity_date date, p_actor_user_id uuid, p_file_original_filename text, p_file_mime_type text, p_file_size_bytes bigint, p_proof_sha256 text, p_request_id uuid, p_earning_selection jsonb) TO service_role, postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_point_submission_receipt_state(p_organization_id uuid, p_submission_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_point_submission_receipt_state(p_organization_id uuid, p_submission_id uuid) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_finalize_point_submission_proof(p_organization_id uuid, p_submission_id uuid, p_file_id uuid, p_upload_token uuid, p_actor_user_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_finalize_point_submission_proof(p_organization_id uuid, p_submission_id uuid, p_file_id uuid, p_upload_token uuid, p_actor_user_id uuid) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission_request_v2(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_request_id uuid, p_earning_selection jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission_request_v2(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_request_id uuid, p_earning_selection jsonb) TO service_role, postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_resubmit_point_submission(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_correlation_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resubmit_point_submission(p_organization_id uuid, p_submission_id uuid, p_claimed_points numeric, p_point_type text, p_activity_date date, p_description text, p_actor_user_id uuid, p_correlation_id uuid) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_exception(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid, p_awarded_point_type text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_exception(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid, p_awarded_point_type text) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_exception_request(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid, p_request_id uuid, p_awarded_point_type text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_exception_request(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid, p_request_id uuid, p_awarded_point_type text) TO service_role, postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_exception_appeal_base(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_correlation_id uuid, p_awarded_points numeric, p_awarded_point_type text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_exception_appeal_base(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_correlation_id uuid, p_awarded_points numeric, p_awarded_point_type text) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_exception_appeal(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_correlation_id uuid, p_awarded_points numeric, p_awarded_point_type text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_exception_appeal(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_correlation_id uuid, p_awarded_points numeric, p_awarded_point_type text) TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_exception_appeal_request(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_request_id uuid, p_awarded_points numeric, p_awarded_point_type text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_exception_appeal_request(p_organization_id uuid, p_appeal_id uuid, p_decision text, p_resolution_notes text, p_actor_user_id uuid, p_request_id uuid, p_awarded_points numeric, p_awarded_point_type text) TO service_role, postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_review_point_submission_v2(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_point_submission_v2(p_organization_id uuid, p_submission_id uuid, p_action text, p_awarded_points numeric, p_review_notes text, p_actor_user_id uuid) TO postgres;

COMMIT;
