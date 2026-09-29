BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ec000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'exception-member@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'exception-reviewer@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'exception-processor@local.test', now(), '{}', '{}', now(), now()),
  ('ec000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'exception-other-org@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'ec100000-0000-4000-8000-000000000001',
    'CSF Point Receipt Safety',
    'csf-point-exception-safety',
    'school',
    '998201'
  ),
  (
    'ec100000-0000-4000-8000-000000000002',
    'CSF Point Receipt Other',
    'csf-point-exception-other',
    'school',
    '998202'
  );

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'member', 'active'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('ec100000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000004', 'admin', 'active');

INSERT INTO plugin_data.csf_roles (
  id, organization_id, key, display_name, public_title, role_type, is_system
) VALUES
  ('ec200000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000001', 'exception-reviewer', 'Receipt reviewer', 'Receipt reviewer', 'custom', false),
  ('ec200000-0000-4000-8000-000000000002', 'ec100000-0000-4000-8000-000000000001', 'exception-processor', 'Receipt processor', 'Receipt processor', 'custom', false);

INSERT INTO plugin_data.csf_role_permissions (
  organization_id, role_id, permission_key, enabled
) VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ec200000-0000-4000-8000-000000000001', 'verify_submissions', true),
  ('ec100000-0000-4000-8000-000000000001', 'ec200000-0000-4000-8000-000000000002', 'process_points', true);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title,
  status, starts_at, ends_at
) VALUES
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', 'ec200000-0000-4000-8000-000000000001', '2099-2100', 'Receipt reviewer', 'active', current_date - 1, current_date + 30),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', 'ec200000-0000-4000-8000-000000000002', '2099-2100', 'Receipt processor', 'active', current_date - 1, current_date + 30);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status
) VALUES (
  'ec300000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
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
  'ec310000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  2100,
  'Class of 2100',
  'active'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name, record_status
) VALUES (
  'ec400000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  'Receipt',
  'Member',
  'exception',
  'member',
  'active'
);

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'ec100000-0000-4000-8000-000000000001',
  'ec400000-0000-4000-8000-000000000001',
  'ec000000-0000-4000-8000-000000000001',
  'verified',
  true
);

INSERT INTO plugin_data.csf_term_memberships (
  organization_id, profile_id, term_id, cohort_id, status, accepted_at
) VALUES (
  'ec100000-0000-4000-8000-000000000001',
  'ec400000-0000-4000-8000-000000000001',
  'ec300000-0000-4000-8000-000000000001',
  'ec310000-0000-4000-8000-000000000001',
  'accepted',
  now()
);

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, max_points_per_activity,
  outside_volunteering_allowed, published_at
) VALUES (
  'ec100000-0000-4000-8000-000000000001',
  'ec300000-0000-4000-8000-000000000001',
  3,
  false,
  now()
);


CREATE FUNCTION pg_temp.begin_exception(n integer) RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_begin_point_exception_request('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001',NULL,NULL,'student','Fictional unlisted activity explanation',2,'non_drive','2099-09-01','ec000000-0000-4000-8000-000000000001','proof.png','image/png',256,repeat('a',64),('ec600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,NULL); $$;
CREATE TEMP TABLE results(n integer PRIMARY KEY,result jsonb);
INSERT INTO results VALUES(1,pg_temp.begin_exception(1));
SELECT extensions.is((SELECT request_kind FROM plugin_data.csf_point_submissions WHERE id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1)),'exception','Other creates an explicit exception submission');
SELECT extensions.is((SELECT source FROM plugin_data.csf_point_submissions WHERE id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1)),'student','Other preserves member provenance');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE organization_id='ec100000-0000-4000-8000-000000000001'),0,'intake grants no credits');
SELECT extensions.is(pg_temp.begin_exception(1)->>'submissionId',(SELECT result->>'submissionId' FROM results WHERE n=1),'lost intake response reuses submission and proof');
SELECT extensions.is((SELECT outside_volunteering_allowed FROM plugin_data.csf_term_policies WHERE organization_id='ec100000-0000-4000-8000-000000000001'),false,'exception intake does not enable outside volunteering');
SELECT extensions.throws_ok($q$UPDATE plugin_data.csf_point_submissions SET request_kind='standard' WHERE id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1)$q$,'55000',NULL,'request kind cannot be cleared');

SAVEPOINT pending_member;
UPDATE plugin_data.csf_term_memberships SET status='pending' WHERE organization_id='ec100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT pg_temp.begin_exception(2)$q$,'P0001',NULL,'pending members cannot use exception intake');
ROLLBACK TO pending_member;
SAVEPOINT closed_term;
UPDATE plugin_data.csf_terms SET is_current=false WHERE id='ec300000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT pg_temp.begin_exception(2)$q$,'P0001',NULL,'noncurrent terms cannot accept exceptions');
ROLLBACK TO closed_term;
SAVEPOINT revoked_link;
UPDATE plugin_data.csf_profile_accounts SET status='pending' WHERE organization_id='ec100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT pg_temp.begin_exception(2)$q$,'P0001',NULL,'revoked account ownership cannot submit exceptions');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_finalize_point_submission_proof_request('ec100000-0000-4000-8000-000000000001',(result->>'submissionId')::uuid,(result->>'fileId')::uuid,(result->>'uploadToken')::uuid,'ec000000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000001') FROM results WHERE n=1$q$,'P0001',NULL,'revoked account ownership cannot finalize proof');
ROLLBACK TO revoked_link;
SAVEPOINT frozen_intake;
INSERT INTO plugin_data.csf_review_periods(organization_id,term_id,kind,status,title,opened_at,opened_by) VALUES('ec100000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','member_points','open','Fictional review period',now(),'ec000000-0000-4000-8000-000000000002');
SELECT extensions.throws_ok($q$SELECT pg_temp.begin_exception(2)$q$,'23514',NULL,'point verification freeze also locks exception intake');
ROLLBACK TO frozen_intake;
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_exception_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,'Proof is not finalized','ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000011','non_drive')$q$,'P0001',NULL,'pending proof cannot be approved');
SELECT plugin_data.csf_finalize_point_submission_proof_request('ec100000-0000-4000-8000-000000000001',(result->>'submissionId')::uuid,(result->>'fileId')::uuid,(result->>'uploadToken')::uuid,'ec000000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000001') FROM results WHERE n=1;
SELECT extensions.is((SELECT status FROM plugin_data.csf_point_submissions WHERE id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1)),'submitted','proof finalization reaches the existing review queue');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_submission_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,'Ordinary approval must refuse','ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000001')$q$,'P0001',NULL,'ordinary approval cannot award exception credit');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_exception_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,NULL,'ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000002','non_drive')$q$,'P0001',NULL,'exception approval requires officer reasons');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_exception_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',4,'Attempt above semester cap','ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000012','non_drive')$q$,'P0001',NULL,'exception award cannot exceed semester activity cap');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_exception_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,'Member cannot grant exception','ec000000-0000-4000-8000-000000000001','ec700000-0000-4000-8000-000000000013','non_drive')$q$,'P0001',NULL,'members cannot approve exception requests');
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_exception_request('ec100000-0000-4000-8000-000000000002',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,'Cross organization request','ec000000-0000-4000-8000-000000000004','ec700000-0000-4000-8000-000000000014','non_drive')$q$,'P0001',NULL,'exception review cannot cross organization boundaries');
SAVEPOINT legacy_approval;
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_submission('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,'Legacy approval bypass','ec000000-0000-4000-8000-000000000002')$q$,'55000',NULL,'legacy approval cannot bypass explicit exception fence');
ROLLBACK TO legacy_approval;
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_review_point_exception_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,'Reviewed proof and authorized this unlisted activity','ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000003','drive')$q$,'explicit officer review can award bounded points');
SELECT extensions.is((SELECT point_type FROM plugin_data.csf_credit_records WHERE submission_id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1)),'drive','officer chooses the awarded point category');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_review_point_exception_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,'Reviewed proof and authorized this unlisted activity','ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000003','drive')$q$,'explicit review receipt retries safely');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE organization_id='ec100000-0000-4000-8000-000000000001'),1,'review retry creates exactly one credit');

SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_exception_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1),'approved',2,'Reviewed proof and authorized this unlisted activity','ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000003','non_drive')$q$,'P0001',NULL,'retry cannot change the awarded category');
INSERT INTO results VALUES(2,pg_temp.begin_exception(2));
SELECT plugin_data.csf_finalize_point_submission_proof_request('ec100000-0000-4000-8000-000000000001',(result->>'submissionId')::uuid,(result->>'fileId')::uuid,(result->>'uploadToken')::uuid,'ec000000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000002') FROM results WHERE n=2;
SELECT plugin_data.csf_review_point_submission_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2),'needs_action',NULL,'Please clarify the event date','ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000021');
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_resubmit_point_submission_request_v2('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2),2,'non_drive','2099-09-02','Clarified fictional activity and date','ec000000-0000-4000-8000-000000000001','ec700000-0000-4000-8000-000000000022',NULL)$q$,'member can resubmit an exception correction with retained proof');
INSERT INTO results VALUES(3,pg_temp.begin_exception(3));
SELECT plugin_data.csf_finalize_point_submission_proof_request('ec100000-0000-4000-8000-000000000001',(result->>'submissionId')::uuid,(result->>'fileId')::uuid,(result->>'uploadToken')::uuid,'ec000000-0000-4000-8000-000000000001','ec600000-0000-4000-8000-000000000003') FROM results WHERE n=3;
SELECT extensions.lives_ok($q$SELECT plugin_data.csf_withdraw_point_submission_request('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=3),'ec000000-0000-4000-8000-000000000001','ec700000-0000-4000-8000-000000000023')$q$,'member can withdraw an unreviewed exception');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE organization_id='ec100000-0000-4000-8000-000000000001'),1,'correction and withdrawal create no additional credits');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_begin_point_exception_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid,jsonb)','execute'),'browser roles cannot invoke exception intake directly');
SELECT extensions.ok(NOT has_function_privilege('service_role','plugin_data.csf_review_point_exception(uuid,uuid,text,numeric,text,uuid,text)','execute'),'service callers cannot bypass explicit review receipts');

SELECT extensions.throws_ok($q$UPDATE plugin_data.csf_credit_records SET points=1 WHERE submission_id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=1)$q$,'55000',NULL,'approved exception credit cannot change without the review fence');
SELECT extensions.throws_ok($q$INSERT INTO plugin_data.csf_credit_records(organization_id,profile_id,term_id,submission_id,source,points,point_type,status,verified_by,verified_at) VALUES('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2),'submission',2,'non_drive','verified','ec000000-0000-4000-8000-000000000002',now())$q$,'55000',NULL,'direct verified credit insertion cannot bypass explicit review');
SELECT extensions.throws_ok($q$INSERT INTO plugin_data.csf_point_submissions(organization_id,profile_id,term_id,source,description,claimed_points,point_type,activity_date,request_kind,status,reviewed_by,reviewed_at) VALUES('ec100000-0000-4000-8000-000000000001','ec400000-0000-4000-8000-000000000001','ec300000-0000-4000-8000-000000000001','student','Fictional bypass attempt',2,'non_drive','2099-09-01','exception','approved','ec000000-0000-4000-8000-000000000002',now())$q$,'55000',NULL,'direct approved exception insertion is refused');
SELECT extensions.throws_ok($q$UPDATE plugin_data.csf_point_submissions SET description=NULL WHERE id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2)$q$,'23514',NULL,'exception explanation cannot become null');
SELECT extensions.throws_ok($q$UPDATE plugin_data.csf_point_submissions SET activity_date=NULL WHERE id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2)$q$,'23514',NULL,'exception date cannot become null');
SELECT plugin_data.csf_review_point_submission_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2),'rejected',NULL,'Officer rejected the fictional exception','ec000000-0000-4000-8000-000000000002','ec700000-0000-4000-8000-000000000031');
INSERT INTO results SELECT 4,plugin_data.csf_submit_point_appeal_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2),'Please reconsider this fictional exception',2,'ec000000-0000-4000-8000-000000000001','ec700000-0000-4000-8000-000000000032');
SAVEPOINT allowed_outside_appeal;
UPDATE plugin_data.csf_term_policies SET outside_volunteering_allowed=true WHERE organization_id='ec100000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok($q$SELECT plugin_data.csf_review_point_appeal_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'appealId')::uuid FROM results WHERE n=4),'approved','Ordinary appeal must not replace exception review','ec000000-0000-4000-8000-000000000003','ec700000-0000-4000-8000-000000000033')$q$,'55000',NULL,'ordinary appeal approval cannot award exception credits even when outside policy permits');
ROLLBACK TO allowed_outside_appeal;
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE organization_id='ec100000-0000-4000-8000-000000000001'),1,'all refused bypasses leave the existing credit unchanged');
CREATE FUNCTION pg_temp.review_exception_appeal(points numeric, kind text, request_suffix text DEFAULT '040', actor_suffix text DEFAULT '003') RETURNS jsonb LANGUAGE sql AS $$
SELECT plugin_data.csf_review_point_exception_appeal_request('ec100000-0000-4000-8000-000000000001',(SELECT (result->>'appealId')::uuid FROM results WHERE n=4),'approved','Reviewed the appeal evidence and authorized an exception',('ec000000-0000-4000-8000-000000000'||actor_suffix)::uuid,('ec700000-0000-4000-8000-000000000'||request_suffix)::uuid,points,kind); $$;
SELECT extensions.throws_ok($q$SELECT pg_temp.review_exception_appeal(NULL,'drive')$q$,'P0001',NULL,'exception appeal requires an explicit award');
SELECT extensions.throws_ok($q$SELECT pg_temp.review_exception_appeal(2,NULL)$q$,'P0001',NULL,'exception appeal requires an explicit category');
SELECT extensions.throws_ok($q$SELECT pg_temp.review_exception_appeal(4,'drive')$q$,'P0001',NULL,'exception appeal preserves the published activity cap');
SELECT extensions.throws_ok($q$SELECT pg_temp.review_exception_appeal(2,'drive','040','001')$q$,'P0001',NULL,'member cannot approve an exception appeal');
SELECT extensions.lives_ok($q$SELECT pg_temp.review_exception_appeal(1,'drive')$q$,'authorized processor can approve a rejected exception appeal');
SELECT extensions.is((SELECT points FROM plugin_data.csf_credit_records WHERE submission_id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2)),1::numeric,'appeal uses the officer award instead of the requested amount');
SELECT extensions.is((SELECT point_type FROM plugin_data.csf_credit_records WHERE submission_id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2)),'drive','appeal uses the officer awarded category');
SELECT extensions.lives_ok($q$SELECT pg_temp.review_exception_appeal(1,'drive')$q$,'exception appeal receipt retries without duplicate credit');
SELECT extensions.throws_ok($q$SELECT pg_temp.review_exception_appeal(2,'drive')$q$,'P0001',NULL,'appeal retry cannot change the explicit award');
SELECT extensions.is((SELECT count(*)::integer FROM plugin_data.csf_credit_records WHERE submission_id=(SELECT (result->>'submissionId')::uuid FROM results WHERE n=2)),1,'appeal approval creates exactly one credit');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_review_point_exception_appeal_request(uuid,uuid,text,text,uuid,uuid,numeric,text)','execute'),'browser cannot call exception appeal review directly');
SELECT * FROM extensions.finish();
ROLLBACK;
