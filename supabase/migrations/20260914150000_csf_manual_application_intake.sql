-- Add one audited term switch for native website intake while preserving
-- Google Form sync, existing application corrections, and officer review.
BEGIN;

ALTER TABLE plugin_data.csf_terms
  ADD COLUMN accepts_new_applications boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN plugin_data.csf_terms.accepts_new_applications IS
  'Controls new native website applications for this term. Terms start closed until authorized staff explicitly opens intake. It does not control an external Google Form, imports, corrections, or staff review.';

CREATE OR REPLACE FUNCTION plugin_data.csf_set_application_intake(
  p_organization_id uuid,
  p_term_id uuid,
  p_accepts_new_applications boolean,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before plugin_data.csf_terms%ROWTYPE;
  v_after plugin_data.csf_terms%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_staff_access:' || p_organization_id::text,
      0
    )
  );

  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_cohorts_terms'
    ) THEN
    RAISE EXCEPTION 'Not authorized to manage CSF application intake.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Serialize the decision with the native-application insert guard. The
  -- staff-access lock stays first so permission changes keep their established
  -- ordering before any term-scoped intake work.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_term_id::text,
      0
    )
  );

  SELECT term.* INTO v_before
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semester was not found in this organization.'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_before.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Closed or archived CSF semesters cannot accept new applications.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_before.accepts_new_applications = p_accepts_new_applications THEN
    RETURN jsonb_build_object(
      'termId', v_before.id,
      'acceptsNewApplications', v_before.accepts_new_applications,
      'changed', false
    );
  END IF;

  UPDATE plugin_data.csf_terms
  SET accepts_new_applications = p_accepts_new_applications,
      updated_at = pg_catalog.now()
  WHERE organization_id = p_organization_id
    AND id = p_term_id
  RETURNING * INTO v_after;

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
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    CASE
      WHEN p_accepts_new_applications THEN 'application_intake.opened'
      ELSE 'application_intake.closed'
    END,
    'csf_terms',
    v_after.id,
    v_after.id,
    jsonb_build_object('acceptsNewApplications', v_before.accepts_new_applications),
    jsonb_build_object('acceptsNewApplications', v_after.accepts_new_applications),
    'staff_action',
    v_after.id::text,
    CASE
      WHEN p_accepts_new_applications THEN 'native_application_intake_opened'
      ELSE 'native_application_intake_closed'
    END
  );

  RETURN jsonb_build_object(
    'termId', v_after.id,
    'acceptsNewApplications', v_after.accepts_new_applications,
    'changed', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_new_application_intake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_accepts_new_applications boolean;
BEGIN
  IF NEW.source <> 'native' THEN
    RETURN NEW;
  END IF;

  -- A close that wins this lock commits before this insert checks the flag. An
  -- insert that wins it keeps the intake state stable through its statement.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.organization_id::text || ':' || NEW.term_id::text,
      0
    )
  );

  SELECT term.accepts_new_applications
  INTO v_accepts_new_applications
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = NEW.organization_id
    AND term.id = NEW.term_id;

  IF NOT FOUND OR v_accepts_new_applications IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'New applications are closed for this semester.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS csf_term_applications_new_intake_guard
  ON plugin_data.csf_term_applications;
CREATE TRIGGER csf_term_applications_new_intake_guard
  BEFORE INSERT ON plugin_data.csf_term_applications
  FOR EACH ROW
  EXECUTE FUNCTION plugin_data.csf_enforce_new_application_intake();

REVOKE ALL ON FUNCTION plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_new_application_intake()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid) IS
  'Service-only, permission-checked switch for new native website applications in one organization term.';
COMMENT ON FUNCTION plugin_data.csf_enforce_new_application_intake() IS
  'Rejects only new native application rows when the term intake switch is off. Existing application updates and imported sources remain available.';

COMMIT;
