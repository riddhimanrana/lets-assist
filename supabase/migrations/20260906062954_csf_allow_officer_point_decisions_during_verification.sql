BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_point_submission_freeze()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row plugin_data.csf_point_submissions%ROWTYPE;
  v_period plugin_data.csf_review_periods%ROWTYPE;
  v_override boolean;
BEGIN
  v_row := COALESCE(NEW, OLD);
  IF TG_OP = 'UPDATE' AND OLD.source = 'student' THEN
    v_row := OLD;
  END IF;
  IF v_row.source <> 'student' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO v_period
  FROM plugin_data.csf_review_periods
  WHERE organization_id = v_row.organization_id
    AND term_id = v_row.term_id
    AND kind = 'member_points' AND status = 'open'
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- A review changes only decision fields, never the member's claim.
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'submitted'
    AND NEW.status IN ('approved', 'rejected', 'needs_action', 'duplicate')
    AND NEW.reviewed_by IS NOT NULL
    AND NEW.reviewed_at IS NOT NULL
    AND (pg_catalog.to_jsonb(NEW) - ARRAY[
      'status', 'reviewed_by', 'reviewed_at', 'review_notes', 'updated_at'
    ]) = (pg_catalog.to_jsonb(OLD) - ARRAY[
      'status', 'reviewed_by', 'reviewed_at', 'review_notes', 'updated_at'
    ]) THEN
    PERFORM plugin_data.csf_assert_point_actor_authority(
      OLD.organization_id, NEW.reviewed_by, ARRAY['verify_submissions']::text[]
    );
    RETURN NEW;
  END IF;

  SELECT submission_lock_override INTO v_override
  FROM plugin_data.csf_review_decisions
  WHERE organization_id = v_row.organization_id
    AND period_id = v_period.id AND subject_kind = 'profile'
    AND subject_id = v_row.profile_id
  LIMIT 1;
  IF COALESCE(v_override, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'Point verification is open for this term; this member''s submissions are locked.'
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_point_submission_freeze()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_point_submission_freeze()
  TO postgres;

COMMIT;
