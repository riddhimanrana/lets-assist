-- Retry safety around waiver source documents.
--
-- 1. Project creation is idempotent per creator attempt, so a reload between
--    staging a waiver project and publishing it finishes the same row instead
--    of inserting another invisible draft.
-- 2. A replaced waiver PDF is queued for deletion through the existing
--    reference-rechecked outbox rather than deleted inline, and the recheck
--    now understands the waiver-uploads bucket instead of judging a source
--    document by signature-asset references.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(18);

-- ---------------------------------------------------------------------------
-- ACLs
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT has_function_privilege(
    role_name, 'public.enqueue_superseded_waiver_source(text)', 'EXECUTE'
  ),
  format('%s cannot execute enqueue_superseded_waiver_source', role_name)
)
FROM (VALUES ('anon'), ('authenticated')) AS client_roles(role_name);

SELECT extensions.ok(
  has_function_privilege(
    'service_role', 'public.enqueue_superseded_waiver_source(text)', 'EXECUTE'
  ),
  'service_role can execute enqueue_superseded_waiver_source'
);

SELECT extensions.ok(
  NOT has_function_privilege(
    role_name, 'private.waiver_source_path_is_referenced(text)', 'EXECUTE'
  ),
  format('%s cannot execute waiver_source_path_is_referenced', role_name)
)
FROM (VALUES ('anon'), ('authenticated')) AS client_roles(role_name);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES ('e1000000-0000-4000-8000-000000000001', 'authenticated',
        'authenticated', 'waiver-retry-owner@local.test', now(), '{}',
        '{"username":"waiver_retry_owner"}', now(), now());

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, workflow_status,
  waiver_required, waiver_pdf_storage_path, creation_idempotency_key
)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Retry fixture', 'Local', 'Retry fixture', 'oneTime', 'manual',
  '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
  false, 'draft', true,
  'project_waivers/e2000000-0000-4000-8000-000000000001/current.pdf',
  'e3000000-0000-4000-8000-000000000001'
);

-- ---------------------------------------------------------------------------
-- Creation is idempotent per creator attempt
-- ---------------------------------------------------------------------------

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.projects (
      creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, workflow_status,
      waiver_required, creation_idempotency_key
    )
    VALUES (
      'e1000000-0000-4000-8000-000000000001',
      'Retry fixture (duplicate attempt)', 'Local', 'Retry fixture', 'oneTime',
      'manual',
      '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
      false, 'draft', true, 'e3000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  NULL,
  'a replayed creation attempt cannot insert a second project row'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.projects
    WHERE creator_id = 'e1000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the creator still has exactly one staged project'
);

-- Distinct attempts and unkeyed legacy rows are unaffected by the index.
SELECT extensions.lives_ok(
  $$
    INSERT INTO public.projects (
      creator_id, title, location, description, event_type,
      verification_method, schedule, require_login, workflow_status,
      creation_idempotency_key
    )
    VALUES
      ('e1000000-0000-4000-8000-000000000001', 'Second attempt', 'Local',
       'Retry fixture', 'oneTime', 'manual',
       '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
       false, 'published', 'e3000000-0000-4000-8000-000000000002'),
      ('e1000000-0000-4000-8000-000000000001', 'Legacy unkeyed one', 'Local',
       'Retry fixture', 'oneTime', 'manual',
       '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
       false, 'published', NULL),
      ('e1000000-0000-4000-8000-000000000001', 'Legacy unkeyed two', 'Local',
       'Retry fixture', 'oneTime', 'manual',
       '{"oneTime":{"date":"2099-05-01","startTime":"09:00","endTime":"12:00","volunteers":2}}'::jsonb,
       false, 'published', NULL)
  $$,
  'a different attempt key and unkeyed rows are unconstrained'
);

-- ---------------------------------------------------------------------------
-- A superseded source document is queued, a referenced one is not
-- ---------------------------------------------------------------------------

SELECT extensions.ok(
  NOT public.enqueue_superseded_waiver_source(
    'project_waivers/e2000000-0000-4000-8000-000000000001/current.pdf'
  ),
  'a source document the project still points at is never queued'
);

SELECT extensions.ok(
  public.enqueue_superseded_waiver_source(
    'project_waivers/e2000000-0000-4000-8000-000000000001/superseded.pdf'
  ),
  'a replaced source document is queued for deletion'
);

SELECT extensions.ok(
  NOT public.enqueue_superseded_waiver_source(
    'https://example.test/not-an-object.pdf'
  ),
  'a legacy inline or remote value is never treated as a Storage object'
);

SELECT extensions.is(
  (
    SELECT bucket_id
    FROM public.waiver_storage_deletion_queue
    WHERE object_path =
      'project_waivers/e2000000-0000-4000-8000-000000000001/superseded.pdf'
  ),
  'waiver-uploads',
  'the queued item names the source bucket, not the evidence bucket'
);

-- Re-queueing the same path is harmless.
SELECT extensions.ok(
  public.enqueue_superseded_waiver_source(
    'project_waivers/e2000000-0000-4000-8000-000000000001/superseded.pdf'
  ),
  'a repeated supersession call still reports the path as deletable'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_storage_deletion_queue
    WHERE object_path =
      'project_waivers/e2000000-0000-4000-8000-000000000001/superseded.pdf'
  ),
  1::bigint,
  'queueing the same superseded path twice keeps one row'
);

-- ---------------------------------------------------------------------------
-- The drain re-check understands the source bucket
-- ---------------------------------------------------------------------------

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.filter_unreferenced_waiver_storage_deletions(
      ARRAY(
        SELECT id FROM public.waiver_storage_deletion_queue
        WHERE bucket_id = 'waiver-uploads'
      )
    )
  ),
  1::bigint,
  'an unreferenced source document survives the last-moment re-check'
);

-- A definition adopting the path cancels the deletion, exactly as an evidence
-- reference does for the signature bucket.
INSERT INTO public.waiver_definitions (
  id, scope, project_id, title, version, active,
  pdf_storage_path, source, created_by, signers, fields
)
VALUES (
  'e4000000-0000-4000-8000-000000000001', 'project',
  'e2000000-0000-4000-8000-000000000001', 'Readopting definition', 1, true,
  'project_waivers/e2000000-0000-4000-8000-000000000001/superseded.pdf',
  'project_pdf', 'e1000000-0000-4000-8000-000000000001',
  '[{"role_key":"volunteer","label":"Volunteer","order_index":0}]'::jsonb,
  '[{"field_key":"sig","field_type":"signature","page_index":0}]'::jsonb
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.filter_unreferenced_waiver_storage_deletions(
      ARRAY(
        SELECT id FROM public.waiver_storage_deletion_queue
        WHERE bucket_id = 'waiver-uploads'
      )
    )
  ),
  0::bigint,
  'a source document that became referenced again is not deleted'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.waiver_storage_deletion_queue
    WHERE bucket_id = 'waiver-uploads'
  ),
  0::bigint,
  'the cancelled deletion item is dropped from the queue'
);

-- An unknown bucket is never reported as safe to delete.
INSERT INTO public.waiver_storage_deletion_queue (bucket_id, object_path)
VALUES ('project-documents', 'some/unrelated/object.pdf');

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.filter_unreferenced_waiver_storage_deletions(
      ARRAY(
        SELECT id FROM public.waiver_storage_deletion_queue
        WHERE bucket_id = 'project-documents'
      )
    )
  ),
  0::bigint,
  'an unrecognized bucket is never handed to the deletion drain'
);

SELECT * FROM extensions.finish();

ROLLBACK;
