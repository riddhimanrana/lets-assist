BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(22);
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


UPDATE plugin_data.csf_term_policies SET published_at=now() WHERE organization_id='f8100000-0000-4000-8000-000000000001';
UPDATE public.organization_members SET role='admin' WHERE user_id='f8000000-0000-4000-8000-000000000003';
CREATE FUNCTION pg_temp.begin_edit(req uuid,rev bigint,proof jsonb DEFAULT NULL,actor uuid DEFAULT 'f8000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_begin_submission_edit('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001',actor,req,rev,'{"description":"Revised description","claimedPoints":2,"pointType":"non_drive","activityDate":"2031-09-01"}',proof);
$$;
CREATE FUNCTION pg_temp.commit_edit(req uuid,digest text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_commit_submission_edit('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000001',req,digest);
$$;
SELECT extensions.lives_ok($$SELECT pg_temp.begin_edit('f8900000-0000-4000-8000-000000000001',0)$$,'stage a needs_action edit');
SELECT extensions.is((SELECT description FROM plugin_data.csf_point_submissions WHERE id='f8500000-0000-4000-8000-000000000001'),'Original description','staging does not change original');
SELECT extensions.lives_ok($$SELECT pg_temp.commit_edit('f8900000-0000-4000-8000-000000000001')$$,'commit correction on the same submission ID');
SELECT extensions.is((SELECT revision FROM plugin_data.csf_point_submissions WHERE id='f8500000-0000-4000-8000-000000000001'),1::bigint,'edit increments revision');
SELECT extensions.is((SELECT status FROM plugin_data.csf_point_submissions WHERE id='f8500000-0000-4000-8000-000000000001'),'submitted','edited correction returns to queue');
SELECT extensions.lives_ok($$SELECT pg_temp.commit_edit('f8900000-0000-4000-8000-000000000001')$$,'response-loss retry returns receipt');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE action='point_submission.revised' AND target_id='f8500000-0000-4000-8000-000000000001'),1,'retry does not duplicate audit');
SELECT extensions.is((SELECT prior_data->>'description' FROM plugin_data.csf_submission_edit_requests WHERE request_id='f8900000-0000-4000-8000-000000000001'),'Original description','prior values preserved');
SELECT extensions.throws_ok($$SELECT pg_temp.begin_edit('f8900000-0000-4000-8000-000000000002',0)$$,'40001','This submission changed or was reviewed. Reload before editing.','stale revision refused');
SELECT extensions.throws_ok($$SELECT pg_temp.begin_edit('f8900000-0000-4000-8000-000000000003',1,NULL,'f8000000-0000-4000-8000-000000000002')$$,'42501','Only the connected member may edit this submission.','another member cannot edit');
SELECT extensions.lives_ok($$SELECT pg_temp.begin_edit('f8900000-0000-4000-8000-000000000004',1,'{"filename":"replacement.pdf","mimeType":"application/pdf","size":512,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,'replacement proof is staged separately');
SELECT extensions.throws_ok($$SELECT pg_temp.commit_edit('f8900000-0000-4000-8000-000000000004','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'P0001','The replacement proof has not been verified.','missing upload cannot commit');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_submission_files WHERE submission_id='f8500000-0000-4000-8000-000000000001' AND superseded_at IS NULL),1,'failed upload keeps original proof current');
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT 'plugins',object_path,'{"size":512,"mimetype":"application/pdf"}'::jsonb FROM plugin_data.csf_submission_edit_requests WHERE request_id='f8900000-0000-4000-8000-000000000004';
SELECT extensions.lives_ok($$SELECT pg_temp.commit_edit('f8900000-0000-4000-8000-000000000004','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'verified replacement commits atomically');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_submission_files WHERE submission_id='f8500000-0000-4000-8000-000000000001' AND superseded_at IS NOT NULL),1,'prior proof remains in history');
SELECT extensions.lives_ok($$SELECT pg_temp.begin_edit('f8900000-0000-4000-8000-000000000005',2)$$,'stage another submitted edit');
SELECT plugin_data.csf_review_point_submission_request('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001','approved',2,'Reviewed while edit was open.','f8000000-0000-4000-8000-000000000003','f8900000-0000-4000-8000-000000000006');
SELECT extensions.throws_ok($$SELECT pg_temp.commit_edit('f8900000-0000-4000-8000-000000000005')$$,'40001','This submission changed or was reviewed. Reload before editing.','officer review blocks outstanding edit');
SELECT extensions.is((SELECT status FROM plugin_data.csf_point_submissions WHERE id='f8500000-0000-4000-8000-000000000001'),'approved','failed edit preserves officer decision');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_commit_submission_edit(uuid,uuid,uuid,uuid,text)','EXECUTE'),'browser cannot commit revisions');
SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.csf_submission_edit_requests','SELECT'),'revision history remains private');
UPDATE plugin_data.csf_submission_edit_requests SET created_at=now()-interval '2 days' WHERE status='pending';
SELECT plugin_data.csf_enqueue_stale_submission_proof_cleanup(now()-interval '1 day',500);
SELECT extensions.is((SELECT status FROM plugin_data.csf_submission_edit_requests WHERE request_id='f8900000-0000-4000-8000-000000000005'),'expired','abandoned staged edit expires');
SELECT extensions.is((SELECT status FROM plugin_data.csf_point_submissions WHERE id='f8500000-0000-4000-8000-000000000001'),'approved','staged edit cleanup does not withdraw the original');
SELECT * FROM extensions.finish();
ROLLBACK;
