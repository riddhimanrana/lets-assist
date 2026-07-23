-- Make reusable class-link profile claims and officer connection decisions
-- transactional. Candidate discovery returns only the single exact verified-
-- email match and never exposes roster search to applicants.

BEGIN;

-- A Let's Assist account represents one student inside an organization.  The
-- procedural checks below provide friendly errors, while this partial unique
-- index is the final concurrency boundary for two claims that race on
-- different invitations or officer-review requests.
CREATE UNIQUE INDEX csf_profile_accounts_one_verified_user_per_org_idx
  ON plugin_data.csf_profile_accounts (organization_id, user_id)
  WHERE status = 'verified';

ALTER TABLE plugin_data.csf_profile_link_requests
  ADD COLUMN claim_correlation_id uuid;

CREATE UNIQUE INDEX csf_profile_link_requests_claim_correlation_idx
  ON plugin_data.csf_profile_link_requests (organization_id, claim_correlation_id)
  WHERE claim_correlation_id IS NOT NULL;

CREATE UNIQUE INDEX csf_profile_link_requests_one_auto_claim_idx
  ON plugin_data.csf_profile_link_requests (
    organization_id,
    onboarding_link_id,
    user_id
  )
  WHERE onboarding_link_id IS NOT NULL
    AND user_id IS NOT NULL
    AND match_status = 'auto_linked';

-- The original tables predate tenant-scoped parent keys.  Keep their original
-- foreign keys for compatibility, but add composite constraints so a link or
-- connection row can never associate organization A with organization B's
-- term, cohort, profile, or invitation.  NOT VALID allows PostgreSQL to install
-- each constraint without an extended table lock; validation then fails closed
-- if a deployment already contains corrupt legacy data.
ALTER TABLE plugin_data.csf_onboarding_links
  ADD CONSTRAINT csf_onboarding_links_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id)
    ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT csf_onboarding_links_cohort_organization_fkey
    FOREIGN KEY (cohort_id, organization_id)
    REFERENCES plugin_data.csf_cohorts (id, organization_id)
    ON DELETE SET NULL (cohort_id) NOT VALID;

ALTER TABLE plugin_data.csf_profile_cohort_memberships
  ADD CONSTRAINT csf_profile_cohort_memberships_profile_organization_fkey
    FOREIGN KEY (profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id)
    ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT csf_profile_cohort_memberships_cohort_organization_fkey
    FOREIGN KEY (cohort_id, organization_id)
    REFERENCES plugin_data.csf_cohorts (id, organization_id)
    ON DELETE CASCADE NOT VALID;

ALTER TABLE plugin_data.csf_profile_link_requests
  ADD CONSTRAINT csf_profile_link_requests_link_organization_fkey
    FOREIGN KEY (onboarding_link_id, organization_id)
    REFERENCES plugin_data.csf_onboarding_links (id, organization_id)
    ON DELETE SET NULL (onboarding_link_id) NOT VALID,
  ADD CONSTRAINT csf_profile_link_requests_term_organization_fkey
    FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id)
    ON DELETE SET NULL (term_id) NOT VALID,
  ADD CONSTRAINT csf_profile_link_requests_cohort_organization_fkey
    FOREIGN KEY (cohort_id, organization_id)
    REFERENCES plugin_data.csf_cohorts (id, organization_id)
    ON DELETE SET NULL (cohort_id) NOT VALID,
  ADD CONSTRAINT csf_profile_link_requests_profile_organization_fkey
    FOREIGN KEY (matched_profile_id, organization_id)
    REFERENCES plugin_data.csf_profiles (id, organization_id)
    ON DELETE SET NULL (matched_profile_id) NOT VALID;

ALTER TABLE plugin_data.csf_onboarding_links
  VALIDATE CONSTRAINT csf_onboarding_links_term_organization_fkey,
  VALIDATE CONSTRAINT csf_onboarding_links_cohort_organization_fkey;
ALTER TABLE plugin_data.csf_profile_cohort_memberships
  VALIDATE CONSTRAINT csf_profile_cohort_memberships_profile_organization_fkey,
  VALIDATE CONSTRAINT csf_profile_cohort_memberships_cohort_organization_fkey;
ALTER TABLE plugin_data.csf_profile_link_requests
  VALIDATE CONSTRAINT csf_profile_link_requests_link_organization_fkey,
  VALIDATE CONSTRAINT csf_profile_link_requests_term_organization_fkey,
  VALIDATE CONSTRAINT csf_profile_link_requests_cohort_organization_fkey,
  VALIDATE CONSTRAINT csf_profile_link_requests_profile_organization_fkey;

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_has_permission(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor_user_id
      AND member.status = 'active'
      AND (
        member.role = 'admin'
        OR EXISTS (
          SELECT 1
          FROM plugin_data.csf_staff_positions AS position
          JOIN plugin_data.csf_role_permissions AS permission
            ON permission.organization_id = position.organization_id
           AND permission.role_id = position.role_id
           AND permission.permission_key = p_permission_key
           AND permission.enabled = true
          WHERE position.organization_id = p_organization_id
            AND position.user_id = p_actor_user_id
            AND position.status = 'active'
            AND (position.starts_at IS NULL OR position.starts_at <= current_date)
            AND (position.ends_at IS NULL OR position.ends_at >= current_date)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_profile_claim_candidate(
  p_organization_id uuid,
  p_code text,
  p_user_id uuid,
  p_verified_email text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link plugin_data.csf_onboarding_links%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_email text := lower(btrim(coalesce(p_verified_email, '')));
  v_candidate_count integer := 0;
  v_candidate_id uuid;
  v_profile_cohort_count integer := 0;
  v_profile_cohort_id uuid;
  v_cohort_label text;
  v_term_label text;
  v_membership_status text;
  v_application_status text;
BEGIN
  IF v_email = '' OR NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = p_user_id
      AND lower(btrim(coalesce(auth_user.email, ''))) = v_email
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;

  SELECT link.* INTO v_link
  FROM plugin_data.csf_onboarding_links AS link
  WHERE link.organization_id = p_organization_id
    AND link.code = p_code
    AND link.invitation_scope = 'cohort'
    AND link.link_type IN ('profile_connect', 'combined')
    AND link.is_active = true
    AND link.delivery_status IN ('link_ready', 'sent')
    AND (link.expires_at IS NULL OR link.expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF class invitation is no longer active.';
  END IF;

  SELECT count(*)::integer, (array_agg(profile.id ORDER BY profile.id))[1]
  INTO v_candidate_count, v_candidate_id
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.record_status = 'active'
    AND (
      profile.normalized_school_email = v_email
      OR profile.normalized_personal_email = v_email
    );

  IF v_candidate_count <> 1 OR v_candidate_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_candidate_count = 0 THEN 'missing' ELSE 'ambiguous' END,
      'candidate', NULL
    );
  END IF;

  SELECT profile.* INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = v_candidate_id;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = v_profile.id
      AND account.status = 'verified'
      AND account.user_id <> p_user_id
  ) OR EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.user_id = p_user_id
      AND account.status = 'verified'
      AND account.profile_id <> v_profile.id
  ) THEN
    RETURN jsonb_build_object('status', 'review', 'candidate', NULL);
  END IF;

  SELECT
    count(*)::integer,
    (array_agg(membership.cohort_id ORDER BY membership.cohort_id))[1]
  INTO v_profile_cohort_count, v_profile_cohort_id
  FROM plugin_data.csf_profile_cohort_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_profile.id
    AND membership.status = 'active';

  IF v_link.cohort_id IS NULL
    OR v_profile_cohort_count <> 1
    OR v_profile_cohort_id IS DISTINCT FROM v_link.cohort_id
  THEN
    -- A class link must never assign its class to an unrelated record or reveal
    -- that record under a false graduating-class label. The normal no-match UI
    -- collects the minimum details needed for officer review.
    RETURN jsonb_build_object('status', 'review', 'candidate', NULL);
  END IF;

  SELECT cohort.label INTO v_cohort_label
  FROM plugin_data.csf_cohorts AS cohort
  WHERE cohort.organization_id = p_organization_id
    AND cohort.id = v_profile_cohort_id;

  SELECT term.label INTO v_term_label
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_link.term_id;

  SELECT membership.status INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_profile.id
    AND membership.term_id = v_link.term_id
  ORDER BY membership.updated_at DESC
  LIMIT 1;

  SELECT application.status INTO v_application_status
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.profile_id = v_profile.id
    AND application.term_id = v_link.term_id
  ORDER BY application.updated_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'status', 'candidate',
    'candidate', jsonb_build_object(
      'profileId', v_profile.id,
      'name', concat_ws(
        ' ',
        coalesce(nullif(v_profile.preferred_name, ''), nullif(v_profile.first_name, '')),
        nullif(v_profile.last_name, '')
      ),
      'legalName', concat_ws(' ', v_profile.first_name, v_profile.last_name),
      'cohortLabel', v_cohort_label,
      'termLabel', v_term_label,
      'membershipContext', coalesce(v_membership_status, v_application_status, 'record found')
    )
  );
END;
$$;

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
DECLARE
  v_link plugin_data.csf_onboarding_links%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_existing_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_email text := lower(btrim(coalesce(p_verified_email, '')));
  v_match_count integer;
  v_correlation_id uuid := gen_random_uuid();
  v_request_id uuid;
  v_now timestamptz := now();
  v_membership_write_count integer := 0;
  v_membership_activated boolean := false;
  v_organization_membership_status text;
  v_profile_account_status text;
  v_profile_cohort_count integer := 0;
  v_profile_cohort_id uuid;
  v_term_lifecycle_status text;
  v_replay_valid boolean := false;
BEGIN
  IF v_email = '' OR NOT EXISTS (
    SELECT 1 FROM auth.users AS auth_user
    WHERE auth_user.id = p_user_id
      AND lower(btrim(coalesce(auth_user.email, ''))) = v_email
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A verified account email is required.';
  END IF;

  SELECT link.* INTO v_link
  FROM plugin_data.csf_onboarding_links AS link
  WHERE link.organization_id = p_organization_id
    AND link.code = p_code
    AND link.invitation_scope = 'cohort'
    AND link.link_type IN ('profile_connect', 'combined')
  FOR UPDATE;
  IF NOT FOUND OR NOT v_link.is_active
    OR v_link.delivery_status NOT IN ('link_ready', 'sent')
    OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= v_now)
  THEN
    RAISE EXCEPTION 'This CSF class invitation is no longer active.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'csf-profile-account:' || p_organization_id::text || ':' || p_user_id::text,
      0
    )
  );

  -- The cohort link is reusable, but one user's successful claim through that
  -- link is not.  Returning the original request makes a retry after an unknown
  -- network outcome idempotent without consuming the link for other students.
  SELECT request.*
  INTO v_existing_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.onboarding_link_id = v_link.id
    AND request.user_id = p_user_id
    AND request.match_status = 'auto_linked'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_request.matched_profile_id IS DISTINCT FROM p_profile_id THEN
      RAISE EXCEPTION 'This invitation was already used to confirm another CSF record.';
    END IF;

    PERFORM 1
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active'
      AND (
        profile.normalized_school_email = v_email
        OR profile.normalized_personal_email = v_email
      )
    FOR UPDATE;
    v_replay_valid := FOUND;

    IF v_replay_valid THEN
      PERFORM 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.profile_id = p_profile_id
        AND account.user_id = p_user_id
        AND account.status = 'verified'
      FOR UPDATE;
      v_replay_valid := FOUND;
    END IF;

    IF v_replay_valid THEN
      PERFORM 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_user_id
        AND member.status = 'active'
      FOR UPDATE;
      v_replay_valid := FOUND;
    END IF;

    IF v_replay_valid THEN
      PERFORM 1
      FROM plugin_data.csf_profile_cohort_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.profile_id = p_profile_id
        AND membership.cohort_id = v_link.cohort_id
        AND membership.status = 'active'
      FOR UPDATE;
      v_replay_valid := FOUND;
    END IF;

    IF v_replay_valid THEN
      v_replay_valid := NOT EXISTS (
        SELECT 1
        FROM plugin_data.csf_profile_cohort_memberships AS membership
        WHERE membership.organization_id = p_organization_id
          AND membership.profile_id = p_profile_id
          AND membership.status = 'active'
          AND membership.cohort_id <> v_link.cohort_id
      ) AND EXISTS (
        SELECT 1
        FROM plugin_data.csf_admin_audit_events AS audit
        WHERE audit.organization_id = p_organization_id
          AND audit.action = 'profile.claim_confirmed'
          AND audit.target_type = 'csf_profile_link_requests'
          AND audit.target_id = v_existing_request.id
          AND audit.correlation_id = v_existing_request.claim_correlation_id
      );
    END IF;

    IF NOT v_replay_valid THEN
      UPDATE plugin_data.csf_profile_link_requests
      SET match_status = 'needs_review',
          matched_profile_id = NULL,
          resolution_notes = 'The previous profile claim could not be revalidated; staff review is required.',
          resolved_by = NULL,
          resolved_at = NULL,
          updated_at = v_now
      WHERE id = v_existing_request.id;

      INSERT INTO plugin_data.csf_admin_audit_events (
        organization_id, actor_user_id, action, target_type, target_id,
        term_id, before_data, after_data, correlation_id, source_type,
        source_id, reason_code
      ) VALUES (
        p_organization_id, p_user_id,
        'profile.claim_revalidation_failed',
        'csf_profile_link_requests', v_existing_request.id,
        v_existing_request.term_id,
        jsonb_build_object(
          'matchStatus', v_existing_request.match_status,
          'profileId', v_existing_request.matched_profile_id
        ),
        jsonb_build_object('matchStatus', 'needs_review'),
        v_correlation_id, 'profile_claim_revalidation',
        v_existing_request.id::text,
        'profile_claim_revalidation_required'
      );

      RETURN jsonb_build_object(
        'profileId', NULL,
        'requestId', v_existing_request.id,
        'termMembershipActivated', false,
        'correlationId', v_correlation_id,
        'idempotentReplay', false,
        'reviewRequired', true
      );
    END IF;

    RETURN jsonb_build_object(
      'profileId', v_existing_request.matched_profile_id,
      'requestId', v_existing_request.id,
      'termMembershipActivated', coalesce((
        SELECT (audit.after_data->>'termMembershipActivated')::boolean
        FROM plugin_data.csf_admin_audit_events AS audit
        WHERE audit.organization_id = p_organization_id
          AND audit.action = 'profile.claim_confirmed'
          AND audit.target_type = 'csf_profile_link_requests'
          AND audit.target_id = v_existing_request.id
          AND audit.correlation_id = v_existing_request.claim_correlation_id
        ORDER BY audit.created_at DESC
        LIMIT 1
      ), false),
      'correlationId', v_existing_request.claim_correlation_id,
      'idempotentReplay', true,
      'reviewRequired', false
    );
  END IF;

  SELECT count(*)::integer INTO v_match_count
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.record_status = 'active'
    AND (profile.normalized_school_email = v_email OR profile.normalized_personal_email = v_email);
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'The verified email does not identify one CSF record.';
  END IF;

  SELECT profile.* INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active'
    AND (profile.normalized_school_email = v_email OR profile.normalized_personal_email = v_email)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The profile claim is no longer valid.'; END IF;

  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.status = 'verified'
      AND account.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'This student record is already connected to another verified account.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.user_id = p_user_id
      AND account.status = 'verified'
      AND account.profile_id <> p_profile_id
  ) THEN
    RAISE EXCEPTION 'This account is already connected to another CSF student record.';
  END IF;

  SELECT
    count(*)::integer,
    (array_agg(membership.cohort_id ORDER BY membership.cohort_id))[1]
  INTO v_profile_cohort_count, v_profile_cohort_id
  FROM plugin_data.csf_profile_cohort_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = p_profile_id
    AND membership.status = 'active';

  IF v_link.cohort_id IS NULL
    OR v_profile_cohort_count <> 1
    OR v_profile_cohort_id IS DISTINCT FROM v_link.cohort_id
  THEN
    RAISE EXCEPTION 'This CSF record belongs to a different class and requires officer review.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_user_id
      AND member.status IS DISTINCT FROM 'active'
  ) THEN
    RAISE EXCEPTION 'This account has inactive organization access; an administrator must review it.';
  END IF;

  INSERT INTO public.organization_members (
    organization_id, user_id, role, status
  ) VALUES (
    p_organization_id, p_user_id, 'member', 'active'
  )
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  SELECT member.status
  INTO v_organization_membership_status
  FROM public.organization_members AS member
  WHERE member.organization_id = p_organization_id
    AND member.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_organization_membership_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'This account has inactive organization access; an administrator must review it.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.user_id = p_user_id
      AND account.status <> 'verified'
  ) THEN
    RAISE EXCEPTION 'This CSF account connection was revoked and requires officer review.';
  END IF;

  INSERT INTO plugin_data.csf_profile_accounts (
    organization_id, profile_id, user_id, status, is_primary,
    linked_by, linked_at, revoked_at, notes
  ) VALUES (
    p_organization_id, p_profile_id, p_user_id, 'verified', true,
    p_user_id, v_now, NULL, 'Confirmed an exact verified-email CSF record match.'
  )
  ON CONFLICT (organization_id, profile_id, user_id) DO NOTHING;

  SELECT account.status
  INTO v_profile_account_status
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.profile_id = p_profile_id
    AND account.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile_account_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'This CSF account connection was revoked and requires officer review.';
  END IF;

  IF v_link.cohort_id IS NOT NULL THEN
    INSERT INTO plugin_data.csf_profile_cohort_memberships (
      organization_id, profile_id, cohort_id, status, updated_at
    ) VALUES (
      p_organization_id, p_profile_id, v_profile_cohort_id, 'active', v_now
    )
    ON CONFLICT (profile_id, cohort_id) DO NOTHING;
  END IF;

  SELECT application.* INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.profile_id = p_profile_id
    AND application.term_id = v_link.term_id
    AND application.cohort_id = v_link.cohort_id
    AND application.status = 'accepted'
  ORDER BY application.reviewed_at DESC NULLS LAST, application.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  SELECT term.lifecycle_status
  INTO v_term_lifecycle_status
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_link.term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The CSF semester for this invitation no longer exists.';
  END IF;

  IF v_application.id IS NOT NULL
    AND v_term_lifecycle_status NOT IN ('closed', 'archived')
  THEN
    INSERT INTO plugin_data.csf_term_memberships AS existing_membership (
      organization_id, profile_id, term_id, cohort_id, application_id,
      status, accepted_at, activated_at, status_reason, updated_at
    ) VALUES (
      p_organization_id, p_profile_id, v_link.term_id,
      coalesce(v_application.cohort_id, v_link.cohort_id), v_application.id,
      'active', v_now, v_now,
      'Verified Let''s Assist account confirmed an exact CSF record match.', v_now
    )
    ON CONFLICT (organization_id, profile_id, term_id) DO UPDATE
    SET cohort_id = EXCLUDED.cohort_id, application_id = EXCLUDED.application_id,
        status = 'active', activated_at = coalesce(existing_membership.activated_at, v_now),
        status_reason = EXCLUDED.status_reason, updated_at = v_now
    WHERE existing_membership.status IN ('pending', 'accepted', 'active')
      AND existing_membership.finalized_closure_id IS NULL;
    GET DIAGNOSTICS v_membership_write_count = ROW_COUNT;
    v_membership_activated := v_membership_write_count > 0;
  END IF;

  INSERT INTO plugin_data.csf_profile_link_requests (
    organization_id, onboarding_link_id, term_id, cohort_id, user_id,
    signed_in_email, first_name, middle_name, last_name, preferred_name,
    personal_email, school_email, normalized_first_name, normalized_last_name,
    normalized_personal_email, normalized_school_email, matched_profile_id,
    candidate_profile_ids, match_status, resolution_notes, resolved_by,
    resolved_at, claim_correlation_id, updated_at
  ) VALUES (
    p_organization_id, v_link.id, v_link.term_id, v_link.cohort_id, p_user_id,
    v_email, v_profile.first_name, v_profile.middle_name, v_profile.last_name,
    v_profile.preferred_name, v_profile.personal_email, v_profile.school_email,
    v_profile.normalized_first_name, v_profile.normalized_last_name,
    v_profile.normalized_personal_email, v_profile.normalized_school_email,
    p_profile_id, ARRAY[p_profile_id], 'auto_linked',
    'Student confirmed the exact verified-email match.', p_user_id, v_now,
    v_correlation_id, v_now
  ) RETURNING id INTO v_request_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, actor_profile_id, action, target_type,
    target_id, term_id, after_data, correlation_id, source_type, source_id,
    reason_code
  ) VALUES (
    p_organization_id, p_user_id, p_profile_id, 'profile.claim_confirmed',
    'csf_profile_link_requests', v_request_id, v_link.term_id,
    jsonb_build_object(
      'profileId', p_profile_id,
      'cohortId', v_link.cohort_id,
      'organizationMembershipActive', true,
      'termMembershipActivated', v_membership_activated
    ),
    v_correlation_id, 'cohort_invitation', v_link.id::text,
    'verified_email_claim_confirmed'
  );

  RETURN jsonb_build_object(
    'profileId', p_profile_id,
    'requestId', v_request_id,
    'termMembershipActivated', v_membership_activated,
    'correlationId', v_correlation_id
  );
END;
$$;

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
DECLARE
  v_link plugin_data.csf_onboarding_links%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_email text := lower(btrim(coalesce(p_verified_email, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_request_id uuid;
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF v_reason IS NULL THEN RAISE EXCEPTION 'A review reason is required.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS auth_user
    WHERE auth_user.id = p_user_id
      AND lower(btrim(coalesce(auth_user.email, ''))) = v_email
      AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'A verified account email is required.'; END IF;

  SELECT link.* INTO v_link
  FROM plugin_data.csf_onboarding_links AS link
  WHERE link.organization_id = p_organization_id
    AND link.code = p_code
    AND link.invitation_scope = 'cohort'
    AND link.link_type IN ('profile_connect', 'combined')
    AND link.is_active = true
    AND link.delivery_status IN ('link_ready', 'sent')
    AND (link.expires_at IS NULL OR link.expires_at > now());
  IF NOT FOUND THEN RAISE EXCEPTION 'This CSF class invitation is no longer active.'; END IF;

  SELECT profile.* INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active'
    AND (profile.normalized_school_email = v_email OR profile.normalized_personal_email = v_email);
  IF NOT FOUND THEN RAISE EXCEPTION 'The profile claim is no longer valid.'; END IF;

  INSERT INTO plugin_data.csf_profile_link_requests (
    organization_id, onboarding_link_id, term_id, cohort_id, user_id,
    signed_in_email, first_name, middle_name, last_name, preferred_name,
    personal_email, school_email, normalized_first_name, normalized_last_name,
    normalized_personal_email, normalized_school_email, matched_profile_id,
    candidate_profile_ids, match_status, resolution_notes, updated_at
  ) VALUES (
    p_organization_id, v_link.id, v_link.term_id, v_link.cohort_id, p_user_id,
    v_email, v_profile.first_name, v_profile.middle_name, v_profile.last_name,
    v_profile.preferred_name, v_profile.personal_email, v_profile.school_email,
    v_profile.normalized_first_name, v_profile.normalized_last_name,
    v_profile.normalized_personal_email, v_profile.normalized_school_email,
    NULL, ARRAY[p_profile_id], 'needs_review', v_reason, now()
  ) RETURNING id INTO v_request_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_user_id, 'profile.claim_declined',
    'csf_profile_link_requests', v_request_id, v_link.term_id,
    jsonb_build_object('candidateProfileId', p_profile_id, 'reason', v_reason),
    v_correlation_id, 'cohort_invitation', v_link.id::text,
    'student_declined_profile_match'
  );

  RETURN jsonb_build_object('requestId', v_request_id, 'correlationId', v_correlation_id);
END;
$$;

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
  v_request plugin_data.csf_profile_link_requests%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_correlation_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_membership_granted boolean := false;
  v_membership_write_count integer := 0;
  v_organization_membership_status text;
  v_profile_account_status text;
  v_profile_cohort_count integer := 0;
  v_profile_cohort_id uuid;
  v_term_lifecycle_status text;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_profiles'
  ) THEN RAISE EXCEPTION 'Not authorized to resolve CSF profile connections.'; END IF;
  IF p_decision NOT IN ('connect', 'reject') THEN RAISE EXCEPTION 'Invalid connection decision.'; END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 4 THEN
    RAISE EXCEPTION 'A reason of at least four characters is required.';
  END IF;

  SELECT request.* INTO v_request
  FROM plugin_data.csf_profile_link_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
    AND request.match_status IN ('pending', 'needs_review')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This connection request has already been resolved.'; END IF;

  IF p_decision = 'reject' THEN
    UPDATE plugin_data.csf_profile_link_requests
    SET match_status = 'rejected', matched_profile_id = NULL,
        resolution_notes = v_reason, resolved_by = p_actor_user_id,
        resolved_at = v_now, updated_at = v_now
    WHERE id = v_request.id;
  ELSE
    IF p_profile_id IS NULL THEN RAISE EXCEPTION 'Choose the student record to connect.'; END IF;
    IF v_request.user_id IS NULL THEN RAISE EXCEPTION 'The student account is no longer available.'; END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'csf-profile-account:' || p_organization_id::text || ':' || v_request.user_id::text,
        0
      )
    );

    SELECT profile.* INTO v_profile
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected student record no longer exists.'; END IF;

    SELECT
      count(*)::integer,
      (array_agg(membership.cohort_id ORDER BY membership.cohort_id))[1]
    INTO v_profile_cohort_count, v_profile_cohort_id
    FROM plugin_data.csf_profile_cohort_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = p_profile_id
      AND membership.status = 'active';

    IF v_request.cohort_id IS NOT NULL
      AND v_profile_cohort_count > 0
      AND (
        v_profile_cohort_count <> 1
        OR v_profile_cohort_id IS DISTINCT FROM v_request.cohort_id
      )
    THEN
      RAISE EXCEPTION 'The selected student record belongs to a different class.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.profile_id = p_profile_id
        AND account.status = 'verified'
        AND account.user_id <> v_request.user_id
    ) THEN RAISE EXCEPTION 'That student record is already connected to another verified account.'; END IF;
    IF EXISTS (
      SELECT 1 FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.user_id = v_request.user_id
        AND account.status = 'verified'
        AND account.profile_id <> p_profile_id
    ) THEN RAISE EXCEPTION 'This account is already connected to another CSF student record.'; END IF;

    IF EXISTS (
      SELECT 1
      FROM public.organization_members AS member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = v_request.user_id
        AND member.status IS DISTINCT FROM 'active'
    ) THEN
      RAISE EXCEPTION 'This account has inactive organization access; reactivate it through organization administration first.';
    END IF;

    INSERT INTO public.organization_members (
      organization_id, user_id, role, status
    ) VALUES (p_organization_id, v_request.user_id, 'member', 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    SELECT member.status
    INTO v_organization_membership_status
    FROM public.organization_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = v_request.user_id
    FOR UPDATE;
    IF NOT FOUND OR v_organization_membership_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'This account has inactive organization access; reactivate it through organization administration first.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM plugin_data.csf_profile_accounts AS account
      WHERE account.organization_id = p_organization_id
        AND account.profile_id = p_profile_id
        AND account.user_id = v_request.user_id
        AND account.status <> 'verified'
    ) THEN
      RAISE EXCEPTION 'This CSF account connection was revoked; use the explicit relink workflow.';
    END IF;

    INSERT INTO plugin_data.csf_profile_accounts (
      organization_id, profile_id, user_id, status, is_primary,
      linked_by, linked_at, revoked_at, notes
    ) VALUES (
      p_organization_id, p_profile_id, v_request.user_id, 'verified', true,
      p_actor_user_id, v_now, NULL, 'Resolved by a CSF officer.'
    )
    ON CONFLICT (organization_id, profile_id, user_id) DO NOTHING;

    SELECT account.status
    INTO v_profile_account_status
    FROM plugin_data.csf_profile_accounts AS account
    WHERE account.organization_id = p_organization_id
      AND account.profile_id = p_profile_id
      AND account.user_id = v_request.user_id
    FOR UPDATE;
    IF NOT FOUND OR v_profile_account_status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'This CSF account connection was revoked; use the explicit relink workflow.';
    END IF;

    IF v_request.cohort_id IS NOT NULL THEN
      INSERT INTO plugin_data.csf_profile_cohort_memberships (
        organization_id, profile_id, cohort_id, status, updated_at
      ) VALUES (
        p_organization_id, p_profile_id, v_request.cohort_id, 'active', v_now
      )
      ON CONFLICT (profile_id, cohort_id) DO NOTHING;
    END IF;

    IF v_request.term_id IS NOT NULL THEN
      SELECT term.lifecycle_status
      INTO v_term_lifecycle_status
      FROM plugin_data.csf_terms AS term
      WHERE term.organization_id = p_organization_id
        AND term.id = v_request.term_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The CSF semester for this request no longer exists.';
      END IF;

      SELECT application.* INTO v_application
      FROM plugin_data.csf_term_applications AS application
      WHERE application.organization_id = p_organization_id
        AND application.profile_id = p_profile_id
        AND application.term_id = v_request.term_id
        AND (
          v_request.cohort_id IS NULL
          OR application.cohort_id = v_request.cohort_id
        )
        AND application.status = 'accepted'
      ORDER BY application.reviewed_at DESC NULLS LAST, application.updated_at DESC
      LIMIT 1
      FOR UPDATE;
      IF v_application.id IS NOT NULL
        AND v_term_lifecycle_status NOT IN ('closed', 'archived')
      THEN
        INSERT INTO plugin_data.csf_term_memberships AS existing_membership (
          organization_id, profile_id, term_id, cohort_id, application_id,
          status, accepted_at, activated_at, status_reason, updated_at
        ) VALUES (
          p_organization_id, p_profile_id, v_request.term_id,
          coalesce(v_application.cohort_id, v_request.cohort_id), v_application.id,
          'active', v_now, v_now, 'Officer resolved the Let''s Assist account connection.', v_now
        )
        ON CONFLICT (organization_id, profile_id, term_id) DO UPDATE
        SET cohort_id = EXCLUDED.cohort_id, application_id = EXCLUDED.application_id,
            status = 'active', activated_at = coalesce(existing_membership.activated_at, v_now),
            status_reason = EXCLUDED.status_reason, updated_at = v_now
        WHERE existing_membership.status IN ('pending', 'accepted', 'active')
          AND existing_membership.finalized_closure_id IS NULL;
        GET DIAGNOSTICS v_membership_write_count = ROW_COUNT;
        v_membership_granted := v_membership_write_count > 0;
      END IF;
    END IF;

    UPDATE plugin_data.csf_profile_link_requests
    SET match_status = 'resolved', matched_profile_id = p_profile_id,
        resolution_notes = v_reason, resolved_by = p_actor_user_id,
        resolved_at = v_now, updated_at = v_now
    WHERE id = v_request.id;
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id,
    CASE WHEN p_decision = 'connect' THEN 'profile.link_request_resolved'
         ELSE 'profile.link_request_rejected' END,
    'csf_profile_link_requests', v_request.id, v_request.term_id,
    jsonb_build_object('matchStatus', v_request.match_status),
    jsonb_build_object(
      'decision', p_decision, 'profileId', p_profile_id,
      'membershipGranted', v_membership_granted, 'reason', v_reason
    ),
    v_correlation_id, 'staff_action', v_request.id::text,
    CASE WHEN p_decision = 'connect' THEN 'profile_connection_approved'
         ELSE 'profile_connection_rejected' END
  );

  RETURN jsonb_build_object(
    'requestId', v_request.id, 'decision', p_decision,
    'profileId', p_profile_id, 'membershipGranted', v_membership_granted,
    'correlationId', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_actor_has_permission(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_actor_has_permission(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_profile_claim_candidate(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_profile_claim_candidate(uuid, text, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_confirm_profile_claim(uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_confirm_profile_claim(uuid, text, uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_decline_profile_claim(uuid, text, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_decline_profile_claim(uuid, text, uuid, uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_profile_claim_candidate(uuid, text, uuid, text) IS
  'Returns one minimal exact-email claim candidate for a reusable CSF class link.';
COMMENT ON FUNCTION plugin_data.csf_confirm_profile_claim(uuid, text, uuid, uuid, text) IS
  'Atomically confirms a reusable-link profile claim, host membership, cohort membership, and audit history.';
COMMENT ON FUNCTION plugin_data.csf_resolve_profile_link_request(uuid, uuid, uuid, text, text, uuid) IS
  'Atomically approves or rejects a CSF account connection request with permission and tenant checks.';

COMMIT;
