-- Publication recovery ownership and receipt binding. Synthetic identities only.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(18);

SELECT extensions.has_function(
  'plugin_data',
  'csf_resolve_post_publication_completion',
  ARRAY['uuid', 'uuid', 'uuid', 'uuid'],
  'the service-only publication recovery boundary exists'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.pg_get_userbyid(proc.proowner)
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)'::regprocedure
  ),
  'postgres',
  'the recovery boundary retains its postgres owner'
);
SELECT extensions.is(
  (
    SELECT proc.proconfig
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)'::regprocedure
  ),
  ARRAY['search_path=""']::text[],
  'the recovery boundary retains its empty search path'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'service role can execute publication recovery'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_resolve_post_publication_completion(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot execute publication recovery'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('af000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'recovery-owner@local.test', now(), '{}', '{}', now(), now()),
  ('af000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'recovery-other@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'af100000-0000-4000-8000-000000000001',
  'Publication recovery binding',
  'publication-recovery-binding',
  'school',
  '995501'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('af100000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('af100000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, published_at, created_by, updated_by
) VALUES
  ('af400000-0000-4000-8000-000000000001', 'af100000-0000-4000-8000-000000000001', 'First post', 'First body', 'members', 'published', false, false, now(), 'af000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001'),
  ('af400000-0000-4000-8000-000000000002', 'af100000-0000-4000-8000-000000000001', 'Second post', 'Second body', 'members', 'published', false, false, now(), 'af000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001');

SELECT plugin_data.csf_begin_post_publication_request(
  'af100000-0000-4000-8000-000000000001',
  'af000000-0000-4000-8000-000000000001',
  'af300000-0000-4000-8000-000000000001',
  0, 0, false
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resolve_post_publication_completion(
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000002',
    'af300000-0000-4000-8000-000000000001',
    'af400000-0000-4000-8000-000000000001'
  ) $$,
  '55000',
  'That post request belongs to another officer.',
  'another authorized officer cannot claim the request during recovery'
);
SELECT extensions.is(
  (SELECT announcement_id
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
     AND request_id = 'af300000-0000-4000-8000-000000000001'),
  NULL::uuid,
  'an actor mismatch leaves the request unbound'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resolve_post_publication_completion(
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'af300000-0000-4000-8000-000000000001',
    'af400000-0000-4000-8000-000000000001'
  ) $$,
  '55000',
  'That post request does not match the committed post mutation.',
  'recovery cannot bind a request without a post mutation receipt'
);
SELECT extensions.is(
  (SELECT announcement_id
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
     AND request_id = 'af300000-0000-4000-8000-000000000001'),
  NULL::uuid,
  'a missing receipt leaves the request unbound'
);

SELECT plugin_data.csf_begin_post_publication_request(
  'af100000-0000-4000-8000-000000000001',
  'af000000-0000-4000-8000-000000000001',
  'af300000-0000-4000-8000-000000000002',
  0, 0, false
);
SELECT plugin_data.csf_mutate_post(
  'af100000-0000-4000-8000-000000000001',
  'update',
  'af400000-0000-4000-8000-000000000002',
  '{"title":"Other actor receipt","body":"Second body","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  'af000000-0000-4000-8000-000000000002',
  'af300000-0000-4000-8000-000000000002'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resolve_post_publication_completion(
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'af300000-0000-4000-8000-000000000002',
    'af400000-0000-4000-8000-000000000002'
  ) $$,
  '55000',
  'That post request does not match the committed post mutation.',
  'recovery rejects a mutation receipt written by a different officer'
);
SELECT extensions.is(
  (SELECT announcement_id
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
     AND request_id = 'af300000-0000-4000-8000-000000000002'),
  NULL::uuid,
  'a receipt actor mismatch leaves the request unbound'
);

SELECT plugin_data.csf_mutate_post(
  'af100000-0000-4000-8000-000000000001',
  'update',
  'af400000-0000-4000-8000-000000000001',
  '{"title":"Receipt-bound post","body":"First body","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  'af000000-0000-4000-8000-000000000001',
  'af300000-0000-4000-8000-000000000001'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resolve_post_publication_completion(
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'af300000-0000-4000-8000-000000000001',
    'af400000-0000-4000-8000-000000000002'
  ) $$,
  '55000',
  'That post request does not match the committed post mutation.',
  'recovery cannot bind the request to a different post than its receipt'
);
SELECT extensions.is(
  (SELECT announcement_id
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
     AND request_id = 'af300000-0000-4000-8000-000000000001'),
  NULL::uuid,
  'a target mismatch leaves the request unbound'
);

SELECT extensions.is(
  plugin_data.csf_resolve_post_publication_completion(
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'af300000-0000-4000-8000-000000000001',
    'af400000-0000-4000-8000-000000000001'
  ),
  '{"status":"incomplete","reason":"attachments_not_saved"}'::jsonb,
  'matching ownership and receipt bind the intended post'
);
SELECT extensions.is(
  (SELECT announcement_id
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
     AND request_id = 'af300000-0000-4000-8000-000000000001'),
  'af400000-0000-4000-8000-000000000001'::uuid,
  'successful recovery records the receipt target'
);
SELECT extensions.is(
  plugin_data.csf_resolve_post_publication_completion(
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'af300000-0000-4000-8000-000000000001',
    'af400000-0000-4000-8000-000000000001'
  ),
  '{"status":"incomplete","reason":"attachments_not_saved"}'::jsonb,
  'an exact recovery retry remains idempotent'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'af100000-0000-4000-8000-000000000001'
     AND request_id = 'af300000-0000-4000-8000-000000000001'),
  1,
  'an exact recovery retry does not duplicate request state'
);

SELECT extensions.is(
  plugin_data.csf_resolve_post_publication_completion(
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'af300000-0000-4000-8000-000000000099',
    'af400000-0000-4000-8000-000000000001'
  ),
  '{"status":"complete"}'::jsonb,
  'a missing publication request remains an idempotent completed outcome'
);

SELECT * FROM extensions.finish();
ROLLBACK;
