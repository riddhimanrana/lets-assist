-- Separate reusable cohort links from student-specific invitations and replace
-- out-of-band application correction email with an audited, in-product record.

BEGIN;

ALTER TABLE plugin_data.csf_onboarding_links
  ADD COLUMN invitation_scope text NOT NULL DEFAULT 'cohort'
    CHECK (invitation_scope IN ('cohort', 'direct')),
  ADD COLUMN recipient_profile_id uuid,
  ADD COLUMN recipient_email text,
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'link_ready'
    CHECK (delivery_status IN ('link_ready', 'sent', 'accepted', 'expired', 'cancelled')),
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN resend_count integer NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  ADD COLUMN last_sent_at timestamptz,
  ADD COLUMN supersedes_link_id uuid,
  ADD CONSTRAINT csf_onboarding_links_recipient_profile_organization_fkey
    FOREIGN KEY (recipient_profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  ADD CONSTRAINT csf_onboarding_links_scope_check CHECK (
    (
      invitation_scope = 'cohort'
      AND recipient_profile_id IS NULL
      AND recipient_email IS NULL
    )
    OR
    (
      invitation_scope = 'direct'
      AND recipient_profile_id IS NOT NULL
      AND nullif(btrim(recipient_email), '') IS NOT NULL
      AND expires_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT csf_onboarding_links_acceptance_state_check CHECK (
    (delivery_status = 'accepted' AND accepted_at IS NOT NULL)
    OR
    (delivery_status <> 'accepted' AND accepted_by IS NULL AND accepted_at IS NULL)
  );

ALTER TABLE plugin_data.csf_onboarding_links
  ADD CONSTRAINT csf_onboarding_links_id_organization_id_key UNIQUE (id, organization_id),
  ADD CONSTRAINT csf_onboarding_links_supersedes_organization_fkey
    FOREIGN KEY (supersedes_link_id, organization_id)
    REFERENCES plugin_data.csf_onboarding_links (id, organization_id) ON DELETE SET NULL (supersedes_link_id);

CREATE INDEX csf_onboarding_links_direct_state_idx
  ON plugin_data.csf_onboarding_links (
    organization_id,
    invitation_scope,
    delivery_status,
    expires_at,
    created_at DESC
  );

CREATE INDEX csf_onboarding_links_recipient_profile_idx
  ON plugin_data.csf_onboarding_links (organization_id, recipient_profile_id, created_at DESC)
  WHERE recipient_profile_id IS NOT NULL;

CREATE TABLE plugin_data.csf_application_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  check_type plugin_data.csf_application_check_type NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 8 AND 4000),
  proposed_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(proposed_data) = 'object'),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'reviewed', 'rejected', 'withdrawn')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_reason text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csf_application_corrections_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_corrections_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT csf_application_corrections_review_state_check CHECK (
    (
      status = 'submitted'
      AND reviewed_by IS NULL
      AND reviewed_at IS NULL
      AND review_reason IS NULL
    )
    OR
    (
      status IN ('reviewed', 'rejected')
      AND reviewed_at IS NOT NULL
      AND nullif(btrim(review_reason), '') IS NOT NULL
    )
    OR
    (
      status = 'withdrawn'
      AND reviewed_by IS NULL
      AND reviewed_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX csf_application_corrections_open_check_idx
  ON plugin_data.csf_application_correction_requests (
    organization_id,
    application_id,
    check_type
  )
  WHERE status = 'submitted';

CREATE UNIQUE INDEX csf_application_corrections_correlation_idx
  ON plugin_data.csf_application_correction_requests (correlation_id);

CREATE INDEX csf_application_corrections_queue_idx
  ON plugin_data.csf_application_correction_requests (
    organization_id,
    status,
    created_at,
    id
  );

ALTER TABLE plugin_data.csf_application_correction_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_application_correction_requests
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_application_correction_requests TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_direct_invitation(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_recipient_email text,
  p_title text,
  p_expires_at timestamptz,
  p_code text,
  p_actor_user_id uuid
)
RETURNS TABLE (id uuid, code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_cohort_id uuid;
  v_invitation_id uuid;
  v_email text := lower(btrim(p_recipient_email));
BEGIN
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'Invitation expiration must be in the future.';
  END IF;
  IF nullif(v_email, '') IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid recipient email.';
  END IF;
  IF char_length(p_code) < 24 THEN
    RAISE EXCEPTION 'Invitation token is not sufficiently random.';
  END IF;

  SELECT profile.* INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Student record not found.'; END IF;

  PERFORM 1
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semester not found.'; END IF;

  SELECT coalesce(application.cohort_id, cohort_membership.cohort_id)
  INTO v_cohort_id
  FROM (SELECT 1) AS anchor
  LEFT JOIN LATERAL (
    SELECT term_application.cohort_id
    FROM plugin_data.csf_term_applications AS term_application
    WHERE term_application.organization_id = p_organization_id
      AND term_application.profile_id = p_profile_id
      AND term_application.term_id = p_term_id
    ORDER BY term_application.created_at DESC
    LIMIT 1
  ) AS application ON true
  LEFT JOIN LATERAL (
    SELECT membership.cohort_id
    FROM plugin_data.csf_profile_cohort_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = p_profile_id
      AND membership.status = 'active'
    ORDER BY membership.updated_at DESC
    LIMIT 1
  ) AS cohort_membership ON true;

  INSERT INTO plugin_data.csf_onboarding_links AS created_invitation (
    organization_id,
    term_id,
    cohort_id,
    code,
    title,
    link_type,
    invitation_scope,
    recipient_profile_id,
    recipient_email,
    delivery_status,
    expires_at,
    last_sent_at,
    created_by
  ) VALUES (
    p_organization_id,
    p_term_id,
    v_cohort_id,
    p_code,
    coalesce(nullif(btrim(p_title), ''), 'Student invitation'),
    'profile_connect',
    'direct',
    p_profile_id,
    v_email,
    'link_ready',
    p_expires_at,
    now(),
    p_actor_user_id
  )
  RETURNING created_invitation.id INTO v_invitation_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    source_type,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'onboarding.direct_invitation_created',
    'csf_onboarding_links',
    v_invitation_id,
    p_term_id,
    jsonb_build_object(
      'profileId', p_profile_id,
      'emailDomain', split_part(v_email, '@', 2),
      'expiresAt', p_expires_at,
      'deliveryStatus', 'link_ready'
    ),
    'staff_action',
    'direct_invitation_created'
  );

  RETURN QUERY SELECT v_invitation_id, p_code;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_direct_invitation(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_operation text,
  p_code text,
  p_expires_at timestamptz,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_onboarding_links%ROWTYPE;
  v_after plugin_data.csf_onboarding_links%ROWTYPE;
BEGIN
  SELECT invitation.* INTO v_before
  FROM plugin_data.csf_onboarding_links AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.id = p_invitation_id
    AND invitation.invitation_scope = 'direct'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Direct invitation not found.'; END IF;
  IF v_before.delivery_status = 'accepted' THEN
    RAISE EXCEPTION 'An accepted invitation cannot be changed.';
  END IF;

  IF p_operation = 'renew' THEN
    IF p_expires_at <= now() OR char_length(p_code) < 24 THEN
      RAISE EXCEPTION 'A future expiration and a new secure token are required.';
    END IF;
    UPDATE plugin_data.csf_onboarding_links
    SET code = p_code,
        delivery_status = 'link_ready',
        is_active = true,
        expires_at = p_expires_at,
        cancelled_at = NULL,
        resend_count = resend_count + 1,
        last_sent_at = now(),
        updated_at = now()
    WHERE organization_id = p_organization_id AND id = p_invitation_id
    RETURNING * INTO v_after;
  ELSIF p_operation = 'cancel' THEN
    UPDATE plugin_data.csf_onboarding_links
    SET delivery_status = 'cancelled',
        is_active = false,
        cancelled_at = now(),
        updated_at = now()
    WHERE organization_id = p_organization_id AND id = p_invitation_id
    RETURNING * INTO v_after;
  ELSIF p_operation = 'expire' THEN
    UPDATE plugin_data.csf_onboarding_links
    SET delivery_status = 'expired',
        is_active = false,
        expires_at = least(expires_at, now()),
        updated_at = now()
    WHERE organization_id = p_organization_id AND id = p_invitation_id
    RETURNING * INTO v_after;
  ELSE
    RAISE EXCEPTION 'Unsupported invitation operation.';
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    before_data,
    after_data,
    source_type,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'onboarding.direct_invitation_' || p_operation,
    'csf_onboarding_links',
    p_invitation_id,
    v_after.term_id,
    jsonb_build_object('deliveryStatus', v_before.delivery_status, 'expiresAt', v_before.expires_at),
    jsonb_build_object('deliveryStatus', v_after.delivery_status, 'expiresAt', v_after.expires_at, 'resendCount', v_after.resend_count),
    'staff_action',
    'direct_invitation_' || p_operation
  );

  RETURN jsonb_build_object(
    'id', v_after.id,
    'code', v_after.code,
    'deliveryStatus', v_after.delivery_status,
    'expiresAt', v_after.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_accept_direct_invitation(
  p_organization_id uuid,
  p_code text,
  p_user_id uuid,
  p_verified_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invitation plugin_data.csf_onboarding_links%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_existing_role text;
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  SELECT invitation.* INTO v_invitation
  FROM plugin_data.csf_onboarding_links AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.code = p_code
    AND invitation.invitation_scope = 'direct'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Direct invitation not found.'; END IF;
  IF NOT v_invitation.is_active OR v_invitation.delivery_status IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'This invitation is no longer active.';
  END IF;
  IF v_invitation.delivery_status = 'accepted' THEN
    IF v_invitation.accepted_by = p_user_id THEN
      RETURN jsonb_build_object('profileId', v_invitation.recipient_profile_id, 'alreadyAccepted', true);
    END IF;
    RAISE EXCEPTION 'This invitation has already been accepted.';
  END IF;
  IF v_invitation.expires_at <= v_now THEN
    UPDATE plugin_data.csf_onboarding_links
    SET delivery_status = 'expired', is_active = false, updated_at = v_now
    WHERE id = v_invitation.id;
    RAISE EXCEPTION 'This invitation has expired.';
  END IF;
  IF lower(btrim(p_verified_email)) <> lower(btrim(v_invitation.recipient_email)) THEN
    RAISE EXCEPTION 'Sign in with the email address this invitation was created for.';
  END IF;

  SELECT profile.* INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = v_invitation.recipient_profile_id
    AND profile.record_status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'The invited student record is unavailable.'; END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_profile.id
      AND account.status = 'verified'
      AND account.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'This student record is already connected to another verified account.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.user_id = p_user_id
      AND account.status = 'verified'
      AND account.profile_id <> v_profile.id
  ) THEN
    RAISE EXCEPTION 'This account is already connected to another CSF student record.';
  END IF;

  INSERT INTO plugin_data.csf_profile_accounts (
    organization_id, profile_id, user_id, status, is_primary,
    linked_by, linked_at, revoked_at, notes
  ) VALUES (
    p_organization_id, v_profile.id, p_user_id, 'verified', true,
    p_user_id, v_now, NULL, 'Accepted a direct CSF student invitation.'
  )
  ON CONFLICT (organization_id, profile_id, user_id) DO UPDATE
  SET status = 'verified',
      is_primary = true,
      linked_by = EXCLUDED.linked_by,
      linked_at = EXCLUDED.linked_at,
      revoked_at = NULL,
      notes = EXCLUDED.notes;

  INSERT INTO public.organization_members AS existing_member (organization_id, user_id, role, status)
  VALUES (p_organization_id, p_user_id, 'member', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
  SET role = CASE
        WHEN existing_member.role IN ('admin', 'staff') THEN existing_member.role
        ELSE 'member'
      END,
      status = 'active';

  SELECT application.* INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.profile_id = v_profile.id
    AND application.term_id = v_invitation.term_id
    AND application.status = 'accepted'
  ORDER BY application.reviewed_at DESC NULLS LAST, application.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO plugin_data.csf_term_memberships AS existing_membership (
      organization_id, profile_id, term_id, cohort_id, application_id,
      status, accepted_at, activated_at, status_reason, updated_at
    ) VALUES (
      p_organization_id, v_profile.id, v_invitation.term_id,
      coalesce(v_application.cohort_id, v_invitation.cohort_id),
      v_application.id, 'active', v_now, v_now,
      'Verified Let''s Assist account connected through a direct invitation.', v_now
    )
    ON CONFLICT (organization_id, profile_id, term_id) DO UPDATE
    SET cohort_id = EXCLUDED.cohort_id,
        application_id = EXCLUDED.application_id,
        status = 'active',
        activated_at = coalesce(existing_membership.activated_at, EXCLUDED.activated_at),
        status_reason = EXCLUDED.status_reason,
        updated_at = EXCLUDED.updated_at;

    IF coalesce(v_application.cohort_id, v_invitation.cohort_id) IS NOT NULL THEN
      INSERT INTO plugin_data.csf_profile_cohort_memberships (
        organization_id, profile_id, cohort_id, status, updated_at
      ) VALUES (
        p_organization_id, v_profile.id,
        coalesce(v_application.cohort_id, v_invitation.cohort_id),
        'active', v_now
      )
      ON CONFLICT (profile_id, cohort_id) DO UPDATE
      SET status = 'active', updated_at = EXCLUDED.updated_at;
    END IF;
  END IF;

  INSERT INTO plugin_data.csf_profile_link_requests (
    organization_id, onboarding_link_id, term_id, cohort_id, user_id,
    signed_in_email, first_name, middle_name, last_name, preferred_name,
    personal_email, school_email, normalized_first_name, normalized_last_name,
    normalized_personal_email, normalized_school_email, matched_profile_id,
    candidate_profile_ids, match_status, resolution_notes, resolved_by,
    resolved_at, updated_at
  ) VALUES (
    p_organization_id, v_invitation.id, v_invitation.term_id, v_invitation.cohort_id, p_user_id,
    lower(btrim(p_verified_email)), v_profile.first_name, v_profile.middle_name,
    v_profile.last_name, v_profile.preferred_name, v_profile.personal_email,
    v_profile.school_email, v_profile.normalized_first_name,
    v_profile.normalized_last_name, v_profile.normalized_personal_email,
    v_profile.normalized_school_email, v_profile.id, ARRAY[v_profile.id],
    'auto_linked', 'Accepted a student-specific invitation.', p_user_id,
    v_now, v_now
  );

  UPDATE plugin_data.csf_onboarding_links
  SET delivery_status = 'accepted',
      accepted_by = p_user_id,
      accepted_at = v_now,
      is_active = false,
      updated_at = v_now
  WHERE id = v_invitation.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, term_id, after_data, correlation_id, source_type, source_id,
    reason_code
  ) VALUES (
    p_organization_id, p_user_id, v_profile.id,
    'onboarding.direct_invitation_accepted', 'csf_onboarding_links',
    v_invitation.id, v_invitation.term_id,
    jsonb_build_object(
      'profileId', v_profile.id,
      'accountConnected', true,
      'membershipActivated', v_application.id IS NOT NULL
    ),
    v_correlation_id, 'direct_invitation', v_invitation.id::text,
    'direct_invitation_accepted'
  );

  RETURN jsonb_build_object(
    'profileId', v_profile.id,
    'membershipActivated', v_application.id IS NOT NULL,
    'alreadyAccepted', false,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_submit_application_correction(
  p_organization_id uuid,
  p_application_id uuid,
  p_check_type plugin_data.csf_application_check_type,
  p_message text,
  p_proposed_data jsonb,
  p_actor_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_correction_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF char_length(btrim(p_message)) NOT BETWEEN 8 AND 4000 THEN
    RAISE EXCEPTION 'Correction details must be between 8 and 4000 characters.';
  END IF;
  IF jsonb_typeof(coalesce(p_proposed_data, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Correction details must be a JSON object.';
  END IF;

  SELECT application.* INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.'; END IF;

  PERFORM 1
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.profile_id = v_application.profile_id
    AND account.user_id = p_actor_user_id
    AND account.status = 'verified';
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only correct your connected CSF application.'; END IF;

  PERFORM 1
  FROM plugin_data.csf_application_checks AS application_check
  WHERE application_check.organization_id = p_organization_id
    AND application_check.application_id = p_application_id
    AND application_check.check_type = p_check_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected application check is unavailable.'; END IF;

  INSERT INTO plugin_data.csf_application_correction_requests (
    organization_id, application_id, profile_id, check_type, requested_by,
    message, proposed_data, correlation_id
  ) VALUES (
    p_organization_id, p_application_id, v_application.profile_id, p_check_type,
    p_actor_user_id, btrim(p_message), coalesce(p_proposed_data, '{}'::jsonb),
    v_correlation_id
  )
  RETURNING id INTO v_correction_id;

  INSERT INTO plugin_data.csf_application_status_events (
    organization_id, application_id, actor_user_id, previous_status,
    next_status, reason, reason_code, correlation_id, details
  ) VALUES (
    p_organization_id, p_application_id, p_actor_user_id,
    v_application.status, v_application.status,
    'Student submitted corrected application information.',
    'missing_information', v_correlation_id,
    jsonb_build_object('correctionId', v_correction_id, 'checkType', p_check_type)
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, term_id, after_data, correlation_id, source_type, source_id,
    reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_application.profile_id,
    'application.correction_submitted',
    'csf_application_correction_requests', v_correction_id,
    v_application.term_id,
    jsonb_build_object('applicationId', p_application_id, 'checkType', p_check_type),
    v_correlation_id, 'member_action', p_application_id::text,
    'student_correction_submitted'
  );

  RETURN v_correction_id;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_review_application_correction(
  p_organization_id uuid,
  p_correction_id uuid,
  p_decision text,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_correction plugin_data.csf_application_correction_requests%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_next_status text;
BEGIN
  IF p_decision NOT IN ('reviewed', 'rejected') THEN
    RAISE EXCEPTION 'Choose reviewed or rejected.';
  END IF;
  IF char_length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'Explain how the correction was handled.';
  END IF;

  SELECT correction.* INTO v_correction
  FROM plugin_data.csf_application_correction_requests AS correction
  WHERE correction.organization_id = p_organization_id
    AND correction.id = p_correction_id
    AND correction.status = 'submitted'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Correction is no longer awaiting review.'; END IF;

  SELECT application.* INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = v_correction.application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.'; END IF;

  UPDATE plugin_data.csf_application_correction_requests
  SET status = p_decision,
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      review_reason = btrim(p_reason),
      updated_at = now()
  WHERE id = p_correction_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, term_id, before_data, after_data, correlation_id, source_type,
    source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, v_correction.profile_id,
    'application.correction_' || p_decision,
    'csf_application_correction_requests', p_correction_id,
    v_application.term_id,
    jsonb_build_object('status', v_correction.status),
    jsonb_build_object('status', p_decision, 'reason', btrim(p_reason)),
    v_correction.correlation_id, 'staff_action', v_correction.application_id::text,
    'student_correction_' || p_decision
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_create_direct_invitation(uuid, uuid, uuid, text, text, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_update_direct_invitation(uuid, uuid, text, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_accept_direct_invitation(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_submit_application_correction(uuid, uuid, plugin_data.csf_application_check_type, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_review_application_correction(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_create_direct_invitation(uuid, uuid, uuid, text, text, timestamptz, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_direct_invitation(uuid, uuid, text, text, timestamptz, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_accept_direct_invitation(uuid, text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_submit_application_correction(uuid, uuid, plugin_data.csf_application_check_type, text, jsonb, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_application_correction(uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_application_correction_requests IS
  'Student-authored, application-scoped corrections. Reviewed application records remain unchanged until an authorized officer applies the correction.';
COMMENT ON FUNCTION plugin_data.csf_accept_direct_invitation(uuid, text, uuid, text) IS
  'Atomically accepts one student invitation, connects the account, preserves host role, activates eligible membership, and writes the audit event.';

COMMIT;
