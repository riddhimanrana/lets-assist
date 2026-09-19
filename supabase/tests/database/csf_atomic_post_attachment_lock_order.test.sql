-- Two-session proof that direct and atomic attachment changes queue on the
-- organization lock before either path can take the announcement row lock.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(5);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'ad000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'atomic-post-lock-order@local.test',
  now(), '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ad100000-0000-4000-8000-000000000001',
  'Atomic Post Lock Order',
  'atomic-post-lock-order',
  'school',
  '995302'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'ad100000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, published_at, created_by, updated_by
) VALUES (
  'ad400000-0000-4000-8000-000000000001',
  'ad100000-0000-4000-8000-000000000001',
  'Lock order flyer',
  'Original details.',
  'members',
  'published',
  false,
  false,
  now(),
  'ad000000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000001'
);

SELECT plugin_data.csf_begin_post_publication_request(
  'ad100000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000001',
  'ad300000-0000-4000-8000-000000000001',
  0, 0, false
);
SELECT plugin_data.csf_mutate_post(
  'ad100000-0000-4000-8000-000000000001',
  'update',
  'ad400000-0000-4000-8000-000000000001',
  '{"title":"Lock order flyer","body":"Original details.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  'ad000000-0000-4000-8000-000000000001',
  'ad300000-0000-4000-8000-000000000001'
);
SELECT plugin_data.csf_begin_post_publication_request(
  'ad100000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000001',
  'ad300000-0000-4000-8000-000000000002',
  0, 0, false
);

CREATE FUNCTION pg_temp.atomic_post_lock_dsn()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'hostaddr=' || coalesce(host(inet_server_addr()), '127.0.0.1') ||
    ' port=' || current_setting('port') ||
    ' dbname=' || current_database() ||
    ' user=' || current_user ||
    ' password=' || current_user ||
    ' sslmode=disable'
$$;

CREATE FUNCTION pg_temp.wait_for_atomic_post_lock(
  p_writer_pid integer,
  p_lock_key bigint
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_waiting boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '15 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks AS waiting_lock
      WHERE waiting_lock.pid = p_writer_pid
        AND waiting_lock.locktype = 'advisory'
        AND NOT waiting_lock.granted
        AND waiting_lock.classid::bigint = ((p_lock_key >> 32) & 4294967295)
        AND waiting_lock.objid::bigint = (p_lock_key & 4294967295)
        AND waiting_lock.objsubid = 1
    ) INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_waiting;
END;
$$;

CREATE FUNCTION pg_temp.wait_for_atomic_post_writer(p_connection text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_complete boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '15 seconds';
BEGIN
  LOOP
    v_complete := extensions.dblink_is_busy(p_connection) = 0;
    EXIT WHEN v_complete OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_complete;
END;
$$;

CREATE TEMP TABLE atomic_post_lock_writer_pids (
  writer text PRIMARY KEY,
  pid integer NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE atomic_post_lock_results (
  writer text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE atomic_post_lock_key AS
SELECT plugin_data.csf_staff_access_lock_key(
  'ad100000-0000-4000-8000-000000000001'
) AS value;

SELECT extensions.dblink_connect(
  'atomic_post_lock_barrier',
  pg_temp.atomic_post_lock_dsn()
);
SELECT extensions.dblink_connect(
  'atomic_post_lock_direct',
  pg_temp.atomic_post_lock_dsn()
);
SELECT extensions.dblink_connect(
  'atomic_post_lock_wrapper',
  pg_temp.atomic_post_lock_dsn()
);

SELECT extensions.dblink_exec(
  'atomic_post_lock_barrier',
  $query$
    DO $lock$ BEGIN
      PERFORM pg_catalog.pg_advisory_lock(
        plugin_data.csf_staff_access_lock_key(
          'ad100000-0000-4000-8000-000000000001'
        )
      );
    END $lock$
  $query$
);

INSERT INTO atomic_post_lock_writer_pids (writer, pid)
SELECT 'direct', pid
FROM extensions.dblink(
  'atomic_post_lock_direct',
  'SELECT pg_catalog.pg_backend_pid()'
) AS result(pid integer);
INSERT INTO atomic_post_lock_writer_pids (writer, pid)
SELECT 'wrapper', pid
FROM extensions.dblink(
  'atomic_post_lock_wrapper',
  'SELECT pg_catalog.pg_backend_pid()'
) AS result(pid integer);

SELECT extensions.dblink_send_query(
  'atomic_post_lock_direct',
  $query$
    SELECT plugin_data.csf_replace_post_attachments(
      'ad100000-0000-4000-8000-000000000001',
      'ad400000-0000-4000-8000-000000000001',
      'ad000000-0000-4000-8000-000000000001',
      '[]'::jsonb,
      'ad300000-0000-4000-8000-000000000001'
    )::text
  $query$
);

SELECT extensions.ok(
  pg_temp.wait_for_atomic_post_lock(
    (SELECT pid FROM atomic_post_lock_writer_pids WHERE writer = 'direct'),
    (SELECT value FROM atomic_post_lock_key)
  ),
  'direct attachment replacement waits on the organization lock'
);

SELECT extensions.dblink_send_query(
  'atomic_post_lock_wrapper',
  $query$
    SELECT plugin_data.csf_update_post_with_attachments(
      'ad100000-0000-4000-8000-000000000001',
      'ad400000-0000-4000-8000-000000000001',
      '{"title":"Serialized flyer","body":"Updated details.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
      '[]'::jsonb,
      'ad000000-0000-4000-8000-000000000001',
      'ad300000-0000-4000-8000-000000000002'
    )::text
  $query$
);

SELECT extensions.ok(
  pg_temp.wait_for_atomic_post_lock(
    (SELECT pid FROM atomic_post_lock_writer_pids WHERE writer = 'wrapper'),
    (SELECT value FROM atomic_post_lock_key)
  ),
  'the atomic wrapper waits on the same organization lock before mutating the post'
);

SELECT extensions.dblink_exec(
  'atomic_post_lock_barrier',
  $query$
    DO $unlock$ BEGIN
      PERFORM pg_catalog.pg_advisory_unlock(
        plugin_data.csf_staff_access_lock_key(
          'ad100000-0000-4000-8000-000000000001'
        )
      );
    END $unlock$
  $query$
);

SELECT extensions.ok(
  pg_temp.wait_for_atomic_post_writer('atomic_post_lock_direct')
    AND pg_temp.wait_for_atomic_post_writer('atomic_post_lock_wrapper'),
  'both overlapping attachment operations settle without a deadlock'
);

INSERT INTO atomic_post_lock_results (writer, payload)
SELECT 'direct', payload::jsonb
FROM extensions.dblink_get_result('atomic_post_lock_direct', false)
  AS result(payload text);
INSERT INTO atomic_post_lock_results (writer, payload)
SELECT 'wrapper', payload::jsonb
FROM extensions.dblink_get_result('atomic_post_lock_wrapper', false)
  AS result(payload text);

SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2 FROM atomic_post_lock_results)
    AND (SELECT payload ? 'attachments'
         FROM atomic_post_lock_results WHERE writer = 'direct')
    AND (SELECT payload ->> 'status' = 'published'
         FROM atomic_post_lock_results WHERE writer = 'wrapper'),
  'both overlapping operations return their successful results'
);

SELECT extensions.ok(
  (SELECT title = 'Serialized flyer'
   FROM plugin_data.csf_announcements
   WHERE id = 'ad400000-0000-4000-8000-000000000001')
    AND (SELECT pg_catalog.count(*) = 4
         FROM plugin_data.csf_admin_audit_events
         WHERE organization_id = 'ad100000-0000-4000-8000-000000000001'
           AND correlation_id IN (
             'ad300000-0000-4000-8000-000000000001',
             'ad300000-0000-4000-8000-000000000002'
           )),
  'the serialized operations persist the post and all four receipts once'
);

SELECT extensions.dblink_disconnect('atomic_post_lock_barrier');
SELECT extensions.dblink_disconnect('atomic_post_lock_direct');
SELECT extensions.dblink_disconnect('atomic_post_lock_wrapper');

SELECT * FROM extensions.finish();
