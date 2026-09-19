-- Durable restore leases keep uploaded objects recoverable until metadata commits.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(18);

SELECT extensions.has_column(
  'plugin_data', 'csf_attachment_restore_preparations', 'lease_expires_at',
  'restore preparations have a bounded lease'
);
SELECT extensions.has_index(
  'plugin_data', 'csf_attachment_restore_preparations',
  'csf_attachment_restore_preparations_active_lease_idx',
  'active restore leases have a cleanup lookup index'
);
SELECT extensions.ok(
  (SELECT p.proowner = 'postgres'::regrole
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']
   FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)'::regprocedure),
  'restore preparation keeps its owner and pinned search path'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_prepare_announcement_attachment_restore(uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'only the worker role can prepare a restore'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'e7000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'restore-lease@local.test', now(),
  '{}', '{}', now(), now()
);
INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'e7100000-0000-4000-8000-000000000001',
  'Restore Lease', 'restore-lease', 'school', '995415'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'e7100000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001', 'admin', 'active'
);
INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, published_at, created_by, updated_by
) VALUES (
  'e7400000-0000-4000-8000-000000000001',
  'e7100000-0000-4000-8000-000000000001',
  'Restore lease flyer', 'Details', 'members', 'published', false, false,
  now(), 'e7000000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001'
);
SELECT plugin_data.csf_begin_post_publication_request(
  'e7100000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000001', 1, 100, false
);
SELECT plugin_data.csf_begin_post_publication_request(
  'e7100000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000002', 1, 100, false
);
SELECT plugin_data.csf_begin_post_publication_request(
  'e7100000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000003', 1, 100, false
);

SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'e7100000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000001',
  'e7400000-0000-4000-8000-000000000001', 'plugins',
  'e7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/e7400000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE object_path LIKE '%/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'),
  1,
  'preparation retains a durable cleanup row before upload'
);
SELECT extensions.ok(
  (SELECT consumed_at IS NULL AND lease_expires_at > now()
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE request_id = 'e7300000-0000-4000-8000-000000000001'),
  'preparation creates an active unconsumed lease'
);
CREATE TEMP TABLE active_lease_claim AS
SELECT * FROM plugin_data.csf_claim_storage_deletion_queue(10);
SELECT extensions.is(
  (SELECT count(*)::integer FROM active_lease_claim), 0,
  'cleanup skips an active restore lease'
);

UPDATE plugin_data.csf_attachment_restore_preparations
SET lease_expires_at = now() - interval '1 second'
WHERE request_id = 'e7300000-0000-4000-8000-000000000001';
CREATE TEMP TABLE abandoned_restore_claim AS
SELECT * FROM plugin_data.csf_claim_storage_deletion_queue(10);
SELECT extensions.is(
  (SELECT count(*)::integer FROM abandoned_restore_claim), 1,
  'cleanup claims a restore whose lease was abandoned'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE request_id = 'e7300000-0000-4000-8000-000000000001'),
  0,
  'claiming removes the abandoned one-use preparation'
);
SELECT extensions.is(
  (SELECT plugin_data.csf_ack_storage_deletion_claim(id, claim_token, true)
     ->> 'status'
   FROM abandoned_restore_claim),
  'deleted',
  'the cleanup worker can settle an abandoned upload path'
);

SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'e7100000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000002',
  'e7400000-0000-4000-8000-000000000001', 'plugins',
  'e7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/e7400000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'
);
INSERT INTO plugin_data.csf_announcement_attachments (
  id, organization_id, announcement_id, position, bucket, object_path,
  file_name, mime_type, size_bytes, checksum_sha256, alt_text, created_by,
  restore_request_id
) VALUES (
  'e7500000-0000-4000-8000-000000000001',
  'e7100000-0000-4000-8000-000000000001',
  'e7400000-0000-4000-8000-000000000001', 0, 'plugins',
  'e7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/e7400000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
  'committed.png', 'image/png', 100,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'Committed attachment', 'e7000000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000002'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE object_path LIKE '%/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'),
  0,
  'attachment commit consumes its cleanup row atomically'
);
SELECT extensions.ok(
  (SELECT consumed_at IS NOT NULL
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE request_id = 'e7300000-0000-4000-8000-000000000002'),
  'attachment commit consumes its restore preparation'
);

SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'e7100000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'e7300000-0000-4000-8000-000000000003',
  'e7400000-0000-4000-8000-000000000001', 'plugins',
  'e7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/e7400000-0000-4000-8000-000000000001/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp'
);
SELECT extensions.throws_ok(
  $$ INSERT INTO plugin_data.csf_announcement_attachments (
    id, organization_id, announcement_id, position, bucket, object_path,
    file_name, mime_type, size_bytes, checksum_sha256, alt_text, created_by,
    restore_request_id
  ) VALUES (
    'e7500000-0000-4000-8000-000000000002',
    'e7100000-0000-4000-8000-000000000001',
    'e7400000-0000-4000-8000-000000000001', 0, 'plugins',
    'e7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/e7400000-0000-4000-8000-000000000001/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp',
    'failed.webp', 'image/webp', 0,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'Failed attachment', 'e7000000-0000-4000-8000-000000000001',
    'e7300000-0000-4000-8000-000000000003'
  ) $$,
  '23514', NULL,
  'a later attachment constraint can still abort the metadata insert'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE object_path LIKE '%/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp'),
  1,
  'a failed metadata insert rolls back cleanup cancellation'
);
SELECT extensions.ok(
  (SELECT consumed_at IS NULL AND lease_expires_at > now()
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE request_id = 'e7300000-0000-4000-8000-000000000003'),
  'a failed metadata insert rolls back preparation consumption'
);

UPDATE plugin_data.csf_attachment_restore_preparations
SET lease_expires_at = now() - interval '1 second'
WHERE request_id = 'e7300000-0000-4000-8000-000000000003';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_validate_attachment_restore_preparation(
    'e7100000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000001',
    'e7300000-0000-4000-8000-000000000003',
    'e7400000-0000-4000-8000-000000000001', 'plugins',
    'e7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/e7400000-0000-4000-8000-000000000001/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp'
  ) $$,
  '55000', 'Post attachment storage must be prepared before restoration.',
  'an expired preparation cannot publish attachment metadata'
);

CREATE TEMP TABLE expired_failed_claim AS
SELECT * FROM plugin_data.csf_claim_organization_storage_deletion_queue(
  'e7100000-0000-4000-8000-000000000001', 10
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM expired_failed_claim), 1,
  'organization cleanup also reclaims an expired preparation'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE consumed_at IS NULL),
  0,
  'no abandoned unconsumed preparation remains after cleanup claim'
);

SELECT * FROM extensions.finish();
ROLLBACK;
