-- Migration: Optimize plugin_data security and performance
-- Adds missing indexes on organization_id and hardens RLS policies.

BEGIN;

-- ============================================================================
-- 1. PERFORMANCE: Add missing indexes on organization_id
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_dv_sd_tournaments_org ON plugin_data.dv_sd_tournaments(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_signup_forms_org ON plugin_data.dv_sd_signup_forms(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_signup_questions_org ON plugin_data.dv_sd_signup_questions(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_signup_submissions_org ON plugin_data.dv_sd_signup_submissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_submission_answers_org ON plugin_data.dv_sd_submission_answers(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_parent_student_links_org ON plugin_data.dv_sd_parent_student_links(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_judge_assignments_org ON plugin_data.dv_sd_judge_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_student_profiles_org ON plugin_data.dv_sd_student_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_parent_profiles_org ON plugin_data.dv_sd_parent_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_profile_links_org ON plugin_data.dv_sd_profile_links(organization_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_profile_activity_log_org ON plugin_data.dv_sd_profile_activity_log(organization_id);


-- ============================================================================
-- 2. SECURITY & PERFORMANCE: Harden RLS Policies
-- ============================================================================
--   - Use (select auth.uid()) for initplan optimization.
--   - Ensure no overlapping FOR ALL policies.

-- ---------- dv_sd_memberships ----------
DROP POLICY IF EXISTS "dv_sd_memberships_read" ON plugin_data.dv_sd_memberships;
CREATE POLICY "dv_sd_memberships_read" ON plugin_data.dv_sd_memberships
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR private.is_org_staff_or_admin(organization_id)
  );

DROP POLICY IF EXISTS "dv_sd_memberships_insert" ON plugin_data.dv_sd_memberships;
CREATE POLICY "dv_sd_memberships_insert" ON plugin_data.dv_sd_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR private.is_org_staff_or_admin(organization_id)
  );

-- ---------- dv_sd_tournament_entries ----------
DROP POLICY IF EXISTS "dv_sd_entries_read" ON plugin_data.dv_sd_tournament_entries;
CREATE POLICY "dv_sd_entries_read" ON plugin_data.dv_sd_tournament_entries
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR private.is_org_staff_or_admin(
      (SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = tournament_id)
    )
  );

DROP POLICY IF EXISTS "dv_sd_entries_insert" ON plugin_data.dv_sd_tournament_entries;
CREATE POLICY "dv_sd_entries_insert" ON plugin_data.dv_sd_tournament_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---------- org_member_profiles ----------
DROP POLICY IF EXISTS "Org member profiles writable by self" ON plugin_data.org_member_profiles;

CREATE POLICY "Org member profiles insert by self"
  ON plugin_data.org_member_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Org member profiles update by self"
  ON plugin_data.org_member_profiles FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Org member profiles delete by self"
  ON plugin_data.org_member_profiles FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

COMMIT;
