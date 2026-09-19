-- Private CSF post-image lifecycle. Synthetic identities only.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(26);

SELECT extensions.has_table(
  'plugin_data', 'csf_announcement_attachments',
  'post attachments have a dedicated evidence table'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class
   WHERE oid = 'plugin_data.csf_announcement_attachments'::regclass),
  'post attachments keep RLS enabled'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'plugin_data.csf_announcement_attachments', 'SELECT'),
  'browser-authenticated users cannot read attachment evidence directly'
);
SELECT extensions.has_function(
  'plugin_data', 'csf_replace_post_attachments',
  ARRAY['uuid', 'uuid', 'uuid', 'jsonb', 'uuid'],
  'the service-only attachment replacement boundary exists'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'service role can call the attachment replacement boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_replace_post_attachments(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot call the attachment replacement boundary'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('ab000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'post-image-admin@local.test', now(), '{}', '{}', now(), now()),
  ('ab000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'post-image-member@local.test', now(), '{}', '{}', now(), now()),
  ('ab000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'post-image-other@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('ab100000-0000-4000-8000-000000000001', 'Post Images A', 'post-images-a', 'school', '995201'),
  ('ab100000-0000-4000-8000-000000000002', 'Post Images B', 'post-images-b', 'school', '995202');

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('ab100000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('ab100000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('ab100000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, published_at, created_by, updated_by
) VALUES
  ('ab400000-0000-4000-8000-000000000001', 'ab100000-0000-4000-8000-000000000001', 'Flyer', 'Details', 'members', 'published', false, false, now(), 'ab000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001'),
  ('ab400000-0000-4000-8000-000000000002', 'ab100000-0000-4000-8000-000000000002', 'Other', 'Private', 'members', 'published', false, false, now(), 'ab000000-0000-4000-8000-000000000003', 'ab000000-0000-4000-8000-000000000003');

SELECT plugin_data.csf_begin_post_publication_request(
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000006',
  0, 0, true
);
SELECT plugin_data.csf_mutate_post(
  'ab100000-0000-4000-8000-000000000001',
  'update',
  'ab400000-0000-4000-8000-000000000001',
  '{"title":"Flyer","body":"Details","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000006'
);
SELECT plugin_data.csf_begin_post_publication_request(
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000002',
  2, 3072, false
);
SELECT plugin_data.csf_begin_post_publication_request(
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000003',
  1, 1024, false
);
SELECT plugin_data.csf_begin_post_publication_request(
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000004',
  2, 2048, false
);
SELECT plugin_data.csf_begin_post_publication_request(
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000005',
  4, 12582912, false
);
SELECT extensions.is(
  plugin_data.csf_resolve_post_publication_completion(
    'ab100000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000001',
    'ab300000-0000-4000-8000-000000000006',
    'ab400000-0000-4000-8000-000000000001'
  ),
  '{"status":"incomplete","reason":"attachments_not_saved"}'::jsonb,
  'recovery reports a committed post whose attachment step is incomplete'
);
SELECT extensions.is(
  (SELECT attachment_status
   FROM plugin_data.csf_post_publication_requests
   WHERE organization_id = 'ab100000-0000-4000-8000-000000000001'
     AND request_id = 'ab300000-0000-4000-8000-000000000006'),
  'pending',
  'observing an incomplete request does not falsely mark its images saved'
);
SELECT extensions.is(
  plugin_data.csf_post_attachments_ready_for_email(
    'ab100000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000001',
    'ab400000-0000-4000-8000-000000000001'
  ),
  false,
  'email remains blocked while image persistence is incomplete'
);
SELECT plugin_data.csf_replace_post_attachments(
  'ab100000-0000-4000-8000-000000000001',
  'ab400000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  '[]'::jsonb,
  'ab300000-0000-4000-8000-000000000006'
);
SELECT extensions.is(
  plugin_data.csf_post_attachments_ready_for_email(
    'ab100000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000001',
    'ab400000-0000-4000-8000-000000000001'
  ),
  true,
  'saving the intended image set enables explicit email retry'
);
SELECT plugin_data.csf_record_post_email_preparation(
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000006',
  'ab400000-0000-4000-8000-000000000001',
  'not_queued'
);
SELECT extensions.is(
  plugin_data.csf_resolve_post_publication_completion(
    'ab100000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000001',
    'ab300000-0000-4000-8000-000000000006',
    'ab400000-0000-4000-8000-000000000001'
  ),
  '{"status":"complete"}'::jsonb,
  'recovery completes only after images and email preparation are recorded'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ab100000-0000-4000-8000-000000000001',
    'ab400000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000002', '[]'::jsonb,
    'ab300000-0000-4000-8000-000000000001'
  ) $$,
  '42501', 'Not authorized to manage CSF posts.',
  'a member cannot change post images'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ab300000-0000-4000-8000-000000000001'),
  0, 'an unauthorized image request writes no receipt'
);

SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000002',
  'ab400000-0000-4000-8000-000000000001', 'plugins',
  'ab100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ab400000-0000-4000-8000-000000000001/'
    || repeat('a', 64) || '.png'
);
SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'ab100000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ab300000-0000-4000-8000-000000000002',
  'ab400000-0000-4000-8000-000000000001', 'plugins',
  'ab100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ab400000-0000-4000-8000-000000000001/'
    || repeat('b', 64) || '.jpg'
);

SELECT plugin_data.csf_replace_post_attachments(
  'ab100000-0000-4000-8000-000000000001',
  'ab400000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'objectPath', 'ab100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ab400000-0000-4000-8000-000000000001/' || repeat('a', 64) || '.png',
      'fileName', 'fundraiser.png', 'mimeType', 'image/png', 'sizeBytes', 1024,
      'checksumSha256', repeat('a', 64), 'altText', 'Fundraiser date and location'
    ),
    pg_catalog.jsonb_build_object(
      'objectPath', 'ab100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ab400000-0000-4000-8000-000000000001/' || repeat('b', 64) || '.jpg',
      'fileName', 'map.jpg', 'mimeType', 'image/jpeg', 'sizeBytes', 2048,
      'checksumSha256', repeat('b', 64), 'altText', 'Map of the fundraiser entrance'
    )
  ),
  'ab300000-0000-4000-8000-000000000002'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_attachments
   WHERE organization_id = 'ab100000-0000-4000-8000-000000000001'
     AND announcement_id = 'ab400000-0000-4000-8000-000000000001'),
  2, 'a valid request stores both scoped images'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ab300000-0000-4000-8000-000000000002'
     AND source_type = 'post_attachment_request'),
  1, 'the image set writes one immutable receipt'
);

SELECT plugin_data.csf_replace_post_attachments(
  'ab100000-0000-4000-8000-000000000001',
  'ab400000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'objectPath', 'ab100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ab400000-0000-4000-8000-000000000001/' || repeat('a', 64) || '.png',
      'fileName', 'fundraiser.png', 'mimeType', 'image/png', 'sizeBytes', 1024,
      'checksumSha256', repeat('a', 64), 'altText', 'Fundraiser date and location'
    ),
    pg_catalog.jsonb_build_object(
      'objectPath', 'ab100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ab400000-0000-4000-8000-000000000001/' || repeat('b', 64) || '.jpg',
      'fileName', 'map.jpg', 'mimeType', 'image/jpeg', 'sizeBytes', 2048,
      'checksumSha256', repeat('b', 64), 'altText', 'Map of the fundraiser entrance'
    )
  ),
  'ab300000-0000-4000-8000-000000000002'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_attachments
   WHERE announcement_id = 'ab400000-0000-4000-8000-000000000001'),
  2, 'an exact replay does not duplicate image evidence'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'ab300000-0000-4000-8000-000000000002'
     AND source_type = 'post_attachment_request'),
  1, 'an exact replay does not duplicate history'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ab100000-0000-4000-8000-000000000001',
    'ab400000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000001', '[]'::jsonb,
    'ab300000-0000-4000-8000-000000000002'
  ) $$,
  '55000', 'That post image request is already bound to another change.',
  'a request id cannot be rebound to a different image set'
);

CREATE TEMP TABLE retained_attachment AS
SELECT id FROM plugin_data.csf_announcement_attachments
WHERE announcement_id = 'ab400000-0000-4000-8000-000000000001'
  AND checksum_sha256 = repeat('a', 64);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ab100000-0000-4000-8000-000000000001',
    'ab400000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('attachmentId', (SELECT id FROM retained_attachment), 'altText', 'First'),
      pg_catalog.jsonb_build_object('attachmentId', (SELECT id FROM retained_attachment), 'altText', 'Again')
    ),
    'ab300000-0000-4000-8000-000000000004'
  ) $$,
  '22023', 'The same post image cannot be attached twice.',
  'a replacement cannot repeat one retained image'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_replace_post_attachments(
    'ab100000-0000-4000-8000-000000000001',
    'ab400000-0000-4000-8000-000000000001',
    'ab000000-0000-4000-8000-000000000001',
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'objectPath', 'ab100000-0000-4000-8000-000000000001/dvhs-csf/post-images/ab400000-0000-4000-8000-000000000001/' || repeat(chr(96 + item), 64) || '.png',
      'fileName', 'large-' || item::text || '.png',
      'mimeType', 'image/png', 'sizeBytes', 4194304,
      'checksumSha256', repeat(chr(96 + item), 64), 'altText', 'Large image'
    ) ORDER BY item) FROM generate_series(3, 6) AS item),
    'ab300000-0000-4000-8000-000000000005'
  ) $$,
  '22023', 'Post images must total 12 MB or less.',
  'the database boundary enforces the total image limit'
);

SELECT plugin_data.csf_replace_post_attachments(
  'ab100000-0000-4000-8000-000000000001',
  'ab400000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'attachmentId', (SELECT id FROM retained_attachment),
    'altText', 'Updated fundraiser details'
  )),
  'ab300000-0000-4000-8000-000000000003'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_attachments
   WHERE announcement_id = 'ab400000-0000-4000-8000-000000000001'),
  1, 'editing a post removes omitted images'
);
SELECT extensions.is(
  (SELECT alt_text FROM plugin_data.csf_announcement_attachments
   WHERE announcement_id = 'ab400000-0000-4000-8000-000000000001'),
  'Updated fundraiser details', 'editing a post updates image descriptions'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue
   WHERE object_path LIKE '%/' || repeat('b', 64) || '.jpg'),
  1, 'removing an image queues its private object for deletion'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO plugin_data.csf_announcement_attachments (
    organization_id, announcement_id, position, object_path, file_name,
    mime_type, size_bytes, checksum_sha256, alt_text, created_by
  ) VALUES (
    'ab100000-0000-4000-8000-000000000001',
    'ab400000-0000-4000-8000-000000000001', 1, 'other/path.png',
    'bad.png', 'image/png', 10, repeat('c', 64), 'Bad path',
    'ab000000-0000-4000-8000-000000000001'
  ) $$,
  '23514', NULL,
  'attachment evidence rejects an object path outside its organization and post'
);

DELETE FROM plugin_data.csf_announcements
WHERE organization_id = 'ab100000-0000-4000-8000-000000000001'
  AND id = 'ab400000-0000-4000-8000-000000000001';
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_attachments
   WHERE announcement_id = 'ab400000-0000-4000-8000-000000000001'),
  0, 'post deletion cascades attachment metadata'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_storage_deletion_queue
   WHERE organization_id = 'ab100000-0000-4000-8000-000000000001'),
  2, 'post deletion queues the final private object without duplicating prior cleanup'
);

SELECT * FROM extensions.finish();
ROLLBACK;
