-- Make plugin_data RLS policy roles explicit.
--
-- Earlier migrations removed direct anon grants from plugin_data. This pass
-- closes the remaining policy-level ambiguity by retargeting plugin_data
-- policies from PUBLIC to authenticated while preserving their existing
-- USING/WITH CHECK expressions.

BEGIN;

ALTER POLICY billing_events_staff
  ON plugin_data.billing_events
  TO authenticated;

ALTER POLICY dv_sd_judge_assignments_read
  ON plugin_data.dv_sd_judge_assignments
  TO authenticated;

ALTER POLICY dv_sd_attendance_read
  ON plugin_data.dv_sd_meeting_attendance
  TO authenticated;

ALTER POLICY dv_sd_meetings_read
  ON plugin_data.dv_sd_meetings
  TO authenticated;

ALTER POLICY dv_sd_memberships_read
  ON plugin_data.dv_sd_memberships
  TO authenticated;

ALTER POLICY dv_sd_parent_profiles_read
  ON plugin_data.dv_sd_parent_profiles
  TO authenticated;

ALTER POLICY dv_sd_parent_student_links_read
  ON plugin_data.dv_sd_parent_student_links
  TO authenticated;

ALTER POLICY dv_sd_activity_log_read
  ON plugin_data.dv_sd_profile_activity_log
  TO authenticated;

ALTER POLICY dv_sd_profile_links_read
  ON plugin_data.dv_sd_profile_links
  TO authenticated;

ALTER POLICY sheet_sync_staff
  ON plugin_data.dv_sd_sheet_sync_configs
  TO authenticated;

ALTER POLICY dv_sd_signup_forms_read
  ON plugin_data.dv_sd_signup_forms
  TO authenticated;

ALTER POLICY dv_sd_signup_questions_read
  ON plugin_data.dv_sd_signup_questions
  TO authenticated;

ALTER POLICY dv_sd_signup_submissions_read
  ON plugin_data.dv_sd_signup_submissions
  TO authenticated;

ALTER POLICY dv_sd_student_profiles_read
  ON plugin_data.dv_sd_student_profiles
  TO authenticated;

ALTER POLICY dv_sd_submission_answers_read
  ON plugin_data.dv_sd_submission_answers
  TO authenticated;

ALTER POLICY dv_sd_teachers_read
  ON plugin_data.dv_sd_teachers
  TO authenticated;

ALTER POLICY dv_sd_tournaments_read
  ON plugin_data.dv_sd_tournaments
  TO authenticated;

ALTER POLICY billing_accounts_admin
  ON plugin_data.org_billing_accounts
  TO authenticated;

ALTER POLICY form_subs_insert
  ON plugin_data.org_form_submissions
  TO authenticated;

ALTER POLICY form_subs_own_read
  ON plugin_data.org_form_submissions
  TO authenticated;

ALTER POLICY form_subs_staff_update
  ON plugin_data.org_form_submissions
  TO authenticated;

ALTER POLICY payment_requests_insert
  ON plugin_data.payment_requests
  TO authenticated;

ALTER POLICY payment_requests_read
  ON plugin_data.payment_requests
  TO authenticated;

COMMIT;
