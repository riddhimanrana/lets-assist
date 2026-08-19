BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(52);

-- ---------------------------------------------------------------------------
-- Exact execution ACLs. The private storage-proof helper is deliberately not
-- reachable from a browser role, and neither is the publication RPC.
-- ---------------------------------------------------------------------------

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), protected_functions(signature) AS (
  VALUES
    ('public.publish_waiver_staged_project(uuid, uuid)'),
    ('private.waiver_source_object_exists(text, text)')
)
SELECT extensions.ok(
  NOT has_function_privilege(role_name, signature, 'EXECUTE'),
  format('%s cannot execute %s', role_name, signature)
)
FROM client_roles
CROSS JOIN protected_functions;

SELECT extensions.ok(
  has_function_privilege('service_role', signature, 'EXECUTE'),
  format('service_role can execute %s', signature)
)
FROM (
  VALUES
    ('public.publish_waiver_staged_project(uuid, uuid)'),
    ('private.waiver_source_object_exists(text, text)')
) AS service_functions(signature);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'staged-waiver-owner@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Staged Owner"}'::jsonb, now(), now()
  ),
  (
    'd1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'staged-waiver-outsider@local.test', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Outsider"}'::jsonb, now(), now()
  );

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, workflow_status,
  waiver_required, waiver_allow_upload, waiver_disable_esignature
)
VALUES
  (
    'd2000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Staged E-Signature Project', 'Local', 'Publication fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
    false, 'draft', true, true, false
  ),
  (
    'd2000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'Staged Upload Only Project', 'Local', 'Publication fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
    false, 'draft', true, true, true
  ),
  (
    'd2000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000001',
    'Staged Unsignable Project', 'Local', 'Publication fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
    false, 'draft', true, false, true
  ),
  (
    'd2000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000001',
    'Plain Project', 'Local', 'Publication fixture', 'oneTime',
    'manual',
    '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
    false, 'draft', false, true, false
  );

CREATE OR REPLACE FUNCTION pg_temp.publish(
  p_project_id uuid,
  p_actor_id uuid DEFAULT 'd1000000-0000-4000-8000-000000000001'
)
RETURNS text
LANGUAGE sql
AS $$
  SELECT outcome
  FROM public.publish_waiver_staged_project(p_project_id, p_actor_id);
$$;

CREATE OR REPLACE FUNCTION pg_temp.status_of(p_project_id uuid)
RETURNS text
LANGUAGE sql
AS $$
  SELECT workflow_status FROM public.projects WHERE id = p_project_id;
$$;

-- ---------------------------------------------------------------------------
-- A staged project without a real source object is never published
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000004'),
  'not_waiver_project',
  'a project without a waiver is not published through this path'
);

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000001'),
  'missing_waiver_source',
  'a staged waiver project with no source path stays unpublished'
);

UPDATE public.projects
SET waiver_pdf_storage_path =
  'project_waivers/d2000000-0000-4000-8000-000000000001/source.pdf'
WHERE id = 'd2000000-0000-4000-8000-000000000001';

-- The client marker alone is not proof: the row now points at a path, but no
-- object exists behind it.
SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000001'),
  'missing_storage_object',
  'a source path with no Storage object behind it stays unpublished'
);

SELECT extensions.is(
  pg_temp.status_of('d2000000-0000-4000-8000-000000000001'),
  'draft',
  'the unproven project is still a draft'
);

INSERT INTO storage.objects (bucket_id, name)
VALUES
  (
    'waiver-uploads',
    'project_waivers/d2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  (
    'waiver-uploads',
    'project_waivers/d2000000-0000-4000-8000-000000000001/other.pdf'
  ),
  (
    'waiver-uploads',
    'project_waivers/d2000000-0000-4000-8000-000000000002/source.pdf'
  ),
  (
    'waiver-uploads',
    'project_waivers/d2000000-0000-4000-8000-000000000003/source.pdf'
  );

SELECT extensions.is(
  pg_temp.publish(
    'd2000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002'
  ),
  'forbidden',
  'a caller who does not manage the project cannot publish it'
);

SELECT extensions.is(
  pg_temp.status_of('d2000000-0000-4000-8000-000000000001'),
  'draft',
  'the refused actor left the project unpublished'
);

-- ---------------------------------------------------------------------------
-- E-signature mode must be backed by a matching, signable definition
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000001'),
  'missing_waiver_definition',
  'an e-signature project is not published without a definition'
);

INSERT INTO public.waiver_definitions (
  id, scope, project_id, title, version, active,
  pdf_storage_path, source, created_by, signers, fields
)
VALUES (
  'd3000000-0000-4000-8000-000000000001', 'project',
  'd2000000-0000-4000-8000-000000000001', 'Mismatched Definition', 1, true,
  'project_waivers/d2000000-0000-4000-8000-000000000001/other.pdf',
  'project_pdf', 'd1000000-0000-4000-8000-000000000001',
  '[{"role_key":"volunteer","label":"Volunteer","order_index":0}]'::jsonb,
  '[{"field_key":"sig","field_type":"signature","page_index":0}]'::jsonb
);

UPDATE public.projects
SET waiver_definition_id = 'd3000000-0000-4000-8000-000000000001'
WHERE id = 'd2000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000001'),
  'definition_source_mismatch',
  'a definition pinned to a different PDF blocks publication'
);

UPDATE public.waiver_definitions
SET pdf_storage_path =
  'project_waivers/d2000000-0000-4000-8000-000000000001/source.pdf',
    fields = '[{"field_key":"name","field_type":"name","page_index":0}]'::jsonb
WHERE id = 'd3000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000001'),
  'definition_missing_signature_field',
  'an e-signature definition without a signature placement blocks publication'
);

UPDATE public.waiver_definitions
SET fields = '[{"field_key":"sig","field_type":"signature","page_index":0}]'::jsonb
WHERE id = 'd3000000-0000-4000-8000-000000000001';

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000001'),
  'published',
  'a fully proven staged e-signature project publishes'
);

SELECT extensions.is(
  pg_temp.status_of('d2000000-0000-4000-8000-000000000001'),
  'published',
  'the published project is now publicly readable'
);

-- ---------------------------------------------------------------------------
-- Repeat finalize and lost responses converge instead of duplicating
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000001'),
  'already_published',
  'a repeated finalize is idempotent'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.projects
    WHERE creator_id = 'd1000000-0000-4000-8000-000000000001'
  ),
  4::bigint,
  'no retry created a duplicate project row'
);

-- ---------------------------------------------------------------------------
-- Upload-only mode does not need a definition, but does need a signing mode
-- ---------------------------------------------------------------------------

UPDATE public.projects
SET waiver_pdf_storage_path =
  'project_waivers/d2000000-0000-4000-8000-000000000002/source.pdf'
WHERE id = 'd2000000-0000-4000-8000-000000000002';

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000002'),
  'published',
  'an upload-only waiver project publishes without a definition'
);

UPDATE public.projects
SET waiver_pdf_storage_path =
  'project_waivers/d2000000-0000-4000-8000-000000000003/source.pdf'
WHERE id = 'd2000000-0000-4000-8000-000000000003';

SELECT extensions.is(
  pg_temp.publish('d2000000-0000-4000-8000-000000000003'),
  'no_signing_mode',
  'a project with neither e-signature nor upload cannot be published'
);

SELECT extensions.is(
  pg_temp.status_of('d2000000-0000-4000-8000-000000000003'),
  'draft',
  'the unsignable project remains unpublished'
);

-- ---------------------------------------------------------------------------
-- Publication is what makes a waiver project signable
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT outcome
    FROM public.insert_project_signup_with_waiver(
      'd2000000-0000-4000-8000-000000000003', 'oneTime',
      'd1000000-0000-4000-8000-000000000002', NULL, 'approved',
      NULL, NULL,
      '{"signer_name":"Blocked","signer_email":"blocked@local.test","signature_type":"typed"}'::jsonb,
      NULL
    )
  ),
  'project_unpublished',
  'the still-staged project cannot be signed up for'
);

SELECT extensions.is(
  (
    SELECT outcome
    FROM public.insert_project_signup_with_waiver(
      'd2000000-0000-4000-8000-000000000001', 'oneTime',
      'd1000000-0000-4000-8000-000000000002', NULL, 'approved',
      NULL, NULL,
      '{"signer_name":"Allowed","signer_email":"allowed@local.test","signature_type":"typed"}'::jsonb,
      NULL
    )
  ),
  'inserted',
  'the published project accepts a signup carrying waiver evidence'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.project_signups
    WHERE project_id = 'd2000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'the staged project consumed no capacity'
);

-- ---------------------------------------------------------------------------
-- Negative control: a missing Storage catalog is never treated as proof
--
-- storage.objects is owned by supabase_storage_admin, which the test role is
-- not a member of, so the catalog cannot be dropped or renamed here. The
-- unavailable-catalog branch is therefore asserted structurally, alongside the
-- behavioral checks that a present object proves and an absent one does not.
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  private.waiver_source_object_exists(
    'waiver-uploads',
    'project_waivers/d2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  'an object that really exists is proof'
);

SELECT extensions.ok(
  NOT private.waiver_source_object_exists(
    'waiver-uploads',
    'project_waivers/d2000000-0000-4000-8000-000000000001/never-uploaded.pdf'
  ),
  'a path with no object behind it is not proof'
);

SELECT extensions.ok(
  NOT private.waiver_source_object_exists('waiver-uploads', '   '),
  'a blank path is not proof'
);

SELECT extensions.ok(
  NOT private.waiver_source_object_exists(
    'project-documents',
    'project_waivers/d2000000-0000-4000-8000-000000000001/source.pdf'
  ),
  'an object in another bucket is not proof'
);

SELECT extensions.matches(
  pg_get_functiondef(
    'private.waiver_source_object_exists(text, text)'::regprocedure
  ),
  'IF to_regclass\(''storage\.objects''\) IS NULL THEN\s+RAISE EXCEPTION',
  'an unavailable Storage catalog raises rather than reporting existence'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'private.waiver_source_object_exists(text, text)'::regprocedure
  ) NOT LIKE '%RETURN true%',
  'the proof helper never returns a hardcoded true'
);


-- ---------------------------------------------------------------------------
-- The database boundary: a browser role cannot publish a waiver project
--
-- These are the exact writes the application layer used to be the only thing
-- standing in front of. RLS on public.projects is column blind, so the
-- organizer really does hold UPDATE on their own row.
-- ---------------------------------------------------------------------------

-- A published non-waiver project, so the "turn the waiver on afterwards"
-- transition can be exercised on a live row.
INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, workflow_status,
  waiver_required, waiver_allow_upload, waiver_disable_esignature
)
VALUES (
  'd2000000-0000-4000-8000-000000000005',
  'd1000000-0000-4000-8000-000000000001',
  'Live Plain Project', 'Local', 'Publication fixture', 'oneTime',
  'manual',
  '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
  false, 'published', false, true, false
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Control: the organizer really can insert and update their own project rows,
-- so every refusal below is the waiver boundary and not a missing grant.
SELECT extensions.lives_ok(
  $$
    INSERT INTO public.projects (
      id, creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, workflow_status,
      waiver_required, visibility
    )
    VALUES (
      'd2000000-0000-4000-8000-000000000010',
      'd1000000-0000-4000-8000-000000000001',
      'Client Draft Waiver Project', 'Local', 'Boundary control', 'oneTime',
      'manual',
      '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
      false, 'draft', true, 'unlisted'
    )
  $$,
  'an organizer can still stage their own waiver project as a draft'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.projects (
      id, creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, workflow_status,
      waiver_required, visibility
    )
    VALUES (
      'd2000000-0000-4000-8000-000000000011',
      'd1000000-0000-4000-8000-000000000001',
      'Client Published Waiver Project', 'Local', 'Boundary', 'oneTime',
      'manual',
      '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
      false, 'published', true, 'unlisted'
    )
  $$,
  '42501',
  'publishing or reconfiguring a waiver-required project requires the server-authorized waiver operation',
  'a browser role cannot insert an already published waiver project'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.projects
    SET workflow_status = 'published'
    WHERE id = 'd2000000-0000-4000-8000-000000000003'
  $$,
  '42501',
  'publishing or reconfiguring a waiver-required project requires the server-authorized waiver operation',
  'a browser role cannot publish a staged waiver project directly'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.projects
    SET waiver_required = true
    WHERE id = 'd2000000-0000-4000-8000-000000000005'
  $$,
  '42501',
  'publishing or reconfiguring a waiver-required project requires the server-authorized waiver operation',
  'a browser role cannot turn a live project into a waiver project'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.projects
    SET waiver_allow_upload = false, waiver_disable_esignature = true
    WHERE id = 'd2000000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'publishing or reconfiguring a waiver-required project requires the server-authorized waiver operation',
  'a browser role cannot leave a live waiver project with no way to sign'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.projects
    SET waiver_pdf_storage_path =
      'project_waivers/d2000000-0000-4000-8000-000000000002/source.pdf'
    WHERE id = 'd2000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'a waiver source document must belong to its own project',
  'a browser role cannot pin its project to another project''s waiver document'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.projects
    SET waiver_definition_id = 'd3000000-0000-4000-8000-000000000001'
    WHERE id = 'd2000000-0000-4000-8000-000000000002'
  $$,
  '42501',
  'waiver definitions are attached by the server-authorized operation',
  'a browser role cannot attach a waiver definition itself'
);

-- No refusal above changed anything.
SELECT extensions.is(
  pg_temp.status_of('d2000000-0000-4000-8000-000000000003'),
  'draft',
  'the unsignable project is still unpublished after the direct attempt'
);

SELECT extensions.is(
  (
    SELECT waiver_required
    FROM public.projects
    WHERE id = 'd2000000-0000-4000-8000-000000000005'
  ),
  false,
  'the live project is still a non-waiver project'
);

-- Legacy safety: an already published waiver project stays editable for
-- everything that is not its waiver configuration, so this boundary does not
-- strand projects that were published before it existed.
SELECT extensions.lives_ok(
  $$
    UPDATE public.projects
    SET title = 'Staged E-Signature Project (edited)'
    WHERE id = 'd2000000-0000-4000-8000-000000000001'
  $$,
  'an ordinary edit to a published waiver project is still allowed'
);

SELECT extensions.is(
  (
    SELECT title
    FROM public.projects
    WHERE id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'Staged E-Signature Project (edited)',
  'the ordinary edit really applied'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- The sanctioned replacement path stays usable
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    role_name,
    'public.apply_project_waiver_settings(uuid, uuid, boolean, boolean, boolean)',
    'EXECUTE'
  ),
  format('%s cannot execute apply_project_waiver_settings', role_name)
)
FROM (VALUES ('anon'), ('authenticated')) AS client_roles(role_name);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.apply_project_waiver_settings(uuid, uuid, boolean, boolean, boolean)',
    'EXECUTE'
  ),
  'service_role can execute apply_project_waiver_settings'
);

CREATE OR REPLACE FUNCTION pg_temp.apply_waiver(
  p_project_id uuid,
  p_required boolean DEFAULT NULL,
  p_allow_upload boolean DEFAULT NULL,
  p_disable_esignature boolean DEFAULT NULL,
  p_actor_id uuid DEFAULT 'd1000000-0000-4000-8000-000000000001'
)
RETURNS text
LANGUAGE sql
AS $$
  SELECT outcome
  FROM public.apply_project_waiver_settings(
    p_project_id, p_actor_id, p_required, p_allow_upload, p_disable_esignature
  );
$$;

SELECT extensions.is(
  pg_temp.apply_waiver(
    'd2000000-0000-4000-8000-000000000005', true, NULL, NULL,
    'd1000000-0000-4000-8000-000000000002'
  ),
  'forbidden',
  'a caller who does not manage the project cannot change its waiver settings'
);

SELECT extensions.is(
  pg_temp.apply_waiver('d2000000-0000-4000-8000-000000000005', true),
  'missing_waiver_source',
  'a live project cannot start requiring a waiver it has no document for'
);

SELECT extensions.is(
  (
    SELECT waiver_required
    FROM public.projects
    WHERE id = 'd2000000-0000-4000-8000-000000000005'
  ),
  false,
  'the refused settings change left the project alone'
);

SELECT extensions.is(
  pg_temp.apply_waiver(
    'd2000000-0000-4000-8000-000000000002', NULL, false, NULL
  ),
  'no_signing_mode',
  'a live waiver project cannot lose its last way to be signed'
);

SELECT extensions.is(
  pg_temp.apply_waiver('d2000000-0000-4000-8000-000000000002', true),
  'unchanged',
  'a settings call that changes nothing is a no-op'
);

SELECT extensions.is(
  pg_temp.apply_waiver(
    'd2000000-0000-4000-8000-000000000002', NULL, true, false
  ),
  'missing_waiver_definition',
  'turning e-signatures on needs a definition to sign'
);

-- A draft is proved at publication time, not here, so its settings still move
-- freely. publish_waiver_staged_project is what refuses an unprovable draft.
SELECT extensions.is(
  pg_temp.apply_waiver('d2000000-0000-4000-8000-000000000004', true),
  'updated',
  'a draft can still change its waiver settings before it is published'
);

SELECT * FROM extensions.finish();

ROLLBACK;
