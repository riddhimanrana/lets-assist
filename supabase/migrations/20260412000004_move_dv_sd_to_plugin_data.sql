-- Migration: Move ALL existing DV SD tables from public → plugin_data schema.
-- Safe because no production data exists — local dev only.
-- Also rebuilds dv_sd_memberships with the full schema needed by membership-flow.ts.

-- ============================================================
-- 1. Move ALL DV SD tables to plugin_data schema
-- ============================================================
-- Order matters: move child tables before parents would break FKs,
-- so we move them all in one go (Postgres handles FK references
-- within the same transaction).

DO $$
DECLARE
  _tbl text;
  _tables text[] := ARRAY[
    'dv_sd_submission_answers',
    'dv_sd_signup_questions',
    'dv_sd_signup_submissions',
    'dv_sd_signup_forms',
    'dv_sd_judge_assignments',
    'dv_sd_parent_student_links',
    'dv_sd_profile_activity_log',
    'dv_sd_profile_links',
    'dv_sd_student_profiles',
    'dv_sd_parent_profiles',
    'dv_sd_memberships',
    'dv_sd_tournaments'
  ];
BEGIN
  FOREACH _tbl IN ARRAY _tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = _tbl) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA plugin_data', _tbl);
      RAISE NOTICE 'Moved public.% → plugin_data.%', _tbl, _tbl;
    ELSE
      RAISE NOTICE 'Skipped % (not found in public)', _tbl;
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- 2. Rebuild dv_sd_memberships with full schema
-- ============================================================
-- The existing table has a simpler schema. Drop and recreate with
-- the columns that membership-flow.ts expects.

DROP TABLE IF EXISTS plugin_data.dv_sd_memberships CASCADE;

CREATE TABLE plugin_data.dv_sd_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  season_id uuid REFERENCES plugin_data.org_seasons(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'expired', 'suspended', 'rejected')),
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'officer', 'captain', 'president')),

  -- Member info
  display_name text NOT NULL,
  email text,
  phone text,
  grade_level text,

  -- Parent/guardian info
  parent_name text,
  parent_email text,
  parent_phone text,

  -- Club-specific
  events_interested text[] NOT NULL DEFAULT '{}',

  -- Payment tracking
  paid boolean NOT NULL DEFAULT false,
  payment_request_id uuid,  -- FK to plugin_data.payment_requests (once created)
  payment_amount_cents integer,

  -- Application data (stores all original form fields)
  application_data jsonb NOT NULL DEFAULT '{}',

  -- Review workflow
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One membership per user per season per org
  UNIQUE (organization_id, user_id, season_id)
);

CREATE INDEX idx_dv_sd_memberships_org ON plugin_data.dv_sd_memberships(organization_id);
CREATE INDEX idx_dv_sd_memberships_user ON plugin_data.dv_sd_memberships(user_id);
CREATE INDEX idx_dv_sd_memberships_season ON plugin_data.dv_sd_memberships(season_id);
CREATE INDEX idx_dv_sd_memberships_status ON plugin_data.dv_sd_memberships(organization_id, status);

COMMENT ON TABLE plugin_data.dv_sd_memberships IS 'Season-scoped club memberships with payment tracking and review workflow.';


-- ============================================================
-- 3. Create dv_sd_tournament_entries (referenced by code but never existed)
-- ============================================================

CREATE TABLE IF NOT EXISTS plugin_data.dv_sd_tournament_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES plugin_data.dv_sd_tournaments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_name text NOT NULL,
  entry_code text,
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'confirmed', 'dropped', 'waitlisted')),
  payment_request_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, user_id, event_name)
);

CREATE INDEX idx_dv_sd_entries_tournament ON plugin_data.dv_sd_tournament_entries(tournament_id);
CREATE INDEX idx_dv_sd_entries_user ON plugin_data.dv_sd_tournament_entries(user_id);
CREATE INDEX idx_dv_sd_entries_status ON plugin_data.dv_sd_tournament_entries(tournament_id, status);

COMMENT ON TABLE plugin_data.dv_sd_tournament_entries IS 'Per-user tournament event registrations with status tracking.';


-- ============================================================
-- 4. Add missing columns to dv_sd_tournaments
-- ============================================================
-- The tournament-manager.ts expects these additional columns:

DO $$
BEGIN
  -- season_id reference
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'season_id') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN season_id uuid REFERENCES plugin_data.org_seasons(id) ON DELETE SET NULL;
  END IF;

  -- description
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'description') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN description text;
  END IF;

  -- location
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'location') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN location text;
  END IF;

  -- format
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'format') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN format text NOT NULL DEFAULT 'individual'
      CHECK (format IN ('individual', 'team', 'mixed'));
  END IF;

  -- status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'status') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN status text NOT NULL DEFAULT 'upcoming'
      CHECK (status IN ('upcoming', 'registration_open', 'in_progress', 'completed', 'cancelled'));
  END IF;

  -- starts_at / ends_at as timestamptz (the original has starts_on / ends_on as date)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'starts_at') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN starts_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'ends_at') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN ends_at timestamptz;
  END IF;

  -- registration_deadline
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'registration_deadline') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN registration_deadline timestamptz;
  END IF;

  -- max_entries
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'max_entries') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN max_entries integer;
  END IF;

  -- entry_fee_cents
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'entry_fee_cents') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN entry_fee_cents integer NOT NULL DEFAULT 0;
  END IF;

  -- override_required_judges (the original has judges_required_override)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'override_required_judges') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN override_required_judges integer;
  END IF;

  -- notes
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'plugin_data' AND table_name = 'dv_sd_tournaments' AND column_name = 'notes') THEN
    ALTER TABLE plugin_data.dv_sd_tournaments ADD COLUMN notes text;
  END IF;
END $$;


-- ============================================================
-- 5. Drop ALL old RLS policies on moved tables + re-create
-- ============================================================

DO $$
DECLARE
  _pol record;
BEGIN
  FOR _pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'plugin_data'
      AND tablename LIKE 'dv_sd_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON plugin_data.%I', _pol.policyname, _pol.tablename);
  END LOOP;
END $$;


-- ============================================================
-- 6. Enable RLS on all moved tables
-- ============================================================

ALTER TABLE plugin_data.dv_sd_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_signup_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_signup_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_signup_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_submission_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_parent_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_judge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_parent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_profile_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_profile_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_data.dv_sd_tournament_entries ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 7. RLS Policies — using private.* helpers
-- ============================================================

-- All tables follow the same pattern:
--   SELECT: org members can read
--   INSERT/UPDATE/DELETE: org staff/admin only
-- Special cases: memberships (user can read own), entries (user can register)

-- Helper macro: most tables are org-scoped with read=member, write=staff
-- We'll create policies for each table individually.

-- ── dv_sd_tournaments ──
CREATE POLICY "dv_sd_tournaments_read" ON plugin_data.dv_sd_tournaments
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_tournaments_insert" ON plugin_data.dv_sd_tournaments
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_tournaments_update" ON plugin_data.dv_sd_tournaments
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_tournaments_delete" ON plugin_data.dv_sd_tournaments
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_signup_forms ──
CREATE POLICY "dv_sd_signup_forms_read" ON plugin_data.dv_sd_signup_forms
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_signup_forms_insert" ON plugin_data.dv_sd_signup_forms
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_signup_forms_update" ON plugin_data.dv_sd_signup_forms
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_signup_forms_delete" ON plugin_data.dv_sd_signup_forms
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_signup_questions ──
CREATE POLICY "dv_sd_signup_questions_read" ON plugin_data.dv_sd_signup_questions
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_signup_questions_insert" ON plugin_data.dv_sd_signup_questions
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_signup_questions_update" ON plugin_data.dv_sd_signup_questions
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_signup_questions_delete" ON plugin_data.dv_sd_signup_questions
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_signup_submissions ──
CREATE POLICY "dv_sd_signup_submissions_read" ON plugin_data.dv_sd_signup_submissions
  FOR SELECT USING (
    (SELECT auth.uid()) = submitted_by
    OR private.is_org_staff_or_admin(organization_id)
  );

CREATE POLICY "dv_sd_signup_submissions_insert" ON plugin_data.dv_sd_signup_submissions
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_signup_submissions_update" ON plugin_data.dv_sd_signup_submissions
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_signup_submissions_delete" ON plugin_data.dv_sd_signup_submissions
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_submission_answers ──
CREATE POLICY "dv_sd_submission_answers_read" ON plugin_data.dv_sd_submission_answers
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_submission_answers_insert" ON plugin_data.dv_sd_submission_answers
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_submission_answers_update" ON plugin_data.dv_sd_submission_answers
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_submission_answers_delete" ON plugin_data.dv_sd_submission_answers
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_parent_student_links ──
CREATE POLICY "dv_sd_parent_student_links_read" ON plugin_data.dv_sd_parent_student_links
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_parent_student_links_insert" ON plugin_data.dv_sd_parent_student_links
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_parent_student_links_update" ON plugin_data.dv_sd_parent_student_links
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_parent_student_links_delete" ON plugin_data.dv_sd_parent_student_links
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_memberships ──
CREATE POLICY "dv_sd_memberships_read" ON plugin_data.dv_sd_memberships
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR private.is_org_staff_or_admin(organization_id)
  );

CREATE POLICY "dv_sd_memberships_insert" ON plugin_data.dv_sd_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR private.is_org_staff_or_admin(organization_id)
  );

CREATE POLICY "dv_sd_memberships_update" ON plugin_data.dv_sd_memberships
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_memberships_delete" ON plugin_data.dv_sd_memberships
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_judge_assignments ──
CREATE POLICY "dv_sd_judge_assignments_read" ON plugin_data.dv_sd_judge_assignments
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_judge_assignments_insert" ON plugin_data.dv_sd_judge_assignments
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_judge_assignments_update" ON plugin_data.dv_sd_judge_assignments
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_judge_assignments_delete" ON plugin_data.dv_sd_judge_assignments
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_student_profiles ──
CREATE POLICY "dv_sd_student_profiles_read" ON plugin_data.dv_sd_student_profiles
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_student_profiles_insert" ON plugin_data.dv_sd_student_profiles
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_student_profiles_update" ON plugin_data.dv_sd_student_profiles
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_student_profiles_delete" ON plugin_data.dv_sd_student_profiles
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_parent_profiles ──
CREATE POLICY "dv_sd_parent_profiles_read" ON plugin_data.dv_sd_parent_profiles
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_parent_profiles_insert" ON plugin_data.dv_sd_parent_profiles
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_parent_profiles_update" ON plugin_data.dv_sd_parent_profiles
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_parent_profiles_delete" ON plugin_data.dv_sd_parent_profiles
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_profile_links ──
CREATE POLICY "dv_sd_profile_links_read" ON plugin_data.dv_sd_profile_links
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_profile_links_insert" ON plugin_data.dv_sd_profile_links
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_profile_links_update" ON plugin_data.dv_sd_profile_links
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_profile_links_delete" ON plugin_data.dv_sd_profile_links
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_profile_activity_log ──
CREATE POLICY "dv_sd_activity_log_read" ON plugin_data.dv_sd_profile_activity_log
  FOR SELECT USING (private.is_org_member(organization_id));

CREATE POLICY "dv_sd_activity_log_insert" ON plugin_data.dv_sd_profile_activity_log
  FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_activity_log_update" ON plugin_data.dv_sd_profile_activity_log
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_activity_log_delete" ON plugin_data.dv_sd_profile_activity_log
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

-- ── dv_sd_tournament_entries ──
CREATE POLICY "dv_sd_entries_read" ON plugin_data.dv_sd_tournament_entries
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR private.is_org_staff_or_admin(
      (SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = tournament_id)
    )
  );

CREATE POLICY "dv_sd_entries_insert" ON plugin_data.dv_sd_tournament_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "dv_sd_entries_update" ON plugin_data.dv_sd_tournament_entries
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(
    (SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = tournament_id)
  ))
  WITH CHECK (private.is_org_staff_or_admin(
    (SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = tournament_id)
  ));

CREATE POLICY "dv_sd_entries_delete" ON plugin_data.dv_sd_tournament_entries
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(
    (SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = tournament_id)
  ));
