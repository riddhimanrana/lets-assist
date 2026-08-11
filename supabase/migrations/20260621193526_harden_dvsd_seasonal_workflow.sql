-- DV Speech & Debate production hardening.
-- Adds durable student/household identities, seasonal membership workflow,
-- explicit tournament registrations and judges, reviewed allocation drafts,
-- immutable service/audit ledgers, guardian action tokens, and Tabroom snapshots.

BEGIN;

ALTER TABLE plugin_data.dv_sd_tournaments
  ADD CONSTRAINT dv_sd_tournaments_project_unique UNIQUE (project_id);

ALTER TABLE plugin_data.dv_sd_tabroom_links
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE plugin_data.dv_sd_tabroom_links l
SET organization_id = t.organization_id
FROM plugin_data.dv_sd_tournaments t
WHERE l.tournament_id = t.id
  AND l.organization_id IS NULL;

ALTER TABLE plugin_data.dv_sd_tabroom_links
  ALTER COLUMN organization_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dv_sd_tabroom_link_tournament
  ON plugin_data.dv_sd_tabroom_links(tournament_id);

CREATE TABLE plugin_data.dv_sd_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  preferred_name text,
  school_email text,
  personal_email text,
  phone text,
  graduation_year integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE plugin_data.dv_sd_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'merged')),
  merged_into_id uuid REFERENCES plugin_data.dv_sd_households(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_data.dv_sd_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  normalized_email text NOT NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'merged')),
  merged_into_id uuid REFERENCES plugin_data.dv_sd_guardians(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (normalized_email = lower(btrim(email))),
  UNIQUE (organization_id, normalized_email)
);

CREATE TABLE plugin_data.dv_sd_household_students (
  household_id uuid NOT NULL REFERENCES plugin_data.dv_sd_households(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES plugin_data.dv_sd_students(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, student_id)
);

CREATE TABLE plugin_data.dv_sd_household_guardians (
  household_id uuid NOT NULL REFERENCES plugin_data.dv_sd_households(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES plugin_data.dv_sd_guardians(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'guardian',
  is_primary_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, guardian_id)
);

CREATE TABLE plugin_data.dv_sd_seasonal_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES plugin_data.org_seasons(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES plugin_data.dv_sd_students(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES plugin_data.dv_sd_households(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'needs_action', 'approved', 'rejected', 'suspended', 'expired')),
  application_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, season_id, student_id)
);

CREATE TABLE plugin_data.dv_sd_membership_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES plugin_data.dv_sd_seasonal_memberships(id) ON DELETE CASCADE,
  requirement_type text NOT NULL
    CHECK (requirement_type IN ('payment', 'receipt', 'code_of_conduct', 'permission_form', 'good_standing', 'staff_review')),
  status text NOT NULL DEFAULT 'missing'
    CHECK (status IN ('missing', 'submitted', 'verified', 'waived', 'rejected')),
  storage_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, requirement_type)
);

CREATE TABLE plugin_data.dv_sd_family_service_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES plugin_data.org_seasons(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES plugin_data.dv_sd_households(id) ON DELETE CASCADE,
  required_credits numeric(8,2) NOT NULL DEFAULT 0 CHECK (required_credits >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, season_id, household_id)
);

CREATE TABLE plugin_data.dv_sd_family_service_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES plugin_data.dv_sd_family_service_accounts(id) ON DELETE CASCADE,
  entry_type text NOT NULL
    CHECK (entry_type IN ('earned', 'waiver', 'substitution', 'penalty', 'adjustment')),
  credits numeric(8,2) NOT NULL CHECK (credits <> 0),
  source_type text NOT NULL,
  source_id uuid,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_data.dv_sd_tournament_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tournaments(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES plugin_data.dv_sd_seasonal_memberships(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'waitlisted', 'approved', 'dropped', 'cancelled')),
  permission_status text NOT NULL DEFAULT 'missing'
    CHECK (permission_status IN ('missing', 'submitted', 'verified', 'waived')),
  payment_status text NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required', 'pending', 'paid', 'waived', 'refunded')),
  guardian_commitment_status text NOT NULL DEFAULT 'not_requested'
    CHECK (guardian_commitment_status IN ('not_requested', 'requested', 'confirmed', 'declined', 'waived')),
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, membership_id)
);

CREATE TABLE plugin_data.dv_sd_registration_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tournament_registrations(id) ON DELETE CASCADE,
  event_code text NOT NULL,
  event_name text NOT NULL,
  division text,
  entry_role text NOT NULL DEFAULT 'competitor'
    CHECK (entry_role IN ('competitor', 'alternate')),
  partner_student_id uuid REFERENCES plugin_data.dv_sd_students(id) ON DELETE SET NULL,
  partner_name text,
  manual_override boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, event_code)
);

CREATE TABLE plugin_data.dv_sd_judges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES plugin_data.dv_sd_guardians(id) ON DELETE CASCADE,
  clearance_status text NOT NULL DEFAULT 'missing'
    CHECK (clearance_status IN ('missing', 'pending', 'verified', 'expired', 'rejected', 'waived')),
  training_status text NOT NULL DEFAULT 'missing'
    CHECK (training_status IN ('missing', 'pending', 'verified', 'expired', 'waived')),
  tabroom_account_status text NOT NULL DEFAULT 'unknown'
    CHECK (tabroom_account_status IN ('unknown', 'linked', 'unlinked', 'needs_action')),
  event_qualifications text[] NOT NULL DEFAULT '{}',
  event_preferences text[] NOT NULL DEFAULT '{}',
  max_rounds_per_day integer CHECK (max_rounds_per_day IS NULL OR max_rounds_per_day > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, guardian_id)
);

CREATE TABLE plugin_data.dv_sd_judge_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tournaments(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL REFERENCES plugin_data.dv_sd_judges(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown', 'available', 'limited', 'unavailable')),
  available_rounds text[] NOT NULL DEFAULT '{}',
  unavailable_rounds text[] NOT NULL DEFAULT '{}',
  notes text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, judge_id)
);

CREATE TABLE plugin_data.dv_sd_judge_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tournaments(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL REFERENCES plugin_data.dv_sd_judges(id) ON DELETE CASCADE,
  conflict_type text NOT NULL CHECK (conflict_type IN ('student', 'school', 'event', 'round', 'other')),
  conflict_value text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_data.dv_sd_allocation_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tournaments(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('rules', 'ai')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'superseded')),
  constraints_version text NOT NULL,
  proposal jsonb NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_data.dv_sd_judge_assignments_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tournaments(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL REFERENCES plugin_data.dv_sd_judges(id) ON DELETE RESTRICT,
  allocation_draft_id uuid NOT NULL REFERENCES plugin_data.dv_sd_allocation_drafts(id) ON DELETE RESTRICT,
  event_code text NOT NULL,
  round_code text NOT NULL,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'confirmed', 'completed', 'no_show', 'cancelled', 'substituted')),
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, judge_id, round_code)
);

CREATE TABLE plugin_data.dv_sd_guardian_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES plugin_data.dv_sd_guardians(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('confirm_availability', 'acknowledge', 'correct_contact')),
  token_hash text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE plugin_data.dv_sd_tabroom_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tournaments(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'stale')),
  source_tournament_id text NOT NULL,
  normalized_payload jsonb,
  diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE plugin_data.dv_sd_tabroom_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tabroom_sync_runs(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  raw_payload jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sync_run_id, content_hash)
);

CREATE TABLE plugin_data.dv_sd_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  season_id uuid REFERENCES plugin_data.org_seasons(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_data.dv_sd_communication_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  season_id uuid REFERENCES plugin_data.org_seasons(id) ON DELETE SET NULL,
  template_key text NOT NULL,
  audience jsonb NOT NULL,
  subject text NOT NULL,
  content jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'sending', 'completed', 'failed', 'cancelled')),
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  queued_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE plugin_data.dv_sd_communication_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES plugin_data.dv_sd_communication_jobs(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('student', 'guardian', 'staff')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'suppressed', 'failed')),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, recipient_email)
);

CREATE INDEX idx_dv_students_org ON plugin_data.dv_sd_students(organization_id);
CREATE INDEX idx_dv_households_org ON plugin_data.dv_sd_households(organization_id);
CREATE INDEX idx_dv_guardians_org ON plugin_data.dv_sd_guardians(organization_id);
CREATE INDEX idx_dv_memberships_org_season ON plugin_data.dv_sd_seasonal_memberships(organization_id, season_id);
CREATE INDEX idx_dv_registrations_tournament ON plugin_data.dv_sd_tournament_registrations(tournament_id);
CREATE INDEX idx_dv_judges_org ON plugin_data.dv_sd_judges(organization_id);
CREATE INDEX idx_dv_availability_tournament ON plugin_data.dv_sd_judge_availability(tournament_id);
CREATE INDEX idx_dv_assignments_tournament ON plugin_data.dv_sd_judge_assignments_v2(tournament_id);
CREATE INDEX idx_dv_service_ledger_account ON plugin_data.dv_sd_family_service_ledger(account_id);
CREATE INDEX idx_dv_guardian_tokens_lookup ON plugin_data.dv_sd_guardian_action_tokens(token_hash, expires_at) WHERE consumed_at IS NULL;
CREATE INDEX idx_dv_tabroom_runs_tournament ON plugin_data.dv_sd_tabroom_sync_runs(tournament_id, started_at DESC);
CREATE INDEX idx_dv_audit_org_created ON plugin_data.dv_sd_audit_events(organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.is_dv_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_students s
    WHERE s.id = p_student_id
      AND s.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.can_access_dv_household(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_households h
    WHERE h.id = p_household_id
      AND (
        private.is_org_staff_or_admin(h.organization_id)
        OR EXISTS (
          SELECT 1
          FROM plugin_data.dv_sd_household_students hs
          JOIN plugin_data.dv_sd_students s ON s.id = hs.student_id
          WHERE hs.household_id = h.id
            AND s.user_id = (SELECT auth.uid())
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.prevent_immutable_dv_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'DV immutable records cannot be updated or deleted';
END;
$$;

CREATE TRIGGER dv_service_ledger_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.dv_sd_family_service_ledger
  FOR EACH ROW EXECUTE FUNCTION private.prevent_immutable_dv_mutation();

CREATE TRIGGER dv_audit_events_immutable
  BEFORE UPDATE OR DELETE ON plugin_data.dv_sd_audit_events
  FOR EACH ROW EXECUTE FUNCTION private.prevent_immutable_dv_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dv_sd_students', 'dv_sd_households', 'dv_sd_guardians',
    'dv_sd_household_students', 'dv_sd_household_guardians',
    'dv_sd_seasonal_memberships', 'dv_sd_membership_requirements',
    'dv_sd_family_service_accounts', 'dv_sd_family_service_ledger',
    'dv_sd_tournament_registrations', 'dv_sd_registration_entries',
    'dv_sd_judges', 'dv_sd_judge_availability', 'dv_sd_judge_conflicts',
    'dv_sd_allocation_drafts', 'dv_sd_judge_assignments_v2',
    'dv_sd_guardian_action_tokens', 'dv_sd_tabroom_sync_runs',
    'dv_sd_tabroom_snapshots', 'dv_sd_audit_events',
    'dv_sd_communication_jobs', 'dv_sd_communication_deliveries'
  ] LOOP
    EXECUTE format('ALTER TABLE plugin_data.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE POLICY dv_students_select ON plugin_data.dv_sd_students
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_students_insert ON plugin_data.dv_sd_students
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_students_update ON plugin_data.dv_sd_students
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_org_staff_or_admin(organization_id))
  WITH CHECK (user_id = (SELECT auth.uid()) OR private.is_org_staff_or_admin(organization_id));

CREATE POLICY dv_households_select ON plugin_data.dv_sd_households
  FOR SELECT TO authenticated USING (private.can_access_dv_household(id));
CREATE POLICY dv_households_staff_update ON plugin_data.dv_sd_households
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_households_staff_delete ON plugin_data.dv_sd_households
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_households_member_insert ON plugin_data.dv_sd_households
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(organization_id));

CREATE POLICY dv_guardians_select ON plugin_data.dv_sd_guardians
  FOR SELECT TO authenticated
  USING (
    private.is_org_staff_or_admin(organization_id)
    OR EXISTS (
      SELECT 1 FROM plugin_data.dv_sd_household_guardians hg
      WHERE hg.guardian_id = id AND private.can_access_dv_household(hg.household_id)
    )
  );
CREATE POLICY dv_guardians_staff_update ON plugin_data.dv_sd_guardians
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_guardians_staff_delete ON plugin_data.dv_sd_guardians
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_guardians_member_insert ON plugin_data.dv_sd_guardians
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(organization_id));

CREATE POLICY dv_household_students_select ON plugin_data.dv_sd_household_students
  FOR SELECT TO authenticated USING (private.can_access_dv_household(household_id));
CREATE POLICY dv_household_students_staff_update ON plugin_data.dv_sd_household_students
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_households h
    WHERE h.id = household_id AND private.is_org_staff_or_admin(h.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_households h
    WHERE h.id = household_id AND private.is_org_staff_or_admin(h.organization_id)
  ));
CREATE POLICY dv_household_students_staff_delete ON plugin_data.dv_sd_household_students
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_households h
    WHERE h.id = household_id AND private.is_org_staff_or_admin(h.organization_id)
  ));
CREATE POLICY dv_household_students_self_insert ON plugin_data.dv_sd_household_students
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_dv_student(student_id)
    OR EXISTS (
      SELECT 1 FROM plugin_data.dv_sd_households h
      WHERE h.id = household_id AND private.is_org_staff_or_admin(h.organization_id)
    )
  );

CREATE POLICY dv_household_guardians_select ON plugin_data.dv_sd_household_guardians
  FOR SELECT TO authenticated USING (private.can_access_dv_household(household_id));
CREATE POLICY dv_household_guardians_staff_update ON plugin_data.dv_sd_household_guardians
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_households h
    WHERE h.id = household_id AND private.is_org_staff_or_admin(h.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_households h
    WHERE h.id = household_id AND private.is_org_staff_or_admin(h.organization_id)
  ));
CREATE POLICY dv_household_guardians_staff_delete ON plugin_data.dv_sd_household_guardians
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_households h
    WHERE h.id = household_id AND private.is_org_staff_or_admin(h.organization_id)
  ));
CREATE POLICY dv_household_guardians_member_insert ON plugin_data.dv_sd_household_guardians
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_access_dv_household(household_id)
    OR EXISTS (
      SELECT 1 FROM plugin_data.dv_sd_households h
      WHERE h.id = household_id AND private.is_org_staff_or_admin(h.organization_id)
    )
  );

CREATE POLICY dv_memberships_select ON plugin_data.dv_sd_seasonal_memberships
  FOR SELECT TO authenticated
  USING (private.is_dv_student(student_id) OR private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_memberships_insert ON plugin_data.dv_sd_seasonal_memberships
  FOR INSERT TO authenticated
  WITH CHECK (private.is_dv_student(student_id) OR private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_memberships_update ON plugin_data.dv_sd_seasonal_memberships
  FOR UPDATE TO authenticated
  USING (
    private.is_org_staff_or_admin(organization_id)
    OR (
      private.is_dv_student(student_id)
      AND status IN ('draft', 'needs_action')
    )
  )
  WITH CHECK (
    private.is_org_staff_or_admin(organization_id)
    OR (
      private.is_dv_student(student_id)
      AND status IN ('draft', 'submitted')
      AND reviewed_by IS NULL
      AND reviewed_at IS NULL
    )
  );

CREATE POLICY dv_requirements_select ON plugin_data.dv_sd_membership_requirements
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
    WHERE m.id = membership_id
      AND (private.is_dv_student(m.student_id) OR private.is_org_staff_or_admin(m.organization_id))
  ));
CREATE POLICY dv_requirements_insert ON plugin_data.dv_sd_membership_requirements
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
    WHERE m.id = membership_id AND private.is_org_staff_or_admin(m.organization_id)
  ) OR EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
    WHERE m.id = membership_id AND private.is_dv_student(m.student_id)
  ));
CREATE POLICY dv_requirements_update ON plugin_data.dv_sd_membership_requirements
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
    WHERE m.id = membership_id AND private.is_org_staff_or_admin(m.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
    WHERE m.id = membership_id AND private.is_org_staff_or_admin(m.organization_id)
  ));
CREATE POLICY dv_requirements_delete ON plugin_data.dv_sd_membership_requirements
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
    WHERE m.id = membership_id AND private.is_org_staff_or_admin(m.organization_id)
  ));

CREATE POLICY dv_service_accounts_select ON plugin_data.dv_sd_family_service_accounts
  FOR SELECT TO authenticated
  USING (private.can_access_dv_household(household_id) OR private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_service_accounts_staff_insert ON plugin_data.dv_sd_family_service_accounts
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_service_accounts_staff_update ON plugin_data.dv_sd_family_service_accounts
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY dv_service_accounts_staff_delete ON plugin_data.dv_sd_family_service_accounts
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

CREATE POLICY dv_service_ledger_select ON plugin_data.dv_sd_family_service_ledger
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_family_service_accounts a
    WHERE a.id = account_id
      AND (private.can_access_dv_household(a.household_id) OR private.is_org_staff_or_admin(a.organization_id))
  ));
CREATE POLICY dv_service_ledger_insert ON plugin_data.dv_sd_family_service_ledger
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_family_service_accounts a
    WHERE a.id = account_id AND private.is_org_staff_or_admin(a.organization_id)
  ));

CREATE POLICY dv_registrations_select ON plugin_data.dv_sd_tournament_registrations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
    WHERE m.id = membership_id
      AND (private.is_dv_student(m.student_id) OR private.is_org_staff_or_admin(organization_id))
  ));
CREATE POLICY dv_registrations_insert ON plugin_data.dv_sd_tournament_registrations
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
    WHERE m.id = membership_id
      AND (
        private.is_dv_student(m.student_id)
        OR private.is_org_staff_or_admin(plugin_data.dv_sd_tournament_registrations.organization_id)
      )
  ) AND plugin_data.dv_sd_tournament_registrations.status IN ('draft', 'submitted'));
CREATE POLICY dv_registrations_update ON plugin_data.dv_sd_tournament_registrations
  FOR UPDATE TO authenticated
  USING (
    private.is_org_staff_or_admin(organization_id)
    OR EXISTS (
      SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
      WHERE m.id = membership_id
        AND private.is_dv_student(m.student_id)
        AND plugin_data.dv_sd_tournament_registrations.status IN ('draft', 'submitted')
    )
  )
  WITH CHECK (
    private.is_org_staff_or_admin(organization_id)
    OR (
      EXISTS (
        SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m
        WHERE m.id = membership_id AND private.is_dv_student(m.student_id)
      )
      AND plugin_data.dv_sd_tournament_registrations.status IN ('draft', 'submitted', 'cancelled')
    )
  );

CREATE POLICY dv_registration_entries_select ON plugin_data.dv_sd_registration_entries
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_tournament_registrations r
    JOIN plugin_data.dv_sd_seasonal_memberships m ON m.id = r.membership_id
    WHERE r.id = registration_id
      AND (private.is_dv_student(m.student_id) OR private.is_org_staff_or_admin(r.organization_id))
  ));
CREATE POLICY dv_registration_entries_insert ON plugin_data.dv_sd_registration_entries
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_tournament_registrations r
    JOIN plugin_data.dv_sd_seasonal_memberships m ON m.id = r.membership_id
    WHERE r.id = registration_id
      AND (private.is_dv_student(m.student_id) OR private.is_org_staff_or_admin(r.organization_id))
  ));
CREATE POLICY dv_registration_entries_update ON plugin_data.dv_sd_registration_entries
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_tournament_registrations r
    JOIN plugin_data.dv_sd_seasonal_memberships m ON m.id = r.membership_id
    WHERE r.id = registration_id
      AND (private.is_dv_student(m.student_id) OR private.is_org_staff_or_admin(r.organization_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_tournament_registrations r
    JOIN plugin_data.dv_sd_seasonal_memberships m ON m.id = r.membership_id
    WHERE r.id = registration_id
      AND (private.is_dv_student(m.student_id) OR private.is_org_staff_or_admin(r.organization_id))
  ));
CREATE POLICY dv_registration_entries_delete ON plugin_data.dv_sd_registration_entries
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM plugin_data.dv_sd_tournament_registrations r
    JOIN plugin_data.dv_sd_seasonal_memberships m ON m.id = r.membership_id
    WHERE r.id = registration_id
      AND (private.is_dv_student(m.student_id) OR private.is_org_staff_or_admin(r.organization_id))
  ));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dv_sd_judges', 'dv_sd_judge_availability', 'dv_sd_judge_conflicts',
    'dv_sd_allocation_drafts', 'dv_sd_judge_assignments_v2',
    'dv_sd_guardian_action_tokens', 'dv_sd_tabroom_sync_runs',
    'dv_sd_communication_jobs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON plugin_data.%I FOR ALL TO authenticated USING (private.is_org_staff_or_admin(organization_id)) WITH CHECK (private.is_org_staff_or_admin(organization_id))',
      table_name || '_staff',
      table_name
    );
  END LOOP;
END $$;

CREATE POLICY dv_audit_events_member_insert ON plugin_data.dv_sd_audit_events
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = (SELECT auth.uid())
    AND private.is_org_member(organization_id)
  );
CREATE POLICY dv_audit_events_staff_select ON plugin_data.dv_sd_audit_events
  FOR SELECT TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

CREATE POLICY dv_tabroom_snapshots_staff ON plugin_data.dv_sd_tabroom_snapshots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_tabroom_sync_runs r
    WHERE r.id = sync_run_id AND private.is_org_staff_or_admin(r.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_tabroom_sync_runs r
    WHERE r.id = sync_run_id AND private.is_org_staff_or_admin(r.organization_id)
  ));

CREATE POLICY dv_communication_deliveries_staff ON plugin_data.dv_sd_communication_deliveries
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_communication_jobs j
    WHERE j.id = job_id AND private.is_org_staff_or_admin(j.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plugin_data.dv_sd_communication_jobs j
    WHERE j.id = job_id AND private.is_org_staff_or_admin(j.organization_id)
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plugin_data TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA plugin_data TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_dv_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_dv_household(uuid) TO authenticated;

COMMIT;
