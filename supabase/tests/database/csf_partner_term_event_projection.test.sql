BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(16);

SELECT extensions.ok(
  to_regprocedure('plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)') IS NOT NULL,
  'the atomic partner-club standing projection operation exists'
);
SELECT extensions.ok(
  NOT has_function_privilege('public', 'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)', 'EXECUTE'),
  'only service_role can invoke the standing mutation'
);
SELECT extensions.ok(
  pg_get_functiondef('plugin_data.csf_set_partner_club_term_status(uuid,uuid,text,text,uuid,uuid)'::regprocedure)
    LIKE '%csf_actor_has_permission%manage_partner_clubs%',
  'the database operation rechecks the exact human permission'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('be000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'club-admin@local.test', now(), '{}', '{}', now(), now()),
  ('be000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ordinary@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('be100000-0000-4000-8000-000000000001', 'Club Event Projection', 'club-event-projection', 'school', '991211'),
  ('be100000-0000-4000-8000-000000000002', 'Other Club Event Projection', 'other-club-event-projection', 'school', '991212');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('be100000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001', 'admin', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, lifecycle_status, is_current
) VALUES
  ('be200000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-000000000001', 'F38', 'Fall 2038', '2038-2039', 'fall', 'open', true),
  ('be200000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-000000000002', 'F38', 'Fall 2038', '2038-2039', 'fall', 'open', true);

INSERT INTO plugin_data.csf_partner_clubs (id, organization_id, name, status)
VALUES
  ('be300000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-000000000001', 'Science Club', 'active'),
  ('be300000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-000000000002', 'Other Science Club', 'active');

INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id, relationship_status,
  workflow_status, approved_point_types, non_drive_points, drive_points, proof_required
) VALUES
  ('be400000-0000-4000-8000-000000000001', 'be100000-0000-4000-8000-000000000001', 'be300000-0000-4000-8000-000000000001', 'be200000-0000-4000-8000-000000000001', 'new', 'active', ARRAY['non_drive']::text[], 2, 0, true),
  ('be400000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-000000000002', 'be300000-0000-4000-8000-000000000002', 'be200000-0000-4000-8000-000000000002', 'new', 'active', ARRAY['non_drive']::text[], 2, 0, true);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_partner_club_term_status(
    'be100000-0000-4000-8000-000000000001', 'be400000-0000-4000-8000-000000000001',
    'inactive', 'Unauthorized attempt.', 'be000000-0000-4000-8000-000000000002',
    'be900000-0000-4000-8000-000000000001'
  )$$,
  'P0001', 'Not authorized to manage CSF partner clubs.',
  'an ordinary user cannot change club standing'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_partner_club_term_status(
    'be100000-0000-4000-8000-000000000001', 'be400000-0000-4000-8000-000000000002',
    'inactive', 'Cross-tenant attempt.', 'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000002'
  )$$,
  'P0001', 'Partner-club semester record not found.',
  'an authorized manager cannot change another organization record'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_set_partner_club_term_status(
    'be100000-0000-4000-8000-000000000001', 'be400000-0000-4000-8000-000000000001',
    'inactive', 'Semester standing was suspended after review.', 'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000003'
  )$$,
  'an authorized manager changes the projection and receipts atomically'
);
SELECT extensions.is(
  (SELECT workflow_status FROM plugin_data.csf_partner_club_terms WHERE id = 'be400000-0000-4000-8000-000000000001'),
  'inactive', 'the current standing projection changes'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE idempotency_key = 'standing-request:be900000-0000-4000-8000-000000000003'),
  1, 'the standing transition writes one immutable lifecycle receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000003'),
  1, 'the same transition writes one staff audit receipt'
);
SELECT extensions.is(
  (plugin_data.csf_set_partner_club_term_status(
    'be100000-0000-4000-8000-000000000001', 'be400000-0000-4000-8000-000000000001',
    'inactive', 'Semester standing was suspended after review.', 'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000003'
  ) ->> 'idempotent'),
  'true', 'an exact request replay returns the committed outcome'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_partner_club_term_events WHERE idempotency_key = 'standing-request:be900000-0000-4000-8000-000000000003'),
  1, 'request replay cannot duplicate lifecycle history'
);
SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_set_partner_club_term_status(
    'be100000-0000-4000-8000-000000000001', 'be400000-0000-4000-8000-000000000001',
    'active', 'Conflicting replay.', 'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000003'
  )$$,
  'P0001', 'That partner-club standing request identifier is already bound to a different change.',
  'a request identifier cannot be rebound to a different standing change'
);
SELECT extensions.is(
  (SELECT workflow_status FROM plugin_data.csf_partner_club_terms WHERE id = 'be400000-0000-4000-8000-000000000001'),
  'inactive', 'a conflicting replay leaves the projection unchanged'
);
SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_set_partner_club_term_status(
    'be100000-0000-4000-8000-000000000001', 'be400000-0000-4000-8000-000000000001',
    'inactive', 'A new review confirmed the same standing.', 'be000000-0000-4000-8000-000000000001',
    'be900000-0000-4000-8000-000000000004'
  )$$,
  'a new no-op request records a replay boundary without rewriting state'
);
SELECT extensions.is(
  (SELECT (metadata ->> 'changed')::boolean FROM plugin_data.csf_partner_club_term_events WHERE idempotency_key = 'standing-request:be900000-0000-4000-8000-000000000004'),
  false, 'the no-op receipt explicitly records that the projection did not change'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'be900000-0000-4000-8000-000000000004'),
  0, 'a no-op request does not invent a staff mutation audit event'
);

SELECT * FROM extensions.finish();
ROLLBACK;
