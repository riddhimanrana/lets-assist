-- Authorized freeform officer editing of a semester application, and an
-- explicit officer-private / member-visible split for profile comments.
--
-- Two gaps this closes.
--
-- A. An officer had no way to correct a reported application field. A member
--    could submit a correction request and an officer could mark it reviewed,
--    but nothing in the product then changed the value the officer had just
--    agreed was wrong. The only writes to `csf_term_applications` were the
--    decision primitives and the import commit, so "fix the record" meant
--    editing the source workbook and re-importing.
--
--    This adds one bounded editor. It writes only reported intake fields, it
--    never touches identity, ownership, decision, release, assignment,
--    eligibility, provenance, or the raw `application_data` payload, and it
--    refuses a row whose outcome is already published or whose semester is
--    finished.
--
--    It deliberately does not write `eligibility_status`. `needs_recalculation`
--    is not a stored enum value; it is derived when the stored verdict and the
--    current calculation disagree. Correcting a reported points field moves the
--    calculation, so the existing V52/V105 derivation reports the staleness on
--    its own. Writing a verdict here would be this editor asserting an
--    eligibility outcome it has no authority to assert.
--
--    The immutable source is untouched by construction: `csf_sheet_import_rows`
--    and `application_data` are never written here, and the pre-edit values are
--    captured in the audit receipt's `before_data`. In a Sheet-reviewed
--    semester the workbook still owns the verdict; this editor deliberately
--    writes no `csf_application_decision_stages` column, so an edit can neither
--    overwrite an officer's source decision nor publish one. The existing
--    `csf_sheet_sync_application` trigger does queue the corrected row for
--    export, which is the intended behaviour: that path writes only managed
--    columns, behind the export authority and lease checks of V112.
--
-- B. `csf_profile_notes` was entirely officer-only, enforced by the caller's
--    route gate rather than by anything the database or a projection knew. The
--    product needs both kinds: an officer-private note (the appeal paper trail)
--    and a comment the member is meant to read. Visibility becomes a stored,
--    checked column that defaults to officer-private, member-visible reads go
--    through one allowlisting function that can only ever return the four
--    member-safe columns, and an over-shared note can be pulled back with a
--    reason and an audit receipt.
--
-- No data migration: every existing note keeps its officer-private meaning
-- through the column default, and no application row is rewritten.

BEGIN;

-- ===========================================================================
-- A1. The editable-field allowlist, in the database.
--
-- A column absent from this list is not editable through this path, and the
-- editor rejects an unknown key instead of ignoring it. Keeping the list in
-- SQL means a future caller cannot widen it by sending a different payload.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_application_editable_fields()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'current_grade_level',
    'returning_status',
    'shirt_size',
    'most_checked_email',
    'social_confirmation',
    'list_i_points',
    'list_i_ii_points',
    'grand_total_points'
  ]::text[];
$$;

ALTER FUNCTION plugin_data.csf_application_editable_fields() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_application_editable_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_application_editable_fields()
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_application_editable_fields() IS
  'The only csf_term_applications columns the officer freeform editor may write. Identity, ownership, decision, release, eligibility, assignment, and provenance columns are deliberately absent.';

-- Fields whose value feeds the eligibility calculation. Changing one of these
-- makes the stored eligibility verdict stale. The verdict is not rewritten
-- here; the flag travels in the result and the audit so the officer surface can
-- say so, and the existing derivation reports `needs_recalculation` because the
-- calculation now disagrees with what was stored.
CREATE OR REPLACE FUNCTION plugin_data.csf_application_eligibility_input_fields()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'current_grade_level',
    'list_i_points',
    'list_i_ii_points',
    'grand_total_points'
  ]::text[];
$$;

ALTER FUNCTION plugin_data.csf_application_eligibility_input_fields() OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_application_eligibility_input_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_application_eligibility_input_fields()
  TO service_role;

-- ===========================================================================
-- A1b. The new capability
--
-- Correcting a reported record is a different authority from deciding an
-- application or annotating one, so it gets its own key rather than riding on
-- `decide_applications`. V99 requires the SQL and TypeScript catalogs to agree,
-- so the shared catalog is restated with the key appended; nothing else in it
-- moves. `lib/plugins/private/plugins/dvhs-csf/constants.ts` carries the
-- matching entry.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_role_permission_catalog()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'manage_roles','manage_cohorts_terms','manage_schedule','manage_profiles',
    'review_applications','view_applications','review_application_checks',
    'decide_applications','assign_applications','write_application_notes',
    'edit_application_records',
    'manage_restrictions','manage_opportunities','manage_posts','manage_partner_clubs',
    'verify_participation','process_points','verify_submissions','manage_review_periods',
    'manage_meetings',
    'reconcile_meeting_attendance','close_term','reopen_term','edit_point_rules',
    'manage_payment_review','import_applications','import_members','import_meetings',
    'import_partner_clubs','manage_sheet_sync','resolve_imports','manage_settings',
    'export_membership_reports','export_dues_reports','export_service_reports',
    'export_club_reports','export_reports','export_sensitive_reports','view_audit_history'
  ]::text[];
$$;

-- Grant the new capability to the existing system roles that already decide or
-- review applications, and to nobody else. A custom role gains it only when an
-- officer with `manage_roles` enables it through Staff access, so this backfill
-- cannot quietly widen a role a chapter narrowed on purpose.
INSERT INTO plugin_data.csf_role_permissions (organization_id, role_id, permission_key, enabled)
SELECT role.organization_id, role.id, 'edit_application_records', true
FROM plugin_data.csf_roles AS role
WHERE role.is_system = true
  AND role.archived_at IS NULL
  AND role.key IN ('owner', 'advisor', 'co-president', 'vice-president-membership')
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- ===========================================================================
-- A2. Request fingerprint
--
-- The same shape the point-action receipts use: a request identifier is only
-- replayable for the exact same actor, operation, and normalized intent.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_application_editor_request_fingerprint(
  p_organization_id uuid,
  p_application_id uuid,
  p_actor_user_id uuid,
  p_intent jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'operation', 'application.fields_edit',
          'organizationId', p_organization_id,
          'applicationId', p_application_id,
          'actorUserId', p_actor_user_id,
          'intent', p_intent
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

ALTER FUNCTION plugin_data.csf_application_editor_request_fingerprint(
  uuid, uuid, uuid, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_application_editor_request_fingerprint(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_application_editor_request_fingerprint(
  uuid, uuid, uuid, jsonb
) TO postgres;

-- ===========================================================================
-- A3. The editor implementation (owner-only)
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_edit_term_application_fields_locked_impl(
  p_organization_id uuid,
  p_application_id uuid,
  p_changes jsonb,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application plugin_data.csf_term_applications%ROWTYPE;
  v_after plugin_data.csf_term_applications%ROWTYPE;
  v_term plugin_data.csf_terms%ROWTYPE;
  v_membership_status text;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_editable text[] := plugin_data.csf_application_editable_fields();
  v_eligibility_inputs text[] := plugin_data.csf_application_eligibility_input_fields();
  v_key text;
  v_unknown text[] := ARRAY[]::text[];
  v_applied jsonb := '{}'::jsonb;
  v_before_values jsonb := '{}'::jsonb;
  v_after_values jsonb := '{}'::jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_intent jsonb;
  v_fingerprint text;
  v_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
  v_recalculate boolean := false;
  v_sheet_reviewed boolean := false;
  v_now timestamptz := pg_catalog.now();
  v_correlation_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable application edit request identifier is required.';
  END IF;
  IF v_reason IS NULL OR pg_catalog.length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Explain the correction in at least 8 characters.';
  END IF;
  IF pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Keep the correction reason under 500 characters.';
  END IF;
  IF p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'The requested application changes must be an object.';
  END IF;
  IF p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Choose at least one field to correct.';
  END IF;

  -- Refuse an unknown or non-editable key rather than dropping it, so a caller
  -- can never believe it wrote a field this editor does not own.
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_changes) LOOP
    IF NOT (v_key = ANY (v_editable)) THEN
      v_unknown := pg_catalog.array_append(v_unknown, v_key);
    END IF;
  END LOOP;
  IF pg_catalog.array_length(v_unknown, 1) IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'That application field cannot be edited here.',
      DETAIL = pg_catalog.format(
        'CSF_APPLICATION_EDIT_REJECTED_FIELDS=%s',
        pg_catalog.array_to_string(v_unknown, ',')
      );
  END IF;

  v_intent := pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'changes', p_changes,
    'reason', v_reason
  );
  v_fingerprint := plugin_data.csf_application_editor_request_fingerprint(
    p_organization_id, p_application_id, p_actor_user_id, v_intent
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_application_edit_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  SELECT audit.*
  INTO v_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'application_field_edit_request'
  ORDER BY audit.created_at, audit.id
  LIMIT 1;
  IF FOUND THEN
    IF v_receipt.action IS DISTINCT FROM 'application.fields_edited'
      OR v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_receipt.target_type IS DISTINCT FROM 'csf_term_applications'
      OR v_receipt.target_id IS DISTINCT FROM p_application_id
      OR v_receipt.after_data ->> 'requestFingerprint'
        IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'That application edit request identifier is already bound to a different change.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'applicationId', p_application_id,
      'correlationId', p_request_id,
      'changedFields', v_receipt.after_data -> 'changedFields',
      'eligibilityInputsChanged',
        coalesce((v_receipt.after_data ->> 'eligibilityInputsChanged')::boolean, false),
      'idempotent', true
    );
  END IF;

  SELECT application.*
  INTO v_application
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'CSF application not found.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = v_application.term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'The semester for this application was not found.';
  END IF;

  -- A finished semester keeps its record. Correcting a closed or archived term
  -- goes through reopen, which is a separate permission and a separate audit.
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This semester is finished. Reopen it before correcting an application.',
      DETAIL = 'CSF_APPLICATION_EDIT_BLOCKER=term_closed';
  END IF;

  -- A published outcome is the chapter's word to the student. Changing the
  -- numbers underneath it silently would make the published decision unreadable
  -- against its own evidence.
  IF v_application.decision_status IS NOT NULL
    AND v_application.decision_status::text <> 'pending' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'This application already has a published decision. Retract it before correcting the record.',
      DETAIL = 'CSF_APPLICATION_EDIT_BLOCKER=decision_published';
  END IF;

  SELECT membership.status
  INTO v_membership_status
  FROM plugin_data.csf_term_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.profile_id = v_application.profile_id
    AND membership.term_id = v_application.term_id
  FOR SHARE;
  IF v_membership_status IN ('completed', 'not_completed') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'A finalized semester membership keeps its published outcome.',
      DETAIL = 'CSF_APPLICATION_EDIT_BLOCKER=historical_outcome';
  END IF;

  -- Reported for the receipt only. A Sheet-reviewed semester still owns its
  -- verdict; this editor writes no staged or released decision column, so the
  -- next sync re-reads the workbook exactly as before.
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.csf_application_decision_stages AS stage
    WHERE stage.organization_id = p_organization_id
      AND stage.application_id = p_application_id
  ) INTO v_sheet_reviewed;

  -- Per-column typed application. Each branch parses its own value, so a
  -- malformed payload fails here rather than reaching a cast in an UPDATE.
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_changes) LOOP
    DECLARE
      v_raw jsonb := p_changes -> v_key;
      v_text text := nullif(pg_catalog.btrim(coalesce(p_changes ->> v_key, '')), '');
      v_before jsonb;
      v_after_value jsonb;
    BEGIN
      IF v_key = 'current_grade_level' THEN
        v_before := pg_catalog.to_jsonb(v_application.current_grade_level);
        IF v_text IS NOT NULL AND (v_text !~ '^(9|10|11|12)$') THEN
          RAISE EXCEPTION 'Grade level must be 9, 10, 11, or 12.';
        END IF;
        v_application.current_grade_level := v_text::integer;
        v_after_value := pg_catalog.to_jsonb(v_application.current_grade_level);

      ELSIF v_key = 'returning_status' THEN
        v_before := pg_catalog.to_jsonb(v_application.returning_status);
        IF v_text IS NOT NULL AND v_text NOT IN ('new', 'returning', 'unknown') THEN
          RAISE EXCEPTION 'Returning status must be new, returning, or unknown.';
        END IF;
        v_application.returning_status := v_text;
        v_after_value := pg_catalog.to_jsonb(v_application.returning_status);

      ELSIF v_key = 'shirt_size' THEN
        v_before := pg_catalog.to_jsonb(v_application.shirt_size);
        IF v_text IS NOT NULL
          AND v_text NOT IN ('S', 'M', 'L', 'XL', 'returning_member', 'unknown') THEN
          RAISE EXCEPTION 'That shirt size is not one of the recorded options.';
        END IF;
        v_application.shirt_size := v_text;
        v_after_value := pg_catalog.to_jsonb(v_application.shirt_size);

      ELSIF v_key = 'most_checked_email' THEN
        v_before := pg_catalog.to_jsonb(v_application.most_checked_email);
        IF v_text IS NOT NULL
          AND (pg_catalog.length(v_text) > 254 OR v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
          RAISE EXCEPTION 'Enter a valid reported contact address.';
        END IF;
        v_application.most_checked_email := pg_catalog.lower(v_text);
        v_after_value := pg_catalog.to_jsonb(v_application.most_checked_email);

      ELSIF v_key = 'social_confirmation' THEN
        v_before := pg_catalog.to_jsonb(v_application.social_confirmation);
        IF v_raw IS NOT NULL
          AND pg_catalog.jsonb_typeof(v_raw) NOT IN ('boolean', 'null') THEN
          RAISE EXCEPTION 'The social confirmation value must be true, false, or empty.';
        END IF;
        v_application.social_confirmation :=
          CASE WHEN pg_catalog.jsonb_typeof(v_raw) = 'boolean'
            THEN (v_raw)::text::boolean ELSE NULL END;
        v_after_value := pg_catalog.to_jsonb(v_application.social_confirmation);

      ELSIF v_key IN ('list_i_points', 'list_i_ii_points', 'grand_total_points') THEN
        IF v_text IS NOT NULL AND v_text !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' THEN
          RAISE EXCEPTION 'Reported points must be a number between 0 and 999.99.';
        END IF;
        IF v_key = 'list_i_points' THEN
          v_before := pg_catalog.to_jsonb(v_application.list_i_points);
          v_application.list_i_points := v_text::numeric(5, 2);
          v_after_value := pg_catalog.to_jsonb(v_application.list_i_points);
        ELSIF v_key = 'list_i_ii_points' THEN
          v_before := pg_catalog.to_jsonb(v_application.list_i_ii_points);
          v_application.list_i_ii_points := v_text::numeric(5, 2);
          v_after_value := pg_catalog.to_jsonb(v_application.list_i_ii_points);
        ELSE
          v_before := pg_catalog.to_jsonb(v_application.grand_total_points);
          v_application.grand_total_points := v_text::numeric(5, 2);
          v_after_value := pg_catalog.to_jsonb(v_application.grand_total_points);
        END IF;

      ELSE
        -- Unreachable: the allowlist check above already refused this key.
        RAISE EXCEPTION 'That application field cannot be edited here.';
      END IF;

      IF v_before IS DISTINCT FROM v_after_value THEN
        v_changed := pg_catalog.array_append(v_changed, v_key);
        v_before_values := v_before_values
          || pg_catalog.jsonb_build_object(v_key, v_before);
        v_after_values := v_after_values
          || pg_catalog.jsonb_build_object(v_key, v_after_value);
        IF v_key = ANY (v_eligibility_inputs) THEN
          v_recalculate := true;
        END IF;
      END IF;
      v_applied := v_applied || pg_catalog.jsonb_build_object(v_key, v_after_value);
    END;
  END LOOP;

  IF pg_catalog.array_length(v_changed, 1) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Those values already match the record. Nothing was changed.',
      DETAIL = 'CSF_APPLICATION_EDIT_BLOCKER=no_change';
  END IF;

  v_correlation_id := p_request_id;

  UPDATE plugin_data.csf_term_applications AS application
  SET
    current_grade_level = v_application.current_grade_level,
    returning_status = v_application.returning_status,
    shirt_size = v_application.shirt_size,
    most_checked_email = v_application.most_checked_email,
    social_confirmation = v_application.social_confirmation,
    list_i_points = v_application.list_i_points,
    list_i_ii_points = v_application.list_i_ii_points,
    grand_total_points = v_application.grand_total_points,
    updated_at = v_now
  WHERE application.organization_id = p_organization_id
    AND application.id = p_application_id
  RETURNING application.* INTO v_after;

  -- Identifiers, field names, and the officer's own reason. The audit carries
  -- the reported values because they are the thing being corrected; it carries
  -- no other student attribute.
  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'application.fields_edited',
    'csf_term_applications',
    p_application_id,
    pg_catalog.jsonb_build_object(
      'values', v_before_values,
      'eligibilityStatus', v_application.eligibility_status
    ),
    pg_catalog.jsonb_build_object(
      'values', v_after_values,
      'changedFields', pg_catalog.to_jsonb(v_changed),
      -- Unchanged by this action, and recorded as such: the edit moved the
      -- inputs, not the verdict.
      'eligibilityStatus', v_after.eligibility_status,
      'eligibilityInputsChanged', v_recalculate,
      'sheetReviewedSemester', v_sheet_reviewed,
      'reason', v_reason,
      'requestFingerprint', v_fingerprint
    ),
    v_correlation_id,
    'application_field_edit_request',
    p_request_id::text,
    'officer_application_correction'
  );

  RETURN pg_catalog.jsonb_build_object(
    'applicationId', p_application_id,
    'correlationId', v_correlation_id,
    'changedFields', pg_catalog.to_jsonb(v_changed),
    'eligibilityInputsChanged', v_recalculate,
    'sheetReviewedSemester', v_sheet_reviewed,
    'idempotent', false
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_edit_term_application_fields_locked_impl(
  uuid, uuid, jsonb, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_edit_term_application_fields_locked_impl(
  uuid, uuid, jsonb, text, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_edit_term_application_fields_locked_impl(
  uuid, uuid, jsonb, text, uuid, uuid
) TO postgres;

COMMENT ON FUNCTION plugin_data.csf_edit_term_application_fields_locked_impl(
  uuid, uuid, jsonb, text, uuid, uuid
) IS
  'Owner-only bounded application-field editor retained behind csf_edit_term_application_fields; direct client and service-role execution is revoked.';

-- ===========================================================================
-- A4. The service signature (V128 lock order)
--
-- Authorization, then the shared organization staff-access lock, then the
-- actor''s active host membership row FOR SHARE, then the recheck, and only
-- then the implementation''s own request and row locks. A queued edit whose
-- role change committed first is denied with zero writes.
-- ===========================================================================

CREATE OR REPLACE FUNCTION plugin_data.csf_edit_term_application_fields(
  p_organization_id uuid,
  p_application_id uuid,
  p_changes jsonb,
  p_reason text,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_membership_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'edit_application_records'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
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
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
  END IF;

  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'edit_application_records'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to correct CSF application records.';
  END IF;

  RETURN plugin_data.csf_edit_term_application_fields_locked_impl(
    p_organization_id, p_application_id, p_changes, p_reason,
    p_actor_user_id, p_request_id
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_edit_term_application_fields(
  uuid, uuid, jsonb, text, uuid, uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_edit_term_application_fields(
  uuid, uuid, jsonb, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_edit_term_application_fields(
  uuid, uuid, jsonb, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_edit_term_application_fields(
  uuid, uuid, jsonb, text, uuid, uuid
) IS
  'Authorized officer correction of reported CSF application fields. Refuses a published decision, a finalized membership, a closed semester, an unknown field, and a no-op; never writes identity, ownership, decision, release, assignment, provenance, or staged Sheet decision state.';

-- ===========================================================================
-- B1. Profile note visibility
-- ===========================================================================

ALTER TABLE plugin_data.csf_profile_notes
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'officer'
    CHECK (visibility IN ('officer', 'member'));

COMMENT ON COLUMN plugin_data.csf_profile_notes.visibility IS
  'officer = private chapter annotation, never leaves staff surfaces. member = a comment written to be read by the member this profile belongs to. Defaults to officer so an unspecified note stays private.';

-- Member reads are a narrow, frequent projection; give them their own index
-- rather than filtering the officer history.
CREATE INDEX IF NOT EXISTS csf_profile_notes_member_visible_idx
  ON plugin_data.csf_profile_notes (organization_id, profile_id, created_at DESC)
  WHERE visibility = 'member' AND redacted_at IS NULL;

-- ---------------------------------------------------------------------------
-- B2. Writing a note with an explicit audience
--
-- A distinct signature rather than a replacement: the six-argument function
-- from 20260823214000 stays exactly as it is and keeps writing officer-private
-- notes through the column default, so every existing caller is unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_add_profile_note(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_profile_id uuid,
  p_term_id uuid,
  p_tag text,
  p_body text,
  p_visibility text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_profile_notes%ROWTYPE;
  v_body text := nullif(pg_catalog.btrim(coalesce(p_body, '')), '');
  v_tag text := nullif(pg_catalog.btrim(coalesce(p_tag, '')), '');
  v_visibility text := pg_catalog.lower(
    nullif(pg_catalog.btrim(coalesce(p_visibility, '')), '')
  );
BEGIN
  IF NOT (
    plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles')
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions')
  ) THEN
    RAISE EXCEPTION 'Not authorized to write CSF member notes.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'A note needs a body.' USING ERRCODE = 'check_violation';
  END IF;

  -- An unrecognized audience is refused, never coerced. Defaulting a typo to
  -- 'member' would publish an officer's private words to a student.
  IF v_visibility IS NULL OR v_visibility NOT IN ('officer', 'member') THEN
    RAISE EXCEPTION 'Choose whether this note is officer-only or visible to the member.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_profiles
    WHERE organization_id = p_organization_id
      AND id = p_profile_id
      AND record_status = 'active'
  ) THEN
    RAISE EXCEPTION 'CSF member not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_terms
    WHERE organization_id = p_organization_id AND id = p_term_id
  ) THEN
    RAISE EXCEPTION 'Term not found.' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO plugin_data.csf_profile_notes (
    organization_id, profile_id, term_id, tag, body, author_user_id, visibility
  )
  VALUES (
    p_organization_id, p_profile_id, p_term_id, v_tag, v_body,
    p_actor_user_id, v_visibility
  )
  RETURNING * INTO v_row;

  -- Publishing to the member is the consequential half of this action, so it
  -- carries its own immutable receipt. The body is deliberately not copied
  -- into the audit; the note row is the durable record of what was said.
  IF v_visibility = 'member' THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      before_data, after_data, source_type, source_id, reason_code
    ) VALUES (
      p_organization_id, p_actor_user_id, 'profile.note_published',
      'csf_profile_notes', v_row.id,
      pg_catalog.jsonb_build_object('visibility', NULL),
      pg_catalog.jsonb_build_object(
        'visibility', 'member',
        'profileId', p_profile_id,
        'termId', p_term_id,
        'tag', v_tag,
        'bodyLength', pg_catalog.length(v_body)
      ),
      'profile_note_visibility', v_row.id::text,
      'member_visible_note_published'
    );
  END IF;

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

ALTER FUNCTION plugin_data.csf_add_profile_note(uuid, uuid, uuid, uuid, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_add_profile_note(uuid, uuid, uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_add_profile_note(uuid, uuid, uuid, uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_add_profile_note(uuid, uuid, uuid, uuid, text, text, text) IS
  'Writes a CSF profile note with an explicit audience. An unrecognized audience is refused rather than defaulted, and a member-visible note records its own audit receipt.';

-- ---------------------------------------------------------------------------
-- B3. Pulling a note back
--
-- A note shared with the member by mistake needs a withdrawal that is not a
-- delete. Visibility narrows only: member -> officer. Widening after the fact
-- would republish words the officer wrote believing they were private.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_restrict_profile_note_to_officers(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_note_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_profile_notes%ROWTYPE;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT (
    plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'manage_profiles')
    OR plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions')
  ) THEN
    RAISE EXCEPTION 'Not authorized to change CSF member notes.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_reason IS NULL OR pg_catalog.length(v_reason) < 8 THEN
    RAISE EXCEPTION 'Explain in at least 8 characters why this note is being withdrawn from the member.';
  END IF;

  SELECT note.*
  INTO v_row
  FROM plugin_data.csf_profile_notes AS note
  WHERE note.organization_id = p_organization_id
    AND note.id = p_note_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF member note not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.visibility = 'officer' THEN
    RETURN pg_catalog.jsonb_build_object(
      'noteId', p_note_id, 'visibility', 'officer', 'idempotent', true
    );
  END IF;

  UPDATE plugin_data.csf_profile_notes
  SET visibility = 'officer', updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id AND id = p_note_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id,
    before_data, after_data, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'profile.note_withdrawn',
    'csf_profile_notes', p_note_id,
    pg_catalog.jsonb_build_object('visibility', 'member'),
    pg_catalog.jsonb_build_object(
      'visibility', 'officer',
      'profileId', v_row.profile_id,
      'reason', v_reason
    ),
    'profile_note_visibility', p_note_id::text,
    'member_visible_note_withdrawn'
  );

  RETURN pg_catalog.jsonb_build_object(
    'noteId', p_note_id, 'visibility', 'officer', 'idempotent', false
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_restrict_profile_note_to_officers(uuid, uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_restrict_profile_note_to_officers(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_restrict_profile_note_to_officers(uuid, uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- B4. The member read allowlist
--
-- The only path by which a profile note may reach a member. It cannot return
-- an officer-private note, a redacted note, or a column outside the four it
-- names, whatever the caller asks for. A TypeScript projection can be widened
-- by a future edit; this signature cannot.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_member_visible_profile_notes(
  p_organization_id uuid,
  p_profile_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  term_id uuid,
  tag text,
  body text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT note.id, note.term_id, note.tag, note.body, note.created_at
  FROM plugin_data.csf_profile_notes AS note
  WHERE note.organization_id = p_organization_id
    AND note.profile_id = p_profile_id
    AND note.visibility = 'member'
    AND note.redacted_at IS NULL
  ORDER BY note.created_at DESC
  -- LEAST/GREATEST are SQL syntax, not schema-qualifiable functions.
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

ALTER FUNCTION plugin_data.csf_member_visible_profile_notes(uuid, uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_member_visible_profile_notes(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_visible_profile_notes(uuid, uuid, integer)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_member_visible_profile_notes(uuid, uuid, integer) IS
  'The only allowlisted member-facing projection of CSF profile notes: member-visible, unredacted rows, and never the author, redaction, or visibility columns.';

-- ---------------------------------------------------------------------------
-- B5. Carrying the comments on the member snapshot
--
-- The member profile is one grouped read; adding a second round trip for
-- comments would break that bounded-read contract. The pending-account branch
-- and the verified projection from 20260901103347 are restated unchanged, with
-- one key merged on afterwards. The comments still come from the allowlisting
-- function above, so the snapshot cannot carry an officer note even though it
-- now carries notes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_member_profile_snapshot(
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
  v_account_status text;
  v_current_term_id uuid;
  v_snapshot jsonb;
  v_profile_id uuid;
BEGIN
  SELECT account.status
  INTO v_account_status
  FROM plugin_data.csf_profile_accounts AS account
  WHERE account.organization_id = p_organization_id
    AND account.user_id = p_actor_user_id
    AND account.status IN ('pending', 'verified')
  ORDER BY account.is_primary DESC, account.linked_at DESC, account.id DESC
  LIMIT 1;

  IF v_account_status = 'pending' THEN
    SELECT term.id
    INTO v_current_term_id
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.is_current = true
    ORDER BY term.updated_at DESC, term.id DESC
    LIMIT 1;

    RETURN pg_catalog.jsonb_build_object(
      'profile', NULL,
      'accountStatus', 'pending',
      'currentTermId', v_current_term_id,
      'notes', '[]'::jsonb
    );
  END IF;

  v_snapshot := plugin_data.csf_member_profile_snapshot_verified_projection(
    p_organization_id,
    p_actor_user_id
  );

  BEGIN
    v_profile_id := nullif(v_snapshot -> 'profile' ->> 'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_profile_id := NULL;
  END;

  RETURN v_snapshot || pg_catalog.jsonb_build_object(
    'notes',
    CASE
      WHEN v_profile_id IS NULL THEN '[]'::jsonb
      ELSE coalesce(
        (
          SELECT pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(note) ORDER BY note.created_at DESC
          )
          FROM plugin_data.csf_member_visible_profile_notes(
            p_organization_id, v_profile_id, 50
          ) AS note
        ),
        '[]'::jsonb
      )
    END
  );
END;
$$;

ALTER FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_member_profile_snapshot(uuid, uuid)
  TO service_role;

COMMIT;
