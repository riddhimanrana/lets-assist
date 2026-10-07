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
COMMIT;
