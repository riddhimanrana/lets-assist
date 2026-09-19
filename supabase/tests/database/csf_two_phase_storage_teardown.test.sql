-- Two-phase organization teardown preserves Storage cleanup work until acked.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(25);

SELECT extensions.has_function(
  'plugin_data', 'csf_claim_organization_storage_deletion_queue',
  ARRAY['uuid', 'integer'],
  'organization-scoped Storage cleanup claims exist'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)',
    'EXECUTE'
  ),
  'service role can claim organization-scoped cleanup work'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot claim cleanup work'
);
SELECT extensions.has_index(
  'plugin_data', 'csf_storage_deletion_queue',
  'csf_storage_deletion_queue_org_unclaimed_idx',
  'organization-scoped unclaimed cleanup work has a partial index'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'c7000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'teardown@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'c7100000-0000-4000-8000-000000000001',
    'Two Phase Storage Teardown', 'two-phase-storage-teardown',
    'school', '995411'
  ),
  (
    'c7100000-0000-4000-8000-000000000002',
    'Unrelated Storage Teardown', 'unrelated-storage-teardown',
    'school', '995412'
  );
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'c7100000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, published_at, created_by, updated_by
) VALUES (
  'c7400000-0000-4000-8000-000000000001',
  'c7100000-0000-4000-8000-000000000001',
  'Teardown flyer', 'Details', 'members', 'published', false, false, now(),
  'c7000000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001'
);
SELECT plugin_data.csf_begin_post_publication_request(
  'c7100000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001',
  'c7300000-0000-4000-8000-000000000001', 1, 100, false
);
SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'c7100000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001',
  'c7300000-0000-4000-8000-000000000001',
  'c7400000-0000-4000-8000-000000000001', 'plugins',
  'c7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/c7400000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
);
INSERT INTO plugin_data.csf_announcement_attachments (
  id, organization_id, announcement_id, position, bucket, object_path,
  file_name, mime_type, size_bytes, checksum_sha256, alt_text, created_by,
  restore_request_id
) VALUES (
  'c7500000-0000-4000-8000-000000000001',
  'c7100000-0000-4000-8000-000000000001',
  'c7400000-0000-4000-8000-000000000001', 0, 'plugins',
  'c7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/c7400000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
  'teardown.jpg', 'image/jpeg', 100,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Teardown attachment', 'c7000000-0000-4000-8000-000000000001',
  'c7300000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_storage_deletion_queue (
  id, organization_id, bucket, object_path
) VALUES (
  'c7600000-0000-4000-8000-000000000001',
  'c7100000-0000-4000-8000-000000000001', 'plugins',
  'c7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/c7400000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
);
CREATE TEMP TABLE teardown_live_claim AS
SELECT * FROM plugin_data.csf_claim_organization_storage_deletion_queue(
  'c7100000-0000-4000-8000-000000000001', 10
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM teardown_live_claim), 0,
  'organization-scoped claim does not return a live attachment path'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'c7600000-0000-4000-8000-000000000001'),
  0,
  'organization-scoped claim cancels a stale live-reference row'
);

INSERT INTO plugin_data.csf_storage_deletion_queue (
  id, organization_id, bucket, object_path
) VALUES
  (
    'c7600000-0000-4000-8000-000000000002',
    'c7100000-0000-4000-8000-000000000001', 'plugins',
    'c7100000-0000-4000-8000-000000000001/dvhs-csf/staging/local.jpg'
  ),
  (
    'c7600000-0000-4000-8000-000000000003',
    'c7100000-0000-4000-8000-000000000002', 'plugins',
    'c7100000-0000-4000-8000-000000000002/dvhs-csf/staging/other.jpg'
  );

-- Model an interrupted upload preparation whose 15-minute lease is still
-- active when an isolated reset or authorized uninstall starts.
SELECT plugin_data.csf_begin_post_publication_request(
  'c7100000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001',
  'c7300000-0000-4000-8000-000000000002', 1, 100, false
);
SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'c7100000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001',
  'c7300000-0000-4000-8000-000000000002',
  'c7400000-0000-4000-8000-000000000001', 'plugins',
  'c7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/c7400000-0000-4000-8000-000000000001/c7300000-0000-4000-8000-000000000002/'
    || repeat('b', 64) || '.png'
);

CREATE TEMP TABLE teardown_first_phase AS
SELECT plugin_data.csf_purge_storage_deletion_queue(
  'c7100000-0000-4000-8000-000000000001'
) AS result;
SELECT extensions.is(
  (SELECT result ->> 'status' FROM teardown_first_phase),
  'cleanup_required',
  'first teardown phase reports required Storage cleanup'
);
SELECT extensions.is(
  (SELECT (result ->> 'attachments')::integer FROM teardown_first_phase),
  1,
  'first teardown phase removes attachment metadata through its queue trigger'
);
SELECT extensions.is(
  (SELECT (result ->> 'queueRows')::integer FROM teardown_first_phase),
  3,
  'first teardown phase reports staging, attachment, and abandoned upload cleanup rows'
);
SELECT extensions.is(
  (SELECT (result ->> 'claimedQueueRows')::integer FROM teardown_first_phase),
  0,
  'first teardown phase distinguishes unclaimed cleanup work'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE organization_id = 'c7100000-0000-4000-8000-000000000001'),
  3,
  'first teardown phase preserves every queue row'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE organization_id = 'c7100000-0000-4000-8000-000000000001'),
  1,
  'first teardown phase preserves consumed restore evidence'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE organization_id = 'c7100000-0000-4000-8000-000000000001'
     AND consumed_at IS NULL),
  0,
  'first teardown phase cancels active preparations before queue claiming'
);
SELECT extensions.ok(
  (SELECT claim_token IS NULL
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'c7600000-0000-4000-8000-000000000003'),
  'organization-scoped teardown leaves another organization untouched'
);

COMMIT;

SELECT extensions.dblink_connect(
  'teardown_claim_holder',
  'hostaddr=' || coalesce(host(inet_server_addr()), '127.0.0.1') ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user || ' password=' || current_user || ' sslmode=disable'
);
SELECT extensions.dblink_connect(
  'teardown_purge_waiter',
  'hostaddr=' || coalesce(host(inet_server_addr()), '127.0.0.1') ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user || ' password=' || current_user || ' sslmode=disable'
);
SELECT extensions.dblink_exec('teardown_claim_holder', 'BEGIN');
CREATE TEMP TABLE teardown_held_claim_count AS
SELECT claimed
FROM extensions.dblink(
  'teardown_claim_holder',
  $query$
    SELECT count(*)::integer
    FROM plugin_data.csf_claim_organization_storage_deletion_queue(
      'c7100000-0000-4000-8000-000000000001', 10
    )
  $query$
) AS result(claimed integer);
SELECT extensions.is(
  (SELECT claimed FROM teardown_held_claim_count), 3,
  'organization-scoped claim takes every available teardown row'
);
SELECT extensions.dblink_send_query(
  'teardown_purge_waiter',
  $query$
    SELECT plugin_data.csf_purge_storage_deletion_queue(
      'c7100000-0000-4000-8000-000000000001'
    )::text
  $query$
);
SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('teardown_purge_waiter'), 1,
  'purge waits for the organization claim transaction'
);
SELECT extensions.dblink_exec('teardown_claim_holder', 'COMMIT');
CREATE TEMP TABLE teardown_concurrent_purge AS
SELECT payload::jsonb AS result
FROM extensions.dblink_get_result(
  'teardown_purge_waiter', false
) AS response(payload text);
SELECT extensions.is(
  (SELECT result ->> 'status' FROM teardown_concurrent_purge),
  'cleanup_required',
  'concurrent purge still requires cleanup after the claim commits'
);
SELECT extensions.is(
  (SELECT (result ->> 'claimedQueueRows')::integer
   FROM teardown_concurrent_purge),
  3,
  'concurrent purge reports every live claim'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE organization_id = 'c7100000-0000-4000-8000-000000000001'
     AND claim_token IS NOT NULL),
  3,
  'purge never erases claimed queue rows'
);
SELECT extensions.dblink_disconnect('teardown_claim_holder');
SELECT extensions.dblink_disconnect('teardown_purge_waiter');

CREATE TEMP TABLE teardown_claim_tokens AS
SELECT id, claim_token
FROM plugin_data.csf_storage_deletion_queue
WHERE organization_id = 'c7100000-0000-4000-8000-000000000001';
CREATE TEMP TABLE teardown_success_acks AS
SELECT plugin_data.csf_ack_storage_deletion_claim(
  token.id, token.claim_token, true
) AS result
FROM teardown_claim_tokens AS token;
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM teardown_success_acks
   WHERE result ->> 'status' = 'deleted'),
  3,
  'token-bound acknowledgements settle every claimed Storage deletion'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE organization_id = 'c7100000-0000-4000-8000-000000000001'),
  0,
  'acknowledged organization cleanup leaves no queue rows'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE organization_id = 'c7100000-0000-4000-8000-000000000002'),
  1,
  'organization acknowledgements do not settle another organization'
);

SELECT extensions.is(
  plugin_data.csf_purge_storage_deletion_queue(
    'c7100000-0000-4000-8000-000000000001'
  ),
  '{"status":"purged","attachments":0,"queueRows":0,"claimedQueueRows":0,"receipts":3,"preparations":1}'::jsonb,
  'final teardown removes receipts and preparations only after cleanup drains'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_storage_deletion_receipts
    WHERE organization_id = 'c7100000-0000-4000-8000-000000000001'
  ) AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_attachment_restore_preparations
    WHERE organization_id = 'c7100000-0000-4000-8000-000000000001'
  ),
  'final teardown removes only the drained organization durable state'
);
SELECT extensions.is(
  plugin_data.csf_purge_storage_deletion_queue(
    'c7100000-0000-4000-8000-000000000001'
  ),
  '{"status":"purged","attachments":0,"queueRows":0,"claimedQueueRows":0,"receipts":0,"preparations":0}'::jsonb,
  'completed teardown retries idempotently'
);

DELETE FROM plugin_data.csf_storage_deletion_queue
WHERE organization_id = 'c7100000-0000-4000-8000-000000000002';
DELETE FROM plugin_data.csf_announcements
WHERE organization_id = 'c7100000-0000-4000-8000-000000000001';
DELETE FROM public.organization_members
WHERE organization_id = 'c7100000-0000-4000-8000-000000000001';
DELETE FROM public.organizations
WHERE id IN (
  'c7100000-0000-4000-8000-000000000001',
  'c7100000-0000-4000-8000-000000000002'
);
DELETE FROM auth.users
WHERE id = 'c7000000-0000-4000-8000-000000000001';

SELECT * FROM extensions.finish();
