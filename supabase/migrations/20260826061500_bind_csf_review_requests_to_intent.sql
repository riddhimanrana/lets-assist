-- Bind reused request UUIDs to the exact reviewed operation.
--
-- The original profile-create wrapper delegated its request UUID to the generic
-- profile writer, whose fingerprint did not know the import row or review
-- reason. The original partner-policy fingerprint normalized NULL and an empty
-- string to the same value even though they mean preserve and clear. Keep the
-- existing transaction bodies as private helpers and put operation-specific,
-- durable receipts in front of them.

BEGIN;

ALTER FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) RENAME TO csf_create_profile_for_application_import_row_legacy;

REVOKE ALL ON FUNCTION plugin_data.csf_create_profile_for_application_import_row_legacy(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_profile_for_application_import_row_legacy(
  uuid, uuid, uuid, uuid, text
) TO postgres;

CREATE UNIQUE INDEX csf_application_profile_create_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action = 'sheet_import.application_profile_create_request';

CREATE OR REPLACE FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  p_organization_id uuid,
  p_row_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text := nullif(pg_catalog.btrim(p_reason), '');
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable profile-create request identifier is required.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Explain why this application should create a new CSF profile.';
  END IF;
  IF pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Keep the profile-create reason to 500 characters or fewer.';
  END IF;

  -- Recheck the row-scoped import authority before consulting a receipt.
  PERFORM plugin_data.csf_assert_import_actor_for_row(
    p_organization_id,
    p_actor_user_id,
    p_row_id
  );

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'rowId', p_row_id,
          'reason', v_reason
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_create_profile_for_application_import_row:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'sheet_import.application_profile_create_request';

  IF FOUND THEN
    IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint
      OR pg_catalog.jsonb_typeof(v_receipt.after_data -> 'result') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'That profile-create request identifier is already bound to a different application row or review.';
    END IF;
    RETURN (v_receipt.after_data -> 'result')
      || pg_catalog.jsonb_build_object('idempotent', true);
  END IF;

  -- A pre-migration generic profile receipt cannot prove which application row
  -- supplied the request UUID. Refuse an ambiguous replay and require a fresh
  -- request identifier instead of guessing.
  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = p_organization_id
      AND audit.correlation_id = p_request_id
      AND audit.action IN ('profile.create', 'profile.edit')
  ) THEN
    RAISE EXCEPTION 'That legacy profile-create request cannot be safely replayed; retry with a new request identifier.';
  END IF;

  v_result := plugin_data.csf_create_profile_for_application_import_row_legacy(
    p_organization_id,
    p_row_id,
    p_actor_user_id,
    p_request_id,
    v_reason
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'sheet_import.application_profile_create_request',
    'csf_sheet_import_rows',
    p_row_id,
    pg_catalog.jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'result', v_result
    ),
    p_request_id,
    'application_import',
    p_row_id::text,
    'application_profile_created'
  );

  RETURN v_result;
END;
$$;

ALTER FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) TO postgres, service_role;

ALTER FUNCTION plugin_data.csf_set_partner_club_policy_review(
  uuid, uuid, uuid, uuid, text, text
) RENAME TO csf_set_partner_club_policy_review_legacy;

REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_policy_review_legacy(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_partner_club_policy_review_legacy(
  uuid, uuid, uuid, uuid, text, text
) TO postgres;

CREATE UNIQUE INDEX csf_partner_policy_review_request_idx
  ON plugin_data.csf_admin_audit_events (organization_id, correlation_id)
  WHERE action = 'partner_club.policy_review_request';

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
  v_allocation_choice text := coalesce(
    nullif(pg_catalog.btrim(p_allocation_satisfied), ''),
    'unknown'
  );
  v_policy_notes text := nullif(pg_catalog.btrim(p_policy_notes), '');
  v_notes_intent text := CASE
    WHEN p_policy_notes IS NULL THEN 'preserve'
    WHEN pg_catalog.btrim(p_policy_notes) = '' THEN 'clear'
    ELSE 'set'
  END;
  v_request_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_partner_clubs'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF partner clubs.';
  END IF;
  IF p_request_id IS NULL OR p_partner_club_term_id IS NULL THEN
    RAISE EXCEPTION 'A partner-club policy review requires a request id and term record.';
  END IF;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'partnerClubTermId', p_partner_club_term_id,
          'allocationSatisfied', v_allocation_choice,
          'policyNotesIntent', v_notes_intent,
          'policyNotes', v_policy_notes
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_set_partner_club_policy_review:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.action = 'partner_club.policy_review_request';

  IF FOUND THEN
    IF v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.after_data ->> 'requestFingerprint' IS DISTINCT FROM v_request_fingerprint
      OR pg_catalog.jsonb_typeof(v_receipt.after_data -> 'result') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'That review request identifier is already bound to a different review.';
    END IF;
    RETURN (v_receipt.after_data -> 'result')
      || pg_catalog.jsonb_build_object('idempotent', true);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_term_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.idempotency_key = 'policy-review:' || p_request_id::text
  ) THEN
    RAISE EXCEPTION 'That legacy policy-review request cannot be safely replayed; retry with a new request identifier.';
  END IF;

  v_result := plugin_data.csf_set_partner_club_policy_review_legacy(
    p_organization_id,
    p_actor_user_id,
    p_request_id,
    p_partner_club_term_id,
    v_allocation_choice,
    p_policy_notes
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'partner_club.policy_review_request',
    'csf_partner_club_terms',
    p_partner_club_term_id,
    pg_catalog.jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'notesIntent', v_notes_intent,
      'result', v_result
    ),
    p_request_id,
    'officer_decision',
    p_partner_club_term_id::text,
    'partner_club_policy_reviewed'
  );

  RETURN v_result;
END;
$$;

ALTER FUNCTION plugin_data.csf_set_partner_club_policy_review(
  uuid, uuid, uuid, uuid, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_set_partner_club_policy_review(
  uuid, uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_partner_club_policy_review(
  uuid, uuid, uuid, uuid, text, text
) TO postgres, service_role;

COMMENT ON FUNCTION plugin_data.csf_create_profile_for_application_import_row(
  uuid, uuid, uuid, uuid, text
) IS 'Service-only application-row profile creation with a row- and reason-bound durable request receipt.';
COMMENT ON FUNCTION plugin_data.csf_set_partner_club_policy_review(
  uuid, uuid, uuid, uuid, text, text
) IS 'Service-only partner policy review with a durable request receipt that distinguishes preserving, clearing and setting notes.';

COMMIT;

NOTIFY pgrst, 'reload schema';
