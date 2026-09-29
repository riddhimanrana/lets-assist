BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('f8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'resubmit-owner@local.test', now(), '{}', '{}', now(), now()),
  ('f8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'resubmit-other@local.test', now(), '{}', '{}', now(), now()),
  ('f8000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'resubmit-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES ('f8100000-0000-4000-8000-000000000001', 'CSF Resubmission', 'csf-resubmission', 'school', '998101');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('f8100000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000003', 'staff', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current, lifecycle_status
) VALUES
  ('f8200000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'F31', 'Fall 2031', '2031-2032', 'fall', true, 'open'),
  ('f8200000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'S31', 'Spring 2031', '2030-2031', 'spring', false, 'open');

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity, outside_volunteering_allowed
) VALUES
  ('f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 3, false),
  ('f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 3, false);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES (
  'f8300000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000001',
  'Resubmit', 'Member', 'resubmit', 'member'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'f8100000-0000-4000-8000-000000000001',
  'f8300000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000001',
  'verified', true
);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, status
) VALUES
  ('f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'active'),
  ('f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'active');

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, point_value, point_type,
  requires_point_submission, evidence_policy, status
) VALUES
  ('f8400000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Claimable activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Roster activity', 'Fixture', 3, 'non_drive', false, 'optional', 'published'),
  ('f8400000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Draft activity', 'Fixture', 3, 'non_drive', true, 'optional', 'draft'),
  ('f8400000-0000-4000-8000-000000000004', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'Past activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000005', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Submitted activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000006', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Policy activity', 'Fixture', 5, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000007', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Type activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000008', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Missing proof activity', 'Fixture', 3, 'non_drive', true, 'required', 'published'),
  ('f8400000-0000-4000-8000-000000000009', 'f8100000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'Pending proof activity', 'Fixture', 3, 'non_drive', true, 'required', 'published');

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, opportunity_id, source, description,
  claimed_points, point_type, activity_date, status, submitted_by,
  reviewed_by, reviewed_at, review_notes
) VALUES
  ('f8500000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000001', 'student', 'Original description', 2.5, 'non_drive', '2031-09-01', 'needs_action', 'f8000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000003', now(), 'Clarify the activity and points.'),
  ('f8500000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000005', 'student', 'Submitted fixture', 2, 'non_drive', '2031-09-02', 'submitted', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'f8400000-0000-4000-8000-000000000004', 'student', 'Prior term fixture', 2, 'non_drive', '2031-03-02', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000004', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000002', 'student', 'Roster fixture', 2, 'non_drive', '2031-09-03', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000005', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000003', 'student', 'Draft fixture', 2, 'non_drive', '2031-09-04', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000006', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000006', 'student', 'Policy fixture', 2, 'non_drive', '2031-09-05', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000007', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000007', 'student', 'Type fixture', 2, 'non_drive', '2031-09-06', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000008', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000008', 'student', 'Missing proof fixture', 2, 'non_drive', '2031-09-07', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL),
  ('f8500000-0000-4000-8000-000000000009', 'f8100000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'f8400000-0000-4000-8000-000000000009', 'student', 'Pending proof fixture', 2, 'non_drive', '2031-09-08', 'needs_action', 'f8000000-0000-4000-8000-000000000001', NULL, NULL, NULL);

INSERT INTO plugin_data.csf_submission_files (
  id, organization_id, submission_id, profile_id, term_id, bucket, object_path,
  original_filename, mime_type, size_bytes, uploaded_by, upload_status,
  upload_token, finalized_at
) VALUES
  ('f8600000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'plugins', 'resubmit/valid.pdf', 'valid.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000003', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'plugins', 'resubmit/prior.pdf', 'prior.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000006', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'plugins', 'resubmit/policy.pdf', 'policy.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000004', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000007', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'plugins', 'resubmit/type.pdf', 'type.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000005', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000009', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'plugins', 'resubmit/pending.pdf', 'pending.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'pending', 'f8700000-0000-4000-8000-000000000001', NULL);

INSERT INTO plugin_data.csf_submission_reviews (
  organization_id, submission_id, actor_user_id, action, previous_status,
  next_status, notes, details
) VALUES (
  'f8100000-0000-4000-8000-000000000001',
  'f8500000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000003',
  'needs_action', 'submitted', 'needs_action',
  'Clarify the activity and points.',
  '{"correlationId":"f8800000-0000-4000-8000-000000000001"}'::jsonb
);

INSERT INTO plugin_data.csf_admin_audit_events (
  organization_id, actor_user_id, actor_profile_id, action, target_type,
  target_id, term_id, before_data, after_data, correlation_id,
  source_type, source_id, reason_code
) VALUES (
  'f8100000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000003',
  'f8300000-0000-4000-8000-000000000001',
  'point_submission.review', 'csf_point_submissions',
  'f8500000-0000-4000-8000-000000000001',
  'f8200000-0000-4000-8000-000000000001',
  '{"status":"submitted"}'::jsonb,
  '{"status":"needs_action"}'::jsonb,
  'f8800000-0000-4000-8000-000000000001',
  'point_submission',
  'f8500000-0000-4000-8000-000000000001',
  'point_submission_correction_requested'
);


UPDATE public.organization_members SET role='admin' WHERE user_id='f8000000-0000-4000-8000-000000000003';
UPDATE plugin_data.csf_term_policies SET published_at=now() WHERE organization_id='f8100000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_opportunities SET evidence_policy='optional' WHERE id='f8400000-0000-4000-8000-000000000005';
SELECT plugin_data.csf_delete_activity('f8100000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000003','f8900000-0000-4000-8000-000000000001');
SELECT plugin_data.csf_delete_activity('f8100000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000005','f8000000-0000-4000-8000-000000000003','f8900000-0000-4000-8000-000000000002');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_review_point_submission_request('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000002','approved',2,NULL,'f8000000-0000-4000-8000-000000000003','f8900000-0000-4000-8000-000000000003')$q$,'staff can approve a preserved submitted claim');
SELECT extensions.is((SELECT status FROM plugin_data.csf_point_submissions WHERE id='f8500000-0000-4000-8000-000000000002'),'approved','approval persists after removal');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_resubmit_point_submission_request_v2('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001',2,'non_drive','2031-09-01','Corrected preserved claim','f8000000-0000-4000-8000-000000000001','f8900000-0000-4000-8000-000000000004',NULL)$q$,'the owner can correct a preserved needs-action claim');
SELECT extensions.is((SELECT status FROM plugin_data.csf_point_submissions WHERE id='f8500000-0000-4000-8000-000000000001'),'submitted','correction returns to the review queue');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_review_point_submission_request('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001','approved',2,NULL,'f8000000-0000-4000-8000-000000000003','f8900000-0000-4000-8000-000000000005')$q$,'staff can approve the corrected preserved claim');
SELECT extensions.is((SELECT status FROM plugin_data.csf_opportunities WHERE id='f8400000-0000-4000-8000-000000000001'),'archived','review never republishes the activity');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_assert_point_submission_eligibility('f8100000-0000-4000-8000-000000000001','f8300000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001',NULL,'student',2,'non_drive',true,false,false)$q$,'P0001','This CSF activity is not available for this point action.','new claims cannot use removed activities');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_assert_point_submission_row_eligibility('f8500000-0000-4000-8000-000000000099','f8100000-0000-4000-8000-000000000001','f8300000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001',NULL,'student',2,'non_drive',true,false,false)$q$,'P0001','This CSF activity is not available for this point action.','a fabricated submission cannot use the preservation path');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_assert_point_submission_eligibility('f8100000-0000-4000-8000-000000000001','f8300000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001',NULL,'student',2,'non_drive',false,true,false)$q$,'P0001','A proof file is required for this point action.','preservation still requires proof');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_assert_point_submission_row_eligibility(uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean)','EXECUTE'),'the internal preservation helper remains owner-only');
SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($q$UPDATE plugin_data.csf_profiles SET reported_application_personal_email='contact-index@local.test' WHERE id='f8300000-0000-4000-8000-000000000001'$q$,'server role can maintain the normalized contact indexes');
RESET ROLE;
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_normalize_email_text(text)','EXECUTE') AND NOT has_function_privilege('authenticated','plugin_data.csf_normalize_email_text(text)','EXECUTE'),'the pure index helper stays unavailable to browser roles');
SELECT * FROM extensions.finish();
ROLLBACK;
