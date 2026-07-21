-- Keep the existing csf_term_policies table as the published-only operational
-- head. Officer edits live in a separate draft table until an adviser or
-- organization admin publishes them atomically.

BEGIN;

ALTER TABLE plugin_data.csf_term_policies
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outside_volunteering_allowed boolean NOT NULL DEFAULT false;

UPDATE plugin_data.csf_term_policies
SET
  published_at = coalesce(published_at, updated_at, created_at, now()),
  published_by = coalesce(published_by, updated_by, created_by)
WHERE published_at IS NULL;

ALTER TABLE plugin_data.csf_term_policies
  ALTER COLUMN published_at SET DEFAULT now(),
  ALTER COLUMN published_at SET NOT NULL;

CREATE TABLE plugin_data.csf_term_policy_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL,
  base_policy_version integer CHECK (base_policy_version IS NULL OR base_policy_version > 0),
  draft_revision integer NOT NULL DEFAULT 1 CHECK (draft_revision > 0),
  total_points_required numeric(6,2) NOT NULL CHECK (total_points_required >= 0),
  max_drive_points numeric(6,2) NOT NULL CHECK (max_drive_points >= 0 AND max_drive_points <= total_points_required),
  max_points_per_activity numeric(6,2) NOT NULL CHECK (max_points_per_activity > 0),
  required_meetings integer NOT NULL CHECK (required_meetings >= 0),
  allowed_absences integer NOT NULL CHECK (
    allowed_absences >= 0
    AND (required_meetings = 0 OR allowed_absences <= required_meetings)
  ),
  allow_point_carryover boolean NOT NULL DEFAULT false,
  outside_volunteering_allowed boolean NOT NULL DEFAULT false,
  academic_rules jsonb NOT NULL CHECK (jsonb_typeof(academic_rules) = 'object'),
  dues_required boolean NOT NULL DEFAULT false,
  dues_amount numeric(8,2) NOT NULL CHECK (dues_amount >= 0),
  dues_currency text NOT NULL CHECK (dues_currency ~ '^[A-Z]{3}$'),
  copied_from_term_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, term_id),
  FOREIGN KEY (term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (copied_from_term_id, organization_id)
    REFERENCES plugin_data.csf_terms (id, organization_id) ON DELETE SET NULL (copied_from_term_id)
);

CREATE INDEX csf_term_policy_drafts_org_updated_idx
  ON plugin_data.csf_term_policy_drafts (organization_id, updated_at DESC, id DESC);

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_term_policy_values(
  p_total_points_required numeric,
  p_max_drive_points numeric,
  p_max_points_per_activity numeric,
  p_required_meetings integer,
  p_allowed_absences integer,
  p_academic_rules jsonb,
  p_dues_amount numeric,
  p_dues_currency text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_total_points_required IS NULL OR p_max_drive_points IS NULL
    OR p_max_points_per_activity IS NULL OR p_required_meetings IS NULL
    OR p_allowed_absences IS NULL OR p_dues_amount IS NULL THEN
    RAISE EXCEPTION 'CSF semester requirements are incomplete.';
  END IF;
  IF p_total_points_required < 0 OR p_max_drive_points < 0
    OR p_max_points_per_activity <= 0 OR p_required_meetings < 0
    OR p_allowed_absences < 0 OR p_dues_amount < 0 THEN
    RAISE EXCEPTION 'CSF semester requirements cannot be negative.';
  END IF;
  IF p_max_drive_points > p_total_points_required THEN
    RAISE EXCEPTION 'The drive-point cap cannot exceed the total point requirement.';
  END IF;
  IF p_required_meetings > 0 AND p_allowed_absences > p_required_meetings THEN
    RAISE EXCEPTION 'Allowed absences cannot exceed required meetings.';
  END IF;
  IF jsonb_typeof(p_academic_rules) <> 'object'
    OR coalesce((p_academic_rules->>'minimumListI')::numeric, -1) < 0
    OR coalesce((p_academic_rules->>'minimumListIAndII')::numeric, -1) < 0
    OR coalesce((p_academic_rules->>'minimumTotal')::numeric, -1) < 0
    OR coalesce((p_academic_rules->>'maximumCourses')::integer, 0) <= 0
    OR jsonb_typeof(coalesce(p_academic_rules->'disqualifyingGrades', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Academic rules are incomplete or invalid.';
  END IF;
  IF p_dues_currency IS NULL OR upper(btrim(p_dues_currency)) !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Dues currency must be a three-letter code.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_can_edit_term_policy_draft(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.organization_members AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.user_id = p_actor_user_id
        AND membership.role = 'admin'
        AND coalesce(membership.status, 'active') = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_role_permissions AS permission
        ON permission.organization_id = position.organization_id
       AND permission.role_id = position.role_id
       AND permission.permission_key = 'manage_settings'
       AND permission.enabled = true
      JOIN public.organization_members AS membership
        ON membership.organization_id = position.organization_id
       AND membership.user_id = position.user_id
       AND membership.role IN ('staff', 'admin')
       AND coalesce(membership.status, 'active') = 'active'
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND (
          position.starts_at IS NULL
          OR position.starts_at <= (now() AT TIME ZONE 'America/Los_Angeles')::date
        )
        AND (
          position.ends_at IS NULL
          OR position.ends_at >= (now() AT TIME ZONE 'America/Los_Angeles')::date
        )
    );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_actor_can_publish_term_policy(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.organization_members AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.user_id = p_actor_user_id
        AND membership.role = 'admin'
        AND coalesce(membership.status, 'active') = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_staff_positions AS position
      JOIN plugin_data.csf_roles AS role
        ON role.organization_id = position.organization_id
        AND role.id = position.role_id
        AND role.is_system = true
      JOIN public.organization_members AS membership
        ON membership.organization_id = position.organization_id
       AND membership.user_id = position.user_id
       AND membership.role IN ('staff', 'admin')
       AND coalesce(membership.status, 'active') = 'active'
      WHERE position.organization_id = p_organization_id
        AND position.user_id = p_actor_user_id
        AND position.status = 'active'
        AND (
          position.starts_at IS NULL
          OR position.starts_at <= (now() AT TIME ZONE 'America/Los_Angeles')::date
        )
        AND (
          position.ends_at IS NULL
          OR position.ends_at >= (now() AT TIME ZONE 'America/Los_Angeles')::date
        )
        AND role.key IN ('advisor', 'owner')
    );
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_save_term_policy_draft(
  p_organization_id uuid,
  p_term_id uuid,
  p_expected_draft_revision integer,
  p_total_points_required numeric,
  p_max_drive_points numeric,
  p_max_points_per_activity numeric,
  p_required_meetings integer,
  p_allowed_absences integer,
  p_allow_point_carryover boolean,
  p_outside_volunteering_allowed boolean,
  p_academic_rules jsonb,
  p_dues_required boolean,
  p_dues_amount numeric,
  p_dues_currency text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_published plugin_data.csf_term_policies%ROWTYPE;
  v_before plugin_data.csf_term_policy_drafts%ROWTYPE;
  v_draft plugin_data.csf_term_policy_drafts%ROWTYPE;
  v_published_version integer := 0;
  v_now timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_can_edit_term_policy_draft(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to edit semester policy drafts.';
  END IF;
  PERFORM plugin_data.csf_assert_term_policy_values(
    p_total_points_required, p_max_drive_points, p_max_points_per_activity,
    p_required_meetings, p_allowed_absences, p_academic_rules,
    p_dues_amount, p_dues_currency
  );

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester not found.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Closed or archived semester policy cannot be changed.';
  END IF;

  SELECT policy.*
  INTO v_published
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF FOUND THEN v_published_version := v_published.policy_version; END IF;

  SELECT draft.*
  INTO v_before
  FROM plugin_data.csf_term_policy_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.term_id = p_term_id
  FOR UPDATE;

  IF FOUND AND coalesce(p_expected_draft_revision, 0) <> v_before.draft_revision THEN
    RAISE EXCEPTION 'The policy draft changed; refresh and try again.';
  ELSIF NOT FOUND AND coalesce(p_expected_draft_revision, 0) <> 0 THEN
    RAISE EXCEPTION 'The policy draft changed; refresh and try again.';
  END IF;

  INSERT INTO plugin_data.csf_term_policy_drafts (
    organization_id, term_id, base_policy_version, draft_revision,
    total_points_required, max_drive_points, max_points_per_activity,
    required_meetings, allowed_absences, allow_point_carryover,
    outside_volunteering_allowed,
    academic_rules, dues_required, dues_amount, dues_currency,
    created_by, updated_by, created_at, updated_at
  ) VALUES (
    p_organization_id, p_term_id,
    CASE WHEN v_published_version = 0 THEN NULL ELSE v_published_version END,
    1, p_total_points_required, p_max_drive_points, p_max_points_per_activity,
    p_required_meetings, p_allowed_absences, coalesce(p_allow_point_carryover, false),
    coalesce(p_outside_volunteering_allowed, false),
    p_academic_rules, coalesce(p_dues_required, false),
    CASE WHEN coalesce(p_dues_required, false) THEN p_dues_amount ELSE 0 END,
    upper(btrim(p_dues_currency)), p_actor_user_id, p_actor_user_id, v_now, v_now
  )
  ON CONFLICT (organization_id, term_id) DO UPDATE SET
    base_policy_version = EXCLUDED.base_policy_version,
    draft_revision = plugin_data.csf_term_policy_drafts.draft_revision + 1,
    total_points_required = EXCLUDED.total_points_required,
    max_drive_points = EXCLUDED.max_drive_points,
    max_points_per_activity = EXCLUDED.max_points_per_activity,
    required_meetings = EXCLUDED.required_meetings,
    allowed_absences = EXCLUDED.allowed_absences,
    allow_point_carryover = EXCLUDED.allow_point_carryover,
    outside_volunteering_allowed = EXCLUDED.outside_volunteering_allowed,
    academic_rules = EXCLUDED.academic_rules,
    dues_required = EXCLUDED.dues_required,
    dues_amount = EXCLUDED.dues_amount,
    dues_currency = EXCLUDED.dues_currency,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_draft;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'term_policy.draft_saved',
    'csf_term_policy_drafts', v_draft.id, p_term_id,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_draft), v_correlation_id, 'policy_draft', v_draft.id::text,
    'semester_policy_draft_saved'
  );

  RETURN jsonb_build_object(
    'draftId', v_draft.id,
    'draftRevision', v_draft.draft_revision,
    'basePolicyVersion', v_draft.base_policy_version,
    'termId', p_term_id,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_publish_term_policy(
  p_organization_id uuid,
  p_term_id uuid,
  p_expected_draft_revision integer,
  p_expected_published_version integer,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_term plugin_data.csf_terms%ROWTYPE;
  v_draft plugin_data.csf_term_policy_drafts%ROWTYPE;
  v_before plugin_data.csf_term_policies%ROWTYPE;
  v_published plugin_data.csf_term_policies%ROWTYPE;
  v_current_version integer := 0;
  v_impact_count bigint := 0;
  v_reason text := nullif(btrim(p_reason), '');
  v_now timestamptz := now();
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_can_publish_term_policy(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Only an adviser or organization admin can publish semester policy.';
  END IF;

  SELECT term.*
  INTO v_term
  FROM plugin_data.csf_terms AS term
  WHERE term.organization_id = p_organization_id
    AND term.id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CSF semester not found.'; END IF;
  IF v_term.lifecycle_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'Closed or archived semester policy cannot be published.';
  END IF;

  SELECT draft.*
  INTO v_draft
  FROM plugin_data.csf_term_policy_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No semester policy draft is available to publish.'; END IF;
  IF v_draft.draft_revision IS DISTINCT FROM p_expected_draft_revision THEN
    RAISE EXCEPTION 'The policy draft changed; refresh and try again.';
  END IF;

  SELECT policy.*
  INTO v_before
  FROM plugin_data.csf_term_policies AS policy
  WHERE policy.organization_id = p_organization_id
    AND policy.term_id = p_term_id
  FOR UPDATE;
  IF FOUND THEN v_current_version := v_before.policy_version; END IF;
  IF v_current_version <> coalesce(p_expected_published_version, 0)
    OR coalesce(v_draft.base_policy_version, 0) <> v_current_version THEN
    RAISE EXCEPTION 'The published policy changed; refresh the draft before publishing.';
  END IF;

  PERFORM plugin_data.csf_assert_term_policy_values(
    v_draft.total_points_required, v_draft.max_drive_points,
    v_draft.max_points_per_activity, v_draft.required_meetings,
    v_draft.allowed_absences, v_draft.academic_rules,
    v_draft.dues_amount, v_draft.dues_currency
  );

  SELECT
    (SELECT count(*) FROM plugin_data.csf_term_applications WHERE organization_id = p_organization_id AND term_id = p_term_id)
    + (SELECT count(*) FROM plugin_data.csf_term_memberships WHERE organization_id = p_organization_id AND term_id = p_term_id)
    + (SELECT count(*) FROM plugin_data.csf_dues_records WHERE organization_id = p_organization_id AND term_id = p_term_id)
    + (SELECT count(*) FROM plugin_data.csf_point_submissions WHERE organization_id = p_organization_id AND term_id = p_term_id)
    + (SELECT count(*) FROM plugin_data.csf_credit_records WHERE organization_id = p_organization_id AND term_id = p_term_id)
    + (SELECT count(*) FROM plugin_data.csf_meeting_attendance WHERE organization_id = p_organization_id AND term_id = p_term_id)
  INTO v_impact_count;

  IF v_current_version > 0 AND v_impact_count > 0
    AND (v_reason IS NULL OR char_length(v_reason) < 10) THEN
    RAISE EXCEPTION 'Publishing over an active policy requires a reason of at least 10 characters.';
  END IF;

  INSERT INTO plugin_data.csf_term_policies (
    organization_id, term_id, policy_version, total_points_required,
    max_drive_points, max_points_per_activity, required_meetings,
    allowed_absences, allow_point_carryover, academic_rules,
    outside_volunteering_allowed,
    dues_required, dues_amount, dues_currency, created_by, updated_by,
    created_at, updated_at, published_at, published_by
  ) VALUES (
    p_organization_id, p_term_id, 1, v_draft.total_points_required,
    v_draft.max_drive_points, v_draft.max_points_per_activity,
    v_draft.required_meetings, v_draft.allowed_absences,
    v_draft.allow_point_carryover, v_draft.academic_rules,
    v_draft.outside_volunteering_allowed,
    v_draft.dues_required, v_draft.dues_amount, v_draft.dues_currency,
    p_actor_user_id, p_actor_user_id, v_now, v_now, v_now, p_actor_user_id
  )
  ON CONFLICT (organization_id, term_id) DO UPDATE SET
    policy_version = plugin_data.csf_term_policies.policy_version + 1,
    total_points_required = EXCLUDED.total_points_required,
    max_drive_points = EXCLUDED.max_drive_points,
    max_points_per_activity = EXCLUDED.max_points_per_activity,
    required_meetings = EXCLUDED.required_meetings,
    allowed_absences = EXCLUDED.allowed_absences,
    allow_point_carryover = EXCLUDED.allow_point_carryover,
    academic_rules = EXCLUDED.academic_rules,
    outside_volunteering_allowed = EXCLUDED.outside_volunteering_allowed,
    dues_required = EXCLUDED.dues_required,
    dues_amount = EXCLUDED.dues_amount,
    dues_currency = EXCLUDED.dues_currency,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at,
    published_at = EXCLUDED.published_at,
    published_by = EXCLUDED.published_by
  RETURNING * INTO v_published;

  DELETE FROM plugin_data.csf_term_policy_drafts
  WHERE organization_id = p_organization_id
    AND term_id = p_term_id
    AND id = v_draft.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'term_policy.published',
    'csf_term_policies', v_published.id, p_term_id,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_published) || jsonb_build_object(
      'draftRevision', v_draft.draft_revision,
      'impactCount', v_impact_count,
      'publicationReason', v_reason
    ),
    v_correlation_id, 'policy_draft', v_draft.id::text,
    CASE WHEN v_current_version = 0 THEN 'semester_policy_published' ELSE 'semester_policy_republished' END
  );

  RETURN jsonb_build_object(
    'policyId', v_published.id,
    'policyVersion', v_published.policy_version,
    'draftRevision', v_draft.draft_revision,
    'impactCount', v_impact_count,
    'termId', p_term_id,
    'correlationId', v_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_discard_term_policy_draft(
  p_organization_id uuid,
  p_term_id uuid,
  p_expected_draft_revision integer,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft plugin_data.csf_term_policy_drafts%ROWTYPE;
  v_reason text := nullif(btrim(p_reason), '');
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  IF p_actor_user_id IS NULL
    OR NOT plugin_data.csf_actor_can_edit_term_policy_draft(p_organization_id, p_actor_user_id) THEN
    RAISE EXCEPTION 'Not authorized to edit semester policy drafts.';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Discarding a policy draft requires a reason of at least 10 characters.';
  END IF;

  SELECT draft.*
  INTO v_draft
  FROM plugin_data.csf_term_policy_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.term_id = p_term_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Semester policy draft not found.'; END IF;
  IF v_draft.draft_revision IS DISTINCT FROM p_expected_draft_revision THEN
    RAISE EXCEPTION 'The policy draft changed; refresh and try again.';
  END IF;

  DELETE FROM plugin_data.csf_term_policy_drafts
  WHERE organization_id = p_organization_id
    AND term_id = p_term_id
    AND id = v_draft.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id, actor_user_id, action, target_type, target_id, term_id,
    before_data, after_data, correlation_id, source_type, source_id, reason_code
  ) VALUES (
    p_organization_id, p_actor_user_id, 'term_policy.draft_discarded',
    'csf_term_policy_drafts', v_draft.id, p_term_id,
    to_jsonb(v_draft), jsonb_build_object('reason', v_reason),
    v_correlation_id, 'policy_draft', v_draft.id::text,
    'semester_policy_draft_discarded'
  );

  RETURN jsonb_build_object(
    'draftId', v_draft.id,
    'draftRevision', v_draft.draft_revision,
    'termId', p_term_id,
    'correlationId', v_correlation_id
  );
END;
$$;

ALTER TABLE plugin_data.csf_term_policy_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plugin_data.csf_term_policy_drafts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_term_policy_drafts TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_assert_term_policy_values(numeric,numeric,numeric,integer,integer,jsonb,numeric,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_actor_can_edit_term_policy_draft(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_actor_can_edit_term_policy_draft(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_actor_can_publish_term_policy(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_actor_can_publish_term_policy(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_save_term_policy_draft(uuid,uuid,integer,numeric,numeric,numeric,integer,integer,boolean,boolean,jsonb,boolean,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_save_term_policy_draft(uuid,uuid,integer,numeric,numeric,numeric,integer,integer,boolean,boolean,jsonb,boolean,numeric,text,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_publish_term_policy(uuid,uuid,integer,integer,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_publish_term_policy(uuid,uuid,integer,integer,text,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_discard_term_policy_draft(uuid,uuid,integer,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_discard_term_policy_draft(uuid,uuid,integer,text,uuid)
  TO service_role;

-- Retire direct writes to the published operational head. Historical SQL
-- functions remain for migration replay but application code can no longer
-- invoke them with the server role.
REVOKE EXECUTE ON FUNCTION plugin_data.csf_update_term_policy_v2(
  uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,jsonb,boolean,numeric,text,uuid
) FROM service_role;
REVOKE EXECUTE ON FUNCTION plugin_data.csf_update_term_policy(
  uuid,uuid,numeric,numeric,numeric,integer,integer,boolean,uuid
) FROM service_role;

COMMENT ON TABLE plugin_data.csf_term_policy_drafts IS
  'Officer-edited semester policy that is never used by operational eligibility, dues, points, reporting, or closeout until published.';
COMMENT ON FUNCTION plugin_data.csf_publish_term_policy(uuid,uuid,integer,integer,text,uuid) IS
  'Adviser/admin-only atomic publication from an optimistic draft revision into the published operational policy head.';

COMMIT;
