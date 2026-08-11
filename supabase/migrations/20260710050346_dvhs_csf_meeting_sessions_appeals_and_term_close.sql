-- Separate logical meetings from dated sessions, add member appeals, and
-- provide an atomic audited term-close boundary.

BEGIN;

CREATE TABLE IF NOT EXISTS plugin_data.csf_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  meeting_key text NOT NULL,
  label text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, term_id, meeting_key)
);

CREATE TABLE IF NOT EXISTS plugin_data.csf_meeting_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES plugin_data.csf_meetings(id) ON DELETE CASCADE,
  legacy_term_meeting_id uuid UNIQUE REFERENCES plugin_data.csf_term_meetings(id) ON DELETE SET NULL,
  session_date date,
  starts_at timestamptz,
  location text,
  attendance_source_url text,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'open', 'closed', 'cancelled', 'archived')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_meetings_org_term_idx
  ON plugin_data.csf_meetings (organization_id, term_id, status, sort_order);
CREATE INDEX IF NOT EXISTS csf_meeting_sessions_meeting_date_idx
  ON plugin_data.csf_meeting_sessions (organization_id, meeting_id, session_date, status);

INSERT INTO plugin_data.csf_meetings (
  organization_id, term_id, meeting_key, label, required, sort_order, status, created_by, created_at, updated_at
)
SELECT
  legacy.organization_id,
  legacy.term_id,
  legacy.meeting_key,
  legacy.label,
  legacy.required,
  legacy.sort_order,
  legacy.status,
  legacy.created_by,
  legacy.created_at,
  legacy.updated_at
FROM plugin_data.csf_term_meetings AS legacy
ON CONFLICT (organization_id, term_id, meeting_key) DO NOTHING;

INSERT INTO plugin_data.csf_meeting_sessions (
  organization_id,
  meeting_id,
  legacy_term_meeting_id,
  session_date,
  starts_at,
  location,
  attendance_source_url,
  status,
  settings,
  created_by,
  created_at,
  updated_at
)
SELECT
  legacy.organization_id,
  meeting.id,
  legacy.id,
  legacy.meeting_date,
  legacy.starts_at,
  legacy.location,
  legacy.attendance_source_url,
  CASE legacy.status WHEN 'active' THEN 'scheduled' WHEN 'inactive' THEN 'cancelled' ELSE 'archived' END,
  legacy.settings,
  legacy.created_by,
  legacy.created_at,
  legacy.updated_at
FROM plugin_data.csf_term_meetings AS legacy
JOIN plugin_data.csf_meetings AS meeting
  ON meeting.organization_id = legacy.organization_id
 AND meeting.term_id = legacy.term_id
 AND meeting.meeting_key = legacy.meeting_key
ON CONFLICT (legacy_term_meeting_id) DO NOTHING;

ALTER TABLE plugin_data.csf_meeting_attendance
  ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES plugin_data.csf_meetings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meeting_session_id uuid REFERENCES plugin_data.csf_meeting_sessions(id) ON DELETE SET NULL;

UPDATE plugin_data.csf_meeting_attendance AS attendance
SET
  meeting_id = session.meeting_id,
  meeting_session_id = session.id
FROM plugin_data.csf_meeting_sessions AS session
WHERE attendance.term_meeting_id = session.legacy_term_meeting_id
  AND (attendance.meeting_id IS NULL OR attendance.meeting_session_id IS NULL);

CREATE INDEX IF NOT EXISTS csf_meeting_attendance_session_idx
  ON plugin_data.csf_meeting_attendance (organization_id, meeting_session_id, match_status, status);

CREATE TABLE IF NOT EXISTS plugin_data.csf_point_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES plugin_data.csf_point_submissions(id) ON DELETE SET NULL,
  credit_record_id uuid REFERENCES plugin_data.csf_credit_records(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (nullif(btrim(reason), '') IS NOT NULL),
  requested_points numeric(6,2) CHECK (requested_points IS NULL OR requested_points > 0),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected', 'withdrawn')),
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS csf_point_appeals_org_term_status_idx
  ON plugin_data.csf_point_appeals (organization_id, term_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS csf_point_appeals_one_open_submission_idx
  ON plugin_data.csf_point_appeals (organization_id, profile_id, submission_id)
  WHERE submission_id IS NOT NULL AND status IN ('submitted', 'under_review');

ALTER TABLE plugin_data.csf_terms
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'open'
    CHECK (lifecycle_status IN ('planned', 'open', 'closed', 'archived')),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closure_policy_version integer;

CREATE TABLE IF NOT EXISTS plugin_data.csf_term_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  decisions jsonb NOT NULL CHECK (jsonb_typeof(decisions) = 'array'),
  closed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, term_id)
);

CREATE OR REPLACE FUNCTION plugin_data.csf_close_term(
  p_organization_id uuid,
  p_term_id uuid,
  p_policy_version integer,
  p_decisions jsonb,
  p_summary jsonb,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_profile_id uuid;
  v_derived_status text;
  v_effective_status text;
  v_now timestamptz := now();
  v_updated integer := 0;
BEGIN
  IF jsonb_typeof(p_decisions) <> 'array' OR jsonb_array_length(p_decisions) = 0 THEN
    RAISE EXCEPTION 'Term close requires at least one membership decision.';
  END IF;
  PERFORM 1
  FROM plugin_data.csf_terms
  WHERE organization_id = p_organization_id AND id = p_term_id AND lifecycle_status <> 'closed'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF term is missing or already closed.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_decisions)
  LOOP
    v_profile_id := (v_item->>'profileId')::uuid;
    v_derived_status := v_item->>'status';
    IF v_derived_status NOT IN ('completed', 'not_completed') THEN
      RAISE EXCEPTION 'Invalid term-close decision for profile %.', v_profile_id;
    END IF;

    SELECT coalesce(membership.override_status, v_derived_status)
    INTO v_effective_status
    FROM plugin_data.csf_term_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.term_id = p_term_id
      AND membership.profile_id = v_profile_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Term membership not found for profile %.', v_profile_id;
    END IF;

    UPDATE plugin_data.csf_term_memberships
    SET
      status = v_effective_status,
      status_reason = coalesce(v_item->>'reason', status_reason),
      eligibility_snapshot = eligibility_snapshot || jsonb_build_object(
        'termClose', v_item,
        'policyVersion', p_policy_version,
        'closedAt', v_now
      ),
      completed_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND term_id = p_term_id
      AND profile_id = v_profile_id;
    v_updated := v_updated + 1;
  END LOOP;

  UPDATE plugin_data.csf_terms
  SET
    lifecycle_status = 'closed',
    is_current = false,
    closed_at = v_now,
    closed_by = p_actor_user_id,
    closure_policy_version = p_policy_version,
    updated_at = v_now
  WHERE organization_id = p_organization_id AND id = p_term_id;

  INSERT INTO plugin_data.csf_term_closures (
    organization_id, term_id, policy_version, summary, decisions, closed_by, closed_at
  ) VALUES (
    p_organization_id, p_term_id, p_policy_version, p_summary, p_decisions, p_actor_user_id, v_now
  );

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id, after_data
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'term.close',
    'csf_terms',
    p_term_id,
    p_term_id,
    jsonb_build_object('policyVersion', p_policy_version, 'summary', p_summary, 'membershipCount', v_updated)
  );

  RETURN jsonb_build_object('termId', p_term_id, 'membershipCount', v_updated, 'closedAt', v_now);
END;
$$;

ALTER TABLE plugin_data.csf_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_meeting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_point_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_term_closures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_meetings, plugin_data.csf_meeting_sessions,
  plugin_data.csf_point_appeals, plugin_data.csf_term_closures FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_meetings, plugin_data.csf_meeting_sessions,
  plugin_data.csf_point_appeals, plugin_data.csf_term_closures TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid)
  TO service_role;

COMMENT ON TABLE plugin_data.csf_meetings IS 'Logical CSF meeting requirements that may have one or more dated sessions.';
COMMENT ON TABLE plugin_data.csf_meeting_sessions IS 'Dated sessions and attendance-source configuration for one logical CSF meeting.';
COMMENT ON TABLE plugin_data.csf_point_appeals IS 'Private member appeal and officer resolution workflow for a point submission or award.';
COMMENT ON FUNCTION plugin_data.csf_close_term(uuid, uuid, integer, jsonb, jsonb, uuid) IS
  'Atomically applies shared-evaluator membership decisions and closes one overlapping CSF term with audit history.';

COMMIT;
