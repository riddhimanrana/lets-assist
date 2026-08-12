-- Verified certificates are unforgeable from the browser.
--
-- The baseline INSERT/UPDATE/DELETE policies on public.certificates each ended
-- in `(type = 'verified' AND auth.uid() = creator_id)`, a branch an
-- authenticated caller satisfies by choosing the values it writes. This test
-- drives the table as the real `authenticated` role with a real
-- request.jwt.claim.sub and proves the forgery, the cross-project signup
-- poisoning it enabled against certificates_verified_signup_unique, and the
-- collateral write paths (TRUNCATE, anon grants, type/ownership promotion by
-- UPDATE) are all refused -- while the self-reported owner flow and the
-- canonical organizer publication RPC still work.
--
-- All fixtures are synthetic and roll back with this test.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ce000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'cert-organizer@local.test', now(), '{}', '{"full_name":"Cert Organizer"}',
   now(), now()),
  ('ce000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'cert-staff@local.test', now(), '{}', '{"full_name":"Cert Staff"}',
   now(), now()),
  ('ce000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'cert-victim@local.test', now(), '{}', '{"full_name":"Cert Victim"}',
   now(), now()),
  ('ce000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'cert-attacker@local.test', now(), '{}', '{"full_name":"Cert Attacker"}',
   now(), now());

UPDATE public.profiles
SET full_name = CASE id
  WHEN 'ce000000-0000-4000-8000-000000000001' THEN 'Cert Organizer'
  WHEN 'ce000000-0000-4000-8000-000000000002' THEN 'Cert Staff'
  WHEN 'ce000000-0000-4000-8000-000000000003' THEN 'Cert Victim'
  ELSE 'Cert Attacker'
END
WHERE id::text LIKE 'ce000000-0000-4000-8000-00000000000%';

INSERT INTO public.organizations (id, name, username, type, join_code, verified)
VALUES ('ce100000-0000-4000-8000-000000000001', 'Synthetic Certificate Org',
        'synthetic-certificate-org', 'nonprofit', '860011', true);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('ce100000-0000-4000-8000-000000000001',
        'ce000000-0000-4000-8000-000000000002', 'staff', 'active');

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, organization_id,
  can_be_managed_by_staff
)
VALUES
  ('ce200000-0000-4000-8000-000000000001',
   'ce000000-0000-4000-8000-000000000001',
   'Certificate Forgery Project', 'Local', 'Synthetic forgery fixture',
   'oneTime', 'manual',
   '{"oneTime":{"date":"2030-09-01","startTime":"09:00","endTime":"12:00","volunteers":20}}',
   true, 'ce100000-0000-4000-8000-000000000001', true),
  ('ce200000-0000-4000-8000-000000000002',
   'ce000000-0000-4000-8000-000000000001',
   'Certificate Publication Project', 'Local', 'Synthetic publication fixture',
   'oneTime', 'manual',
   '{"oneTime":{"date":"2030-09-02","startTime":"09:00","endTime":"12:00","volunteers":20}}',
   true, 'ce100000-0000-4000-8000-000000000001', true),
  ('ce200000-0000-4000-8000-000000000003',
   'ce000000-0000-4000-8000-000000000001',
   'Certificate Poisoning Project', 'Local', 'Synthetic poisoning fixture',
   'oneTime', 'manual',
   '{"oneTime":{"date":"2030-09-04","startTime":"09:00","endTime":"12:00","volunteers":20}}',
   true, 'ce100000-0000-4000-8000-000000000001', true);

INSERT INTO public.project_signups (id, project_id, user_id, schedule_id, status)
VALUES
  ('ce300000-0000-4000-8000-000000000001',
   'ce200000-0000-4000-8000-000000000001',
   'ce000000-0000-4000-8000-000000000003', 'oneTime', 'attended'),
  ('ce300000-0000-4000-8000-000000000002',
   'ce200000-0000-4000-8000-000000000002',
   'ce000000-0000-4000-8000-000000000003', 'oneTime', 'attended'),
  ('ce300000-0000-4000-8000-000000000003',
   'ce200000-0000-4000-8000-000000000003',
   'ce000000-0000-4000-8000-000000000003', 'oneTime', 'attended');

-- A genuine organizer-issued certificate the attacker must not be able to
-- touch. Written here with owner privileges, exactly as the SECURITY DEFINER
-- publication path writes it.
INSERT INTO public.certificates (
  id, project_id, user_id, signup_id, volunteer_name, volunteer_email,
  project_title, event_start, event_end, is_certified, creator_id, type,
  check_in_method
)
VALUES (
  'ce400000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000003',
  'ce300000-0000-4000-8000-000000000001',
  'Cert Victim', 'cert-victim@local.test',
  'Certificate Forgery Project',
  '2030-09-01T16:00:00Z', '2030-09-01T19:00:00Z',
  true, 'ce000000-0000-4000-8000-000000000001', 'verified', 'manual'
);

-- ---------------------------------------------------------------------------
-- Contract: grants and the canonical organizer entry point
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.certificates', 'TRUNCATE'),
  'authenticated cannot TRUNCATE certificates, which no policy would have stopped'
);

SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.certificates', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.certificates', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.certificates', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.certificates', 'TRUNCATE'),
  'the public anon key carries no write privilege on certificates'
);

SELECT extensions.ok(
  has_table_privilege('authenticated', 'public.certificates', 'SELECT')
    AND has_table_privilege('authenticated', 'public.certificates', 'INSERT')
    AND has_table_privilege('authenticated', 'public.certificates', 'UPDATE')
    AND has_table_privilege('authenticated', 'public.certificates', 'DELETE'),
  'the self-reported owner flow keeps the table privileges it needs'
);

SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'certificates'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) LIKE '%verified%'
  ),
  'no certificate write policy still admits a caller-declared verified type'
);

SELECT extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.publish_volunteer_hours_transactional(uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'the canonical organizer publication RPC keeps its authenticated EXECUTE grant'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS indexes
    JOIN pg_class AS relations ON relations.oid = indexes.indexrelid
    WHERE relations.relname = 'certificates_verified_signup_unique'
      AND indexes.indisunique
      AND indexes.indpred IS NOT NULL
  ),
  'verified certificates remain unique per signup'
);

-- ---------------------------------------------------------------------------
-- The forgery itself, driven as the real authenticated role
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'ce000000-0000-4000-8000-000000000004';
SET LOCAL "request.jwt.claims" =
  '{"sub":"ce000000-0000-4000-8000-000000000004","role":"authenticated"}';

SELECT extensions.is(
  (SELECT auth.uid()),
  'ce000000-0000-4000-8000-000000000004'::uuid,
  'the session really is the attacker, not a privileged test role'
);

SELECT extensions.ok(
  NOT (SELECT public.is_super_admin()),
  'the attacker cannot self-assert the super-admin escape hatch'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.certificates (
      project_title, is_certified, event_start, event_end, check_in_method,
      user_id, creator_id, type, organization_name, volunteer_name
    )
    VALUES ('Totally Real Volunteering', true,
            '2030-09-01T16:00:00Z', '2030-09-01T22:00:00Z', 'qr-code',
            'ce000000-0000-4000-8000-000000000004',
            'ce000000-0000-4000-8000-000000000004',
            'verified', 'Synthetic Certificate Org', 'Cert Attacker')
  $$,
  '42501',
  NULL,
  'an authenticated user cannot mint a verified certificate for themselves'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.certificates (
      project_title, is_certified, event_start, event_end, check_in_method,
      user_id, creator_id, type, signup_id, project_id
    )
    VALUES ('Squatted Session', true,
            '2030-09-02T16:00:00Z', '2030-09-02T19:00:00Z', 'manual',
            'ce000000-0000-4000-8000-000000000004',
            'ce000000-0000-4000-8000-000000000004',
            'verified',
            'ce300000-0000-4000-8000-000000000002',
            'ce200000-0000-4000-8000-000000000002')
  $$,
  '42501',
  NULL,
  'an authenticated user cannot squat a verified certificate on another project signup'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.certificates (
      project_title, is_certified, event_start, event_end, check_in_method,
      user_id, creator_id, type, signup_id
    )
    VALUES ('Self Report With A Signup', false,
            '2030-09-02T16:00:00Z', '2030-09-02T19:00:00Z', 'self_report',
            'ce000000-0000-4000-8000-000000000004',
            'ce000000-0000-4000-8000-000000000004',
            'self-reported',
            'ce300000-0000-4000-8000-000000000002')
  $$,
  '42501',
  NULL,
  'a self-reported certificate cannot attach itself to someone else''s signup'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.certificates (
      project_title, is_certified, event_start, event_end, check_in_method,
      user_id, creator_id, type, project_id
    )
    VALUES ('Self Report With A Project', false,
            '2030-09-01T16:00:00Z', '2030-09-01T19:00:00Z', 'self_report',
            'ce000000-0000-4000-8000-000000000004',
            'ce000000-0000-4000-8000-000000000004',
            'self-reported',
            'ce200000-0000-4000-8000-000000000001')
  $$,
  '42501',
  NULL,
  'a self-reported certificate cannot inject itself into a project report'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.certificates (
      project_title, is_certified, event_start, event_end, check_in_method,
      user_id, creator_id, type
    )
    VALUES ('Self Certified Hours', true,
            '2030-09-01T16:00:00Z', '2030-09-01T19:00:00Z', 'self_report',
            'ce000000-0000-4000-8000-000000000004',
            'ce000000-0000-4000-8000-000000000004',
            'self-reported')
  $$,
  '42501',
  NULL,
  'a self-reported certificate cannot claim platform certification'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.certificates (
      project_title, is_certified, event_start, event_end, check_in_method,
      user_id, creator_id, type
    )
    VALUES ('Scanned In, Honest', false,
            '2030-09-01T16:00:00Z', '2030-09-01T19:00:00Z', 'qr-code',
            'ce000000-0000-4000-8000-000000000004',
            'ce000000-0000-4000-8000-000000000004',
            'self-reported')
  $$,
  '42501',
  NULL,
  'a self-reported certificate cannot claim a stronger check-in method'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.certificates (
      project_title, is_certified, event_start, event_end, check_in_method,
      user_id, creator_id, type
    )
    VALUES ('Hours For Somebody Else', false,
            '2030-09-01T16:00:00Z', '2030-09-01T19:00:00Z', 'self_report',
            'ce000000-0000-4000-8000-000000000003',
            'ce000000-0000-4000-8000-000000000004',
            'self-reported')
  $$,
  '42501',
  NULL,
  'a self-reported certificate cannot be filed against another volunteer'
);

-- The legitimate owner flow, exactly as app/api/self-reported-hours/route.ts
-- writes it.
INSERT INTO public.certificates (
  id, project_id, user_id, signup_id, volunteer_name, volunteer_email,
  project_title, event_start, event_end, organization_name, creator_name,
  is_certified, creator_id, check_in_method, schedule_id, type, description
)
VALUES (
  'ce400000-0000-4000-8000-000000000002',
  NULL, 'ce000000-0000-4000-8000-000000000004', NULL,
  'Cert Attacker', 'cert-attacker@local.test',
  'Beach Cleanup I Did Myself',
  '2030-09-03T16:00:00Z', '2030-09-03T19:00:00Z',
  'Some Neighborhood Group', 'A Neighbor',
  false, 'ce000000-0000-4000-8000-000000000004', 'self_report', NULL,
  'self-reported', 'Picked up litter.'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.certificates
   WHERE id = 'ce400000-0000-4000-8000-000000000002'),
  1::bigint,
  'a volunteer can still file self-reported hours for themselves'
);

-- ---------------------------------------------------------------------------
-- UPDATE: the type and ownership boundaries are immutable in both directions
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    UPDATE public.certificates SET type = 'verified', is_certified = true
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'an owned self-reported certificate cannot be promoted to verified'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.certificates SET is_certified = true
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'an owned self-reported certificate cannot certify itself'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.certificates
    SET user_id = 'ce000000-0000-4000-8000-000000000003'
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'an owned self-reported certificate cannot be pushed onto another volunteer'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.certificates
    SET signup_id = 'ce300000-0000-4000-8000-000000000002',
        project_id = 'ce200000-0000-4000-8000-000000000002'
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'an owned self-reported certificate cannot be attached to a project signup later'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.certificates SET check_in_method = 'qr-code'
    WHERE id = 'ce400000-0000-4000-8000-000000000002'
  $$,
  '42501',
  NULL,
  'an owned self-reported certificate cannot upgrade its check-in method'
);

UPDATE public.certificates
SET description = 'Picked up litter for three hours.'
WHERE id = 'ce400000-0000-4000-8000-000000000002';

SELECT extensions.is(
  (SELECT description FROM public.certificates
   WHERE id = 'ce400000-0000-4000-8000-000000000002'),
  'Picked up litter for three hours.',
  'a volunteer can still correct the free text of their own self-reported hours'
);

-- Someone else's verified certificate: USING never matches, so these are
-- silent no-ops rather than errors. Assert the rows, not the error code.
WITH attempted AS (
  UPDATE public.certificates
  SET creator_id = 'ce000000-0000-4000-8000-000000000004',
      event_end = '2030-09-01T23:59:00Z'
  WHERE id = 'ce400000-0000-4000-8000-000000000001'
  RETURNING 1
)
SELECT extensions.is(
  (SELECT count(*) FROM attempted),
  0::bigint,
  'an attacker cannot rewrite another volunteer''s verified certificate'
);

WITH attempted AS (
  DELETE FROM public.certificates
  WHERE id = 'ce400000-0000-4000-8000-000000000001'
  RETURNING 1
)
SELECT extensions.is(
  (SELECT count(*) FROM attempted),
  0::bigint,
  'an attacker cannot delete another volunteer''s verified certificate'
);

SELECT extensions.throws_ok(
  $$ TRUNCATE public.certificates $$,
  '42501',
  NULL,
  'an authenticated caller cannot wipe the certificate table outright'
);

-- A volunteer still owns the exit from their own self-report.
DELETE FROM public.certificates
WHERE id = 'ce400000-0000-4000-8000-000000000002';

SELECT extensions.is(
  (SELECT count(*) FROM public.certificates
   WHERE id = 'ce400000-0000-4000-8000-000000000002'),
  0::bigint,
  'a volunteer can still delete their own self-reported hours'
);

RESET ROLE;

SELECT extensions.is(
  (SELECT count(*) FROM public.certificates
   WHERE creator_id = 'ce000000-0000-4000-8000-000000000001'
     AND type = 'verified'
     AND event_end = '2030-09-01T19:00:00Z'::timestamptz),
  1::bigint,
  'the genuine verified certificate survived every attempt untouched'
);

SELECT extensions.is(
  (SELECT count(*) FROM public.certificates
   WHERE user_id = 'ce000000-0000-4000-8000-000000000004'),
  0::bigint,
  'the attacker left no certificate behind at all'
);

-- ---------------------------------------------------------------------------
-- The organizer's canonical path still publishes
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'ce000000-0000-4000-8000-000000000002';
SET LOCAL "request.jwt.claims" =
  '{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT extensions.is(
  public.publish_volunteer_hours_transactional(
    'ce200000-0000-4000-8000-000000000002',
    'oneTime',
    '[{"signupId":"ce300000-0000-4000-8000-000000000002","checkIn":"2030-09-02T16:00:00Z","checkOut":"2030-09-02T19:00:00Z"}]'::jsonb,
    'hours-publication:v1:cececececececececececececececececececececececececececececececece'
  ) ->> 'outcome',
  'accepted',
  'an authorized org staff organizer still publishes hours through the RPC'
);

RESET ROLE;

SELECT extensions.is(
  (SELECT count(*) FROM public.certificates
   WHERE project_id = 'ce200000-0000-4000-8000-000000000002'
     AND type = 'verified'
     AND creator_id = 'ce000000-0000-4000-8000-000000000001'
     AND user_id = 'ce000000-0000-4000-8000-000000000003'),
  1::bigint,
  'the publication issued the verified certificate the browser could not forge'
);

-- ---------------------------------------------------------------------------
-- Why this mattered: the same forged row, planted here with owner privileges
-- because RLS now refuses it from the browser, permanently blocks the
-- victim's session. This is the primitive the removed policy branch handed to
-- every holder of the public anon key.
-- ---------------------------------------------------------------------------

INSERT INTO public.certificates (
  id, project_id, user_id, signup_id, project_title, event_start, event_end,
  is_certified, creator_id, type, check_in_method
)
VALUES (
  'ce400000-0000-4000-8000-000000000003',
  NULL,
  'ce000000-0000-4000-8000-000000000004',
  'ce300000-0000-4000-8000-000000000003',
  'Squatted Session', '2030-01-01T00:00:00Z', '2030-01-01T01:00:00Z',
  true, 'ce000000-0000-4000-8000-000000000004', 'verified', 'qr-code'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'ce000000-0000-4000-8000-000000000002';
SET LOCAL "request.jwt.claims" =
  '{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT extensions.throws_ok(
  $$
    SELECT public.publish_volunteer_hours_transactional(
      'ce200000-0000-4000-8000-000000000003',
      'oneTime',
      '[{"signupId":"ce300000-0000-4000-8000-000000000003","checkIn":"2030-09-04T16:00:00Z","checkOut":"2030-09-04T19:00:00Z"}]'::jsonb,
      'hours-publication:v1:dededededededededededededededededededededededededededededededede'
    )
  $$,
  '23505',
  NULL,
  'a squatted verified certificate blocks the victim session the organizer must publish'
);

RESET ROLE;

DELETE FROM public.certificates
WHERE id = 'ce400000-0000-4000-8000-000000000003';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'ce000000-0000-4000-8000-000000000002';
SET LOCAL "request.jwt.claims" =
  '{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT extensions.is(
  public.publish_volunteer_hours_transactional(
    'ce200000-0000-4000-8000-000000000003',
    'oneTime',
    '[{"signupId":"ce300000-0000-4000-8000-000000000003","checkIn":"2030-09-04T16:00:00Z","checkOut":"2030-09-04T19:00:00Z"}]'::jsonb,
    'hours-publication:v1:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef'
  ) ->> 'outcome',
  'accepted',
  'with the squatting row gone the same publication succeeds'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
