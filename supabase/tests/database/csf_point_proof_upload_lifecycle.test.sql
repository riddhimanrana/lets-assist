BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(30);

SELECT extensions.has_column('plugin_data', 'csf_submission_files', 'upload_status', 'proof rows store upload lifecycle state');
SELECT extensions.has_column('plugin_data', 'csf_submission_files', 'upload_token', 'pending proof rows use a one-time upload token');
SELECT extensions.has_table('plugin_data', 'csf_storage_deletion_queue', 'failed proof objects use a durable cleanup outbox');
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'plugin_data.csf_submission_files'::regclass
      AND conname = 'csf_submission_files_submission_organization_fkey'
      AND contype = 'f'
      AND convalidated
  ),
  'proof-to-submission references are organization scoped'
);
SELECT extensions.ok(
  NOT has_function_privilege('public', 'plugin_data.csf_begin_point_submission(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)', 'EXECUTE'),
  'PUBLIC cannot create pending proof records'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_begin_point_submission(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)', 'EXECUTE'),
  'authenticated users cannot bypass the permission-checked point action'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_begin_point_submission(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)', 'EXECUTE'),
  'the server role cannot bypass the request-aware point-submission boundary'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_begin_point_submission_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid)', 'EXECUTE'),
  'the server role can begin a replay-safe proof-backed point submission'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_finalize_point_submission_proof(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated users cannot finalize proof metadata directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_finalize_point_submission_proof(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'the server role cannot bypass request-aware proof finalization'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_finalize_point_submission_proof_request(uuid,uuid,uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'the server role can finalize proof metadata through a replay-safe request'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'plugin_data.csf_fail_point_submission_proof(uuid,uuid,uuid,uuid,uuid,text)', 'EXECUTE'),
  'authenticated users cannot fail proof uploads directly'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role', 'plugin_data.csf_fail_point_submission_proof(uuid,uuid,uuid,uuid,uuid,text)', 'EXECUTE'),
  'the server role cannot bypass request-aware proof cleanup'
);
SELECT extensions.ok(
  has_function_privilege('service_role', 'plugin_data.csf_fail_point_submission_proof_request(uuid,uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'the server role can fail proof uploads through a replay-safe request'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('d5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'proof-member@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('d5100000-0000-4000-8000-000000000001', 'CSF Proof One', 'csf-proof-one', 'school', '995101'),
  ('d5100000-0000-4000-8000-000000000002', 'CSF Proof Two', 'csf-proof-two', 'school', '995102');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('d5100000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'member', 'active');

INSERT INTO plugin_data.csf_terms (id, organization_id, code, label, school_year, semester, is_current)
VALUES
  ('d5200000-0000-4000-8000-000000000001', 'd5100000-0000-4000-8000-000000000001', 'F30', 'Fall 2030', '2030-2031', 'fall', true),
  ('d5200000-0000-4000-8000-000000000002', 'd5100000-0000-4000-8000-000000000002', 'F30', 'Fall 2030', '2030-2031', 'fall', true);

INSERT INTO plugin_data.csf_profiles (id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name)
VALUES
  ('d5300000-0000-4000-8000-000000000001', 'd5100000-0000-4000-8000-000000000001', 'Proof', 'Member', 'proof', 'member'),
  ('d5300000-0000-4000-8000-000000000002', 'd5100000-0000-4000-8000-000000000002', 'Other', 'Tenant', 'other', 'tenant');

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'd5100000-0000-4000-8000-000000000001',
  'd5300000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000001',
  'verified',
  true
);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, status, accepted_at
) VALUES (
  'd5100000-0000-4000-8000-000000000001',
  'd5300000-0000-4000-8000-000000000001',
  'd5200000-0000-4000-8000-000000000001',
  'accepted',
  now()
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity,
  outside_volunteering_allowed, published_at
) VALUES (
  'd5100000-0000-4000-8000-000000000001',
  'd5200000-0000-4000-8000-000000000001',
  3,
  true,
  now()
);

SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'd5100000-0000-4000-8000-000000000001',
    'd5400000-0000-4000-8000-000000000011',
    'd5300000-0000-4000-8000-000000000001',
    'd5200000-0000-4000-8000-000000000001',
    NULL, NULL, 'student', 'Library volunteering', 2, 'non_drive', '2030-09-05',
    'd5000000-0000-4000-8000-000000000001',
    'd5500000-0000-4000-8000-000000000001', 'csf-private',
    'organizations/proof-one/submissions/one/proof.pdf', 'proof.pdf', 'application/pdf', 512,
    'd5600000-0000-4000-8000-000000000001', 'd5700000-0000-4000-8000-000000000001'
  ) $$,
  'a proof-backed submission begins with one atomic database intent'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'd5400000-0000-4000-8000-000000000011'),
  'draft',
  'a claim remains a draft until private proof finalization'
);
SELECT extensions.is(
  (SELECT upload_status FROM plugin_data.csf_submission_files WHERE id = 'd5500000-0000-4000-8000-000000000001'),
  'pending',
  'the intended proof object is recorded before Storage upload'
);
SELECT extensions.is(
  (SELECT action FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'd5700000-0000-4000-8000-000000000001'),
  'point_submission.proof_pending',
  'the pending upload has a correlated immutable audit event'
);
SELECT extensions.throws_ok(
  $$ UPDATE plugin_data.csf_point_submissions
     SET status = 'approved'
     WHERE id = 'd5400000-0000-4000-8000-000000000011' $$,
  'P0001', 'A draft point submission cannot be reviewed before its proof upload is finalized.',
  'a pending upload cannot be approved or otherwise reviewed'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_finalize_point_submission_proof(
    'd5100000-0000-4000-8000-000000000001',
    'd5400000-0000-4000-8000-000000000011',
    'd5500000-0000-4000-8000-000000000001',
    'd5600000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001'
  ) $$,
  'the uploader can atomically finalize proof and submit the claim'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'd5400000-0000-4000-8000-000000000011'),
  'submitted',
  'finalization makes the claim reviewable'
);
SELECT extensions.is(
  (SELECT upload_status FROM plugin_data.csf_submission_files WHERE id = 'd5500000-0000-4000-8000-000000000001'),
  'finalized',
  'finalization freezes the proof metadata'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'd5700000-0000-4000-8000-000000000001'),
  2,
  'pending and finalized events retain one correlation trail'
);

SELECT plugin_data.csf_begin_point_submission(
  'd5100000-0000-4000-8000-000000000001',
  'd5400000-0000-4000-8000-000000000012',
  'd5300000-0000-4000-8000-000000000001',
  'd5200000-0000-4000-8000-000000000001',
  NULL, NULL, 'student', 'Food bank shift', 3, 'non_drive', '2030-09-06',
  'd5000000-0000-4000-8000-000000000001',
  'd5500000-0000-4000-8000-000000000002', 'csf-private',
  'organizations/proof-one/submissions/two/proof.png', 'proof.png', 'image/png', 256,
  'd5600000-0000-4000-8000-000000000002', 'd5700000-0000-4000-8000-000000000002'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_fail_point_submission_proof(
    'd5100000-0000-4000-8000-000000000001',
    'd5400000-0000-4000-8000-000000000012',
    'd5500000-0000-4000-8000-000000000002',
    'd5600000-0000-4000-8000-000000000002',
    'd5000000-0000-4000-8000-000000000001', 'Storage upload failed.'
  ) $$,
  'a failed upload atomically withdraws its draft and queues cleanup'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'd5400000-0000-4000-8000-000000000012'),
  'withdrawn',
  'a failed proof never enters the officer review queue'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue WHERE submission_file_id = 'd5500000-0000-4000-8000-000000000002'),
  1,
  'failed proof cleanup is durable and idempotent'
);

SELECT plugin_data.csf_begin_point_submission(
  'd5100000-0000-4000-8000-000000000001',
  'd5400000-0000-4000-8000-000000000013',
  'd5300000-0000-4000-8000-000000000001',
  'd5200000-0000-4000-8000-000000000001',
  NULL, NULL, 'student', 'Campus service', 1, 'non_drive', '2030-09-07',
  'd5000000-0000-4000-8000-000000000001',
  'd5500000-0000-4000-8000-000000000003', 'csf-private',
  'organizations/proof-one/submissions/three/proof.jpg', 'proof.jpg', 'image/jpeg', 128,
  'd5600000-0000-4000-8000-000000000003', 'd5700000-0000-4000-8000-000000000003'
);
UPDATE plugin_data.csf_submission_files
SET created_at = now() - interval '2 hours'
WHERE id = 'd5500000-0000-4000-8000-000000000003';
SELECT extensions.is(
  (plugin_data.csf_enqueue_stale_submission_proof_cleanup(now() - interval '1 hour', 20)->>'enqueued')::integer,
  1,
  'stale pending uploads are claimed for cleanup exactly once'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'd5400000-0000-4000-8000-000000000013'),
  'withdrawn',
  'stale cleanup removes an abandoned claim from operational review'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue),
  2,
  'failed and abandoned objects both remain queued until Storage acknowledges deletion'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission(
    'd5100000-0000-4000-8000-000000000001',
    'd5400000-0000-4000-8000-000000000014',
    'd5300000-0000-4000-8000-000000000002',
    'd5200000-0000-4000-8000-000000000001',
    NULL, NULL, 'student', 'Cross tenant', 1, 'non_drive', '2030-09-08',
    'd5000000-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'd5700000-0000-4000-8000-000000000004'
  ) $$,
  'P0001', 'Only the connected member may submit this point claim.',
  'a point submission cannot target another organization profile or disclose it before ownership'
);

SELECT extensions.finish();
ROLLBACK;
