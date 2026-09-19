-- Persistent Storage cleanup claims and post-image restoration fencing.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(28);

SELECT extensions.has_table(
  'plugin_data', 'csf_storage_deletion_receipts',
  'storage deletion acknowledgements have durable replay receipts'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class
   WHERE oid = 'plugin_data.csf_storage_deletion_receipts'::regclass),
  'storage deletion receipts keep RLS enabled'
);
SELECT extensions.has_function(
  'plugin_data', 'csf_claim_storage_deletion_queue', ARRAY['integer'],
  'the bounded storage deletion claim RPC exists'
);
SELECT extensions.has_function(
  'plugin_data', 'csf_ack_storage_deletion_claim',
  ARRAY['uuid', 'uuid', 'boolean'],
  'the claim-token acknowledgement RPC exists'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_claim_storage_deletion_queue(integer)', 'EXECUTE'
  ) AND has_function_privilege(
    'service_role',
    'plugin_data.csf_ack_storage_deletion_claim(uuid,uuid,boolean)', 'EXECUTE'
  ),
  'service role can use the two cleanup RPCs'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_claim_storage_deletion_queue(integer)', 'EXECUTE'
  ) AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_ack_storage_deletion_claim(uuid,uuid,boolean)', 'EXECUTE'
  ),
  'browser-authenticated users cannot use cleanup RPCs'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role', 'plugin_data.csf_storage_deletion_queue', 'SELECT'
  ) AND NOT has_table_privilege(
    'service_role', 'plugin_data.csf_storage_deletion_queue', 'UPDATE'
  ) AND NOT has_table_privilege(
    'service_role', 'plugin_data.csf_storage_deletion_queue', 'DELETE'
  ),
  'service role cannot bypass cleanup claims through the queue table'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'b7000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'storage-claim@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'b7100000-0000-4000-8000-000000000001',
  'Storage Claim Boundary', 'storage-claim-boundary', 'school', '995410'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001', 'admin', 'active'
);

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, published_at, created_by, updated_by
) VALUES (
  'b7400000-0000-4000-8000-000000000001',
  'b7100000-0000-4000-8000-000000000001',
  'Claimed flyer', 'Details', 'members', 'published', false, false, now(),
  'b7000000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001'
);

SELECT plugin_data.csf_begin_post_publication_request(
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'b7300000-0000-4000-8000-000000000001', 1, 100, false
);
SELECT plugin_data.csf_begin_post_publication_request(
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'b7300000-0000-4000-8000-000000000002', 1, 100, false
);
SELECT plugin_data.csf_begin_post_publication_request(
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'b7300000-0000-4000-8000-000000000003', 1, 100, false
);

SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'b7300000-0000-4000-8000-000000000001',
  'b7400000-0000-4000-8000-000000000001', 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
);

-- A queue row that already conflicts with a live attachment must be cancelled
-- by the claim boundary, never handed to Storage.
INSERT INTO plugin_data.csf_announcement_attachments (
  id, organization_id, announcement_id, position, bucket, object_path,
  file_name, mime_type, size_bytes, checksum_sha256, alt_text, created_by,
  restore_request_id
) VALUES (
  'b7500000-0000-4000-8000-000000000001',
  'b7100000-0000-4000-8000-000000000001',
  'b7400000-0000-4000-8000-000000000001', 0, 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',
  'live.jpg', 'image/jpeg', 100,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Live attachment', 'b7000000-0000-4000-8000-000000000001',
  'b7300000-0000-4000-8000-000000000001'
);
INSERT INTO plugin_data.csf_storage_deletion_queue (
  id, organization_id, bucket, object_path
) VALUES (
  'b7600000-0000-4000-8000-000000000001',
  'b7100000-0000-4000-8000-000000000001', 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
);

CREATE TEMP TABLE storage_claim_live_result AS
SELECT * FROM plugin_data.csf_claim_storage_deletion_queue(10);

SELECT extensions.is(
  (SELECT count(*)::integer FROM storage_claim_live_result), 0,
  'claiming never returns a path restored by a live attachment'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'b7600000-0000-4000-8000-000000000001'), 0,
  'claiming cancels the stale live-reference queue row'
);

-- Restoration owns and removes an unclaimed queue row before it publishes the
-- path again.
INSERT INTO plugin_data.csf_storage_deletion_queue (
  id, organization_id, bucket, object_path
) VALUES (
  'b7600000-0000-4000-8000-000000000002',
  'b7100000-0000-4000-8000-000000000001', 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'
);
SELECT plugin_data.csf_prepare_announcement_attachment_restore(
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'b7300000-0000-4000-8000-000000000002',
  'b7400000-0000-4000-8000-000000000001', 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'b7600000-0000-4000-8000-000000000002'), 0,
  'pre-upload preparation cancels an unclaimed cleanup row'
);
INSERT INTO plugin_data.csf_announcement_attachments (
  id, organization_id, announcement_id, position, bucket, object_path,
  file_name, mime_type, size_bytes, checksum_sha256, alt_text, created_by,
  restore_request_id
) VALUES (
  'b7500000-0000-4000-8000-000000000002',
  'b7100000-0000-4000-8000-000000000001',
  'b7400000-0000-4000-8000-000000000001', 1, 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
  'restored.png', 'image/png', 100,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'Restored attachment', 'b7000000-0000-4000-8000-000000000001',
  'b7300000-0000-4000-8000-000000000002'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE request_id = 'b7300000-0000-4000-8000-000000000002'
     AND consumed_at IS NOT NULL), 1,
  'attachment insertion consumes its exact request-bound preparation'
);
UPDATE plugin_data.csf_post_publication_requests
SET attachment_status = 'saved'
WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'
  AND request_id = 'b7300000-0000-4000-8000-000000000002';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_prepare_announcement_attachment_restore(
    'b7100000-0000-4000-8000-000000000001',
    'b7000000-0000-4000-8000-000000000001',
    'b7300000-0000-4000-8000-000000000002',
    'b7400000-0000-4000-8000-000000000001', 'plugins',
    'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.jpg'
  ) $$,
  '55000', 'The post attachment preparation request is not current.',
  'a completed publication request cannot create an unused restore preparation'
);

-- Claim and acknowledge success. The exact token can replay, while another
-- token cannot settle the row.
INSERT INTO plugin_data.csf_storage_deletion_queue (
  id, organization_id, bucket, object_path
) VALUES (
  'b7600000-0000-4000-8000-000000000003',
  'b7100000-0000-4000-8000-000000000001', 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/orphans/success.jpg'
);
CREATE TEMP TABLE storage_claim_success AS
SELECT * FROM plugin_data.csf_claim_storage_deletion_queue(1);
SELECT extensions.ok(
  (SELECT id = 'b7600000-0000-4000-8000-000000000003'
      AND claim_token IS NOT NULL AND claimed_at IS NOT NULL
   FROM storage_claim_success),
  'claiming binds the oldest unclaimed row to one persistent token'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_ack_storage_deletion_claim(
    'b7600000-0000-4000-8000-000000000003',
    'b7610000-0000-4000-8000-000000000003', true
  ) $$,
  '55000', 'The storage deletion claim is no longer current.',
  'a different token cannot acknowledge a claimed deletion'
);
CREATE TEMP TABLE storage_success_ack AS
SELECT plugin_data.csf_ack_storage_deletion_claim(
  'b7600000-0000-4000-8000-000000000003',
  (SELECT claim_token FROM storage_claim_success), true
) AS result;
SELECT extensions.is(
  (SELECT result ->> 'status' FROM storage_success_ack), 'deleted',
  'confirmed Storage success deletes the matching claimed queue row'
);
SELECT extensions.is(
  (SELECT plugin_data.csf_ack_storage_deletion_claim(
    'b7600000-0000-4000-8000-000000000003',
    (SELECT claim_token FROM storage_claim_success), true
  )),
  (SELECT result FROM storage_success_ack),
  'the exact success acknowledgement replays from its durable receipt'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_ack_storage_deletion_claim(
    'b7600000-0000-4000-8000-000000000003',
    (SELECT claim_token FROM storage_claim_success), false
  ) $$,
  '55000',
  'That storage deletion claim was acknowledged with a different outcome.',
  'an acknowledgement replay cannot change its confirmed outcome'
);

-- Confirmed failure releases only the current token and increments retry state.
INSERT INTO plugin_data.csf_storage_deletion_queue (
  id, organization_id, bucket, object_path
) VALUES (
  'b7600000-0000-4000-8000-000000000004',
  'b7100000-0000-4000-8000-000000000001', 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/orphans/retry.jpg'
);
CREATE TEMP TABLE storage_claim_retry AS
SELECT * FROM plugin_data.csf_claim_storage_deletion_queue(1);
CREATE TEMP TABLE storage_retry_ack AS
SELECT plugin_data.csf_ack_storage_deletion_claim(
  'b7600000-0000-4000-8000-000000000004',
  (SELECT claim_token FROM storage_claim_retry), false
) AS result;
SELECT extensions.is(
  (SELECT result ->> 'status' FROM storage_retry_ack), 'retry_queued',
  'confirmed failure releases the queue row for a later retry'
);
SELECT extensions.ok(
  (SELECT claim_token IS NULL AND claimed_at IS NULL
      AND attempt_count = 1 AND last_error = 'Storage removal failed.'
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'b7600000-0000-4000-8000-000000000004'),
  'failure clears the claim and records bounded retry metadata'
);
SELECT extensions.is(
  (SELECT plugin_data.csf_ack_storage_deletion_claim(
    'b7600000-0000-4000-8000-000000000004',
    (SELECT claim_token FROM storage_claim_retry), false
  )),
  (SELECT result FROM storage_retry_ack),
  'the exact failure acknowledgement replays without another increment'
);
DELETE FROM plugin_data.csf_storage_deletion_queue
WHERE id = 'b7600000-0000-4000-8000-000000000004';

-- Hold a real claim transaction open. Restoration must wait for the queue row,
-- then observe the committed token and fail with the retryable 40001 fence.
INSERT INTO plugin_data.csf_storage_deletion_queue (
  id, organization_id, bucket, object_path
) VALUES (
  'b7600000-0000-4000-8000-000000000005',
  'b7100000-0000-4000-8000-000000000001', 'plugins',
  'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp'
);

-- dblink sessions need the fixture and queue row committed before they can
-- exercise the real cross-session row-lock ordering.
COMMIT;

SELECT extensions.dblink_connect(
  'storage_claim_holder',
  'hostaddr=' || coalesce(host(inet_server_addr()), '127.0.0.1') ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user || ' password=' || current_user || ' sslmode=disable'
);
SELECT extensions.dblink_connect(
  'storage_restore_writer',
  'hostaddr=' || coalesce(host(inet_server_addr()), '127.0.0.1') ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user || ' password=' || current_user || ' sslmode=disable'
);
SELECT extensions.dblink_exec('storage_claim_holder', 'BEGIN');
CREATE TEMP TABLE held_storage_claim AS
SELECT claim_token::uuid
FROM extensions.dblink(
  'storage_claim_holder',
  'SELECT claim_token FROM plugin_data.csf_claim_storage_deletion_queue(1)'
) AS result(claim_token uuid);
SELECT extensions.ok(
  (SELECT claim_token IS NOT NULL FROM held_storage_claim),
  'the concurrent holder obtains a token inside its open transaction'
);
SELECT extensions.dblink_send_query(
  'storage_restore_writer',
  $query$
    SELECT plugin_data.csf_prepare_announcement_attachment_restore(
      'b7100000-0000-4000-8000-000000000001',
      'b7000000-0000-4000-8000-000000000001',
      'b7300000-0000-4000-8000-000000000003',
      'b7400000-0000-4000-8000-000000000001', 'plugins',
      'b7100000-0000-4000-8000-000000000001/dvhs-csf/post-images/b7400000-0000-4000-8000-000000000001/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp'
    )::text
  $query$
);
SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('storage_restore_writer'), 1,
  'restoration waits for the in-flight cleanup claim transaction'
);
SELECT extensions.dblink_exec('storage_claim_holder', 'COMMIT');
SELECT pg_sleep(0.25);
SELECT * FROM extensions.dblink_get_result(
  'storage_restore_writer', false
) AS result(payload text);
SELECT extensions.ok(
  position(
    'Post attachment restoration must retry after storage cleanup reconciliation.'
    IN extensions.dblink_error_message('storage_restore_writer')
  ) > 0,
  'pre-upload preparation loses to the committed claim and receives the retryable fence'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_attachment_restore_preparations
   WHERE request_id = 'b7300000-0000-4000-8000-000000000003'), 0,
  'the fenced pre-upload call creates no preparation receipt'
);
SELECT extensions.ok(
  (SELECT claim_token IS NOT NULL
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'b7600000-0000-4000-8000-000000000005'),
  'the losing restoration cannot cancel the live cleanup claim'
);

SELECT extensions.dblink_disconnect('storage_claim_holder');
SELECT extensions.dblink_disconnect('storage_restore_writer');

-- Organization teardown must preserve unresolved cleanup state until an
-- external worker has settled every queue row.
SELECT extensions.is(
  plugin_data.csf_purge_storage_deletion_queue(
    'b7100000-0000-4000-8000-000000000001'
  ),
  '{"status":"cleanup_required","attachments":2,"queueRows":3,"claimedQueueRows":1,"receipts":0,"preparations":0}'::jsonb,
  'organization teardown reports cleanup work without erasing it'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE organization_id = 'b7100000-0000-4000-8000-000000000001'),
  3,
  'organization teardown preserves every unresolved and claimed queue row'
);
DELETE FROM plugin_data.csf_storage_deletion_queue
WHERE organization_id = 'b7100000-0000-4000-8000-000000000001';
SELECT extensions.is(
  plugin_data.csf_purge_storage_deletion_queue(
    'b7100000-0000-4000-8000-000000000001'
  ),
  '{"status":"purged","attachments":0,"queueRows":0,"claimedQueueRows":0,"receipts":2,"preparations":2}'::jsonb,
  'organization teardown removes durable state only after cleanup is empty'
);
DELETE FROM plugin_data.csf_announcements
WHERE organization_id = 'b7100000-0000-4000-8000-000000000001';
DELETE FROM public.organization_members
WHERE organization_id = 'b7100000-0000-4000-8000-000000000001';
DELETE FROM public.organizations
WHERE id = 'b7100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id = 'b7000000-0000-4000-8000-000000000001';

SELECT * FROM extensions.finish();
