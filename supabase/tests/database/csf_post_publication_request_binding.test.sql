-- Publication request binding for CSF flyer metadata. Synthetic identities only.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(21);

SELECT extensions.has_function(
  'plugin_data',
  'csf_replace_post_attachments',
  ARRAY['uuid', 'uuid', 'uuid', 'jsonb', 'uuid'],
  'the service-only attachment replacement boundary exists'
);
SELECT extensions.is(
  (
    SELECT pg_catalog.pg_get_userbyid(proc.proowner)
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)'::regprocedure
  ),
  'postgres',
  'the replacement boundary retains its postgres owner'
);
SELECT extensions.is(
  (
    SELECT proc.proconfig
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid =
      'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)'::regprocedure
  ),
  ARRAY['search_path=""']::text[],
  'the replacement boundary retains its empty search path'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'service role can execute the replacement boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot execute the replacement boundary'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ae000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'request-owner@local.test', now(), '{}', '{}', now(), now()),
  ('ae000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other-officer@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ae100000-0000-4000-8000-000000000001',
  'Publication request binding',
  'publication-request-binding',
  'school',
  '995401'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('ae100000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ae100000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, published_at, created_by, updated_by
) VALUES
  ('ae400000-0000-4000-8000-000000000001', 'ae100000-0000-4000-8000-000000000001', 'First post', 'First body', 'members', 'published', false, false, now(), 'ae000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001'),
  ('ae400000-0000-4000-8000-000000000002', 'ae100000-0000-4000-8000-000000000001', 'Second post', 'Second body', 'members', 'published', false, false, now(), 'ae000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001');

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ae100000-0000-4000-8000-000000000001',
    'ae400000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    'ae300000-0000-4000-8000-000000000001'
  ) $$,
  '55000',
  'That post image request was not prepared.',
  'an unprepared request cannot change attachment metadata'
);

SELECT plugin_data.csf_begin_post_publication_request(
  'ae100000-0000-4000-8000-000000000001',
  'ae000000-0000-4000-8000-000000000001',
  'ae300000-0000-4000-8000-000000000002',
  1,
  1024,
  false
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ae100000-0000-4000-8000-000000000001',
    'ae400000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000002',
    '[]'::jsonb,
    'ae300000-0000-4000-8000-000000000002'
  ) $$,
  '55000',
  'That post image request is already bound to another change.',
  'a different authorized actor cannot reuse the prepared request'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ae100000-0000-4000-8000-000000000001',
    'ae400000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    'ae300000-0000-4000-8000-000000000002'
  ) $$,
  '55000',
  'That post image request is already bound to another change.',
  'a different attachment count cannot reuse the prepared request'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ae100000-0000-4000-8000-000000000001',
    'ae400000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'objectPath', 'ae100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ae400000-0000-4000-8000-000000000001/' || repeat('a', 64) || '.png',
      'fileName', 'wrong-size.png',
      'mimeType', 'image/png',
      'sizeBytes', 2048,
      'checksumSha256', repeat('a', 64),
      'altText', 'Wrong byte total'
    )),
    'ae300000-0000-4000-8000-000000000002'
  ) $$,
  '55000',
  'That post image request does not match the prepared byte total.',
  'a different attachment byte total cannot reuse the prepared request'
);
SELECT extensions.is(
  (SELECT attachment_status
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
     AND request_id = 'ae300000-0000-4000-8000-000000000002'),
  'pending',
  'rejected reuse leaves the publication request pending'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_announcement_attachments
   WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'),
  0,
  'rejected reuse leaves attachment metadata unchanged'
);

UPDATE plugin_data.csf_post_publication_requests
SET announcement_id = 'ae400000-0000-4000-8000-000000000001'
WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
  AND request_id = 'ae300000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ae100000-0000-4000-8000-000000000001',
    'ae400000-0000-4000-8000-000000000002',
    'ae000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'objectPath', 'ae100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ae400000-0000-4000-8000-000000000002/' || repeat('b', 64) || '.png',
      'fileName', 'wrong-post.png',
      'mimeType', 'image/png',
      'sizeBytes', 1024,
      'checksumSha256', repeat('b', 64),
      'altText', 'Wrong post'
    )),
    'ae300000-0000-4000-8000-000000000002'
  ) $$,
  '55000',
  'That post image request is already bound to another change.',
  'a request already bound to one post cannot move to another post'
);
UPDATE plugin_data.csf_post_publication_requests
SET announcement_id = NULL
WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
  AND request_id = 'ae300000-0000-4000-8000-000000000002';

SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'ae100000-0000-4000-8000-000000000001',
  'ae000000-0000-4000-8000-000000000001',
  'ae300000-0000-4000-8000-000000000002',
  'ae400000-0000-4000-8000-000000000001', 'plugins',
  'ae100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ae400000-0000-4000-8000-000000000001/'
    || repeat('c', 64) || '.png'
);

SELECT plugin_data.csf_replace_post_attachments(
  'ae100000-0000-4000-8000-000000000001',
  'ae400000-0000-4000-8000-000000000001',
  'ae000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'objectPath', 'ae100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ae400000-0000-4000-8000-000000000001/' || repeat('c', 64) || '.png',
    'fileName', 'prepared.png',
    'mimeType', 'image/png',
    'sizeBytes', 1024,
    'checksumSha256', repeat('c', 64),
    'altText', 'Prepared flyer'
  )),
  'ae300000-0000-4000-8000-000000000002'
);
SELECT extensions.is(
  (SELECT attachment_status
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
     AND request_id = 'ae300000-0000-4000-8000-000000000002'),
  'saved',
  'the matching replacement marks the prepared request saved'
);
SELECT extensions.is(
  (SELECT announcement_id
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
     AND request_id = 'ae300000-0000-4000-8000-000000000002'),
  'ae400000-0000-4000-8000-000000000001'::uuid,
  'the matching replacement binds the intended post'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
     AND correlation_id = 'ae300000-0000-4000-8000-000000000002'
     AND source_type = 'post_attachment_request'),
  1,
  'the matching replacement writes one attachment receipt'
);
SELECT extensions.is(
  (plugin_data.csf_replace_post_attachments(
    'ae100000-0000-4000-8000-000000000001',
    'ae400000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'objectPath', 'ae100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ae400000-0000-4000-8000-000000000001/' || repeat('c', 64) || '.png',
      'fileName', 'prepared.png',
      'mimeType', 'image/png',
      'sizeBytes', 1024,
      'checksumSha256', repeat('c', 64),
      'altText', 'Prepared flyer'
    )),
    'ae300000-0000-4000-8000-000000000002'
  )->>'idempotent')::boolean,
  true,
  'an exact payload retry replays the saved receipt'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ae100000-0000-4000-8000-000000000001',
    'ae400000-0000-4000-8000-000000000001',
    'ae000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'objectPath', 'ae100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ae400000-0000-4000-8000-000000000001/' || repeat('d', 64) || '.png',
      'fileName', 'same-size-different-payload.png',
      'mimeType', 'image/png',
      'sizeBytes', 1024,
      'checksumSha256', repeat('d', 64),
      'altText', 'Different flyer'
    )),
    'ae300000-0000-4000-8000-000000000002'
  ) $$,
  '55000',
  'That post image request is already bound to another change.',
  'a saved request rejects a different payload with the same count and bytes'
);
SELECT extensions.is(
  (SELECT checksum_sha256
   FROM plugin_data.csf_announcement_attachments
   WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
     AND announcement_id = 'ae400000-0000-4000-8000-000000000001'),
  repeat('c', 64),
  'a rejected payload replay preserves the saved attachment'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
     AND correlation_id = 'ae300000-0000-4000-8000-000000000002'
     AND source_type = 'post_attachment_request'),
  1,
  'a rejected payload replay does not duplicate the receipt'
);

SELECT plugin_data.csf_begin_post_publication_request(
  'ae100000-0000-4000-8000-000000000001',
  'ae000000-0000-4000-8000-000000000001',
  'ae300000-0000-4000-8000-000000000003',
  0,
  0,
  false
);
SELECT plugin_data.csf_mutate_post(
  'ae100000-0000-4000-8000-000000000001',
  'update',
  'ae400000-0000-4000-8000-000000000001',
  '{"title":"Receipt-bound post","body":"First body","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  'ae000000-0000-4000-8000-000000000001',
  'ae300000-0000-4000-8000-000000000003'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ae100000-0000-4000-8000-000000000001',
    'ae400000-0000-4000-8000-000000000002',
    'ae000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    'ae300000-0000-4000-8000-000000000003'
  ) $$,
  '55000',
  'That post image request is not bound to this post mutation.',
  'a post mutation receipt prevents rebinding an unbound request to another post'
);
SELECT extensions.is(
  (SELECT attachment_status
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'ae100000-0000-4000-8000-000000000001'
     AND request_id = 'ae300000-0000-4000-8000-000000000003'),
  'pending',
  'a mutation receipt mismatch leaves the request pending'
);

SELECT * FROM extensions.finish();
ROLLBACK;
