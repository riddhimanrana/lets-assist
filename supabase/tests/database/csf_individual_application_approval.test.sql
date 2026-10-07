BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('de000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'csf-sheet-decision-officer@local.test', now(), '{}', '{}', now(), now()),
  ('de000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'csf-sheet-decision-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'de100000-0000-4000-8000-000000000001',
  'CSF Sheet Decision Review',
  'csf-sheet-decision-review',
  'school',
  '740021'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('de100000-0000-4000-8000-000000000001',
   'de000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('de100000-0000-4000-8000-000000000001',
   'de000000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, is_current)
VALUES (
  'de200000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  'F30', 'Fall 2030', '2030-2031', 'fall', true
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label, status)
VALUES (
  'de500000-0000-4000-8000-000000000001',
  'de100000-0000-4000-8000-000000000001',
  2034, 'c/o 2034', 'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('de300000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'Green', 'Applicant', 'green', 'applicant'),
  ('de300000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'Yellow', 'Applicant', 'yellow', 'applicant'),
  ('de300000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001',
   'Explained', 'Applicant', 'explained', 'applicant'),
  ('de300000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001',
   'Uncolored', 'Applicant', 'uncolored', 'applicant'),
  ('de300000-0000-4000-8000-000000000005', 'de100000-0000-4000-8000-000000000001',
   'Unbound', 'Applicant', 'unbound', 'applicant');

-- The accepted applicant owns the member account, so the member-side projection
-- can be checked before and after release.
INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'de100000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000001',
  'de000000-0000-4000-8000-000000000002',
  'verified', true
);

-- Two registered application-responses workbooks: the regular form and the
-- late-response form. Both are ordinary rows; no id is special.
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, source_type, drive_file_id, spreadsheet_id
) VALUES
  ('de400000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'Fall 2030 applications', 'google_sheets', 'application_responses',
   'de-regular-workbook', 'de-regular-workbook'),
  ('de400000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'Fall 2030 late applications', 'google_sheets', 'application_responses',
   'de-late-workbook', 'de-late-workbook');

INSERT INTO plugin_data.csf_application_decision_mappings (
  organization_id, source_id, decision_columns, reason_columns, reads_cell_note
) VALUES (
  'de100000-0000-4000-8000-000000000001',
  'de400000-0000-4000-8000-000000000001',
  ARRAY[7], ARRAY[8], true
);

-- A commit job has to name the preview it came from, so the fixture follows
-- the real preview-then-commit lineage rather than inventing a bare commit.
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_file_id
) VALUES
  ('de700000-0000-4000-8000-000000000011', 'de100000-0000-4000-8000-000000000001',
   'de400000-0000-4000-8000-000000000001', 'preview', 'completed', 'de-regular-workbook'),
  ('de700000-0000-4000-8000-000000000012', 'de100000-0000-4000-8000-000000000001',
   'de400000-0000-4000-8000-000000000002', 'preview', 'completed', 'de-late-workbook');

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, mode, status, source_file_id, preview_job_id
) VALUES
  ('de700000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'de400000-0000-4000-8000-000000000001', 'commit', 'completed', 'de-regular-workbook',
   'de700000-0000-4000-8000-000000000011'),
  ('de700000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'de400000-0000-4000-8000-000000000002', 'commit', 'completed', 'de-late-workbook',
   'de700000-0000-4000-8000-000000000012');

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  source_file_id, source_sheet_tab, source_row_number,
  google_form_response_id, source_submitted_at
) VALUES
  ('de600000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'de-regular-workbook', 'Form Responses 1', 11,
   'response-green', '2030-08-01T09:00:00Z'),
  ('de600000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000002', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'de-regular-workbook', 'Form Responses 1', 12,
   'response-yellow', '2030-08-01T09:05:00Z'),
  ('de600000-0000-4000-8000-000000000003', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000003', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'de-regular-workbook', 'Form Responses 1', 13,
   'response-explained', '2030-08-01T09:10:00Z'),
  ('de600000-0000-4000-8000-000000000004', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000004', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'google_form_sheet', 'submitted',
   'de-regular-workbook', 'Form Responses 1', 14,
   'response-uncolored', '2030-08-01T09:15:00Z'),
  -- Manually created: no workbook, no import row, no response id. A sheet row
  -- claiming it has no provenance chain to stand on.
  ('de600000-0000-4000-8000-000000000005', 'de100000-0000-4000-8000-000000000001',
   'de300000-0000-4000-8000-000000000005', 'de500000-0000-4000-8000-000000000001',
   'de200000-0000-4000-8000-000000000001', 'manual', 'submitted',
   NULL, NULL, NULL, NULL, NULL);


UPDATE plugin_data.csf_terms SET lifecycle_status = 'open', application_review_source = 'sheet'
WHERE id = 'de200000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_application_decision_stages
(organization_id, application_id, term_id, profile_id, staged_decision, block_reason, decision_digest, identity_digest)
SELECT organization_id, id, term_id, profile_id, 'on_hold', 'awaiting_review', repeat('a',64), repeat('b',64)
FROM plugin_data.csf_term_applications WHERE id = 'de600000-0000-4000-8000-000000000001';
CREATE TEMP TABLE approval_input AS SELECT updated_at FROM plugin_data.csf_term_applications
WHERE id = 'de600000-0000-4000-8000-000000000001';

SELECT extensions.ok(NOT has_function_privilege('authenticated',
'plugin_data.csf_approve_individual_term_application(uuid,uuid,uuid,uuid,uuid,timestamptz,text,uuid)', 'EXECUTE'), 'browser roles cannot approve directly');
SELECT extensions.ok(has_function_privilege('service_role',
'plugin_data.csf_approve_individual_term_application(uuid,uuid,uuid,uuid,uuid,timestamptz,text,uuid)', 'EXECUTE'), 'reviewed server boundary can approve');
SELECT extensions.ok(NOT has_table_privilege('service_role', 'plugin_data.csf_individual_application_approvals', 'INSERT'), 'server client cannot forge approval receipts');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000002',
'de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001',
'de600000-0000-4000-8000-000000000001', (SELECT updated_at FROM approval_input), 'Officer reviewed',
'de900000-0000-4000-8000-000000000001')$q$, '42501', 'Not authorized to approve CSF applications.', 'ordinary members cannot approve');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
'de300000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000001',
'de600000-0000-4000-8000-000000000001', (SELECT updated_at FROM approval_input), 'Officer reviewed',
'de900000-0000-4000-8000-000000000001')$q$, 'P0002', 'Application not found for this student and semester.', 'a different student cannot receive the approval');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
'de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001',
'de600000-0000-4000-8000-000000000001', '2000-01-01'::timestamptz, 'Officer reviewed',
'de900000-0000-4000-8000-000000000001')$q$, '55000', 'The application changed. Review it again before approving.', 'stale previews cannot approve');

-- The unique profile/term key prevents a duplicate from reaching approval.
SELECT extensions.throws_ok($q$INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status
) VALUES (
  'de600000-0000-4000-8000-000000000006',
  'de100000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000002',
  'de500000-0000-4000-8000-000000000001',
  'de200000-0000-4000-8000-000000000001', 'manual', 'submitted'
)$q$, '23505', 'duplicate key value violates unique constraint "csf_term_applications_profile_id_term_id_key"',
  'the database refuses a duplicate application before it can be approved');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_term_applications
  WHERE organization_id = 'de100000-0000-4000-8000-000000000001'
    AND profile_id = 'de300000-0000-4000-8000-000000000002'
    AND term_id = 'de200000-0000-4000-8000-000000000001'), 1,
  'duplicate refusal retains the original application');

-- Keep each outcome refusal on a pending application so its guard is reached.
INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, application_id, status, completed_at
) VALUES
  ('de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000003',
   'de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001',
   'de600000-0000-4000-8000-000000000003', 'completed', now()),
  ('de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000004',
   'de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001',
   'de600000-0000-4000-8000-000000000004', 'not_completed', now());

-- Close through the real workflow, retaining its snapshot and revision pointers.
INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'de200000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000001',
  'S30', 'Spring 2030', '2029-2030', 'spring', false
);
INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required, total_points_required, required_meetings
) VALUES (
  'de100000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000002',
  1, false, 5, 1
);
INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status
) VALUES (
  'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000005',
  'de200000-0000-4000-8000-000000000002', 'de500000-0000-4000-8000-000000000001', 'accepted'
);
INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status, decision_status
) VALUES (
  'de600000-0000-4000-8000-000000000007',
  'de100000-0000-4000-8000-000000000001', 'de300000-0000-4000-8000-000000000005',
  'de500000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000002',
  'manual', 'rejected', 'rejected'
);
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_close_term_v2(
  'de100000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000002', 1,
  plugin_data.csf_term_closure_readiness(
    'de100000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000002'
  )->>'evidenceHash', 'de000000-0000-4000-8000-000000000001'
)$q$, 'the closed-semester fixture uses the canonical close operation');
SELECT extensions.ok((SELECT lifecycle_status = 'closed' AND active_closure_id IS NOT NULL
  AND active_closure_id = latest_closure_id AND closure_revision = 1
  FROM plugin_data.csf_terms WHERE id = 'de200000-0000-4000-8000-000000000002'),
  'the closed-semester fixture has its real closure snapshot');

CREATE TEMP TABLE approval_denial_before AS
SELECT
  (SELECT jsonb_agg(to_jsonb(application) ORDER BY id)
   FROM plugin_data.csf_term_applications AS application
   WHERE organization_id = 'de100000-0000-4000-8000-000000000001') AS applications,
  (SELECT jsonb_agg(to_jsonb(membership) ORDER BY id)
   FROM plugin_data.csf_term_memberships AS membership
   WHERE organization_id = 'de100000-0000-4000-8000-000000000001') AS memberships,
  (SELECT count(*) FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'de100000-0000-4000-8000-000000000001') AS audit_count;

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
  'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000005', 'de200000-0000-4000-8000-000000000002',
  'de600000-0000-4000-8000-000000000007',
  (SELECT updated_at FROM plugin_data.csf_term_applications WHERE id = 'de600000-0000-4000-8000-000000000007'),
  'Officer reviewed', 'de900000-0000-4000-8000-000000000002'
)$q$, '55000', 'Only an open semester can receive an application approval.',
  'a closed semester refuses approval before the existing decision check');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
  'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000003', 'de200000-0000-4000-8000-000000000001',
  'de600000-0000-4000-8000-000000000003',
  (SELECT updated_at FROM plugin_data.csf_term_applications WHERE id = 'de600000-0000-4000-8000-000000000003'),
  'Officer reviewed', 'de900000-0000-4000-8000-000000000004'
)$q$, '55000', 'A finalized semester keeps its published outcome.',
  'completed membership refuses a pending application approval');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
  'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
  'de300000-0000-4000-8000-000000000004', 'de200000-0000-4000-8000-000000000001',
  'de600000-0000-4000-8000-000000000004',
  (SELECT updated_at FROM plugin_data.csf_term_applications WHERE id = 'de600000-0000-4000-8000-000000000004'),
  'Officer reviewed', 'de900000-0000-4000-8000-000000000005'
)$q$, '55000', 'A finalized semester keeps its published outcome.',
  'not-completed membership refuses a pending application approval');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(application) ORDER BY id)
  FROM plugin_data.csf_term_applications AS application
  WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  (SELECT applications FROM approval_denial_before), 'refusals preserve every application');
SELECT extensions.is((SELECT jsonb_agg(to_jsonb(membership) ORDER BY id)
  FROM plugin_data.csf_term_memberships AS membership
  WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  (SELECT memberships FROM approval_denial_before), 'refusals preserve every membership outcome');
SELECT extensions.is((SELECT count(*) FROM plugin_data.csf_admin_audit_events
  WHERE organization_id = 'de100000-0000-4000-8000-000000000001'),
  (SELECT audit_count FROM approval_denial_before), 'refusals do not append success audit events');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_individual_application_approvals
  WHERE organization_id = 'de100000-0000-4000-8000-000000000001'), 0,
  'refusals do not create approval receipts');

SELECT extensions.lives_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
'de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001',
'de600000-0000-4000-8000-000000000001', (SELECT updated_at FROM approval_input), 'Identity and application evidence reviewed by officer',
'de900000-0000-4000-8000-000000000001')$q$, 'an officer approves only the reviewed application in a Sheet semester');
SELECT extensions.is((SELECT decision_status::text FROM plugin_data.csf_term_applications WHERE id = 'de600000-0000-4000-8000-000000000001'), 'approved', 'application is approved');
SELECT extensions.is((SELECT status FROM plugin_data.csf_term_memberships WHERE application_id = 'de600000-0000-4000-8000-000000000001'), 'accepted', 'approval creates accepted membership without completing service');
SELECT extensions.is((SELECT application_review_source FROM plugin_data.csf_terms WHERE id = 'de200000-0000-4000-8000-000000000001'), 'sheet', 'semester review source is unchanged');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_term_applications WHERE decision_status = 'approved' AND organization_id = 'de100000-0000-4000-8000-000000000001'), 1, 'other applications remain untouched');
SELECT extensions.is((SELECT block_reason FROM plugin_data.csf_application_decision_stages WHERE application_id = 'de600000-0000-4000-8000-000000000001'), 'officer_approved', 'Sheet release cannot replace an individual officer approval');
UPDATE plugin_data.csf_application_decision_stages SET staged_decision = 'rejected', block_reason = NULL
WHERE application_id = 'de600000-0000-4000-8000-000000000001';
SELECT extensions.ok((SELECT blocks_release AND block_reason = 'officer_approved' FROM plugin_data.csf_application_decision_stages WHERE application_id = 'de600000-0000-4000-8000-000000000001'), 'later Sheet sync cannot clear the officer protection');
SELECT extensions.is((SELECT plugin_data.csf_approve_individual_term_application(
'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
'de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001',
'de600000-0000-4000-8000-000000000001', (SELECT updated_at FROM approval_input), 'Identity and application evidence reviewed by officer',
'de900000-0000-4000-8000-000000000001')->>'replay'), 'true', 'same request replays without another decision');
SELECT extensions.is((SELECT count(*)::int FROM plugin_data.csf_admin_audit_events WHERE action = 'application.individual_officer_approval' AND target_id = 'de600000-0000-4000-8000-000000000001'), 1, 'one immutable officer audit event is recorded');
SELECT extensions.throws_ok($q$UPDATE plugin_data.csf_individual_application_approvals SET result = '{}' $q$, '55000', 'CSF application decision evidence is immutable.', 'approval receipt cannot be rewritten');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
'de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001',
'de600000-0000-4000-8000-000000000001', (SELECT updated_at FROM approval_input), 'Changed reason',
'de900000-0000-4000-8000-000000000001')$q$, '22023', 'This request was used for another approval.', 'request reuse with changed intent fails');
UPDATE public.organization_members SET status = 'inactive' WHERE user_id = 'de000000-0000-4000-8000-000000000001' AND organization_id = 'de100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_approve_individual_term_application(
'de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001',
'de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001',
'de600000-0000-4000-8000-000000000001', (SELECT updated_at FROM approval_input), 'Identity and application evidence reviewed by officer',
'de900000-0000-4000-8000-000000000001')$q$, '42501', 'Not authorized to approve CSF applications.', 'revoked staff cannot replay a prior approval');
SELECT * FROM extensions.finish();
ROLLBACK;
