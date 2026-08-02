BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(42);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_acknowledge_partner_representative(uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_request_partner_representative_correction(uuid,uuid,uuid,text,text,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)') IS NOT NULL,
  'all four atomic partner-representative operations exist'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)',
      'plugin_data.csf_acknowledge_partner_representative(uuid,uuid,uuid,uuid)',
      'plugin_data.csf_request_partner_representative_correction(uuid,uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)'
    ]) AS operation(signature)
    CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated']) AS client(role_name)
    WHERE has_function_privilege(client.role_name::name, operation.signature, 'EXECUTE')
  ),
  'no client role can invoke partner-representative capability mutations'
);
SELECT extensions.ok(
  (
    SELECT bool_and(has_function_privilege('service_role', operation.signature, 'EXECUTE'))
    FROM unnest(ARRAY[
      'plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)',
      'plugin_data.csf_acknowledge_partner_representative(uuid,uuid,uuid,uuid)',
      'plugin_data.csf_request_partner_representative_correction(uuid,uuid,uuid,text,text,uuid,uuid)',
      'plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)'
    ]) AS operation(signature)
  ),
  'service_role can invoke every atomic partner-representative operation'
);
SELECT extensions.ok(
  (
    SELECT bool_and(proc.prosecdef AND proc.proconfig @> ARRAY['search_path=""']::text[])
    FROM pg_proc AS proc
    WHERE proc.oid IN (
      'plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)'::regprocedure,
      'plugin_data.csf_acknowledge_partner_representative(uuid,uuid,uuid,uuid)'::regprocedure,
      'plugin_data.csf_request_partner_representative_correction(uuid,uuid,uuid,text,text,uuid,uuid)'::regprocedure,
      'plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
    )
  ),
  'every privileged operation is SECURITY DEFINER with an empty search path'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_assign_partner_representative(uuid,uuid,text,text,text,date,boolean,uuid,uuid)'::regprocedure)
    LIKE '%csf_actor_has_permission%manage_partner_clubs%'
  AND pg_get_functiondef('plugin_data.csf_revoke_partner_representative(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure)
    LIKE '%csf_actor_has_permission%manage_partner_clubs%',
  'staff assignment and revocation recheck the exact database permission'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_acknowledge_partner_representative(uuid,uuid,uuid,uuid)'::regprocedure)
    LIKE '%auth.users%email_confirmed_at%normalized_email%',
  'acknowledgment rechecks verified auth email before binding an invited assignment'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('bd000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'partner-admin@local.test', now(), '{}', '{}', now(), now()),
  ('bd000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'partner-rep@local.test', now(), '{}', '{}', now(), now()),
  ('bd000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'wrong-rep@local.test', now(), '{}', '{}', now(), now()),
  ('bd000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'second-rep@local.test', now(), '{}', '{}', now(), now()),
  ('bd000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'other-admin@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'Representative Workflow One', 'representative-workflow-one', 'school', '991201'),
  ('bd100000-0000-4000-8000-000000000002', 'Representative Workflow Two', 'representative-workflow-two', 'school', '991202');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('bd100000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('bd100000-0000-4000-8000-000000000002', 'bd000000-0000-4000-8000-000000000005', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('bd200000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001', 'F37', 'Fall 2037', '2037-2038', 'fall', 'open', true),
  ('bd200000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000002', 'F37', 'Fall 2037', '2037-2038', 'fall', 'open', true);

INSERT INTO plugin_data.csf_partner_clubs (id, organization_id, name, status)
VALUES
  ('bd300000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001', 'Robotics', 'active'),
  ('bd300000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000002', 'Key Club', 'active');

INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id, relationship_status,
  workflow_status, approved_point_types, non_drive_points, drive_points,
  proof_required
) VALUES
  ('bd400000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-000000000001', 'bd300000-0000-4000-8000-000000000001', 'bd200000-0000-4000-8000-000000000001', 'new', 'active', ARRAY['non_drive']::text[], 2, 0, true),
  ('bd400000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-000000000002', 'bd300000-0000-4000-8000-000000000002', 'bd200000-0000-4000-8000-000000000002', 'new', 'active', ARRAY['drive']::text[], 0, 2, true);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assign_partner_representative(
    'bd100000-0000-4000-8000-000000000001', 'bd400000-0000-4000-8000-000000000001',
    'Unauthorized Rep', 'unauthorized@local.test', 'other',
    (now() AT TIME ZONE 'America/Los_Angeles')::date, false,
    'bd900000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000003'
  )$$,
  'P0001', 'Not authorized to manage CSF partner clubs.',
  'an ordinary authenticated account cannot assign representative access'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assign_partner_representative(
    'bd100000-0000-4000-8000-000000000001', 'bd400000-0000-4000-8000-000000000002',
    'Cross Tenant Rep', 'cross@local.test', 'other',
    (now() AT TIME ZONE 'America/Los_Angeles')::date, false,
    'bd900000-0000-4000-8000-000000000002', 'bd000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'That active club semester is not available in this organization.',
  'an authorized manager cannot assign access to another organization club semester'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_assign_partner_representative(
    'bd100000-0000-4000-8000-000000000001', 'bd400000-0000-4000-8000-000000000001',
    'Partner Representative', 'partner-rep@local.test', 'president',
    (now() AT TIME ZONE 'America/Los_Angeles')::date, true,
    'bd900000-0000-4000-8000-000000000003', 'bd000000-0000-4000-8000-000000000001'
  )$$,
  'an authorized manager atomically creates representative access'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_representatives WHERE organization_id = 'bd100000-0000-4000-8000-000000000001' AND normalized_email = 'partner-rep@local.test'),
  1, 'assignment creation writes one exact tenant and club-semester row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE organization_id = 'bd100000-0000-4000-8000-000000000001' AND idempotency_key = 'representative:assignment-request:bd900000-0000-4000-8000-000000000003'),
  1, 'assignment creation writes its immutable lifecycle receipt in the same operation'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE organization_id = 'bd100000-0000-4000-8000-000000000001' AND action = 'partner_representative.assign'),
  1, 'assignment creation also writes staff audit evidence'
);
SELECT extensions.is(
  (plugin_data.csf_assign_partner_representative(
    'bd100000-0000-4000-8000-000000000001', 'bd400000-0000-4000-8000-000000000001',
    'Partner Representative', 'partner-rep@local.test', 'president',
    (now() AT TIME ZONE 'America/Los_Angeles')::date, true,
    'bd900000-0000-4000-8000-000000000003', 'bd000000-0000-4000-8000-000000000001'
  ) ->> 'idempotent'),
  'true', 'an exact assignment request replay returns the committed result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_representatives WHERE organization_id = 'bd100000-0000-4000-8000-000000000001' AND normalized_email = 'partner-rep@local.test'),
  1, 'assignment replay does not duplicate access'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE organization_id = 'bd100000-0000-4000-8000-000000000001' AND idempotency_key = 'representative:assignment-request:bd900000-0000-4000-8000-000000000003'),
  1, 'assignment replay does not duplicate its receipt'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_assign_partner_representative(
    'bd100000-0000-4000-8000-000000000001', 'bd400000-0000-4000-8000-000000000001',
    'Changed Representative', 'changed@local.test', 'other',
    (now() AT TIME ZONE 'America/Los_Angeles')::date, false,
    'bd900000-0000-4000-8000-000000000003', 'bd000000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'That assignment request identifier is already bound to different access.',
  'an assignment request identifier cannot be reused for a different payload'
);
SELECT extensions.is(
  (SELECT display_name FROM plugin_data.csf_partner_club_representatives WHERE organization_id = 'bd100000-0000-4000-8000-000000000001' AND normalized_email = 'partner-rep@local.test'),
  'Partner Representative', 'a conflicting replay leaves the committed assignment unchanged'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_acknowledge_partner_representative(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'bd000000-0000-4000-8000-000000000003'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')
  ),
  'P0001', 'Use the verified email address that received this representative assignment.',
  'a different verified email cannot claim an invitation'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test'),
  'invited', 'a rejected acknowledgment leaves access invited'
);
SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_acknowledge_partner_representative(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'bd000000-0000-4000-8000-000000000002'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')
  ),
  'the invited verified email atomically binds and acknowledges access'
);
SELECT extensions.ok(
  (SELECT status = 'active' AND user_id = 'bd000000-0000-4000-8000-000000000002' FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test'),
  'acknowledgment makes access active only for the verified account'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE idempotency_key LIKE 'representative:%:acknowledgment:v1' AND actor_user_id = 'bd000000-0000-4000-8000-000000000002'),
  1, 'activation and its acknowledgment receipt commit together'
);
SELECT extensions.is(
  (plugin_data.csf_acknowledge_partner_representative(
    'bd100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test'),
    'bd400000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000002'
  ) ->> 'idempotent'),
  'true', 'acknowledgment replay returns the existing receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE idempotency_key LIKE 'representative:%:acknowledgment:v1' AND actor_user_id = 'bd000000-0000-4000-8000-000000000002'),
  1, 'acknowledgment replay cannot duplicate its receipt'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_request_partner_representative_correction(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'standing', 'The standing should be reviewed again.', 'bd900000-0000-4000-8000-000000000004',
      'bd000000-0000-4000-8000-000000000003'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')
  ),
  'P0001', 'Active representative access is required to request a correction.',
  'another account cannot request a correction for the assignment'
);
SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_request_partner_representative_correction(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'standing', 'The standing should be reviewed again.', 'bd900000-0000-4000-8000-000000000004',
      'bd000000-0000-4000-8000-000000000002'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')
  ),
  'the bound representative can atomically record a correction request'
);
SELECT extensions.is(
  (plugin_data.csf_request_partner_representative_correction(
    'bd100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test'),
    'bd400000-0000-4000-8000-000000000001', 'standing',
    'The standing should be reviewed again.', 'bd900000-0000-4000-8000-000000000004',
    'bd000000-0000-4000-8000-000000000002'
  ) ->> 'idempotent'),
  'true', 'correction replay returns the existing event'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE idempotency_key LIKE 'representative:%:correction:bd900000-0000-4000-8000-000000000004'),
  1, 'correction replay cannot duplicate club history'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_request_partner_representative_correction(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'standing', 'A different correction reason must not replay.', 'bd900000-0000-4000-8000-000000000004',
      'bd000000-0000-4000-8000-000000000002'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')
  ),
  'P0001', 'The correction request key is already bound to unrelated history.',
  'a correction request identifier cannot be reused for a different reason'
);

SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_revoke_partner_representative(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'This access is no longer needed.', 'bd900000-0000-4000-8000-000000000006',
      'bd000000-0000-4000-8000-000000000003'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')
  ),
  'P0001', 'Not authorized to manage CSF partner clubs.',
  'an ordinary account cannot revoke representative access'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test'),
  'active', 'an unauthorized revocation leaves access active'
);
SELECT extensions.lives_ok(
  format(
    $$SELECT plugin_data.csf_revoke_partner_representative(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'The representative role has ended.', 'bd900000-0000-4000-8000-000000000007',
      'bd000000-0000-4000-8000-000000000001'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')
  ),
  'an authorized manager atomically revokes representative access'
);
SELECT extensions.ok(
  (SELECT status = 'revoked' AND effective_end IS NOT NULL FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test'),
  'revocation closes the exact assignment capability'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE metadata ->> 'representativeAction' = 'revoked' AND metadata ->> 'representativeId' = (SELECT id::text FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')),
  1, 'revocation writes one immutable club-history event'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE action = 'partner_representative.revoke' AND target_id = (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')),
  1, 'revocation writes one staff audit receipt'
);
SELECT extensions.is(
  (plugin_data.csf_revoke_partner_representative(
    'bd100000-0000-4000-8000-000000000001',
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test'),
    'bd400000-0000-4000-8000-000000000001', 'The representative role has ended.',
    'bd900000-0000-4000-8000-000000000007',
    'bd000000-0000-4000-8000-000000000001'
  ) ->> 'idempotent'),
  'true', 'revocation replay returns the existing receipt'
);
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_revoke_partner_representative(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'A conflicting reason must not be accepted.', 'bd900000-0000-4000-8000-000000000007',
      'bd000000-0000-4000-8000-000000000001'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')
  ),
  'P0001', 'That revocation request identifier is already bound to a different change.',
  'a revocation request identifier cannot be reused for a different semantic payload'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_partner_club_term_events
    WHERE organization_id = 'bd100000-0000-4000-8000-000000000001'
      AND idempotency_key = 'representative:revocation-request:bd900000-0000-4000-8000-000000000007'
      AND correlation_id = 'bd900000-0000-4000-8000-000000000007'
      AND metadata ->> 'requestId' = 'bd900000-0000-4000-8000-000000000007'
  ),
  'revocation binds its immutable receipt and correlation to the stable request identifier'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE metadata ->> 'representativeAction' = 'revoked' AND metadata ->> 'representativeId' = (SELECT id::text FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'partner-rep@local.test')),
  1, 'revocation replay cannot duplicate history'
);

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_assign_partner_representative(
    'bd100000-0000-4000-8000-000000000001', 'bd400000-0000-4000-8000-000000000001',
    'Second Representative', 'second-rep@local.test', 'coordinator',
    (now() AT TIME ZONE 'America/Los_Angeles')::date, false,
    'bd900000-0000-4000-8000-000000000005', 'bd000000-0000-4000-8000-000000000001'
  )$$,
  'a second invitation is available for rollback testing'
);
INSERT INTO plugin_data.csf_partner_club_term_events (
  organization_id, partner_club_term_id, event_type, actor_user_id,
  metadata, idempotency_key
)
SELECT
  representative.organization_id,
  representative.partner_club_term_id,
  'decision_recorded',
  'bd000000-0000-4000-8000-000000000004',
  jsonb_build_object('representativeId', representative.id),
  'representative:' || representative.id::text || ':acknowledgment:v1'
FROM plugin_data.csf_partner_club_representatives AS representative
WHERE representative.normalized_email = 'second-rep@local.test';
SELECT extensions.throws_ok(
  format(
    $$SELECT plugin_data.csf_acknowledge_partner_representative(
      'bd100000-0000-4000-8000-000000000001', %L, 'bd400000-0000-4000-8000-000000000001',
      'bd000000-0000-4000-8000-000000000004'
    )$$,
    (SELECT id FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'second-rep@local.test')
  ),
  'P0001', 'The acknowledgment receipt key is already bound to unrelated history.',
  'an unrelated receipt collision aborts acknowledgment'
);
SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_partner_club_representatives WHERE normalized_email = 'second-rep@local.test'),
  'invited', 'a failed receipt write can never leave representative access active'
);

SELECT * FROM extensions.finish();
ROLLBACK;
