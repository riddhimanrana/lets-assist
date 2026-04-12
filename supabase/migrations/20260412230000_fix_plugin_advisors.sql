BEGIN;

-- 1. Missing RLS policies for plugin_data tables
ALTER TABLE plugin_data.ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AI usage logs readable by org members"
  ON plugin_data.ai_usage_log FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));
CREATE POLICY "AI usage logs insertable by org members"
  ON plugin_data.ai_usage_log FOR INSERT TO authenticated
  WITH CHECK (private.is_org_member(organization_id));

ALTER TABLE plugin_data.dv_sd_tabroom_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tabroom links readable by org members"
  ON plugin_data.dv_sd_tabroom_links FOR SELECT TO authenticated
  USING (private.is_org_member((SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = plugin_data.dv_sd_tabroom_links.tournament_id)));
CREATE POLICY "Tabroom links insertable by org admins and staff"
  ON plugin_data.dv_sd_tabroom_links FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin((SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = plugin_data.dv_sd_tabroom_links.tournament_id)));
CREATE POLICY "Tabroom links updatable by org admins and staff"
  ON plugin_data.dv_sd_tabroom_links FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin((SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = plugin_data.dv_sd_tabroom_links.tournament_id)))
  WITH CHECK (private.is_org_staff_or_admin((SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = plugin_data.dv_sd_tabroom_links.tournament_id)));
CREATE POLICY "Tabroom links deletable by org admins and staff"
  ON plugin_data.dv_sd_tabroom_links FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin((SELECT organization_id FROM plugin_data.dv_sd_tournaments WHERE id = plugin_data.dv_sd_tabroom_links.tournament_id)));

ALTER TABLE plugin_data.org_member_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org member profiles readable by org members"
  ON plugin_data.org_member_profiles FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));
CREATE POLICY "Org member profiles writable by self"
  ON plugin_data.org_member_profiles FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 2. Auth initplan performance issues
DO $$
DECLARE
  rec record;
  v_using text;
  v_check text;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE policyname IN (
        'plugin_entitlements_select_org_member',
        'plugin_installs_select_org_member',
        'payment_requests_insert',
        'payment_requests_read',
        'form_subs_insert',
        'form_subs_own_read'
    )
  LOOP
    v_using := rec.qual;
    v_check := rec.with_check;

    IF v_using IS NOT NULL THEN
      v_using := replace(v_using, 'auth.uid()', '(select auth.uid())');
      v_using := replace(v_using, '"auth"."uid"()', '(select auth.uid())');
    END IF;

    IF v_check IS NOT NULL THEN
      v_check := replace(v_check, 'auth.uid()', '(select auth.uid())');
      v_check := replace(v_check, '"auth"."uid"()', '(select auth.uid())');
    END IF;

    IF rec.qual IS DISTINCT FROM v_using OR rec.with_check IS DISTINCT FROM v_check THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I %s%s%s',
        rec.policyname,
        rec.schemaname,
        rec.tablename,
        CASE WHEN v_using IS NOT NULL THEN format('USING (%s)', v_using) ELSE '' END,
        CASE WHEN v_using IS NOT NULL AND v_check IS NOT NULL THEN ' ' ELSE '' END,
        CASE WHEN v_check IS NOT NULL THEN format('WITH CHECK (%s)', v_check) ELSE '' END
      );
    END IF;
  END LOOP;
END
$$;

-- 3. Multiple permissive policies (combining them)
DROP POLICY IF EXISTS "form_defs_member_read" ON plugin_data.org_form_definitions;
DROP POLICY IF EXISTS "form_defs_staff_write" ON plugin_data.org_form_definitions;

CREATE POLICY "form_defs_member_read"
  ON plugin_data.org_form_definitions FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

CREATE POLICY "form_defs_staff_write_insert"
  ON plugin_data.org_form_definitions FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY "form_defs_staff_write_update"
  ON plugin_data.org_form_definitions FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY "form_defs_staff_write_delete"
  ON plugin_data.org_form_definitions FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));

DROP POLICY IF EXISTS "org_seasons_admin_write" ON plugin_data.org_seasons;
DROP POLICY IF EXISTS "org_seasons_staff_read" ON plugin_data.org_seasons;

CREATE POLICY "org_seasons_read"
  ON plugin_data.org_seasons FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_seasons_write_insert"
  ON plugin_data.org_seasons FOR INSERT TO authenticated
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY "org_seasons_write_update"
  ON plugin_data.org_seasons FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));
CREATE POLICY "org_seasons_write_delete"
  ON plugin_data.org_seasons FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));


-- 4. Missing foreign key indexes
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_id ON plugin_data.ai_usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_judge_assign_created_by ON plugin_data.dv_sd_judge_assignments(created_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_judge_assign_parent_link ON plugin_data.dv_sd_judge_assignments(parent_link_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_judge_assign_sub_id ON plugin_data.dv_sd_judge_assignments(submission_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_judge_assign_tour_id ON plugin_data.dv_sd_judge_assignments(tournament_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_memberships_rev_by ON plugin_data.dv_sd_memberships(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_parent_profiles_cr_by ON plugin_data.dv_sd_parent_profiles(created_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_parent_student_cr_by ON plugin_data.dv_sd_parent_student_links(created_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_parent_student_stu_id ON plugin_data.dv_sd_parent_student_links(student_profile_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_prof_act_actor ON plugin_data.dv_sd_profile_activity_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_prof_act_link ON plugin_data.dv_sd_profile_activity_log(link_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_prof_act_sub ON plugin_data.dv_sd_profile_activity_log(submission_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_prof_link_cr_by ON plugin_data.dv_sd_profile_links(created_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_prof_link_par ON plugin_data.dv_sd_profile_links(parent_profile_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_prof_link_stu ON plugin_data.dv_sd_profile_links(student_profile_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_sheet_sync_cr_by ON plugin_data.dv_sd_sheet_sync_configs(created_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_form_cr_by ON plugin_data.dv_sd_signup_forms(created_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_form_tour_id ON plugin_data.dv_sd_signup_forms(tournament_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_signup_sub_form ON plugin_data.dv_sd_signup_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_signup_sub_par ON plugin_data.dv_sd_signup_submissions(parent_profile_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_signup_sub_stu ON plugin_data.dv_sd_signup_submissions(student_profile_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_signup_sub_sub_by ON plugin_data.dv_sd_signup_submissions(submitted_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_signup_sub_tour ON plugin_data.dv_sd_signup_submissions(tournament_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_stu_prof_cr_by ON plugin_data.dv_sd_student_profiles(created_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_sub_ans_q_id ON plugin_data.dv_sd_submission_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_tour_entry_partner ON plugin_data.dv_sd_tournament_entries(partner_user_id);
CREATE INDEX IF NOT EXISTS idx_dv_sd_tour_cr_by ON plugin_data.dv_sd_tournaments(created_by);
CREATE INDEX IF NOT EXISTS idx_dv_sd_tour_season ON plugin_data.dv_sd_tournaments(season_id);
CREATE INDEX IF NOT EXISTS idx_org_form_defs_cr_by ON plugin_data.org_form_definitions(created_by);
CREATE INDEX IF NOT EXISTS idx_org_form_defs_seas ON plugin_data.org_form_definitions(season_id);
CREATE INDEX IF NOT EXISTS idx_org_form_subs_rev_by ON plugin_data.org_form_submissions(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_plugin_ver_pub_by ON public.plugin_versions(published_by);

COMMIT;
