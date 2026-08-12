-- Real two-connection proof for follow-up replay and authorization races.
-- This file intentionally runs in autocommit so the remote connection can
-- observe the first connection's committed receipt and staff revocation.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(10);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'fc000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'reply-race-admin@local.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    'fc000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'reply-race-staff@local.test', now(),
    '{}', '{}', now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'fc100000-0000-4000-8000-000000000001',
  'Reply Race Chapter', 'reply-race-chapter', 'school', '994401'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  (
    'fc100000-0000-4000-8000-000000000001',
    'fc000000-0000-4000-8000-000000000001',
    'admin', 'active'
  ),
  (
    'fc100000-0000-4000-8000-000000000001',
    'fc000000-0000-4000-8000-000000000002',
    'member', 'active'
  );

SELECT plugin_data.csf_install_default_roles(
  'fc100000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_staff_positions (
  organization_id, user_id, role_id, school_year, display_title, status
)
SELECT
  'fc100000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000002',
  role.id,
  '2026-2027',
  'Publicity VP',
  'active'
FROM plugin_data.csf_roles AS role
WHERE role.organization_id = 'fc100000-0000-4000-8000-000000000001'
  AND role.key = 'vice-president-publicity';

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, published_at, created_by
) VALUES (
  'fc200000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'Concurrent follow-ups', 'Synthetic concurrency fixture.',
  'members', 'published', now(),
  'fc000000-0000-4000-8000-000000000001'
);

CREATE TEMP TABLE csf_post_reply_race_results (
  key text PRIMARY KEY,
  payload jsonb NOT NULL
);

SELECT extensions.dblink_connect(
  'post_reply_replay_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key(
    'fc100000-0000-4000-8000-000000000001'
  )
);
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'plugin_data.csf_post_reply_mutation_request:' ||
      'fc100000-0000-4000-8000-000000000001' || ':' ||
      'fc300000-0000-4000-8000-000000000001',
    0
  )
);
SELECT extensions.dblink_send_query(
  'post_reply_replay_writer',
  $query$
    SELECT plugin_data.csf_mutate_post_reply(
      'fc100000-0000-4000-8000-000000000001'::uuid,
      'add',
      'fc200000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'One logical concurrent follow-up.',
      'fc000000-0000-4000-8000-000000000001'::uuid,
      'fc300000-0000-4000-8000-000000000001'::uuid
    )::text
  $query$
);
DO $wait_for_replay_lock$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.pid <> pg_catalog.pg_backend_pid()
        AND activity.query LIKE '%fc300000-0000-4000-8000-000000000001%'
        AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory'
    )
    INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  INSERT INTO csf_post_reply_race_results (key, payload)
  VALUES ('replay_wait', pg_catalog.jsonb_build_object('observed', v_waiting));
END
$wait_for_replay_lock$;
SELECT extensions.ok(
  (SELECT (payload ->> 'observed')::boolean
   FROM csf_post_reply_race_results WHERE key = 'replay_wait'),
  'the concurrent retry is observed waiting on the shared advisory lock'
);
INSERT INTO csf_post_reply_race_results (key, payload)
SELECT 'primary', plugin_data.csf_mutate_post_reply(
  'fc100000-0000-4000-8000-000000000001',
  'add',
  'fc200000-0000-4000-8000-000000000001',
  NULL,
  'One logical concurrent follow-up.',
  'fc000000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001'
);
COMMIT;

INSERT INTO csf_post_reply_race_results (key, payload)
SELECT 'retry', payload::jsonb
FROM extensions.dblink_get_result('post_reply_replay_writer', false)
  AS result(payload text);
SELECT extensions.dblink_disconnect('post_reply_replay_writer');

SELECT extensions.ok(
  (SELECT (payload ->> 'idempotent')::boolean = false
   FROM csf_post_reply_race_results WHERE key = 'primary'),
  'the first concurrent request commits the reply'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'idempotent')::boolean
     AND payload ->> 'replyId' = (
       SELECT payload ->> 'replyId'
       FROM csf_post_reply_race_results
       WHERE key = 'primary'
     )
   FROM csf_post_reply_race_results WHERE key = 'retry'),
  'the queued concurrent retry resolves to the exact committed reply'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_announcement_replies
   WHERE organization_id = 'fc100000-0000-4000-8000-000000000001'
     AND body = 'One logical concurrent follow-up.'),
  1,
  'two concurrent attempts create one reply'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'fc300000-0000-4000-8000-000000000001'
     AND source_type = 'post_reply_mutation_request'),
  1,
  'two concurrent attempts create one immutable receipt'
);

SELECT extensions.dblink_connect(
  'post_reply_revoked_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  plugin_data.csf_staff_access_lock_key(
    'fc100000-0000-4000-8000-000000000001'
  )
);
SELECT extensions.dblink_send_query(
  'post_reply_revoked_writer',
  $query$
    SELECT plugin_data.csf_mutate_post_reply(
      'fc100000-0000-4000-8000-000000000001'::uuid,
      'add',
      'fc200000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'Must not survive revocation.',
      'fc000000-0000-4000-8000-000000000002'::uuid,
      'fc300000-0000-4000-8000-000000000002'::uuid
    )::text
  $query$
);
DO $wait_for_revocation_lock$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.pid <> pg_catalog.pg_backend_pid()
        AND activity.query LIKE '%fc300000-0000-4000-8000-000000000002%'
        AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory'
    )
    INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  INSERT INTO csf_post_reply_race_results (key, payload)
  VALUES ('revocation_wait', pg_catalog.jsonb_build_object('observed', v_waiting));
END
$wait_for_revocation_lock$;
SELECT extensions.ok(
  (SELECT (payload ->> 'observed')::boolean
   FROM csf_post_reply_race_results WHERE key = 'revocation_wait'),
  'the staff-only request is observed waiting after its initial authorization'
);
UPDATE plugin_data.csf_role_permissions AS permission
SET enabled = false
FROM plugin_data.csf_roles AS role
WHERE permission.organization_id = 'fc100000-0000-4000-8000-000000000001'
  AND permission.role_id = role.id
  AND role.organization_id = permission.organization_id
  AND role.key = 'vice-president-publicity'
  AND permission.permission_key = 'manage_posts';
COMMIT;

SELECT *
FROM extensions.dblink_get_result('post_reply_revoked_writer', false)
  AS result(payload text);
SELECT extensions.ok(
  position(
    'Not authorized to manage CSF post follow-ups.'
    IN extensions.dblink_error_message('post_reply_revoked_writer')
  ) > 0,
  'the queued request rechecks authorization after acquiring the lock'
);
SELECT extensions.dblink_disconnect('post_reply_revoked_writer');

SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_announcement_replies
   WHERE organization_id = 'fc100000-0000-4000-8000-000000000001'
     AND body = 'Must not survive revocation.'),
  0,
  'the revoked queued request writes no reply'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = 'fc300000-0000-4000-8000-000000000002'),
  0,
  'the revoked queued request writes no receipt'
);
SELECT extensions.is(
  (SELECT permission.enabled::text
   FROM plugin_data.csf_role_permissions AS permission
   JOIN plugin_data.csf_roles AS role
     ON role.id = permission.role_id
    AND role.organization_id = permission.organization_id
   WHERE permission.organization_id = 'fc100000-0000-4000-8000-000000000001'
     AND role.key = 'vice-president-publicity'
     AND permission.permission_key = 'manage_posts'),
  'false',
  'the staff-role capability revocation committed before the request resumed'
);

-- dblink commits outside the pgTAP driver's transaction, so remove every
-- durable fixture before later database files run on this same replay stack.
-- The audit row is intentionally immutable at runtime; replica mode is scoped
-- to this test-only cleanup statement and restored before ordinary FK cleanup.
SET session_replication_role = replica;
DELETE FROM plugin_data.csf_admin_audit_events
WHERE organization_id = 'fc100000-0000-4000-8000-000000000001'
  AND source_type = 'post_reply_mutation_request';
SET session_replication_role = origin;

DELETE FROM plugin_data.csf_announcement_replies
WHERE organization_id = 'fc100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_announcements
WHERE organization_id = 'fc100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_staff_positions
WHERE organization_id = 'fc100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_role_permissions
WHERE organization_id = 'fc100000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_roles
WHERE organization_id = 'fc100000-0000-4000-8000-000000000001';
DELETE FROM public.organization_members
WHERE organization_id = 'fc100000-0000-4000-8000-000000000001';
DELETE FROM public.organizations
WHERE id = 'fc100000-0000-4000-8000-000000000001';
DELETE FROM auth.users
WHERE id IN (
  'fc000000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000002'
);

DROP TABLE csf_post_reply_race_results;

SELECT * FROM extensions.finish();
