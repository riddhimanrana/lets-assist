-- Add explicit CSF term memberships and versioned requirement policies.

BEGIN;

CREATE TABLE IF NOT EXISTS plugin_data.csf_term_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  total_points_required numeric(6,2) NOT NULL DEFAULT 7 CHECK (total_points_required >= 0),
  max_drive_points numeric(6,2) NOT NULL DEFAULT 2 CHECK (max_drive_points >= 0),
  max_points_per_activity numeric(6,2) NOT NULL DEFAULT 3 CHECK (max_points_per_activity > 0),
  required_meetings integer NOT NULL DEFAULT 0 CHECK (required_meetings >= 0),
  allowed_absences integer NOT NULL DEFAULT 1 CHECK (allowed_absences >= 0),
  allow_point_carryover boolean NOT NULL DEFAULT false,
  academic_rules jsonb NOT NULL DEFAULT jsonb_build_object(
    'minimumTotal', 10,
    'minimumListI', 4,
    'minimumListIAndII', 7,
    'maximumCourses', 5,
    'disqualifyingGrades', jsonb_build_array('D', 'F')
  ) CHECK (jsonb_typeof(academic_rules) = 'object'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, term_id)
);

CREATE TABLE IF NOT EXISTS plugin_data.csf_term_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES plugin_data.csf_profiles(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES plugin_data.csf_terms(id) ON DELETE CASCADE,
  cohort_id uuid REFERENCES plugin_data.csf_cohorts(id) ON DELETE SET NULL,
  application_id uuid REFERENCES plugin_data.csf_term_applications(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'active', 'completed', 'not_completed', 'withdrawn', 'revoked')),
  status_reason text,
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(eligibility_snapshot) = 'object'),
  override_status text CHECK (override_status IN ('completed', 'not_completed')),
  override_reason text,
  overridden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  overridden_at timestamptz,
  accepted_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, profile_id, term_id),
  CHECK (
    (override_status IS NULL AND override_reason IS NULL AND overridden_by IS NULL AND overridden_at IS NULL)
    OR
    (override_status IS NOT NULL AND nullif(btrim(override_reason), '') IS NOT NULL AND overridden_by IS NOT NULL AND overridden_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS csf_term_policies_org_term_idx
  ON plugin_data.csf_term_policies (organization_id, term_id);

CREATE INDEX IF NOT EXISTS csf_term_memberships_org_term_status_idx
  ON plugin_data.csf_term_memberships (organization_id, term_id, status, profile_id);

CREATE INDEX IF NOT EXISTS csf_term_memberships_profile_history_idx
  ON plugin_data.csf_term_memberships (organization_id, profile_id, term_id);

INSERT INTO plugin_data.csf_term_policies (organization_id, term_id)
SELECT term.organization_id, term.id
FROM plugin_data.csf_terms AS term
ON CONFLICT (organization_id, term_id) DO NOTHING;

INSERT INTO plugin_data.csf_term_memberships (
  organization_id,
  profile_id,
  term_id,
  cohort_id,
  application_id,
  status,
  accepted_at
)
SELECT
  application.organization_id,
  application.profile_id,
  application.term_id,
  application.cohort_id,
  application.id,
  'accepted',
  COALESCE(application.reviewed_at, application.updated_at, now())
FROM plugin_data.csf_term_applications AS application
WHERE application.profile_id IS NOT NULL
  AND application.status = 'accepted'
ON CONFLICT (organization_id, profile_id, term_id) DO NOTHING;

ALTER TABLE plugin_data.csf_term_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.csf_term_memberships ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE plugin_data.csf_term_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE plugin_data.csf_term_memberships FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE plugin_data.csf_term_policies TO service_role;
GRANT ALL ON TABLE plugin_data.csf_term_memberships TO service_role;

COMMENT ON TABLE plugin_data.csf_term_policies IS
  'Versioned DVHS CSF academic, activity-point, drive-cap, and meeting requirements for one term.';

COMMENT ON TABLE plugin_data.csf_term_memberships IS
  'Explicit profile membership lifecycle for one CSF term, separate from application review and cohort identity.';

COMMIT;
