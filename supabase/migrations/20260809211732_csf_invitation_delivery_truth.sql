-- A direct invitation currently creates a secure link; it does not call an
-- email provider. Keep link renewal separate from ledger-backed email delivery
-- telemetry so officers never see a fabricated sent/resend state.

BEGIN;

ALTER TABLE plugin_data.csf_onboarding_links
  ADD COLUMN renewal_count integer NOT NULL DEFAULT 0
    CHECK (renewal_count >= 0);

UPDATE plugin_data.csf_onboarding_links
SET renewal_count = resend_count,
    delivery_status = CASE
      WHEN delivery_status = 'sent' THEN 'link_ready'
      ELSE delivery_status
    END,
    last_sent_at = NULL,
    resend_count = 0
WHERE invitation_scope = 'direct';

-- The request receipt closes response-loss and double-submit ambiguity for the
-- server action. An identity-scoped transaction lock below serializes older
-- callers too, without assuming preexisting chapter data is already duplicate
-- free or silently invalidating an officer's existing links.
CREATE UNIQUE INDEX csf_admin_audit_events_direct_invitation_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE correlation_id IS NOT NULL
    AND action IN (
      'onboarding.direct_invitation_created',
      'onboarding.direct_invitation_renew',
      'onboarding.direct_invitation_cancel',
      'onboarding.direct_invitation_expire'
    );

CREATE OR REPLACE FUNCTION plugin_data.csf_create_direct_invitation_engine(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_recipient_email text,
  p_title text,
  p_expires_at timestamptz,
  p_validity_key text,
  p_code text,
  p_actor_user_id uuid,
  p_request_id uuid
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
  v_title text := coalesce(nullif(btrim(p_title), ''), 'Student invitation');
  v_request jsonb;
  v_request_fingerprint text;
  v_token_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_replay_code text;
  v_email_profile_count integer;
  v_email_profile_id uuid;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to create CSF student invitations.';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable direct-invitation request identifier is required.';
  END IF;
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'Invitation expiration must be in the future.';
  END IF;
  IF nullif(v_email, '') IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid recipient email.';
  END IF;
  IF char_length(p_code) < 24 THEN
    RAISE EXCEPTION 'Invitation token is not sufficiently random.';
  END IF;
  IF nullif(btrim(p_validity_key), '') IS NULL THEN
    RAISE EXCEPTION 'Invitation validity intent is required.';
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'operation', 'create',
    'profileId', p_profile_id,
    'termId', p_term_id,
    'recipientEmail', v_email,
    'title', v_title,
    'linkType', 'profile_connect',
    'validity', p_validity_key
  );
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_request::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_token_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_code, 'UTF8'), 'sha256'),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_direct_invitation_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action IN (
      'onboarding.direct_invitation_created',
      'onboarding.direct_invitation_renew',
      'onboarding.direct_invitation_cancel',
      'onboarding.direct_invitation_expire'
    )
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'onboarding.direct_invitation_created'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_onboarding_links'
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That direct-invitation request identifier is already bound to different content.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    -- A receipt proves what committed, not that the link is still safe to
    -- share. Revalidate current profile/email ownership under the same writer
    -- lock used by profile corrections before returning replayed link truth.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'plugin_data.csf_upsert_profile:' || p_organization_id::text,
        0
      )
    );

    SELECT profile.* INTO v_profile
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = p_profile_id
      AND profile.record_status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That email is not uniquely recorded on the selected active student profile. Correct the student record first, then create the link.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    SELECT count(DISTINCT profile.id)::integer, min(profile.id::text)::uuid
    INTO v_email_profile_count, v_email_profile_id
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND (
        profile.normalized_school_email = v_email
        OR profile.normalized_personal_email = v_email
      );
    IF v_email_profile_count IS DISTINCT FROM 1
      OR v_email_profile_id IS DISTINCT FROM p_profile_id THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That email is not uniquely recorded on the selected active student profile. Correct the student record first, then create the link.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'plugin_data.csf_direct_invitation_identity:'
          || p_organization_id::text || ':' || p_profile_id::text || ':'
          || p_term_id::text || ':' || v_email || ':profile_connect',
        0
      )
    );

    SELECT invitation.code
    INTO v_replay_code
    FROM plugin_data.csf_onboarding_links AS invitation
    WHERE invitation.organization_id = p_organization_id
      AND invitation.id = v_receipt.target_id
      AND invitation.invitation_scope = 'direct'
      AND invitation.is_active
      AND invitation.delivery_status = 'link_ready'
      AND invitation.expires_at > pg_catalog.statement_timestamp()
      AND pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(invitation.code, 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = v_receipt.after_data ->> 'tokenFingerprint'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = 'The committed invitation has changed or is no longer ready. Reload Members for its current status.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    RETURN QUERY SELECT v_receipt.target_id, v_replay_code;
    RETURN;
  END IF;

  -- Share the canonical profile-writer organization lock so a concurrent
  -- correction cannot add, remove, or move this email between our check and
  -- the invitation insert. Request receipt -> profile-org -> profile -> link
  -- identity is the common lock order for a new create.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_upsert_profile:' || p_organization_id::text,
      0
    )
  );

  SELECT profile.* INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_profile_id
    AND profile.record_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student record not found.'; END IF;

  SELECT count(DISTINCT profile.id)::integer, min(profile.id::text)::uuid
  INTO v_email_profile_count, v_email_profile_id
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.record_status = 'active'
    AND (
      (
        profile.normalized_school_email IS NOT NULL
        AND profile.normalized_school_email = v_email
      )
      OR (
        profile.normalized_personal_email IS NOT NULL
        AND profile.normalized_personal_email = v_email
      )
    );
  IF v_email_profile_count IS DISTINCT FROM 1
    OR v_email_profile_id IS DISTINCT FROM p_profile_id THEN
    RAISE EXCEPTION 'That email is not uniquely recorded on the selected active student profile. Correct the student record first, then create the link.';
  END IF;

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

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_direct_invitation_identity:'
        || p_organization_id::text || ':' || p_profile_id::text || ':'
        || p_term_id::text || ':' || v_email || ':profile_connect',
      0
    )
  );

  PERFORM 1
  FROM plugin_data.csf_onboarding_links AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.recipient_profile_id = p_profile_id
    AND invitation.term_id = p_term_id
    AND lower(btrim(invitation.recipient_email)) = v_email
    AND invitation.link_type = 'profile_connect'
    AND invitation.invitation_scope = 'direct'
    AND invitation.is_active
    AND invitation.delivery_status = 'link_ready'
    AND invitation.expires_at > pg_catalog.statement_timestamp();
  IF FOUND THEN
    RAISE EXCEPTION 'An active student-specific link already exists. Copy it or use Renew link instead.';
  END IF;

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
    renewal_count,
    resend_count,
    last_sent_at,
    created_by
  ) VALUES (
    p_organization_id,
    p_term_id,
    v_cohort_id,
    p_code,
    v_title,
    'profile_connect',
    'direct',
    p_profile_id,
    v_email,
    'link_ready',
    p_expires_at,
    0,
    0,
    NULL,
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
    correlation_id,
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
    p_request_id,
    pg_catalog.jsonb_build_object(
      'profileId', p_profile_id,
      'emailDomain', split_part(v_email, '@', 2),
      'expiresAt', p_expires_at,
      'deliveryStatus', 'link_ready',
      'isActive', true,
      'renewalCount', 0,
      'emailResendCount', 0,
      'requestFingerprint', v_request_fingerprint,
      'tokenFingerprint', v_token_fingerprint
    ),
    'staff_action',
    'direct_invitation_created'
  );

  RETURN QUERY SELECT v_invitation_id, p_code;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_create_direct_invitation(
  p_organization_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_recipient_email text,
  p_title text,
  p_validity_days integer,
  p_code text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS TABLE (id uuid, code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to create CSF student invitations.';
  END IF;
  IF p_validity_days IS NULL OR p_validity_days < 1 OR p_validity_days > 90 THEN
    RAISE EXCEPTION 'Invitation validity must be between 1 and 90 days.';
  END IF;

  RETURN QUERY
  SELECT invitation.id, invitation.code
  FROM plugin_data.csf_create_direct_invitation_engine(
    p_organization_id,
    p_profile_id,
    p_term_id,
    p_recipient_email,
    p_title,
    pg_catalog.statement_timestamp() + pg_catalog.make_interval(days => p_validity_days),
    'days:' || p_validity_days::text,
    p_code,
    p_actor_user_id,
    p_request_id
  ) AS invitation;
END;
$$;

-- Transitional exact-call compatibility. The deterministic receipt identity
-- makes an identical legacy RPC replay safe, while the engine's identity lock
-- rejects a second create attempt with different token/timestamp content.
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
  v_request_id uuid;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to create CSF student invitations.';
  END IF;

  v_request_id := pg_catalog.substr(
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'operation', 'legacy_create',
            'organizationId', p_organization_id,
            'profileId', p_profile_id,
            'termId', p_term_id,
            'recipientEmail', lower(btrim(p_recipient_email)),
            'title', coalesce(nullif(btrim(p_title), ''), 'Student invitation'),
            'expiresAt', p_expires_at,
            'code', p_code,
            'actorUserId', p_actor_user_id
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    1,
    32
  )::uuid;

  RETURN QUERY
  SELECT invitation.id, invitation.code
  FROM plugin_data.csf_create_direct_invitation_engine(
    p_organization_id,
    p_profile_id,
    p_term_id,
    p_recipient_email,
    p_title,
    p_expires_at,
    'expires:' || p_expires_at::text,
    p_code,
    p_actor_user_id,
    v_request_id
  ) AS invitation;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_direct_invitation_engine(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_operation text,
  p_code text,
  p_expires_at timestamptz,
  p_validity_key text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity plugin_data.csf_onboarding_links%ROWTYPE;
  v_before plugin_data.csf_onboarding_links%ROWTYPE;
  v_after plugin_data.csf_onboarding_links%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_request jsonb;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_email text;
  v_email_profile_count integer;
  v_email_profile_id uuid;
  v_is_replay boolean := false;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF student invitations.';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable direct-invitation request identifier is required.';
  END IF;
  IF p_operation NOT IN ('renew', 'cancel', 'expire') THEN
    RAISE EXCEPTION 'Unsupported invitation operation.';
  END IF;
  IF nullif(btrim(p_validity_key), '') IS NULL THEN
    RAISE EXCEPTION 'Invitation validity intent is required.';
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'operation', p_operation,
    'invitationId', p_invitation_id,
    'validity', p_validity_key
  );
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_request::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_direct_invitation_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action IN (
      'onboarding.direct_invitation_created',
      'onboarding.direct_invitation_renew',
      'onboarding.direct_invitation_cancel',
      'onboarding.direct_invitation_expire'
    )
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'onboarding.direct_invitation_' || p_operation
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_onboarding_links'
      OR v_receipt.target_id IS DISTINCT FROM p_invitation_id
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION USING
        MESSAGE = 'That direct-invitation request identifier is already bound to different content.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=request_conflict',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    v_is_replay := true;
  END IF;

  SELECT invitation.* INTO v_identity
  FROM plugin_data.csf_onboarding_links AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.id = p_invitation_id
    AND invitation.invitation_scope = 'direct';
  IF NOT FOUND THEN
    IF v_is_replay THEN
      RAISE EXCEPTION USING
        MESSAGE = 'The committed direct-invitation receipt no longer resolves to its link.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    RAISE EXCEPTION 'Direct invitation not found.';
  END IF;

  IF p_operation = 'renew' THEN
    -- A renewed link must still target the one active profile that currently
    -- owns its recorded email. Share the profile writer's organization lock
    -- before any profile or invitation row lock so corrections cannot race
    -- this decision.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'plugin_data.csf_upsert_profile:' || p_organization_id::text,
        0
      )
    );

    v_email := lower(btrim(v_identity.recipient_email));
    SELECT profile.* INTO v_profile
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.id = v_identity.recipient_profile_id
      AND profile.record_status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      IF v_is_replay THEN
        RAISE EXCEPTION USING
          MESSAGE = 'This invitation email is no longer uniquely recorded on the invited active student profile. Correct the student record first, then renew the link.',
          DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
          HINT = 'CSF_RELOAD_REQUIRED=true';
      END IF;
      RAISE EXCEPTION 'This invitation email is no longer uniquely recorded on the invited active student profile. Correct the student record first, then renew the link.';
    END IF;

    SELECT count(DISTINCT profile.id)::integer, min(profile.id::text)::uuid
    INTO v_email_profile_count, v_email_profile_id
    FROM plugin_data.csf_profiles AS profile
    WHERE profile.organization_id = p_organization_id
      AND profile.record_status = 'active'
      AND (
        profile.normalized_school_email = v_email
        OR profile.normalized_personal_email = v_email
      );
    IF v_email_profile_count IS DISTINCT FROM 1
      OR v_email_profile_id IS DISTINCT FROM v_identity.recipient_profile_id THEN
      IF v_is_replay THEN
        RAISE EXCEPTION USING
          MESSAGE = 'This invitation email is no longer uniquely recorded on the invited active student profile. Correct the student record first, then renew the link.',
          DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
          HINT = 'CSF_RELOAD_REQUIRED=true';
      END IF;
      RAISE EXCEPTION 'This invitation email is no longer uniquely recorded on the invited active student profile. Correct the student record first, then renew the link.';
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_direct_invitation_identity:'
        || p_organization_id::text || ':'
        || v_identity.recipient_profile_id::text || ':'
        || v_identity.term_id::text || ':'
        || lower(btrim(v_identity.recipient_email)) || ':'
        || v_identity.link_type,
      0
    )
  );

  SELECT invitation.* INTO v_before
  FROM plugin_data.csf_onboarding_links AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.id = p_invitation_id
    AND invitation.invitation_scope = 'direct'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Direct invitation not found.'; END IF;
  IF v_before.recipient_profile_id IS DISTINCT FROM v_identity.recipient_profile_id
    OR v_before.term_id IS DISTINCT FROM v_identity.term_id
    OR lower(btrim(v_before.recipient_email))
      IS DISTINCT FROM lower(btrim(v_identity.recipient_email))
    OR v_before.link_type IS DISTINCT FROM v_identity.link_type THEN
    IF v_is_replay THEN
      RAISE EXCEPTION USING
        MESSAGE = 'The direct invitation identity changed while it was being locked. Reload Members and try again.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    RAISE EXCEPTION 'The direct invitation identity changed while it was being locked. Reload Members and try again.';
  END IF;

  IF v_is_replay THEN
    v_after := v_before;
    IF v_after.delivery_status IS DISTINCT FROM v_receipt.after_data ->> 'deliveryStatus'
      OR v_after.is_active IS DISTINCT FROM (v_receipt.after_data ->> 'isActive')::boolean
      OR v_after.renewal_count IS DISTINCT FROM (v_receipt.after_data ->> 'renewalCount')::integer
      OR v_after.expires_at IS DISTINCT FROM (v_receipt.after_data ->> 'expiresAt')::timestamptz
      OR v_after.cancelled_at IS DISTINCT FROM (v_receipt.after_data ->> 'cancelledAt')::timestamptz
      OR v_after.updated_at IS DISTINCT FROM (v_receipt.after_data ->> 'updatedAt')::timestamptz
      OR (
        p_operation = 'renew'
        AND (
          v_after.expires_at <= pg_catalog.statement_timestamp()
          OR pg_catalog.encode(
            extensions.digest(
              pg_catalog.convert_to(v_after.code, 'UTF8'),
              'sha256'
            ),
            'hex'
          ) IS DISTINCT FROM v_receipt.after_data ->> 'tokenFingerprint'
        )
      ) THEN
      RAISE EXCEPTION USING
        MESSAGE = 'The committed invitation operation is no longer current. Reload Members before trying again.',
        DETAIL = 'CSF_COMMITTED_REQUEST_OUTCOME=saved_stale',
        HINT = 'CSF_RELOAD_REQUIRED=true';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'id', v_after.id,
      'code', v_after.code,
      'deliveryStatus', v_after.delivery_status,
      'expiresAt', v_after.expires_at,
      'renewalCount', v_after.renewal_count,
      'idempotent', true
    );
  END IF;

  IF v_before.delivery_status = 'accepted' THEN
    RAISE EXCEPTION 'An accepted invitation cannot be changed.';
  END IF;

  IF p_operation = 'renew' THEN
    PERFORM 1
    FROM plugin_data.csf_onboarding_links AS invitation
    WHERE invitation.organization_id = p_organization_id
      AND invitation.id <> p_invitation_id
      AND invitation.recipient_profile_id = v_before.recipient_profile_id
      AND invitation.term_id = v_before.term_id
      AND lower(btrim(invitation.recipient_email))
        = lower(btrim(v_before.recipient_email))
      AND invitation.link_type = v_before.link_type
      AND invitation.invitation_scope = 'direct'
      AND invitation.is_active
      AND invitation.delivery_status = 'link_ready'
      AND invitation.expires_at > pg_catalog.statement_timestamp()
    FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'Another active student-specific link already exists. Copy or manage that link instead.';
    END IF;
    IF p_expires_at <= now() OR char_length(p_code) < 24 THEN
      RAISE EXCEPTION 'A future expiration and a new secure token are required.';
    END IF;
    UPDATE plugin_data.csf_onboarding_links
    SET code = p_code,
        delivery_status = 'link_ready',
        is_active = true,
        expires_at = p_expires_at,
        cancelled_at = NULL,
        renewal_count = renewal_count + 1,
        resend_count = 0,
        last_sent_at = NULL,
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
  END IF;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    correlation_id,
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
    p_request_id,
    pg_catalog.jsonb_build_object(
      'deliveryStatus', v_before.delivery_status,
      'expiresAt', v_before.expires_at,
      'renewalCount', v_before.renewal_count,
      'emailResendCount', v_before.resend_count,
      'lastSentAt', v_before.last_sent_at
    ),
    pg_catalog.jsonb_build_object(
      'deliveryStatus', v_after.delivery_status,
      'isActive', v_after.is_active,
      'expiresAt', v_after.expires_at,
      'cancelledAt', v_after.cancelled_at,
      'updatedAt', v_after.updated_at,
      'renewalCount', v_after.renewal_count,
      'emailResendCount', v_after.resend_count,
      'lastSentAt', v_after.last_sent_at,
      'requestFingerprint', v_request_fingerprint,
      'tokenFingerprint', CASE
        WHEN p_operation = 'renew' THEN pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(v_after.code, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
        ELSE NULL
      END
    ),
    'staff_action',
    'direct_invitation_' || p_operation
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', v_after.id,
    'code', v_after.code,
    'deliveryStatus', v_after.delivery_status,
    'expiresAt', v_after.expires_at,
    'renewalCount', v_after.renewal_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_update_direct_invitation(
  p_organization_id uuid,
  p_invitation_id uuid,
  p_operation text,
  p_code text,
  p_validity_days integer,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expires_at timestamptz;
  v_validity_key text;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF student invitations.';
  END IF;
  IF p_operation = 'renew' THEN
    IF p_validity_days IS NULL OR p_validity_days < 1 OR p_validity_days > 90 THEN
      RAISE EXCEPTION 'Invitation validity must be between 1 and 90 days.';
    END IF;
    v_expires_at := pg_catalog.statement_timestamp()
      + pg_catalog.make_interval(days => p_validity_days);
    v_validity_key := 'days:' || p_validity_days::text;
  ELSE
    v_expires_at := NULL;
    v_validity_key := 'none';
  END IF;

  RETURN plugin_data.csf_update_direct_invitation_engine(
    p_organization_id,
    p_invitation_id,
    p_operation,
    p_code,
    v_expires_at,
    v_validity_key,
    p_actor_user_id,
    p_request_id
  );
END;
$$;

-- The legacy update signature is retained only as an owner-callable exact-call
-- adapter. Service callers must use the request-aware overload above.
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
  v_request_id uuid;
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(
    p_organization_id,
    p_actor_user_id,
    'manage_profiles'
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF student invitations.';
  END IF;

  v_request_id := pg_catalog.substr(
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'operation', p_operation,
            'organizationId', p_organization_id,
            'invitationId', p_invitation_id,
            'code', p_code,
            'expiresAt', p_expires_at,
            'actorUserId', p_actor_user_id
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    1,
    32
  )::uuid;

  RETURN plugin_data.csf_update_direct_invitation_engine(
    p_organization_id,
    p_invitation_id,
    p_operation,
    p_code,
    p_expires_at,
    CASE
      WHEN p_operation = 'renew' THEN 'expires:' || p_expires_at::text
      ELSE 'none'
    END,
    p_actor_user_id,
    v_request_id
  );
END;
$$;

-- Keep the historical, heavily tested write engine intact, but fence it behind
-- a current profile/email preflight. The wrapper below is now the only service
-- API. Renaming preserves the original function body without copying it.
ALTER FUNCTION plugin_data.csf_accept_direct_invitation(uuid, text, uuid, text)
  RENAME TO csf_accept_direct_invitation_base;

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
  v_probe plugin_data.csf_onboarding_links%ROWTYPE;
  v_invitation plugin_data.csf_onboarding_links%ROWTYPE;
  v_profile plugin_data.csf_profiles%ROWTYPE;
  v_email text := lower(btrim(p_verified_email));
  v_email_profile_count integer;
  v_email_profile_id uuid;
BEGIN
  -- Resolve only the lock identity first. The canonical profile-writer org lock
  -- then serializes email corrections before invitation -> profile row locks.
  SELECT invitation.*
  INTO v_probe
  FROM plugin_data.csf_onboarding_links AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.code = p_code
    AND invitation.invitation_scope = 'direct';
  IF NOT FOUND THEN RAISE EXCEPTION 'Direct invitation not found.'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_upsert_profile:' || p_organization_id::text,
      0
    )
  );

  SELECT invitation.*
  INTO v_invitation
  FROM plugin_data.csf_onboarding_links AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.id = v_probe.id
    AND invitation.code = p_code
    AND invitation.invitation_scope = 'direct'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Direct invitation not found.'; END IF;

  -- Accepted-by-this-user is a read-only replay of committed truth. It remains
  -- available even if an officer later corrects the profile email.
  IF v_invitation.delivery_status = 'accepted' THEN
    IF v_invitation.accepted_by = p_user_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'profileId', v_invitation.recipient_profile_id,
        'alreadyAccepted', true
      );
    END IF;
    RAISE EXCEPTION 'This invitation has already been accepted.';
  END IF;
  IF NOT v_invitation.is_active
    OR v_invitation.delivery_status <> 'link_ready' THEN
    RAISE EXCEPTION 'This invitation is no longer active.';
  END IF;
  IF v_invitation.expires_at <= pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'This invitation has expired.';
  END IF;
  IF v_email IS DISTINCT FROM lower(btrim(v_invitation.recipient_email)) THEN
    RAISE EXCEPTION 'Sign in with the email address this invitation was created for.';
  END IF;

  SELECT profile.*
  INTO v_profile
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.id = v_invitation.recipient_profile_id
    AND profile.record_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invited student record is unavailable.';
  END IF;

  SELECT count(DISTINCT profile.id)::integer, min(profile.id::text)::uuid
  INTO v_email_profile_count, v_email_profile_id
  FROM plugin_data.csf_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.record_status = 'active'
    AND (
      (
        profile.normalized_school_email IS NOT NULL
        AND profile.normalized_school_email = v_email
      )
      OR (
        profile.normalized_personal_email IS NOT NULL
        AND profile.normalized_personal_email = v_email
      )
    );
  IF v_email_profile_count IS DISTINCT FROM 1
    OR v_email_profile_id IS DISTINCT FROM v_profile.id THEN
    RAISE EXCEPTION 'This invitation email is no longer uniquely recorded on the invited active student profile. Ask a CSF officer to correct the student record first.';
  END IF;

  RETURN plugin_data.csf_accept_direct_invitation_base(
    p_organization_id,
    p_code,
    p_user_id,
    p_verified_email
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_create_direct_invitation(uuid, uuid, uuid, text, text, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_update_direct_invitation(uuid, uuid, text, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_create_direct_invitation(uuid, uuid, uuid, text, text, integer, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_update_direct_invitation(uuid, uuid, text, text, integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_create_direct_invitation_engine(uuid, uuid, uuid, text, text, timestamptz, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_update_direct_invitation_engine(uuid, uuid, text, text, timestamptz, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_accept_direct_invitation_base(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_accept_direct_invitation(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION plugin_data.csf_create_direct_invitation(uuid, uuid, uuid, text, text, timestamptz, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_direct_invitation(uuid, uuid, uuid, text, text, integer, text, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_direct_invitation(uuid, uuid, text, text, integer, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_accept_direct_invitation(uuid, text, uuid, text)
  TO service_role;

COMMENT ON COLUMN plugin_data.csf_onboarding_links.renewal_count IS
  'Number of secure link token renewals. This is intentionally separate from ledger-backed email resend_count.';
COMMENT ON FUNCTION plugin_data.csf_create_direct_invitation(uuid, uuid, uuid, text, text, timestamptz, text, uuid) IS
  'Legacy exact-call-compatible create adapter. A single-live identity lock prevents this signature from creating a second active token.';
COMMENT ON FUNCTION plugin_data.csf_create_direct_invitation(uuid, uuid, uuid, text, text, integer, text, uuid, uuid) IS
  'Request-aware direct invitation create boundary. Exact retries return one immutable receipt and never imply email delivery.';
COMMENT ON FUNCTION plugin_data.csf_update_direct_invitation(uuid, uuid, text, text, timestamptz, uuid) IS
  'Owner-only legacy exact-call adapter retained for migration compatibility; service callers use the request-aware overload.';
COMMENT ON FUNCTION plugin_data.csf_update_direct_invitation(uuid, uuid, text, text, integer, uuid, uuid) IS
  'Request-aware direct invitation renew, cancel, and expire boundary. Exact retries do not rotate twice or imply an email send.';
COMMENT ON FUNCTION plugin_data.csf_create_direct_invitation_engine(uuid, uuid, uuid, text, text, timestamptz, text, text, uuid, uuid) IS
  'Internal direct invitation create engine. Not callable by API roles.';
COMMENT ON FUNCTION plugin_data.csf_update_direct_invitation_engine(uuid, uuid, text, text, timestamptz, text, uuid, uuid) IS
  'Internal direct invitation lifecycle engine. Not callable by API roles.';
COMMENT ON FUNCTION plugin_data.csf_accept_direct_invitation_base(uuid, text, uuid, text) IS
  'Internal historical direct invitation write engine. The request boundary must revalidate current unique profile email ownership before calling it.';
COMMENT ON FUNCTION plugin_data.csf_accept_direct_invitation(uuid, text, uuid, text) IS
  'Locks and revalidates the invitation against current unique active-profile email ownership before invoking the internal atomic acceptance engine.';

NOTIFY pgrst, 'reload schema';

COMMIT;
