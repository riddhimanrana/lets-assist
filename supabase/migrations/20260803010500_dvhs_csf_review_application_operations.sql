-- Membership-application review campaigns.
--
-- Uses the enum values added in the previous migration. Nothing here creates a
-- new table or RPC: the campaign tables are subject-agnostic, and
-- csf_assign_review_ranges already takes a cohort, which csf_term_applications
-- carries.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Which subject a period reviews
--
-- csf_record_review_decision and csf_add_review_note both cast p_subject_kind
-- with no allowlist, so nothing stopped a partner_club verdict being filed
-- inside a member_points campaign. One mapping, used by both, closes that.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_review_subject_kind_for(
  p_kind plugin_data.csf_review_period_kind
)
RETURNS plugin_data.csf_review_subject_kind
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (CASE p_kind
    WHEN 'member_points' THEN 'profile'
    WHEN 'club_audit' THEN 'partner_club'
    WHEN 'membership_applications' THEN 'application'
  END)::plugin_data.csf_review_subject_kind;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_review_subject_kind_for(plugin_data.csf_review_period_kind)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_subject_kind_for(plugin_data.csf_review_period_kind)
  TO service_role;

-- ---------------------------------------------------------------------------
-- B. Decisions reject a subject the period does not review
-- ---------------------------------------------------------------------------

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

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Notes reject the same mismatch
--
-- The note function previously never loaded the period at all, so it could not
-- have checked. It loads it now for the same reason decisions do.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_add_review_note(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_period_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_review_notes%ROWTYPE;
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_kind plugin_data.csf_review_subject_kind := p_subject_kind::plugin_data.csf_review_subject_kind;
  v_expected plugin_data.csf_review_subject_kind;
  v_body text := nullif(pg_catalog.btrim(coalesce(p_body, '')), '');
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions') THEN
    RAISE EXCEPTION 'Not authorized to write CSF review notes.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'A note needs a body.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review period not found.' USING ERRCODE = 'no_data_found';
  END IF;

  v_expected := plugin_data.csf_review_subject_kind_for(v_period.kind);
  IF v_kind <> v_expected THEN
    RAISE EXCEPTION 'A % period reviews % subjects, not %.', v_period.kind, v_expected, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO plugin_data.csf_review_notes (
    organization_id, period_id, subject_kind, subject_id, body, author_user_id
  )
  VALUES (
    p_organization_id, p_period_id, v_kind,
    p_subject_id, v_body, p_actor_user_id
  )
  RETURNING * INTO v_row;

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- C2. The override follows the period's kind
--
-- The original override hardcoded member_points and 'profile', so the row the
-- application freeze below looks for could never have been written. Deriving
-- the subject kind from the period keeps one escape hatch for both campaigns.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_set_review_submission_override(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_period_id uuid,
  p_subject_id uuid,
  p_enabled boolean,
  p_reason text
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
  v_kind plugin_data.csf_review_subject_kind;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT plugin_data.csf_actor_has_permission(p_organization_id, p_actor_user_id, 'verify_submissions') THEN
    RAISE EXCEPTION 'Not authorized to change the CSF submission lock.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_enabled AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Unlocking a member needs a reason.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = p_organization_id AND id = p_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review period not found.' USING ERRCODE = 'no_data_found';
  END IF;

  v_kind := plugin_data.csf_review_subject_kind_for(v_period.kind);

  INSERT INTO plugin_data.csf_review_decisions (
    organization_id, period_id, subject_kind, subject_id,
    submission_lock_override, override_reason, override_by, override_at
  )
  VALUES (
    p_organization_id, p_period_id, v_kind, p_subject_id,
    p_enabled,
    CASE WHEN p_enabled THEN v_reason ELSE NULL END,
    CASE WHEN p_enabled THEN p_actor_user_id ELSE NULL END,
    CASE WHEN p_enabled THEN v_now ELSE NULL END
  )
  ON CONFLICT (organization_id, period_id, subject_kind, subject_id)
  DO UPDATE SET
    submission_lock_override = EXCLUDED.submission_lock_override,
    override_reason = EXCLUDED.override_reason,
    override_by = EXCLUDED.override_by,
    override_at = EXCLUDED.override_at,
    updated_at = v_now
  RETURNING * INTO v_row;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, after_data, reason_code
  )
  VALUES (
    p_organization_id, p_actor_user_id,
    CASE WHEN p_enabled THEN 'review_decision.unlock' ELSE 'review_decision.relock' END,
    'csf_review_decision', v_row.id, v_period.term_id, pg_catalog.to_jsonb(v_row), v_reason
  );

  RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Application freeze, as defense in depth
--
-- Applicants have no direct write path to csf_term_applications today:
-- csf_submit_application_correction only inserts a correction request, and
-- csf_review_application_correction only updates that request. Staff apply
-- corrections; applicants propose them.
--
-- This trigger is therefore inert against every current caller, and is written
-- so that staying inert is checkable: every write today runs as service_role
-- through a SECURITY DEFINER RPC, where auth.uid() is null and the function
-- returns immediately. It exists to catch a future direct applicant write path
-- being added without remembering the campaign.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_application_review_freeze()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_term_applications%ROWTYPE;
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_override boolean;
BEGIN
  -- No end-user session: this is the server acting, which is the campaign work.
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_row := COALESCE(NEW, OLD);

  SELECT *
    INTO v_period
    FROM plugin_data.csf_review_periods
   WHERE organization_id = v_row.organization_id
     AND term_id = v_row.term_id
     AND kind = 'membership_applications'
     AND status = 'open'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only the applicant themselves freezes. An officer with a browser session is
  -- doing the reviewing, not evading it.
  SELECT account.user_id
    INTO v_owner
    FROM plugin_data.csf_profile_accounts AS account
   WHERE account.organization_id = v_row.organization_id
     AND account.profile_id = v_row.profile_id
     AND account.user_id = v_actor
     -- Only a verified link means this session really is the applicant. A
     -- pending or rejected claim must not be able to freeze anyone.
     AND account.status = 'verified'
     AND account.revoked_at IS NULL
   LIMIT 1;

  IF v_owner IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT submission_lock_override
    INTO v_override
    FROM plugin_data.csf_review_decisions
   WHERE organization_id = v_row.organization_id
     AND period_id = v_period.id
     AND subject_kind = 'application'
     AND subject_id = v_row.id
   LIMIT 1;

  IF COALESCE(v_override, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'Application review is open; this application is locked.'
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_application_review_freeze()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS csf_term_applications_review_freeze ON plugin_data.csf_term_applications;
CREATE TRIGGER csf_term_applications_review_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON plugin_data.csf_term_applications
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_enforce_application_review_freeze();

-- ---------------------------------------------------------------------------
-- E. Comments
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION plugin_data.csf_review_subject_kind_for(plugin_data.csf_review_period_kind) IS
  'The one subject kind a review period of the given kind may hold decisions and notes for.';

COMMENT ON FUNCTION plugin_data.csf_enforce_application_review_freeze() IS
  'Defense in depth: blocks an applicant editing their own application while a membership_applications period is open. Inert for service_role callers, which is every caller today.';

COMMIT;
