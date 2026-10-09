-- One service-only statement snapshot. Reviewed columns exclude credentials,
-- access links, staff notes, source sheets, and other students' records.
BEGIN;
CREATE FUNCTION public.account_data_export_snapshot(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
SET statement_timeout = '30s'
AS $$
DECLARE
  v_auth jsonb;
  v_item record;
  v_data jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_total integer := 0;
  v_count integer;
  v_bytes bigint := 0;
BEGIN
  IF p_user_id IS NULL OR NOT app_private.account_deletion_actor_is_active(p_user_id) THEN
    RAISE EXCEPTION 'account_export_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('id', u.id, 'email', u.email, 'phone', u.phone,
    'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at,
    'emailConfirmedAt', u.email_confirmed_at, 'phoneConfirmedAt', u.phone_confirmed_at,
    'identities', (SELECT coalesce(jsonb_agg(jsonb_build_object('provider', i.provider,
      'createdAt', i.created_at, 'lastSignInAt', i.last_sign_in_at) ORDER BY i.id), '[]'::jsonb)
      FROM auth.identities i WHERE i.user_id = u.id))
    INTO v_auth FROM auth.users u WHERE u.id = p_user_id AND u.deleted_at IS NULL;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'account_export_unavailable' USING ERRCODE = 'P0002'; END IF;
  FOR v_item IN
    SELECT 'profile'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.username, r.full_name, r.created_at, r.updated_at, r.phone, r.email, r.volunteer_goals, r.trusted_member, r.profile_visibility
      FROM public.profiles r WHERE r.id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'userEmails'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.email, r.is_primary, r.verified_at, r.created_at, r.updated_at
      FROM public.user_emails r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'notificationSettings'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.user_id, r.email_notifications, r.project_updates, r.general
      FROM public.notification_settings r WHERE r.user_id = p_user_id
      ORDER BY r.user_id LIMIT 10001) x
    UNION ALL
    SELECT 'notifications'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.title, r.body, r.type, r.read, r.created_at, r.displayed, r.severity
      FROM public.notifications r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'feedback'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.section, r.email, r.title, r.feedback, r.created_at
      FROM public.feedback r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'trustedMember'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.created_at, r.name, r.email, r.reason, r.status
      FROM public.trusted_member r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'projectSignups'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.project_id, r.schedule_id, r.status, r.created_at, r.check_in_time, r.check_out_time, r.volunteer_comment, r.response_data
      FROM public.project_signups r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'certificates'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.project_title, r.creator_name, r.is_certified, r.event_start, r.event_end, r.volunteer_email, r.check_in_method, r.created_at, r.organization_name, r.project_id, r.schedule_id, r.issued_at, r.signup_id, r.volunteer_name, r.project_location, r.type, r.description
      FROM public.certificates r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'contentReports'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.content_type, r.content_id, r.reason, r.description, r.status, r.created_at, r.updated_at, r.resolved_at
      FROM public.content_reports r WHERE r.reporter_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'calendarConnections'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.provider, r.calendar_email, r.connected_at, r.last_synced_at, r.is_active, r.created_at, r.updated_at, r.granted_scopes, r.connection_type
      FROM public.user_calendar_connections r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'organizationMemberships'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.role, r.joined_at, r.can_verify_hours, r.status, r.last_activity_at, r.is_visible
      FROM public.organization_members r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'organizationsCreated'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.name, r.username, r.description, r.website, r.type, r.verified, r.created_at
      FROM public.organizations r WHERE r.created_by = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'projectsCreated'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.title, r.location, r.description, r.event_type, r.verification_method, r.created_at, r.schedule, r.status, r.require_login, r.organization_id, r.cancellation_reason, r.cancelled_at, r.pause_signups, r.published, r.project_timezone, r.restrict_to_org_domains, r.visibility, r.can_be_managed_by_staff, r.workflow_status, r.enable_volunteer_comments, r.show_attendees_publicly, r.recurrence_rule, r.recurrence_parent_id, r.recurrence_sequence, r.waiver_required, r.waiver_allow_upload, r.waiver_disable_esignature, r.recurrence_occurrence_date
      FROM public.projects r WHERE r.creator_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'anonymousSignupsLinked'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.project_id, r.created_at, r.email, r.name, r.phone_number, r.confirmed_at, r.email_opt_out_at
      FROM public.anonymous_signups r WHERE r.linked_user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'waiverSignatures'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.project_id, r.signup_id, r.signer_name, r.signer_email, r.signature_type, r.signature_text, r.signed_at, r.expires_at, r.created_at, r.waiver_definition_id
      FROM public.waiver_signatures r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfProfile'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.first_name, r.middle_name, r.last_name, r.preferred_name, r.nicknames, r.school_email, r.personal_email, r.created_at, r.updated_at
      FROM plugin_data.csf_profiles r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCohortMemberships'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.cohort_id, r.status, r.created_at, r.updated_at
      FROM plugin_data.csf_profile_cohort_memberships r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfApplications'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.cohort_id, r.term_id, r.source, r.status, r.current_grade_level, r.returning_status, r.shirt_size, r.most_checked_email, r.list_i_points, r.list_i_ii_points, r.grand_total_points, r.social_confirmation, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_term_applications r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfTermMemberships'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.cohort_id, r.application_id, r.status, r.accepted_at, r.activated_at, r.completed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_term_memberships r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfTermOutcomes'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.membership_id, r.closure_revision, r.policy_version, r.derived_status, r.effective_status, r.final_status, r.final_completed_at, r.created_at
      FROM plugin_data.csf_term_membership_outcomes r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfRestrictions'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.scope, r.status, r.visible_message, r.starts_at, r.expires_at, r.resolved_at, r.created_at, r.updated_at
      FROM plugin_data.csf_profile_restrictions r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfPointSubmissions'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.opportunity_id, r.category_id, r.source, r.description, r.claimed_points, r.point_type, r.status, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_point_submissions r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCredits'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.submission_id, r.opportunity_id, r.source, r.points, r.point_type, r.status, r.verified_at, r.created_at, r.updated_at
      FROM plugin_data.csf_credit_records r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfMeetingAttendance'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.meeting_key, r.meeting_label, r.status, r.source, r.created_at, r.updated_at
      FROM plugin_data.csf_meeting_attendance r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfOpportunitySignups'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.opportunity_id, r.term_id, r.source, r.signup_status, r.attendance_status, r.signed_up_at, r.attendance_verified_at, r.points_expected, r.created_at, r.updated_at
      FROM plugin_data.csf_opportunity_signups r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfDues'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.application_id, r.status, r.required_amount, r.paid_amount, r.currency, r.submitted_at, r.verified_at, r.waived_at, r.created_at, r.updated_at
      FROM plugin_data.csf_dues_records r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfApplicationFiles'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.application_id, r.file_type, r.original_filename, r.mime_type, r.size_bytes, r.created_at
      FROM plugin_data.csf_application_files r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfSubmissionFiles'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.submission_id, r.original_filename, r.mime_type, r.size_bytes, r.created_at
      FROM plugin_data.csf_submission_files r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCorrections'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.application_id, r.check_type, r.message, r.status, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_application_correction_requests r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCourses'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.application_id, r.course_list, r.course_name, r.grade, r.points, r.is_bonus, r.created_at
      FROM plugin_data.csf_application_course_entries r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_term_applications t JOIN plugin_data.csf_profile_accounts a ON a.profile_id = t.profile_id AND a.organization_id = t.organization_id AND a.status = 'verified' AND a.user_id = p_user_id WHERE t.id = r.application_id AND t.organization_id = r.organization_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfAccountLinks'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.status, r.is_primary, r.linked_at, r.revoked_at
      FROM plugin_data.csf_profile_accounts r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvStudents'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.legal_name, r.preferred_name, r.school_email, r.personal_email, r.phone, r.graduation_year, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_students r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvMemberships'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.season_id, r.student_id, r.status, r.application_data, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_seasonal_memberships r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_students s WHERE s.user_id = p_user_id AND s.organization_id = r.organization_id AND s.id = r.student_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvRequirements'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.membership_id, r.requirement_type, r.status, r.verified_at, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_membership_requirements r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m JOIN plugin_data.dv_sd_students s ON s.id = m.student_id AND s.organization_id = m.organization_id AND s.user_id = p_user_id WHERE m.id = r.membership_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvRegistrations'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.tournament_id, r.membership_id, r.status, r.permission_status, r.payment_status, r.guardian_commitment_status, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_tournament_registrations r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m JOIN plugin_data.dv_sd_students s ON s.id = m.student_id AND s.organization_id = m.organization_id AND s.user_id = p_user_id WHERE m.id = r.membership_id AND m.organization_id = r.organization_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvEntries'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.registration_id, r.event_code, r.event_name, r.division, r.entry_role, r.created_at
      FROM plugin_data.dv_sd_registration_entries r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_tournament_registrations t JOIN plugin_data.dv_sd_seasonal_memberships m ON m.id = t.membership_id AND m.organization_id = t.organization_id JOIN plugin_data.dv_sd_students s ON s.id = m.student_id AND s.organization_id = m.organization_id AND s.user_id = p_user_id WHERE t.id = r.registration_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvMeetingAttendance'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.meeting_id, r.check_in_time, r.check_out_time, r.status
      FROM plugin_data.dv_sd_meeting_attendance r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvTeacherProfile'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.full_name, r.email, r.department, r.is_advisor, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_teachers r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvLegacySubmissions'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.form_id, r.tournament_id, r.participant_type, r.student_name, r.parent_name, r.email, r.phone, r.wants_parent_to_judge, r.judge_days, r.paid_membership, r.tabroom_points, r.submitted_at, r.updated_at
      FROM plugin_data.dv_sd_signup_submissions r WHERE r.submitted_by = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvLegacyAnswers'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.submission_id, r.question_id, r.answer_text, r.answer_json, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_submission_answers r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_signup_submissions s WHERE s.id = r.submission_id AND s.organization_id = r.organization_id AND s.submitted_by = p_user_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'projectDrafts'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.title, r.draft_data, r.created_at, r.updated_at
      FROM public.project_drafts r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'pluginDisplayPreferences'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.user_id, r.show_plugin_content, r.hidden_plugin_keys, r.created_at, r.updated_at
      FROM public.user_plugin_display_preferences r WHERE r.user_id = p_user_id
      ORDER BY r.user_id LIMIT 10001) x
    UNION ALL
    SELECT 'organizationJoinSuppressions'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.organization_id, r.created_at
      FROM public.organization_autojoin_suppressions r WHERE r.user_id = p_user_id
      ORDER BY r.organization_id LIMIT 10001) x
    UNION ALL
    SELECT 'csfStaffViewPreferences'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.organization_id, r.view_mode, r.updated_at
      FROM plugin_data.csf_staff_view_preferences r WHERE r.user_id = p_user_id
      ORDER BY r.organization_id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCalendarBindings'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.source_kind, r.source_id, r.occurrence_key, r.desired_state, r.sync_state, r.last_error_code, r.provider_confirmed_at, r.reconciled_at, r.created_at, r.updated_at
      FROM plugin_data.csf_personal_calendar_bindings r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfBroadcastPreferences'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.topic_key, r.recipient_email, r.subscription_state, r.opt_out_at, r.resubscribed_at, r.last_decision_at, r.created_at, r.updated_at
      FROM plugin_data.csf_communication_broadcast_preferences r WHERE r.user_id = p_user_id OR EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfPointAppeals'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.submission_id, r.credit_record_id, r.reason, r.requested_points, r.status, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_point_appeals r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvLegacyMemberships'::text AS key, count(*) AS count, coalesce(sum(octet_length(to_jsonb(x)::text) + 2), 0)::bigint AS bytes
    FROM (SELECT r.id, r.organization_id, r.season_id, r.status, r.role, r.display_name, r.email, r.phone, r.grade_level, r.parent_name, r.parent_email, r.parent_phone, r.events_interested, r.paid, r.payment_amount_cents, r.application_data, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_memberships r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
  LOOP
    IF v_item.count > 10000 THEN RAISE EXCEPTION 'account_export_dataset_limit' USING ERRCODE = '54000'; END IF;
    v_total := v_total + v_item.count;
    v_bytes := v_bytes + v_item.bytes + 100;
    IF v_total > 100000 OR v_bytes > 39900000 THEN
      RAISE EXCEPTION 'account_export_size_limit' USING ERRCODE = '54000';
    END IF;
  END LOOP;
  v_total := 0;
  -- The stable snapshot keeps this second read identical to the budget preflight.
  FOR v_item IN
    SELECT 'profile'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.username, r.full_name, r.created_at, r.updated_at, r.phone, r.email, r.volunteer_goals, r.trusted_member, r.profile_visibility
      FROM public.profiles r WHERE r.id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'userEmails'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.email, r.is_primary, r.verified_at, r.created_at, r.updated_at
      FROM public.user_emails r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'notificationSettings'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.user_id, r.email_notifications, r.project_updates, r.general
      FROM public.notification_settings r WHERE r.user_id = p_user_id
      ORDER BY r.user_id LIMIT 10001) x
    UNION ALL
    SELECT 'notifications'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.title, r.body, r.type, r.read, r.created_at, r.displayed, r.severity
      FROM public.notifications r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'feedback'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.section, r.email, r.title, r.feedback, r.created_at
      FROM public.feedback r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'trustedMember'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.created_at, r.name, r.email, r.reason, r.status
      FROM public.trusted_member r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'projectSignups'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.project_id, r.schedule_id, r.status, r.created_at, r.check_in_time, r.check_out_time, r.volunteer_comment, r.response_data
      FROM public.project_signups r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'certificates'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.project_title, r.creator_name, r.is_certified, r.event_start, r.event_end, r.volunteer_email, r.check_in_method, r.created_at, r.organization_name, r.project_id, r.schedule_id, r.issued_at, r.signup_id, r.volunteer_name, r.project_location, r.type, r.description
      FROM public.certificates r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'contentReports'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.content_type, r.content_id, r.reason, r.description, r.status, r.created_at, r.updated_at, r.resolved_at
      FROM public.content_reports r WHERE r.reporter_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'calendarConnections'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.provider, r.calendar_email, r.connected_at, r.last_synced_at, r.is_active, r.created_at, r.updated_at, r.granted_scopes, r.connection_type
      FROM public.user_calendar_connections r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'organizationMemberships'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.role, r.joined_at, r.can_verify_hours, r.status, r.last_activity_at, r.is_visible
      FROM public.organization_members r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'organizationsCreated'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.name, r.username, r.description, r.website, r.type, r.verified, r.created_at
      FROM public.organizations r WHERE r.created_by = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'projectsCreated'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.title, r.location, r.description, r.event_type, r.verification_method, r.created_at, r.schedule, r.status, r.require_login, r.organization_id, r.cancellation_reason, r.cancelled_at, r.pause_signups, r.published, r.project_timezone, r.restrict_to_org_domains, r.visibility, r.can_be_managed_by_staff, r.workflow_status, r.enable_volunteer_comments, r.show_attendees_publicly, r.recurrence_rule, r.recurrence_parent_id, r.recurrence_sequence, r.waiver_required, r.waiver_allow_upload, r.waiver_disable_esignature, r.recurrence_occurrence_date
      FROM public.projects r WHERE r.creator_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'anonymousSignupsLinked'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.project_id, r.created_at, r.email, r.name, r.phone_number, r.confirmed_at, r.email_opt_out_at
      FROM public.anonymous_signups r WHERE r.linked_user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'waiverSignatures'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.project_id, r.signup_id, r.signer_name, r.signer_email, r.signature_type, r.signature_text, r.signed_at, r.expires_at, r.created_at, r.waiver_definition_id
      FROM public.waiver_signatures r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfProfile'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.first_name, r.middle_name, r.last_name, r.preferred_name, r.nicknames, r.school_email, r.personal_email, r.created_at, r.updated_at
      FROM plugin_data.csf_profiles r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCohortMemberships'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.cohort_id, r.status, r.created_at, r.updated_at
      FROM plugin_data.csf_profile_cohort_memberships r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfApplications'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.cohort_id, r.term_id, r.source, r.status, r.current_grade_level, r.returning_status, r.shirt_size, r.most_checked_email, r.list_i_points, r.list_i_ii_points, r.grand_total_points, r.social_confirmation, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_term_applications r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfTermMemberships'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.cohort_id, r.application_id, r.status, r.accepted_at, r.activated_at, r.completed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_term_memberships r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfTermOutcomes'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.membership_id, r.closure_revision, r.policy_version, r.derived_status, r.effective_status, r.final_status, r.final_completed_at, r.created_at
      FROM plugin_data.csf_term_membership_outcomes r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfRestrictions'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.scope, r.status, r.visible_message, r.starts_at, r.expires_at, r.resolved_at, r.created_at, r.updated_at
      FROM plugin_data.csf_profile_restrictions r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfPointSubmissions'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.opportunity_id, r.category_id, r.source, r.description, r.claimed_points, r.point_type, r.status, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_point_submissions r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCredits'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.submission_id, r.opportunity_id, r.source, r.points, r.point_type, r.status, r.verified_at, r.created_at, r.updated_at
      FROM plugin_data.csf_credit_records r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfMeetingAttendance'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.meeting_key, r.meeting_label, r.status, r.source, r.created_at, r.updated_at
      FROM plugin_data.csf_meeting_attendance r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfOpportunitySignups'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.opportunity_id, r.term_id, r.source, r.signup_status, r.attendance_status, r.signed_up_at, r.attendance_verified_at, r.points_expected, r.created_at, r.updated_at
      FROM plugin_data.csf_opportunity_signups r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfDues'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.application_id, r.status, r.required_amount, r.paid_amount, r.currency, r.submitted_at, r.verified_at, r.waived_at, r.created_at, r.updated_at
      FROM plugin_data.csf_dues_records r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfApplicationFiles'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.application_id, r.file_type, r.original_filename, r.mime_type, r.size_bytes, r.created_at
      FROM plugin_data.csf_application_files r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfSubmissionFiles'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.submission_id, r.original_filename, r.mime_type, r.size_bytes, r.created_at
      FROM plugin_data.csf_submission_files r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCorrections'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.application_id, r.check_type, r.message, r.status, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_application_correction_requests r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCourses'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.application_id, r.course_list, r.course_name, r.grade, r.points, r.is_bonus, r.created_at
      FROM plugin_data.csf_application_course_entries r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_term_applications t JOIN plugin_data.csf_profile_accounts a ON a.profile_id = t.profile_id AND a.organization_id = t.organization_id AND a.status = 'verified' AND a.user_id = p_user_id WHERE t.id = r.application_id AND t.organization_id = r.organization_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfAccountLinks'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.status, r.is_primary, r.linked_at, r.revoked_at
      FROM plugin_data.csf_profile_accounts r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvStudents'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.legal_name, r.preferred_name, r.school_email, r.personal_email, r.phone, r.graduation_year, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_students r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvMemberships'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.season_id, r.student_id, r.status, r.application_data, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_seasonal_memberships r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_students s WHERE s.user_id = p_user_id AND s.organization_id = r.organization_id AND s.id = r.student_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvRequirements'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.membership_id, r.requirement_type, r.status, r.verified_at, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_membership_requirements r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m JOIN plugin_data.dv_sd_students s ON s.id = m.student_id AND s.organization_id = m.organization_id AND s.user_id = p_user_id WHERE m.id = r.membership_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvRegistrations'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.tournament_id, r.membership_id, r.status, r.permission_status, r.payment_status, r.guardian_commitment_status, r.submitted_at, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_tournament_registrations r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_seasonal_memberships m JOIN plugin_data.dv_sd_students s ON s.id = m.student_id AND s.organization_id = m.organization_id AND s.user_id = p_user_id WHERE m.id = r.membership_id AND m.organization_id = r.organization_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvEntries'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.registration_id, r.event_code, r.event_name, r.division, r.entry_role, r.created_at
      FROM plugin_data.dv_sd_registration_entries r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_tournament_registrations t JOIN plugin_data.dv_sd_seasonal_memberships m ON m.id = t.membership_id AND m.organization_id = t.organization_id JOIN plugin_data.dv_sd_students s ON s.id = m.student_id AND s.organization_id = m.organization_id AND s.user_id = p_user_id WHERE t.id = r.registration_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvMeetingAttendance'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.meeting_id, r.check_in_time, r.check_out_time, r.status
      FROM plugin_data.dv_sd_meeting_attendance r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvTeacherProfile'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.full_name, r.email, r.department, r.is_advisor, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_teachers r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvLegacySubmissions'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.form_id, r.tournament_id, r.participant_type, r.student_name, r.parent_name, r.email, r.phone, r.wants_parent_to_judge, r.judge_days, r.paid_membership, r.tabroom_points, r.submitted_at, r.updated_at
      FROM plugin_data.dv_sd_signup_submissions r WHERE r.submitted_by = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvLegacyAnswers'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.submission_id, r.question_id, r.answer_text, r.answer_json, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_submission_answers r WHERE EXISTS (SELECT 1 FROM plugin_data.dv_sd_signup_submissions s WHERE s.id = r.submission_id AND s.organization_id = r.organization_id AND s.submitted_by = p_user_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'projectDrafts'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.title, r.draft_data, r.created_at, r.updated_at
      FROM public.project_drafts r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'pluginDisplayPreferences'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.user_id, r.show_plugin_content, r.hidden_plugin_keys, r.created_at, r.updated_at
      FROM public.user_plugin_display_preferences r WHERE r.user_id = p_user_id
      ORDER BY r.user_id LIMIT 10001) x
    UNION ALL
    SELECT 'organizationJoinSuppressions'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.organization_id, r.created_at
      FROM public.organization_autojoin_suppressions r WHERE r.user_id = p_user_id
      ORDER BY r.organization_id LIMIT 10001) x
    UNION ALL
    SELECT 'csfStaffViewPreferences'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.organization_id, r.view_mode, r.updated_at
      FROM plugin_data.csf_staff_view_preferences r WHERE r.user_id = p_user_id
      ORDER BY r.organization_id LIMIT 10001) x
    UNION ALL
    SELECT 'csfCalendarBindings'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.source_kind, r.source_id, r.occurrence_key, r.desired_state, r.sync_state, r.last_error_code, r.provider_confirmed_at, r.reconciled_at, r.created_at, r.updated_at
      FROM plugin_data.csf_personal_calendar_bindings r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfBroadcastPreferences'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.topic_key, r.recipient_email, r.subscription_state, r.opt_out_at, r.resubscribed_at, r.last_decision_at, r.created_at, r.updated_at
      FROM plugin_data.csf_communication_broadcast_preferences r WHERE r.user_id = p_user_id OR EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'csfPointAppeals'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.profile_id, r.term_id, r.submission_id, r.credit_record_id, r.reason, r.requested_points, r.status, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.csf_point_appeals r WHERE EXISTS (SELECT 1 FROM plugin_data.csf_profile_accounts a WHERE a.user_id = p_user_id AND a.status = 'verified' AND a.organization_id = r.organization_id AND a.profile_id = r.profile_id)
      ORDER BY r.id LIMIT 10001) x
    UNION ALL
    SELECT 'dvLegacyMemberships'::text AS key, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) AS rows
    FROM (SELECT r.id, r.organization_id, r.season_id, r.status, r.role, r.display_name, r.email, r.phone, r.grade_level, r.parent_name, r.parent_email, r.parent_phone, r.events_interested, r.paid, r.payment_amount_cents, r.application_data, r.reviewed_at, r.created_at, r.updated_at
      FROM plugin_data.dv_sd_memberships r WHERE r.user_id = p_user_id
      ORDER BY r.id LIMIT 10001) x
  LOOP
    v_count := jsonb_array_length(v_item.rows);
    IF v_count > 10000 THEN RAISE EXCEPTION 'account_export_dataset_limit' USING ERRCODE = '54000'; END IF;
    v_total := v_total + v_count;
    v_data := v_data || jsonb_build_object(v_item.key, v_item.rows);
    v_counts := v_counts || jsonb_build_object(v_item.key, v_count);
    IF v_total > 100000 OR octet_length(v_data::text) > 40000000 THEN
      RAISE EXCEPTION 'account_export_size_limit' USING ERRCODE = '54000';
    END IF;
  END LOOP;
  RETURN jsonb_build_object('schemaVersion', '2026-10-07', 'generatedAt', statement_timestamp(),
    'userId', p_user_id, 'auth', v_auth, 'datasets', v_data, 'counts', v_counts,
    'totalRecords', v_total);
END;
$$;
REVOKE ALL ON FUNCTION public.account_data_export_snapshot(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_data_export_snapshot(uuid) TO service_role;
COMMENT ON FUNCTION public.account_data_export_snapshot(uuid) IS
  'Trusted export worker only. Complete bounded snapshot of explicitly declared account-owned datasets. Verified CSF links and exact DV user UUIDs only. A limit or query failure refuses the whole snapshot.';

-- Service-only export requests, leased archive receipts, and explicit delivery outcomes.
ALTER TABLE public.account_data_export_jobs
  ADD COLUMN protocol_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN artifact_sha256 text,
  ADD COLUMN artifact_ready_at timestamptz,
  ADD COLUMN artifact_expires_at timestamptz,
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'not_attempted'
    CHECK (delivery_status IN ('not_attempted', 'sending', 'accepted', 'skipped', 'failed')),
  ADD COLUMN delivery_attempted_at timestamptz,
  ADD COLUMN provider_message_id text;
ALTER TABLE public.account_data_export_jobs ALTER COLUMN protocol_version SET DEFAULT 2;
-- Old processing jobs may already have reached the provider. Operators reconcile
-- legacy jobs before adoption; the new worker never retries them automatically.
REVOKE INSERT ON public.account_data_export_jobs FROM anon, authenticated;
CREATE OR REPLACE FUNCTION app_private.client_relation_grant_catalog()
RETURNS TABLE (
  relation_name text,
  role_name text,
  privilege text,
  columns text[]
)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT *
  FROM (
    VALUES
      ('account_data_export_jobs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('certificate_verification_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('certificate_verification_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('content_reports'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_invitation_acceptance_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_invitation_acceptance_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_members'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_members'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_members'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_plugin_access'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_entitlements'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_feature_flags'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_installs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_public_member_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_public_member_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_public_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_public_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organizations'::text, 'anon'::text, 'SELECT'::text, ARRAY['allowed_email_domains', 'created_at', 'description', 'id', 'logo_url', 'name', 'show_members_publicly', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organizations'::text, 'authenticated'::text, 'INSERT'::text, ARRAY['allowed_email_domains', 'auto_join_domain', 'created_at', 'created_by', 'description', 'id', 'join_code', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'staff_join_token', 'staff_join_token_created_at', 'staff_join_token_expires_at', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'SELECT'::text, ARRAY['allowed_email_domains', 'created_at', 'description', 'id', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'UPDATE'::text, ARRAY['allowed_email_domains', 'auto_join_domain', 'created_at', 'created_by', 'description', 'id', 'join_code', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'staff_join_token', 'staff_join_token_created_at', 'staff_join_token_expires_at', 'type', 'username', 'verified', 'website']::text[]),
      ('plugin_audit_logs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugin_runtime_contracts'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugin_versions'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugins'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_discovery_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('project_discovery_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_paper_roster_entries'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_batches'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_images'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_rows'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_signups'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_signups'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('projects'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('projects_with_creator'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('projects_with_creator'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('public_profile_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('public_profile_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('system_banners'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('user_certificate_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('user_certificate_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_emails'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_emails'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'UPDATE'::text, NULL)
  ) AS catalog(relation_name, role_name, privilege, columns);
$$;

REVOKE ALL ON FUNCTION app_private.client_relation_grant_catalog()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.client_relation_grant_catalog()
  TO service_role;

CREATE TABLE app_private.account_export_artifacts (
  storage_path text PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.account_data_export_jobs(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 50000000),
  planned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  removed_at timestamptz
);
ALTER TABLE app_private.account_export_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.account_export_artifacts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON app_private.account_export_artifacts TO service_role;
CREATE INDEX account_export_artifacts_expiry_idx ON app_private.account_export_artifacts(expires_at)
  WHERE removed_at IS NULL;

CREATE FUNCTION public.request_account_data_export(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.account_data_export_jobs%ROWTYPE; v_email text; v_created boolean := false;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'export_auth_required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || p_user_id::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(p_user_id) THEN
    RAISE EXCEPTION 'export_account_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id
    AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL;
  IF nullif(v_email, '') IS NULL THEN RAISE EXCEPTION 'export_verified_email_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM public.account_data_export_jobs WHERE user_id = p_user_id
    AND (status IN ('pending', 'processing') OR requested_at > now() - interval '24 hours')
    ORDER BY requested_at DESC LIMIT 1;
  IF v_job.id IS NULL THEN
    v_created := true;
    INSERT INTO public.account_data_export_jobs(user_id, requested_by, delivery_email, request_metadata)
      VALUES (p_user_id, p_user_id, v_email, '{"requested_from":"account_security"}') RETURNING * INTO v_job;
    INSERT INTO public.account_data_export_audit_logs(job_id, user_id, event_type, status, source)
      VALUES (v_job.id, p_user_id, 'requested', 'info', 'account-security');
  END IF;
  RETURN jsonb_build_object('id', v_job.id, 'status', v_job.status, 'requested_at', v_job.requested_at,
    'delivery_email', v_job.delivery_email, 'protocol_version', v_job.protocol_version, 'existing', NOT v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.request_account_data_export(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_account_data_export(uuid) TO service_role;

CREATE FUNCTION public.claim_account_data_export_jobs(p_limit integer DEFAULT 1)
RETURNS SETOF public.account_data_export_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_candidate record; v_job public.account_data_export_jobs%ROWTYPE; v_count integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5 THEN RAISE EXCEPTION 'export_invalid_limit'; END IF;
  FOR v_candidate IN SELECT id, user_id FROM public.account_data_export_jobs
    WHERE protocol_version = 2 AND app_private.account_deletion_actor_is_active(user_id)
      AND (status IN ('pending', 'processing') OR (status = 'completed' AND delivery_status = 'not_attempted'))
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
    ORDER BY requested_at, id LIMIT 25
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || v_candidate.user_id::text, 0)) THEN CONTINUE; END IF;
    IF NOT app_private.account_deletion_actor_is_active(v_candidate.user_id) THEN CONTINUE; END IF;
    SELECT * INTO v_job FROM public.account_data_export_jobs WHERE id = v_candidate.id
      AND protocol_version = 2
      AND (status IN ('pending', 'processing') OR (status = 'completed' AND delivery_status = 'not_attempted'))
      AND (lease_expires_at IS NULL OR lease_expires_at < now()) FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_job.artifact_ready_at IS NOT NULL AND (v_job.artifact_expires_at IS NULL OR v_job.artifact_expires_at <= now()) THEN
      UPDATE public.account_data_export_jobs SET delivery_status = 'failed', lease_token = NULL, lease_expires_at = NULL,
        error_message = 'Archive expired before notification.', updated_at = now() WHERE id = v_job.id;
      INSERT INTO public.account_data_export_audit_logs(job_id,user_id,event_type,status,source)
        VALUES(v_job.id,v_job.user_id,'notification_expired','error','export-worker');
      CONTINUE;
    END IF;
    IF v_job.attempt_count >= 5 AND v_job.artifact_ready_at IS NULL THEN
      UPDATE public.account_data_export_jobs SET status = 'failed', failed_at = now(),
        error_message = 'Archive generation could not be confirmed.', lease_token = NULL, lease_expires_at = NULL
        WHERE id = v_job.id;
      CONTINUE;
    END IF;
    UPDATE public.account_data_export_jobs SET
      status = CASE WHEN artifact_ready_at IS NULL THEN 'processing' ELSE 'completed' END,
      lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes',
      started_at = coalesce(started_at, now()), last_attempt_at = now(), attempt_count = attempt_count + 1,
      updated_at = now()
      WHERE id = v_job.id RETURNING * INTO v_job;
    RETURN NEXT v_job;
    v_count := v_count + 1;
    EXIT WHEN v_count >= p_limit;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_account_data_export_jobs(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_data_export_jobs(integer) TO service_role;

CREATE FUNCTION public.advance_account_data_export(p_job_id uuid, p_lease uuid, p_step text, p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_job public.account_data_export_jobs%ROWTYPE; v_user uuid; v_path text; v_email text; v_outcome text;
BEGIN
  SELECT user_id INTO v_user FROM public.account_data_export_jobs WHERE id = p_job_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'export_job_missing' USING ERRCODE = 'P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lets-assist-account-write:' || v_user::text, 0));
  IF NOT app_private.account_deletion_actor_is_active(v_user) THEN RAISE EXCEPTION 'export_account_unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM public.account_data_export_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.protocol_version <> 2 OR v_job.lease_token IS DISTINCT FROM p_lease
    OR p_lease IS NULL OR v_job.lease_expires_at IS NULL OR v_job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'export_lease_lost' USING ERRCODE = '55P03';
  END IF;
  IF p_step = 'plan_artifact' AND v_job.status = 'processing' AND v_job.artifact_ready_at IS NULL THEN
    v_path := v_user::text || '/' || p_job_id::text || '/' || p_lease::text || '.zip';
    IF NOT (p_data ?& ARRAY['sha256','size_bytes','record_count','datasets_count','manifest'])
      OR jsonb_typeof(p_data->'sha256') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_data->'size_bytes') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_data->'record_count') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_data->'datasets_count') IS DISTINCT FROM 'number'
      OR p_data->>'sha256' !~ '^[a-f0-9]{64}$' OR p_data->>'sha256' IS NULL
      OR (p_data->>'size_bytes')::bigint NOT BETWEEN 1 AND 50000000
      OR p_data->>'size_bytes' IS NULL OR (p_data->>'record_count')::integer NOT BETWEEN 0 AND 100000
      OR (p_data->>'datasets_count')::integer NOT BETWEEN 1 AND 100
      OR (p_data->'manifest'->>'totalDatasets')::integer IS DISTINCT FROM (p_data->>'datasets_count')::integer OR jsonb_typeof(p_data->'manifest') <> 'object'
      OR octet_length((p_data->'manifest')::text) > 20000 THEN RAISE EXCEPTION 'export_invalid_artifact'; END IF;
    INSERT INTO app_private.account_export_artifacts(storage_path, job_id, sha256, size_bytes)
      VALUES (v_path, p_job_id, p_data->>'sha256', (p_data->>'size_bytes')::bigint);
    UPDATE public.account_data_export_jobs SET storage_path = v_path, artifact_sha256 = p_data->>'sha256',
      zip_size_bytes = (p_data->>'size_bytes')::bigint, record_count = (p_data->>'record_count')::integer,
      datasets_count = (p_data->>'datasets_count')::integer, export_metadata = jsonb_build_object('manifest', p_data->'manifest'),
      updated_at = now() WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_step = 'archive_ready' AND v_job.status = 'processing' AND v_job.storage_path IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app_private.account_export_artifacts a WHERE a.storage_path = v_job.storage_path
      AND a.job_id = p_job_id AND a.sha256 = v_job.artifact_sha256 AND a.size_bytes = v_job.zip_size_bytes
      AND a.removed_at IS NULL AND a.expires_at > now()) THEN RAISE EXCEPTION 'export_artifact_missing'; END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'data-exports' AND o.name = v_job.storage_path
      AND (o.metadata->>'size') ~ '^[0-9]{1,9}$' AND (o.metadata->>'size')::bigint = v_job.zip_size_bytes) THEN
      RAISE EXCEPTION 'export_storage_unconfirmed';
    END IF;
    UPDATE public.account_data_export_jobs SET status = 'completed', completed_at = now(), artifact_ready_at = now(),
      artifact_expires_at = (SELECT expires_at FROM app_private.account_export_artifacts WHERE storage_path = v_job.storage_path),
      signed_url = NULL, signed_url_expires_at = NULL, error_message = NULL, updated_at = now()
      WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_step = 'begin_delivery' AND v_job.status = 'completed' AND v_job.delivery_status = 'not_attempted' THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_user AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL;
    IF nullif(v_email, '') IS NULL OR v_job.artifact_expires_at IS NULL OR v_job.artifact_expires_at <= now() THEN RAISE EXCEPTION 'export_delivery_unavailable'; END IF;
    UPDATE public.account_data_export_jobs SET delivery_status = 'sending', delivery_attempted_at = now(),
      delivery_email = v_email, updated_at = now() WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_step = 'settle_delivery' AND v_job.delivery_status = 'sending' THEN
    v_outcome := p_data->>'outcome';
    IF v_outcome NOT IN ('accepted', 'skipped', 'failed', 'unknown') OR v_outcome IS NULL THEN RAISE EXCEPTION 'export_invalid_outcome'; END IF;
    UPDATE public.account_data_export_jobs SET delivery_status = CASE WHEN v_outcome = 'unknown' THEN 'sending' ELSE v_outcome END,
      provider_message_id = CASE WHEN v_outcome = 'accepted' THEN left(p_data->>'message_id', 200) ELSE NULL END,
      lease_expires_at = NULL, lease_token = NULL, updated_at = now()
      WHERE id = p_job_id RETURNING * INTO v_job;
  ELSIF p_step = 'failed' AND v_job.status = 'processing' THEN
    UPDATE public.account_data_export_jobs SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END,
      failed_at = CASE WHEN attempt_count >= 5 THEN now() ELSE NULL END,
      error_message = 'Archive generation could not be confirmed.', lease_expires_at = now() + interval '20 minutes',
      lease_token = NULL, updated_at = now() WHERE id = p_job_id RETURNING * INTO v_job;
  ELSE RAISE EXCEPTION 'export_transition_refused';
  END IF;
  INSERT INTO public.account_data_export_audit_logs(job_id, user_id, event_type, status, source, details)
    VALUES (p_job_id, v_user, p_step, CASE WHEN p_step = 'failed' THEN 'error' ELSE 'info' END, 'export-worker',
      jsonb_build_object('attempt', v_job.attempt_count, 'delivery_status', v_job.delivery_status));
  RETURN to_jsonb(v_job);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_account_data_export(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_account_data_export(uuid,uuid,text,jsonb) TO service_role;
CREATE FUNCTION public.expired_account_export_artifacts(p_limit integer DEFAULT 10)
RETURNS TABLE(storage_path text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.storage_path FROM app_private.account_export_artifacts a
    WHERE a.removed_at IS NULL AND a.expires_at < now()
    ORDER BY a.expires_at, a.storage_path LIMIT greatest(0, least(p_limit, 25));
$$;
REVOKE ALL ON FUNCTION public.expired_account_export_artifacts(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expired_account_export_artifacts(integer) TO service_role;

CREATE FUNCTION public.confirm_account_export_artifact_removed(p_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'data-exports' AND name = p_path) THEN RETURN false; END IF;
  UPDATE app_private.account_export_artifacts SET removed_at = now()
    WHERE storage_path = p_path AND expires_at < now() AND removed_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_account_export_artifact_removed(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_account_export_artifact_removed(text) TO service_role;
COMMIT;
