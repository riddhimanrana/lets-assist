BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.ok(
  (
    SELECT pg_catalog.bool_and(
      pg_catalog.has_function_privilege('service_role', function_signature, 'EXECUTE')
    )
    FROM (
      VALUES
        ('plugin_data.csf_begin_point_submission_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid)'),
        ('plugin_data.csf_finalize_point_submission_proof_request(uuid,uuid,uuid,uuid,uuid,uuid)'),
        ('plugin_data.csf_fail_point_submission_proof_request(uuid,uuid,uuid,uuid,uuid,text,uuid)'),
        ('plugin_data.csf_withdraw_point_submission_request(uuid,uuid,uuid,uuid,uuid)'),
        ('plugin_data.csf_resubmit_point_submission_request(uuid,uuid,numeric,text,date,text,uuid,uuid)'),
        ('plugin_data.csf_review_point_submission_request(uuid,uuid,text,numeric,text,uuid,uuid)'),
        ('plugin_data.csf_submit_point_appeal_request(uuid,uuid,text,numeric,uuid,uuid)'),
        ('plugin_data.csf_review_point_appeal_request(uuid,uuid,text,text,uuid,uuid)')
    ) AS request_functions(function_signature)
  ),
  'service_role can execute every request-aware point writer'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (
      VALUES ('public'), ('anon'), ('authenticated')
    ) AS client_roles(role_name)
    CROSS JOIN (
      VALUES
        ('plugin_data.csf_begin_point_submission_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid)'),
        ('plugin_data.csf_finalize_point_submission_proof_request(uuid,uuid,uuid,uuid,uuid,uuid)'),
        ('plugin_data.csf_fail_point_submission_proof_request(uuid,uuid,uuid,uuid,uuid,text,uuid)'),
        ('plugin_data.csf_withdraw_point_submission_request(uuid,uuid,uuid,uuid,uuid)'),
        ('plugin_data.csf_resubmit_point_submission_request(uuid,uuid,numeric,text,date,text,uuid,uuid)'),
        ('plugin_data.csf_review_point_submission_request(uuid,uuid,text,numeric,text,uuid,uuid)'),
        ('plugin_data.csf_submit_point_appeal_request(uuid,uuid,text,numeric,uuid,uuid)'),
        ('plugin_data.csf_review_point_appeal_request(uuid,uuid,text,text,uuid,uuid)')
    ) AS request_functions(function_signature)
    WHERE pg_catalog.has_function_privilege(
      client_roles.role_name,
      request_functions.function_signature,
      'EXECUTE'
    )
  ),
  'browser roles cannot execute any request-aware point writer directly'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('plugin_data.csf_begin_point_submission(uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,uuid,text,text,text,text,bigint,uuid,uuid)'),
        ('plugin_data.csf_finalize_point_submission_proof(uuid,uuid,uuid,uuid,uuid)'),
        ('plugin_data.csf_fail_point_submission_proof(uuid,uuid,uuid,uuid,uuid,text)'),
        ('plugin_data.csf_withdraw_point_submission(uuid,uuid,uuid,uuid)'),
        ('plugin_data.csf_resubmit_point_submission(uuid,uuid,numeric,text,date,text,uuid,uuid)'),
        ('plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)'),
        ('plugin_data.csf_submit_point_appeal(uuid,uuid,text,numeric,uuid,uuid)'),
        ('plugin_data.csf_review_point_appeal(uuid,uuid,text,text,uuid,uuid)')
    ) AS legacy_functions(function_signature)
    WHERE pg_catalog.has_function_privilege(
      'service_role',
      legacy_functions.function_signature,
      'EXECUTE'
    )
  ),
  'service_role cannot bypass receipts through a legacy point writer'
);

SELECT extensions.ok(
  NOT pg_catalog.has_function_privilege(
    'service_role',
    'plugin_data.csf_point_submission_receipt_state(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'service_role',
    'plugin_data.csf_point_appeal_receipt_state(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'service_role',
    'plugin_data.csf_point_request_fingerprint(text,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'receipt internals remain private to the security-definer request boundary'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'receipt-member@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'receipt-reviewer@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'receipt-processor@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'receipt-other-org@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'fb100000-0000-4000-8000-000000000001',
    'CSF Point Receipt Safety',
    'csf-point-receipt-safety',
    'school',
    '998101'
  ),
  (
    'fb100000-0000-4000-8000-000000000002',
    'CSF Point Receipt Other',
    'csf-point-receipt-other',
    'school',
    '998102'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('fb100000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000004', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title, role_type, is_system
) VALUES
  ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'receipt-reviewer', 'Receipt reviewer', 'Receipt reviewer', 'custom', false),
  ('fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'receipt-processor', 'Receipt processor', 'Receipt processor', 'custom', false);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000001', 'verify_submissions', true),
  ('fb100000-0000-4000-8000-000000000001', 'fb200000-0000-4000-8000-000000000002', 'process_points', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title,
  status, starts_at, ends_at
) VALUES
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'fb200000-0000-4000-8000-000000000001', '2099-2100', 'Receipt reviewer', 'active', current_date - 1, current_date + 30),
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000003', 'fb200000-0000-4000-8000-000000000002', '2099-2100', 'Receipt processor', 'active', current_date - 1, current_date + 30);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status
) VALUES (
  'fb300000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'F99',
  'Fall 2099',
  '2099-2100',
  'fall',
  true,
  'open'
);

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES (
  'fb310000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  2100,
  'Class of 2100',
  'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name, record_status
) VALUES (
  'fb400000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'Receipt',
  'Member',
  'receipt',
  'member',
  'active'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000001',
  'verified',
  true
);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, accepted_at
) VALUES (
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001',
  'fb310000-0000-4000-8000-000000000001',
  'accepted',
  now()
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity,
  outside_volunteering_allowed, published_at
) VALUES (
  'fb100000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001',
  3,
  true,
  now()
);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, cohort_id, title, body, status,
  point_value, point_cap, point_type, requires_point_submission,
  evidence_policy, published_at
) VALUES
  ('fb500000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000001', 'fb310000-0000-4000-8000-000000000001', 'Review replay activity', 'Synthetic receipt fixture.', 'published', 3, 3, 'non_drive', true, 'optional', now()),
  ('fb500000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000001', 'fb310000-0000-4000-8000-000000000001', 'Withdrawal replay activity', 'Synthetic receipt fixture.', 'published', 3, 3, 'non_drive', true, 'optional', now()),
  ('fb500000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000001', 'fb310000-0000-4000-8000-000000000001', 'Proof finalization activity', 'Synthetic receipt fixture.', 'published', 3, 3, 'non_drive', true, 'required', now()),
  ('fb500000-0000-4000-8000-000000000004', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000001', 'fb310000-0000-4000-8000-000000000001', 'Proof cleanup activity', 'Synthetic receipt fixture.', 'published', 3, 3, 'non_drive', true, 'required', now()),
  ('fb500000-0000-4000-8000-000000000005', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000001', 'fb310000-0000-4000-8000-000000000001', 'Resubmission replay activity', 'Synthetic receipt fixture.', 'published', 3, 3, 'non_drive', true, 'optional', now()),
  ('fb500000-0000-4000-8000-000000000006', 'fb100000-0000-4000-8000-000000000001', 'fb300000-0000-4000-8000-000000000001', 'fb310000-0000-4000-8000-000000000001', 'Appeal replay activity', 'Synthetic receipt fixture.', 'published', 3, 3, 'non_drive', true, 'optional', now());

CREATE TEMPORARY TABLE point_request_results (
  label text PRIMARY KEY,
  result jsonb NOT NULL
);

-- A proofless structured claim commits once and replays the same receipt.
INSERT INTO point_request_results (label, result)
SELECT 'review-begin', plugin_data.csf_begin_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001',
  'fb500000-0000-4000-8000-000000000001',
  NULL,
  'student',
  'receipt-private-review-description',
  2,
  'non_drive',
  '2099-09-01',
  'fb000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fb600000-0000-4000-8000-000000000001'
);

SELECT extensions.is(
  (SELECT result ->> 'status' FROM point_request_results WHERE label = 'review-begin'),
  'submitted',
  'a proofless structured point request commits a submitted claim'
);
SELECT extensions.is(
  (
    plugin_data.csf_begin_point_submission_request(
      'fb100000-0000-4000-8000-000000000001',
      'fb400000-0000-4000-8000-000000000001',
      'fb300000-0000-4000-8000-000000000001',
      'fb500000-0000-4000-8000-000000000001',
      NULL, 'student', 'receipt-private-review-description', 2,
      'non_drive', '2099-09-01',
      'fb000000-0000-4000-8000-000000000001',
      NULL, NULL, NULL, NULL,
      'fb600000-0000-4000-8000-000000000001'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'an exact point-begin retry returns the committed receipt'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request(
    'fb100000-0000-4000-8000-000000000001',
    'fb400000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000001',
    'fb500000-0000-4000-8000-000000000001',
    NULL, 'student', 'receipt-private-conflicting-description', 2,
    'non_drive', '2099-09-01',
    'fb000000-0000-4000-8000-000000000001',
    NULL, NULL, NULL, NULL,
    'fb600000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'That point request identifier is already bound to a different change.',
  'one request identifier cannot fork a second point-begin intent'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_point_submissions
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND opportunity_id = 'fb500000-0000-4000-8000-000000000001'
  ),
  1,
  'begin retries and intent conflicts still create only one claim'
);

-- Review response-loss retries are allowed through the request receipt, while
-- a new review request against the already-reviewed state remains fail closed.
INSERT INTO point_request_results (label, result)
SELECT 'approved-review', plugin_data.csf_review_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'review-begin'),
  'approved',
  2,
  'receipt-private-review-note',
  'fb000000-0000-4000-8000-000000000002',
  'fb700000-0000-4000-8000-000000000001'
);
SELECT extensions.is(
  (
    plugin_data.csf_review_point_submission_request(
      'fb100000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'review-begin'),
      'approved', 2, 'receipt-private-review-note',
      'fb000000-0000-4000-8000-000000000002',
      'fb700000-0000-4000-8000-000000000001'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'an exact review retry reaches the database receipt after status changed'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'review-begin'),
    'approved', 2, 'receipt-private-new-review-note',
    'fb000000-0000-4000-8000-000000000002',
    'fb700000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Only a submitted point claim can be reviewed. A correction-requested claim must be resubmitted by the member first.',
  'a new review request cannot mutate an already-reviewed claim'
);

-- Withdrawal is exact-once and remains member-owned.
INSERT INTO point_request_results (label, result)
SELECT 'withdraw-begin', plugin_data.csf_begin_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001',
  'fb500000-0000-4000-8000-000000000002',
  NULL, 'student', 'receipt-private-withdraw-description', 1,
  'non_drive', '2099-09-02',
  'fb000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fb600000-0000-4000-8000-000000000002'
);
INSERT INTO point_request_results (label, result)
SELECT 'withdraw', plugin_data.csf_withdraw_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'withdraw-begin'),
  'fb000000-0000-4000-8000-000000000001',
  'fb700000-0000-4000-8000-000000000003'
);
SELECT extensions.is(
  (
    plugin_data.csf_withdraw_point_submission_request(
      'fb100000-0000-4000-8000-000000000001',
      'fb400000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'withdraw-begin'),
      'fb000000-0000-4000-8000-000000000001',
      'fb700000-0000-4000-8000-000000000003'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'an exact withdrawal retry returns one withdrawn outcome'
);

-- Finalization receipts bind the server-issued upload token. A wrong token
-- cannot borrow a valid receipt, while the exact token can replay safely.
INSERT INTO point_request_results (label, result)
SELECT 'proof-final-begin', plugin_data.csf_begin_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001',
  'fb500000-0000-4000-8000-000000000003',
  NULL, 'student', 'receipt-private-proof-final-description', 2,
  'non_drive', '2099-09-03',
  'fb000000-0000-4000-8000-000000000001',
  'receipt-private-proof-final.pdf', 'application/pdf', 512,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'fb600000-0000-4000-8000-000000000003'
);
SELECT extensions.is(
  (SELECT result ->> 'status' FROM point_request_results WHERE label = 'proof-final-begin'),
  'pending',
  'proof-backed begin returns one pending server-issued coordinate set'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request(
    'fb100000-0000-4000-8000-000000000001',
    'fb400000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000001',
    'fb500000-0000-4000-8000-000000000003',
    NULL, 'student', 'receipt-private-proof-oversize', 2,
    'non_drive', '2099-09-03',
    'fb000000-0000-4000-8000-000000000001',
    'receipt-private-proof-oversize.pdf', 'application/pdf', 10485761,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'fb600000-0000-4000-8000-000000000099'
  ) $$,
  'P0001',
  'Validated proof metadata and digest are required together.',
  'the request boundary rejects proof files above 10 MB before creating state'
);
INSERT INTO point_request_results (label, result)
SELECT 'proof-finalize', plugin_data.csf_finalize_point_submission_proof_request(
  'fb100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
  (SELECT (result ->> 'fileId')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
  (SELECT (result ->> 'uploadToken')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
  'fb000000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000003'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_finalize_point_submission_proof_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
    (SELECT (result ->> 'fileId')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
    'fb800000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000001',
    'fb600000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'The finalized point submission is no longer current.',
  'a finalization receipt cannot be replayed with a different upload token'
);
SELECT extensions.is(
  (
    plugin_data.csf_finalize_point_submission_proof_request(
      'fb100000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
      (SELECT (result ->> 'fileId')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
      (SELECT (result ->> 'uploadToken')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
      'fb000000-0000-4000-8000-000000000001',
      'fb600000-0000-4000-8000-000000000003'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'the exact finalization token replays the committed receipt'
);
SELECT extensions.ok(
  (
    SELECT replay ? 'uploadToken' IS false AND replay ? 'objectPath' IS false
    FROM (
      SELECT plugin_data.csf_begin_point_submission_request(
        'fb100000-0000-4000-8000-000000000001',
        'fb400000-0000-4000-8000-000000000001',
        'fb300000-0000-4000-8000-000000000001',
        'fb500000-0000-4000-8000-000000000003',
        NULL, 'student', 'receipt-private-proof-final-description', 2,
        'non_drive', '2099-09-03',
        'fb000000-0000-4000-8000-000000000001',
        'receipt-private-proof-final.pdf', 'application/pdf', 512,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'fb600000-0000-4000-8000-000000000003'
      ) AS replay
    ) AS replay_result
  ),
  'a finalized begin replay does not return reusable storage coordinates'
);

-- Cleanup receipts have the same token binding and produce one durable outbox
-- row without returning storage coordinates on a later begin replay.
INSERT INTO point_request_results (label, result)
SELECT 'proof-fail-begin', plugin_data.csf_begin_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001',
  'fb500000-0000-4000-8000-000000000004',
  NULL, 'student', 'receipt-private-proof-fail-description', 2,
  'non_drive', '2099-09-04',
  'fb000000-0000-4000-8000-000000000001',
  'receipt-private-proof-fail.png', 'image/png', 256,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'fb600000-0000-4000-8000-000000000004'
);
INSERT INTO point_request_results (label, result)
SELECT 'proof-fail', plugin_data.csf_fail_point_submission_proof_request(
  'fb100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'proof-fail-begin'),
  (SELECT (result ->> 'fileId')::uuid FROM point_request_results WHERE label = 'proof-fail-begin'),
  (SELECT (result ->> 'uploadToken')::uuid FROM point_request_results WHERE label = 'proof-fail-begin'),
  'fb000000-0000-4000-8000-000000000001',
  'receipt-private-upload-error',
  'fb600000-0000-4000-8000-000000000004'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_fail_point_submission_proof_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'proof-fail-begin'),
    (SELECT (result ->> 'fileId')::uuid FROM point_request_results WHERE label = 'proof-fail-begin'),
    'fb800000-0000-4000-8000-000000000002',
    'fb000000-0000-4000-8000-000000000001',
    'receipt-private-upload-error',
    'fb600000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'The failed proof identity is invalid or no longer current.',
  'a cleanup receipt cannot be replayed with a different upload token'
);
SELECT extensions.is(
  (
    plugin_data.csf_fail_point_submission_proof_request(
      'fb100000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'proof-fail-begin'),
      (SELECT (result ->> 'fileId')::uuid FROM point_request_results WHERE label = 'proof-fail-begin'),
      (SELECT (result ->> 'uploadToken')::uuid FROM point_request_results WHERE label = 'proof-fail-begin'),
      'fb000000-0000-4000-8000-000000000001',
      'receipt-private-upload-error',
      'fb600000-0000-4000-8000-000000000004'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'the exact cleanup token replays the failed outcome'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_storage_deletion_queue
    WHERE submission_file_id = (
      SELECT (result ->> 'fileId')::uuid
      FROM point_request_results
      WHERE label = 'proof-fail-begin'
    )
  ),
  1,
  'proof failure creates exactly one durable cleanup job'
);
SELECT extensions.ok(
  (
    SELECT replay ? 'uploadToken' IS false AND replay ? 'objectPath' IS false
    FROM (
      SELECT plugin_data.csf_begin_point_submission_request(
        'fb100000-0000-4000-8000-000000000001',
        'fb400000-0000-4000-8000-000000000001',
        'fb300000-0000-4000-8000-000000000001',
        'fb500000-0000-4000-8000-000000000004',
        NULL, 'student', 'receipt-private-proof-fail-description', 2,
        'non_drive', '2099-09-04',
        'fb000000-0000-4000-8000-000000000001',
        'receipt-private-proof-fail.png', 'image/png', 256,
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'fb600000-0000-4000-8000-000000000004'
      ) AS replay
    ) AS replay_result
  ),
  'a failed begin replay does not return reusable storage coordinates'
);

-- A needs-action claim can be resubmitted once with the corrected description,
-- and the corrected request signature itself is replay-safe.
INSERT INTO point_request_results (label, result)
SELECT 'resubmit-begin', plugin_data.csf_begin_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001',
  'fb500000-0000-4000-8000-000000000005',
  NULL, 'student', 'receipt-private-original-resubmit-description', 2,
  'non_drive', '2099-09-05',
  'fb000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fb600000-0000-4000-8000-000000000005'
);
INSERT INTO point_request_results (label, result)
SELECT 'needs-action-review', plugin_data.csf_review_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'resubmit-begin'),
  'needs_action', NULL, 'receipt-private-needs-action-note',
  'fb000000-0000-4000-8000-000000000002',
  'fb700000-0000-4000-8000-000000000004'
);
INSERT INTO point_request_results (label, result)
SELECT 'resubmit', plugin_data.csf_resubmit_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'resubmit-begin'),
  2,
  'non_drive',
  '2099-09-06',
  'receipt-private-corrected-resubmit-description',
  'fb000000-0000-4000-8000-000000000001',
  'fb700000-0000-4000-8000-000000000005'
);
SELECT extensions.is(
  (
    plugin_data.csf_resubmit_point_submission_request(
      'fb100000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'resubmit-begin'),
      2, 'non_drive', '2099-09-06',
      'receipt-private-corrected-resubmit-description',
      'fb000000-0000-4000-8000-000000000001',
      'fb700000-0000-4000-8000-000000000005'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'the exact correction resubmission replays its committed receipt'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resubmit_point_submission_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'resubmit-begin'),
    2, 'non_drive', '2099-09-06',
    'receipt-private-second-resubmit-description',
    'fb000000-0000-4000-8000-000000000001',
    'fb700000-0000-4000-8000-000000000006'
  ) $$,
  'P0001',
  'Only a correction-requested point submission can be resubmitted.',
  'a fresh resubmission request cannot mutate an already-resubmitted claim'
);

-- Appeal submission and decision each retain their own exact receipt.
INSERT INTO point_request_results (label, result)
SELECT 'appeal-begin', plugin_data.csf_begin_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001',
  'fb500000-0000-4000-8000-000000000006',
  NULL, 'student', 'receipt-private-appeal-description', 2,
  'non_drive', '2099-09-07',
  'fb000000-0000-4000-8000-000000000001',
  NULL, NULL, NULL, NULL,
  'fb600000-0000-4000-8000-000000000006'
);
INSERT INTO point_request_results (label, result)
SELECT 'rejected-review', plugin_data.csf_review_point_submission_request(
  'fb100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'appeal-begin'),
  'rejected', NULL, 'receipt-private-rejection-note',
  'fb000000-0000-4000-8000-000000000002',
  'fb700000-0000-4000-8000-000000000007'
);
INSERT INTO point_request_results (label, result)
SELECT 'appeal-submit', plugin_data.csf_submit_point_appeal_request(
  'fb100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'appeal-begin'),
  'receipt-private-appeal-reason-is-long-enough',
  2,
  'fb000000-0000-4000-8000-000000000001',
  'fb700000-0000-4000-8000-000000000008'
);
SELECT extensions.is(
  (
    plugin_data.csf_submit_point_appeal_request(
      'fb100000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'appeal-begin'),
      'receipt-private-appeal-reason-is-long-enough', 2,
      'fb000000-0000-4000-8000-000000000001',
      'fb700000-0000-4000-8000-000000000008'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'an exact appeal submission returns its committed receipt'
);

UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND user_id = 'fb000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'appeal-begin'),
    'receipt-private-appeal-reason-is-long-enough', 2,
    'fb000000-0000-4000-8000-000000000001',
    'fb700000-0000-4000-8000-000000000008'
  ) $$,
  'P0001',
  'Point-action actor is not an active organization member.',
  'appeal-submit authorization is checked before an existing receipt can be replayed'
);
UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND user_id = 'fb000000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'appeal-begin'),
    'receipt-private-changed-appeal-reason', 2,
    'fb000000-0000-4000-8000-000000000001',
    'fb700000-0000-4000-8000-000000000008'
  ) $$,
  'P0001',
  'That point request identifier is already bound to a different change.',
  'an appeal-submit request UUID cannot be rebound to a different intent'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'appeal-begin'),
    'receipt-private-cross-organization-appeal', 2,
    'fb000000-0000-4000-8000-000000000004',
    'fb700000-0000-4000-8000-000000000011'
  ) $$,
  'P0001',
  'Point-action actor is not an active organization member.',
  'an org-B actor cannot submit an appeal for an org-A point claim'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_submit_point_appeal_request(
    'fb100000-0000-4000-8000-000000000002',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'appeal-begin'),
    'receipt-private-mismatched-organization-appeal', 2,
    'fb000000-0000-4000-8000-000000000004',
    'fb700000-0000-4000-8000-000000000012'
  ) $$,
  'P0001',
  'Only the connected member may appeal this point submission.',
  'an org-B actor cannot submit against an org-A point claim through org B'
);
SELECT extensions.ok(
  (SELECT count(*) = 1 AND pg_catalog.bool_and(status = 'submitted')
   FROM plugin_data.csf_point_appeals
   WHERE submission_id = (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'appeal-begin'))
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id IN (
      'fb700000-0000-4000-8000-000000000011',
      'fb700000-0000-4000-8000-000000000012'
    )
  ),
  'cross-organization appeal-submit attempts create zero appeal rows or receipts'
);

INSERT INTO point_request_results (label, result)
SELECT 'appeal-review', plugin_data.csf_review_point_appeal_request(
  'fb100000-0000-4000-8000-000000000001',
  (SELECT (result ->> 'appealId')::uuid FROM point_request_results WHERE label = 'appeal-submit'),
  'rejected',
  'receipt-private-appeal-resolution-note',
  'fb000000-0000-4000-8000-000000000003',
  'fb700000-0000-4000-8000-000000000009'
);
SELECT extensions.is(
  (
    plugin_data.csf_review_point_appeal_request(
      'fb100000-0000-4000-8000-000000000001',
      (SELECT (result ->> 'appealId')::uuid FROM point_request_results WHERE label = 'appeal-submit'),
      'rejected', 'receipt-private-appeal-resolution-note',
      'fb000000-0000-4000-8000-000000000003',
      'fb700000-0000-4000-8000-000000000009'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'an exact appeal decision returns its committed receipt'
);

UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND user_id = 'fb000000-0000-4000-8000-000000000003';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'appealId')::uuid FROM point_request_results WHERE label = 'appeal-submit'),
    'rejected', 'receipt-private-appeal-resolution-note',
    'fb000000-0000-4000-8000-000000000003',
    'fb700000-0000-4000-8000-000000000009'
  ) $$,
  'P0001',
  'Point-action actor is not an active organization member.',
  'appeal-review authorization is checked before an existing receipt can be replayed'
);
UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND user_id = 'fb000000-0000-4000-8000-000000000003';

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'appealId')::uuid FROM point_request_results WHERE label = 'appeal-submit'),
    'rejected', 'receipt-private-changed-appeal-resolution',
    'fb000000-0000-4000-8000-000000000003',
    'fb700000-0000-4000-8000-000000000009'
  ) $$,
  'P0001',
  'That point request identifier is already bound to a different change.',
  'an appeal-review request UUID cannot be rebound to a different intent'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'appealId')::uuid FROM point_request_results WHERE label = 'appeal-submit'),
    'rejected', 'receipt-private-cross-organization-review',
    'fb000000-0000-4000-8000-000000000004',
    'fb700000-0000-4000-8000-000000000013'
  ) $$,
  'P0001',
  'Point-action actor is not an active organization member.',
  'an org-B actor cannot review an org-A point appeal'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal_request(
    'fb100000-0000-4000-8000-000000000002',
    (SELECT (result ->> 'appealId')::uuid FROM point_request_results WHERE label = 'appeal-submit'),
    'rejected', 'receipt-private-mismatched-organization-review',
    'fb000000-0000-4000-8000-000000000004',
    'fb700000-0000-4000-8000-000000000014'
  ) $$,
  'P0001',
  'Point appeal was not found.',
  'an org-B actor cannot review an org-A appeal through org B'
);
SELECT extensions.ok(
  (SELECT status = 'rejected'
   FROM plugin_data.csf_point_appeals
   WHERE id = (SELECT (result ->> 'appealId')::uuid FROM point_request_results WHERE label = 'appeal-submit'))
  AND NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id IN (
      'fb700000-0000-4000-8000-000000000013',
      'fb700000-0000-4000-8000-000000000014'
    )
  ),
  'cross-organization appeal-review attempts leave the appeal unchanged with zero receipts'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_appeal_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'appealId')::uuid FROM point_request_results WHERE label = 'appeal-submit'),
    'rejected', 'receipt-private-new-appeal-resolution',
    'fb000000-0000-4000-8000-000000000003',
    'fb700000-0000-4000-8000-000000000010'
  ) $$,
  'P0001',
  'Point appeal was not found or has already been decided.',
  'a new appeal decision cannot mutate an already-decided appeal'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND source_type IN (
        'point_action_request',
        'point_proof_finalize_request',
        'point_proof_fail_request'
      )
  ),
  15,
  'every committed point mutation has exactly one request receipt'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS receipt
    WHERE receipt.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND receipt.source_type IN (
        'point_action_request',
        'point_proof_finalize_request',
        'point_proof_fail_request'
      )
      AND (
        coalesce(receipt.before_data, '{}'::jsonb)::text
          || receipt.after_data::text
      ) LIKE '%receipt-private%'
  ),
  'request receipts do not store descriptions, notes, reasons, filenames, or errors'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS receipt
    CROSS JOIN plugin_data.csf_submission_files AS proof
    WHERE receipt.organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND proof.organization_id = receipt.organization_id
      AND proof.submission_id IN (
        (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'proof-final-begin'),
        (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'proof-fail-begin')
      )
      AND receipt.source_type IN (
        'point_action_request',
        'point_proof_finalize_request',
        'point_proof_fail_request'
      )
      AND (
        (coalesce(receipt.before_data, '{}'::jsonb)::text || receipt.after_data::text)
          LIKE '%' || proof.object_path || '%'
        OR (coalesce(receipt.before_data, '{}'::jsonb)::text || receipt.after_data::text)
          LIKE '%' || proof.original_filename || '%'
        OR (coalesce(receipt.before_data, '{}'::jsonb)::text || receipt.after_data::text)
          LIKE '%' || proof.upload_token::text || '%'
      )
  ),
  'request receipts do not store storage paths, filenames, or upload tokens'
);

-- Authorization is rechecked before the receipt can be returned.
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND user_id = 'fb000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_begin_point_submission_request(
    'fb100000-0000-4000-8000-000000000001',
    'fb400000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000001',
    'fb500000-0000-4000-8000-000000000003',
    NULL, 'student', 'receipt-private-proof-final-description', 2,
    'non_drive', '2099-09-03',
    'fb000000-0000-4000-8000-000000000001',
    'receipt-private-proof-final.pdf', 'application/pdf', 512,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'fb600000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Point-action actor is not an active organization member.',
  'revoked organization membership blocks even an exact receipt replay'
);
UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND user_id = 'fb000000-0000-4000-8000-000000000001';

-- Exact replay also depends on the current supporting policy/source evidence.
UPDATE plugin_data.csf_opportunities
SET point_cap = 3.5, updated_at = now() + interval '1 second'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND id = 'fb500000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_review_point_submission_request(
    'fb100000-0000-4000-8000-000000000001',
    (SELECT (result ->> 'submissionId')::uuid FROM point_request_results WHERE label = 'review-begin'),
    'approved', 2, 'receipt-private-review-note',
    'fb000000-0000-4000-8000-000000000002',
    'fb700000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'The reviewed point submission is no longer current. Reload Point submissions.',
  'supporting source drift invalidates an otherwise exact review receipt'
);

SELECT extensions.finish();
ROLLBACK;
