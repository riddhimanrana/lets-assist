BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
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
  ('f8600000-0000-4000-8000-000000000001', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000001', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'plugins', 'f8100000-0000-4000-8000-000000000001/dvhs-csf/profiles/f8300000-0000-4000-8000-000000000001/terms/f8200000-0000-4000-8000-000000000001/submissions/f8500000-0000-4000-8000-000000000001/f8600000-0000-4000-8000-000000000001-proof', 'valid.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000003', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000002', 'plugins', 'resubmit/prior.pdf', 'prior.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000006', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'plugins', 'resubmit/policy.pdf', 'policy.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000004', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000007', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'plugins', 'resubmit/type.pdf', 'type.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'finalized', NULL, now()),
  ('f8600000-0000-4000-8000-000000000005', 'f8100000-0000-4000-8000-000000000001', 'f8500000-0000-4000-8000-000000000009', 'f8300000-0000-4000-8000-000000000001', 'f8200000-0000-4000-8000-000000000001', 'plugins', 'resubmit/pending.pdf', 'pending.pdf', 'application/pdf', 512, 'f8000000-0000-4000-8000-000000000001', 'pending', 'f8700000-0000-4000-8000-000000000001', NULL);

CREATE FUNCTION pg_temp.delete_claim(suffix integer DEFAULT 1,actor uuid DEFAULT 'f8000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_delete_member_point_submission_request('f8100000-0000-4000-8000-000000000001','f8300000-0000-4000-8000-000000000001',('f8500000-0000-4000-8000-'||lpad(suffix::text,12,'0'))::uuid,actor,'f8900000-0000-4000-8000-000000000010');
$$;
CREATE FUNCTION pg_temp.finish_delete() RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_finish_member_point_submission_deletion('f8100000-0000-4000-8000-000000000001','f8300000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000001','f8900000-0000-4000-8000-000000000010');
$$;
CREATE TEMP TABLE proof_paths AS SELECT object_path FROM plugin_data.csf_submission_files WHERE submission_id='f8500000-0000-4000-8000-000000000001';
INSERT INTO storage.objects(bucket_id,name,metadata) SELECT 'plugins',object_path,'{"size":512,"mimetype":"application/pdf"}' FROM proof_paths;
SELECT extensions.lives_ok($$UPDATE storage.objects SET metadata='{"size":512}' WHERE name=(SELECT object_path FROM proof_paths)$$,'live exact proof permits idempotent metadata update');
INSERT INTO plugin_data.csf_admin_audit_events(organization_id,action,target_type,target_id,before_data)
VALUES ('f8100000-0000-4000-8000-000000000001','point_submission.revised','csf_point_submissions','f8500000-0000-4000-8000-000000000001','{"description":"Prior evidence"}'),
('f8100000-0000-4000-8000-000000000001','point_submission.revised','csf_point_submissions','f8500000-0000-4000-8000-000000000002','{"description":"Other evidence"}');
INSERT INTO plugin_data.csf_submission_edit_requests(request_id,organization_id,submission_id,actor_user_id,expected_revision,fingerprint,intent,prior_data)
VALUES('f8900000-0000-4000-8000-000000000011','f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000001',0,'fixture','{"description":"Draft edit"}','{"description":"Old evidence"}');
UPDATE plugin_data.csf_submission_files SET superseded_at=now() WHERE submission_id='f8500000-0000-4000-8000-000000000001';
INSERT INTO plugin_data.csf_submission_files(organization_id,submission_id,profile_id,term_id,bucket,object_path,original_filename,mime_type,size_bytes,uploaded_by,upload_status,finalized_at)
SELECT organization_id,submission_id,profile_id,term_id,bucket,replace(object_path,'f8600000','f8600002'),'replacement.heic','image/heic',512,uploaded_by,'finalized',now()
FROM plugin_data.csf_submission_files WHERE submission_id='f8500000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_submission_edit_requests SET object_path='dvhs-csf/f8100000-0000-4000-8000-000000000001/submission-edits/f8900000-0000-4000-8000-000000000011/f8600000-0000-4000-8000-000000000001-proof'
WHERE request_id='f8900000-0000-4000-8000-000000000011';
SELECT extensions.lives_ok($$INSERT INTO storage.objects(bucket_id,name) SELECT 'plugins',object_path FROM plugin_data.csf_submission_edit_requests WHERE request_id='f8900000-0000-4000-8000-000000000011'$$,'live staged edit permits exact proof upload');
SELECT extensions.throws_ok($$SELECT pg_temp.delete_claim(1,'f8000000-0000-4000-8000-000000000002')$$,'42501','Only the connected member may unsubmit this submission.','another account cannot delete claim');
SELECT extensions.throws_ok($$DELETE FROM plugin_data.csf_admin_audit_events WHERE target_id='f8500000-0000-4000-8000-000000000001'$$,'P0001','CSF audit events are immutable.','direct audit deletion remains forbidden');
SELECT extensions.throws_ok($$SELECT pg_temp.delete_claim(3)$$,'55000','Point submissions are locked for this semester.','historical term remains protected');
UPDATE plugin_data.csf_point_submissions SET status='approved' WHERE id='f8500000-0000-4000-8000-000000000004';
SELECT extensions.throws_ok($$SELECT pg_temp.delete_claim(4)$$,'55000','Reviewed or awarded submissions require the correction workflow.','approved claim cannot be erased');
UPDATE plugin_data.csf_term_memberships SET status='pending' WHERE profile_id='f8300000-0000-4000-8000-000000000001' AND term_id='f8200000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($$SELECT pg_temp.delete_claim()$$,'55000','An accepted or active semester membership is required to unsubmit points.','pending membership cannot delete');
UPDATE plugin_data.csf_term_memberships SET status='active' WHERE profile_id='f8300000-0000-4000-8000-000000000001' AND term_id='f8200000-0000-4000-8000-000000000001';
SELECT extensions.is(pg_temp.delete_claim()->>'status','cleanup_required','claim deletion waits for physical proof removal');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_point_submissions WHERE id='f8500000-0000-4000-8000-000000000001'),0,'submission is deleted');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_submission_files WHERE submission_id='f8500000-0000-4000-8000-000000000001'),0,'proof metadata is deleted');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_submission_edit_requests WHERE submission_id='f8500000-0000-4000-8000-000000000001'),0,'edit snapshots are deleted');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id='f8500000-0000-4000-8000-000000000001'),0,'exact claim audit history is deleted');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id='f8500000-0000-4000-8000-000000000002'),1,'unrelated audit history is retained');
SELECT extensions.is(jsonb_array_length(pg_temp.delete_claim()->'files'),3,'all current, superseded, and staged proof paths are returned');
SELECT extensions.is(pg_temp.delete_claim()->>'status','cleanup_required','request replay retains exact cleanup work');
SELECT extensions.is(pg_temp.finish_delete()->>'status','cleanup_required','finish does not claim success while bytes remain');
SELECT extensions.is(plugin_data.csf_purge_storage_deletion_queue('f8100000-0000-4000-8000-000000000001')->>'status','cleanup_required','chapter teardown preserves pending member proof cleanup');
SELECT extensions.throws_ok($$UPDATE storage.objects SET metadata='{"size":512}' WHERE name=(SELECT object_path FROM proof_paths)$$,'55000','This submission no longer accepts proof uploads.','late original upload update is fenced');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name) SELECT 'plugins',replace(object_path,'f8600000','f8600001') FROM proof_paths$$,'55000','This submission no longer accepts proof uploads.','late original upload insertion is fenced');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES('plugins','dvhs-csf/f8100000-0000-4000-8000-000000000001/submission-edits/f8900000-0000-4000-8000-000000000011/f8600000-0000-4000-8000-000000000001-proof')$$,'55000','This submission no longer accepts proof uploads.','late staged edit upload is fenced');
SELECT extensions.lives_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES('plugins','unrelated-fixture/attachment.png')$$,'unrelated plugin storage path is unaffected');
-- This rollback-only fixture simulates the metadata removal confirmed by the
-- Storage API. Production functions never delete storage.objects themselves.
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects WHERE bucket_id='plugins' AND name IN (SELECT object_path FROM plugin_data.csf_member_submission_deletion_paths);
SELECT extensions.is(pg_temp.finish_delete()->>'status','deleted','finish succeeds after storage confirms absence');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_member_submission_deletions),0,'temporary request is erased');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_member_submission_deletion_paths),0,'temporary proof paths are erased');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue WHERE object_path=(SELECT object_path FROM proof_paths)),0,'cleanup queue leaves no claim path');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_receipts WHERE object_path=(SELECT object_path FROM proof_paths)),0,'cleanup receipts leave no claim path');
SELECT extensions.is(pg_temp.delete_claim()->>'status','deleted','lost final response safely retries without permanent history');
SELECT extensions.is(pg_temp.finish_delete()->>'status','deleted','finish replay is safe');
SELECT extensions.throws_ok($$DELETE FROM plugin_data.csf_admin_audit_events WHERE target_id='f8500000-0000-4000-8000-000000000002'$$,'P0001','CSF audit events are immutable.','audit exception does not outlive deletion');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_delete_member_point_submission_request(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'browser cannot invoke deletion RPC');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_delete_member_point_submission_request(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'server can invoke deletion RPC');
SELECT extensions.ok(NOT has_table_privilege('service_role','plugin_data.csf_member_submission_deletions','INSERT'),'service cannot forge audit deletion authorization');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_fence_deleted_submission_storage_upload()','EXECUTE'),'storage fence is trigger-only');
SELECT extensions.is(plugin_data.csf_cleanup_deleted_submission_upload('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001',(SELECT object_path FROM proof_paths)),true,'orphan callback confirms already absent proof without retaining queue');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_member_submission_deletion_paths),0,'absent orphan callback retains no paths');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_cleanup_deleted_submission_upload('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001','unrelated-fixture/attachment.png')$$,'22023','A valid submission proof path is required.','orphan callback refuses unrelated path');

-- A queue worker can finish abandoned UI work without retaining path receipts.
SELECT extensions.is(pg_temp.delete_claim(9)->>'status','cleanup_required','another claim queues pending proof cleanup');
CREATE TEMP TABLE worker_claim AS SELECT * FROM plugin_data.csf_claim_organization_storage_deletion_queue('f8100000-0000-4000-8000-000000000001',100);
SELECT extensions.is((SELECT count(*)::integer FROM worker_claim),1,'worker receives one exact claim path');
SELECT extensions.is((SELECT plugin_data.csf_ack_storage_deletion_claim(id,claim_token,true)->>'status' FROM worker_claim),'deleted','worker confirms storage absence and clears claim queue');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_member_submission_deletions),0,'worker clears temporary deletion request');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_member_submission_deletion_paths),0,'worker clears temporary deletion paths');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_receipts r JOIN worker_claim w ON r.queue_id=w.id),0,'worker does not retain erased proof receipt');
SELECT extensions.throws_ok($$SELECT plugin_data.csf_ack_storage_deletion_claim(id,claim_token,true) FROM worker_claim$$,'55000','The storage deletion claim is no longer current.','late acknowledgement cannot recreate erased history');
INSERT INTO plugin_data.csf_submission_reviews(organization_id,submission_id,action,notes)
VALUES('f8100000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000002','resubmitted','Synthetic prior note');
SELECT extensions.is(pg_temp.delete_claim(2)->>'status','deleted','unreviewed submission without proof deletes immediately');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_submission_reviews WHERE submission_id='f8500000-0000-4000-8000-000000000002'),0,'review notes for unreviewed edits are erased');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE target_id='f8500000-0000-4000-8000-000000000002'),0,'no-proof submission audit is erased');

-- In-app-only notices are erased with their claim; active senders are fenced.
INSERT INTO plugin_data.csf_publication_events(id,organization_id,source_kind,source_id,event_key)
VALUES('f8700000-0000-4000-8000-000000000050','f8100000-0000-4000-8000-000000000001','point_submission','f8500000-0000-4000-8000-000000000005','fixture');
INSERT INTO plugin_data.csf_publication_notification_deliveries(organization_id,event_id,user_id,status,lease_token,lease_expires_at)
VALUES('f8100000-0000-4000-8000-000000000001','f8700000-0000-4000-8000-000000000050','f8000000-0000-4000-8000-000000000001','processing',gen_random_uuid(),now()+interval '5 minutes');
SELECT extensions.throws_ok($$SELECT pg_temp.delete_claim(5)$$,'55000','This submission has a review notice in delivery. Use the correction workflow.','active notice delivery prevents erasure race');
UPDATE plugin_data.csf_publication_notification_deliveries SET status='queued',lease_token=NULL,lease_expires_at=NULL WHERE event_id='f8700000-0000-4000-8000-000000000050';
SELECT extensions.is(pg_temp.delete_claim(5)->>'status','deleted','queued in-app-only notice does not block deletion');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_events WHERE id='f8700000-0000-4000-8000-000000000050'),0,'exact personal event is erased');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_publication_notification_deliveries WHERE event_id='f8700000-0000-4000-8000-000000000050'),0,'exact personal delivery is erased');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_retention_reference_coverage_gaps()),0,'new cleanup state does not leave unclassified retention references');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_retention_identity_coverage_gaps()),0,'retention identity inventory remains complete');
SELECT extensions.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('plugin_data.csf_member_submission_deletions'::regclass,'plugin_data.csf_member_submission_deletion_paths'::regclass)),'both temporary tables enforce RLS');
SELECT extensions.ok(NOT has_table_privilege('authenticated','plugin_data.csf_member_submission_deletion_paths','SELECT') AND NOT has_table_privilege('service_role','plugin_data.csf_member_submission_deletion_paths','DELETE'),'proof cleanup paths remain owner-only');
SELECT extensions.is((SELECT count(*)::integer FROM pg_class c WHERE c.oid IN ('plugin_data.csf_member_submission_deletions'::regclass,'plugin_data.csf_member_submission_deletion_paths'::regclass)
AND NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0] WHERE i.indrelid=c.oid AND a.attname='organization_id')),0,'temporary tenant tables have leading organization indexes');
SELECT * FROM extensions.finish();
ROLLBACK;
