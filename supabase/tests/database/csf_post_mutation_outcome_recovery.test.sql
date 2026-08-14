-- Response-loss outcome recovery for CSF post mutations. Synthetic only.
--
-- A service caller that loses the csf_mutate_post response must be able to ask
-- plugin_data.csf_resolve_post_mutation_outcome(p_organization_id uuid,
-- p_actor_user_id uuid, p_request_id uuid) whether its request committed. The
-- resolver must serialize on the exact same advisory key as the mutation
-- ('plugin_data.csf_post_mutation_request:<org>:<request>' hashed with
-- hashtextextended seed 0), so it can never answer while the mutation
-- transaction is still open: after commit it resolves the committed receipt,
-- after rollback it resolves not_written. Authorization must hold on both
-- sides of the lock wait: checked before queueing (scenario four) and
-- re-checked after the wait completes (scenario three).
--
-- RED: plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid) does not
-- exist yet. This file intentionally fails until that forward migration lands.
--
-- Like csf_post_reply_concurrency, this file runs in autocommit so the dblink
-- connections can see the committed fixtures. The file is rerunnable without
-- replication-role tricks, trigger bypasses, or receipt deletion: the stable
-- org-A/user-A fixture chain upserts with ON CONFLICT, every mutation runs
-- under a request UUID generated fresh each run in a temp fixture table, and
-- durable-row assertions key on the returned postId or the run's request UUID
-- rather than titles or counts that would accumulate. Committed org-A posts
-- and their immutable audit receipts intentionally stay behind in the
-- dedicated fcde-prefixed namespace where they cannot collide with other
-- database files or later runs.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(43);

-- Metadata assertions resolve the signature through
-- pg_catalog.to_regprocedure, which returns NULL while the resolver is absent,
-- so every RED check below fails cleanly instead of raising a cast error.
SELECT extensions.has_function(
  'plugin_data',
  'csf_resolve_post_mutation_outcome',
  ARRAY['uuid', 'uuid', 'uuid'],
  'the post mutation outcome resolver exists'
);
SELECT extensions.ok(
  COALESCE(
    has_function_privilege(
      'service_role',
      pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')::oid,
      'EXECUTE'
    ),
    false
  ),
  'service role can resolve lost post mutation outcomes'
);
SELECT extensions.ok(
  COALESCE(
    NOT has_function_privilege(
      'anon',
      pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')::oid,
      'EXECUTE'
    ),
    false
  ),
  'anonymous callers cannot resolve post mutation outcomes'
);
SELECT extensions.ok(
  COALESCE(
    NOT has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')::oid,
      'EXECUTE'
    ),
    false
  ),
  'browser-authenticated callers cannot resolve post mutation outcomes directly'
);
SELECT extensions.ok(
  pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc,
      LATERAL pg_catalog.aclexplode(proc.proacl) AS acl
    WHERE proc.oid = pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'no raw PUBLIC aclitem grants execute on the outcome resolver'
);
SELECT extensions.ok(
  COALESCE(
    NOT has_function_privilege(
      'public',
      pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')::oid,
      'EXECUTE'
    ),
    false
  ),
  'PUBLIC holds no effective execute privilege on the outcome resolver'
);
SELECT extensions.ok(
  COALESCE(
    (SELECT proc.provolatile = 'v'
     FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')),
    false
  ),
  'the outcome resolver is VOLATILE so lock waits and receipt reads are never cached across calls'
);
SELECT extensions.ok(
  COALESCE(
    (SELECT proc.prosecdef
     FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')),
    false
  ),
  'the outcome resolver runs SECURITY DEFINER'
);
SELECT extensions.ok(
  COALESCE(
    (SELECT proc.proconfig @> ARRAY['search_path=""']
     FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')),
    false
  ),
  'the outcome resolver pins an empty search_path (stored as search_path="")'
);
-- Source-order authorization proof: the function body must call
-- csf_actor_has_permission before pg_advisory_xact_lock and call it again
-- after the lock. The runtime preauth/reauth scenarios below exercise both
-- checks behaviorally; this static assertion is the authoritative ordering
-- proof. pg_get_functiondef is strict, so a NULL regprocedure yields NULL and
-- COALESCE turns the RED case into a clean failure.
SELECT extensions.ok(
  COALESCE(
    (SELECT pg_catalog.strpos(src.def, 'csf_actor_has_permission') > 0
       AND pg_catalog.strpos(src.def, 'pg_advisory_xact_lock') >
         pg_catalog.strpos(src.def, 'csf_actor_has_permission')
       AND pg_catalog.strpos(
         pg_catalog.substr(
           src.def,
           pg_catalog.strpos(src.def, 'pg_advisory_xact_lock')
         ),
         'csf_actor_has_permission'
       ) > 0
     FROM (
       SELECT pg_catalog.pg_get_functiondef(
         pg_catalog.to_regprocedure('plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)')
       ) AS def
     ) AS src
     WHERE src.def IS NOT NULL),
    false
  ),
  'resolver source calls csf_actor_has_permission before pg_advisory_xact_lock and again after the lock'
);

-- Stable synthetic fixture chain. Org A and user A persist across runs beside
-- their immutable receipts, so every insert is conflict-safe; the membership
-- upsert also restores the canonical admin/active state.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fcde0001-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'outcome-admin-a@local.test', now(), '{}', '{}', now(), now()),
  ('fcde0001-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'outcome-admin-b@local.test', now(), '{}', '{}', now(), now()),
  ('fcde0001-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'outcome-admin-a2@local.test', now(), '{}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fcde1001-0000-4000-8000-000000000001', 'Outcome Recovery A', 'post-outcome-recovery-a', 'school', '995871'),
  ('fcde1001-0000-4000-8000-000000000002', 'Outcome Recovery B', 'post-outcome-recovery-b', 'school', '995872')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('fcde1001-0000-4000-8000-000000000001', 'fcde0001-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fcde1001-0000-4000-8000-000000000002', 'fcde0001-0000-4000-8000-000000000002', 'admin', 'active'),
  ('fcde1001-0000-4000-8000-000000000001', 'fcde0001-0000-4000-8000-000000000003', 'admin', 'active')
ON CONFLICT ON CONSTRAINT organization_members_organization_id_user_id_key
DO UPDATE SET role = excluded.role, status = excluded.status;

CREATE TEMP TABLE csf_post_outcome_results (
  key text PRIMARY KEY,
  payload jsonb NOT NULL
);

-- Every mutation/receipt scenario gets a request UUID minted fresh this run,
-- so reruns never collide with prior committed receipts. All dblink SQL that
-- embeds a request id is built with format(%L) from this table.
CREATE TEMP TABLE csf_post_outcome_requests (
  key text PRIMARY KEY,
  request_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid()
);
INSERT INTO csf_post_outcome_requests (key)
VALUES ('commit'), ('rollback'), ('reauth'), ('preauth');

-- Scenario one: the mutation transaction commits after the resolver queues.
SELECT extensions.dblink_connect(
  'post_outcome_commit_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec('post_outcome_commit_writer', 'BEGIN');
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'commit_write', payload::jsonb
FROM extensions.dblink(
  'post_outcome_commit_writer',
  (SELECT pg_catalog.format(
    $query$
      SELECT plugin_data.csf_mutate_post(
        'fcde1001-0000-4000-8000-000000000001'::uuid,
        'create',
        NULL,
        '{"title":"Outcome commit probe","body":"Synthetic outcome fixture.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
        'fcde0001-0000-4000-8000-000000000001'::uuid,
        %L::uuid
      )::text
    $query$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'commit')
) AS result(payload text);
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'commit_writer_pid', pg_catalog.jsonb_build_object('pid', payload::integer)
FROM extensions.dblink(
  'post_outcome_commit_writer',
  'SELECT pg_catalog.pg_backend_pid()::text'
) AS result(payload text);

SELECT extensions.dblink_connect(
  'post_outcome_commit_resolver',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'commit_resolver_pid', pg_catalog.jsonb_build_object('pid', payload::integer)
FROM extensions.dblink(
  'post_outcome_commit_resolver',
  'SELECT pg_catalog.pg_backend_pid()::text'
) AS result(payload text);
SELECT extensions.dblink_send_query(
  'post_outcome_commit_resolver',
  (SELECT pg_catalog.format(
    $query$
      SELECT plugin_data.csf_resolve_post_mutation_outcome(
        'fcde1001-0000-4000-8000-000000000001'::uuid,
        'fcde0001-0000-4000-8000-000000000001'::uuid,
        %L::uuid
      )::text
    $query$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'commit')
);

DO $wait_for_commit_overlap$
DECLARE
  v_request uuid := (
    SELECT request_id FROM csf_post_outcome_requests WHERE key = 'commit'
  );
  v_key bigint := pg_catalog.hashtextextended(
    'plugin_data.csf_post_mutation_request:' ||
      'fcde1001-0000-4000-8000-000000000001' || ':' ||
      v_request::text,
    0
  );
  v_classid bigint := (v_key >> 32) & 4294967295;
  v_objid bigint := v_key & 4294967295;
  v_writer_pid integer := (
    SELECT (payload ->> 'pid')::integer
    FROM csf_post_outcome_results
    WHERE key = 'commit_writer_pid'
  );
  v_resolver_pid integer := (
    SELECT (payload ->> 'pid')::integer
    FROM csf_post_outcome_results
    WHERE key = 'commit_resolver_pid'
  );
  v_waiting boolean := false;
  v_holder_shares boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks AS waiter
      WHERE waiter.locktype = 'advisory'
        AND NOT waiter.granted
        AND waiter.objsubid = 1
        AND waiter.classid::bigint = v_classid
        AND waiter.objid::bigint = v_objid
        AND waiter.pid = v_resolver_pid
    )
    INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_locks AS holder
    WHERE holder.locktype = 'advisory'
      AND holder.granted
      AND holder.objsubid = 1
      AND holder.classid::bigint = v_classid
      AND holder.objid::bigint = v_objid
      AND holder.pid = v_writer_pid
  )
  INTO v_holder_shares;
  INSERT INTO csf_post_outcome_results (key, payload)
  VALUES (
    'commit_overlap',
    pg_catalog.jsonb_build_object(
      'resolverWaiting', v_waiting,
      'writerHoldsSameKey', v_holder_shares
    )
  );
END
$wait_for_commit_overlap$;

SELECT extensions.ok(
  (SELECT payload ->> 'status' = 'published'
     AND (payload ->> 'idempotent')::boolean = false
   FROM csf_post_outcome_results WHERE key = 'commit_write'),
  'the open writer transaction performs a real post mutation'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'resolverWaiting')::boolean
   FROM csf_post_outcome_results WHERE key = 'commit_overlap'),
  'the exact resolver backend is observed waiting on the post-mutation advisory key before release'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'writerHoldsSameKey')::boolean
   FROM csf_post_outcome_results WHERE key = 'commit_overlap'),
  'the writer transaction holds the exact advisory key the resolver waits on'
);

SELECT extensions.dblink_exec('post_outcome_commit_writer', 'COMMIT');
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'commit_resolution', payload::jsonb
FROM extensions.dblink_get_result('post_outcome_commit_resolver', false)
  AS result(payload text);
SELECT extensions.dblink_disconnect('post_outcome_commit_resolver');
SELECT extensions.dblink_disconnect('post_outcome_commit_writer');

SELECT extensions.ok(
  (SELECT payload ->> 'status' = 'committed'
     AND payload ->> 'postId' = (
       SELECT payload ->> 'postId'
       FROM csf_post_outcome_results
       WHERE key = 'commit_write'
     )
     AND payload ->> 'action' = 'post_created'
   FROM csf_post_outcome_results WHERE key = 'commit_resolution'),
  'after commit the queued resolver resolves the exact committed mutation'
);
SELECT extensions.ok(
  (SELECT (
      SELECT pg_catalog.array_agg(outcome_key.key ORDER BY outcome_key.key)
      FROM pg_catalog.jsonb_object_keys(payload) AS outcome_key(key)
    ) = ARRAY['action', 'postId', 'status']::text[]
   FROM csf_post_outcome_results WHERE key = 'commit_resolution'),
  'a committed resolution carries only action, postId, and status'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcements
   WHERE id = (
     SELECT (payload ->> 'postId')::uuid
     FROM csf_post_outcome_results
     WHERE key = 'commit_write'
   )),
  1,
  'the committed scenario persists exactly the post returned by the mutation'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = (
     SELECT request_id FROM csf_post_outcome_requests WHERE key = 'commit'
   )
     AND source_type = 'post_mutation_request'),
  1,
  'resolution reads the committed receipt without writing another'
);

-- Scenario two: the mutation transaction rolls back after the resolver queues.
SELECT extensions.dblink_connect(
  'post_outcome_rollback_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec('post_outcome_rollback_writer', 'BEGIN');
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'rollback_write', payload::jsonb
FROM extensions.dblink(
  'post_outcome_rollback_writer',
  (SELECT pg_catalog.format(
    $query$
      SELECT plugin_data.csf_mutate_post(
        'fcde1001-0000-4000-8000-000000000001'::uuid,
        'create',
        NULL,
        '{"title":"Outcome rollback probe","body":"Synthetic rollback fixture.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
        'fcde0001-0000-4000-8000-000000000001'::uuid,
        %L::uuid
      )::text
    $query$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'rollback')
) AS result(payload text);
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'rollback_writer_pid', pg_catalog.jsonb_build_object('pid', payload::integer)
FROM extensions.dblink(
  'post_outcome_rollback_writer',
  'SELECT pg_catalog.pg_backend_pid()::text'
) AS result(payload text);

SELECT extensions.dblink_connect(
  'post_outcome_rollback_resolver',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'rollback_resolver_pid', pg_catalog.jsonb_build_object('pid', payload::integer)
FROM extensions.dblink(
  'post_outcome_rollback_resolver',
  'SELECT pg_catalog.pg_backend_pid()::text'
) AS result(payload text);
SELECT extensions.dblink_send_query(
  'post_outcome_rollback_resolver',
  (SELECT pg_catalog.format(
    $query$
      SELECT plugin_data.csf_resolve_post_mutation_outcome(
        'fcde1001-0000-4000-8000-000000000001'::uuid,
        'fcde0001-0000-4000-8000-000000000001'::uuid,
        %L::uuid
      )::text
    $query$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'rollback')
);

DO $wait_for_rollback_overlap$
DECLARE
  v_request uuid := (
    SELECT request_id FROM csf_post_outcome_requests WHERE key = 'rollback'
  );
  v_key bigint := pg_catalog.hashtextextended(
    'plugin_data.csf_post_mutation_request:' ||
      'fcde1001-0000-4000-8000-000000000001' || ':' ||
      v_request::text,
    0
  );
  v_classid bigint := (v_key >> 32) & 4294967295;
  v_objid bigint := v_key & 4294967295;
  v_writer_pid integer := (
    SELECT (payload ->> 'pid')::integer
    FROM csf_post_outcome_results
    WHERE key = 'rollback_writer_pid'
  );
  v_resolver_pid integer := (
    SELECT (payload ->> 'pid')::integer
    FROM csf_post_outcome_results
    WHERE key = 'rollback_resolver_pid'
  );
  v_waiting boolean := false;
  v_holder_shares boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks AS waiter
      WHERE waiter.locktype = 'advisory'
        AND NOT waiter.granted
        AND waiter.objsubid = 1
        AND waiter.classid::bigint = v_classid
        AND waiter.objid::bigint = v_objid
        AND waiter.pid = v_resolver_pid
    )
    INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_locks AS holder
    WHERE holder.locktype = 'advisory'
      AND holder.granted
      AND holder.objsubid = 1
      AND holder.classid::bigint = v_classid
      AND holder.objid::bigint = v_objid
      AND holder.pid = v_writer_pid
  )
  INTO v_holder_shares;
  INSERT INTO csf_post_outcome_results (key, payload)
  VALUES (
    'rollback_overlap',
    pg_catalog.jsonb_build_object(
      'resolverWaiting', v_waiting,
      'writerHoldsSameKey', v_holder_shares
    )
  );
END
$wait_for_rollback_overlap$;

SELECT extensions.ok(
  (SELECT payload ->> 'status' = 'published'
     AND (payload ->> 'idempotent')::boolean = false
   FROM csf_post_outcome_results WHERE key = 'rollback_write'),
  'the doomed writer transaction performs a real post mutation before rollback'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'resolverWaiting')::boolean
   FROM csf_post_outcome_results WHERE key = 'rollback_overlap'),
  'the exact resolver backend is observed waiting on the doomed request advisory key'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'writerHoldsSameKey')::boolean
   FROM csf_post_outcome_results WHERE key = 'rollback_overlap'),
  'the doomed writer transaction holds the exact advisory key the resolver waits on'
);

SELECT extensions.dblink_exec('post_outcome_rollback_writer', 'ROLLBACK');
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'rollback_resolution', payload::jsonb
FROM extensions.dblink_get_result('post_outcome_rollback_resolver', false)
  AS result(payload text);
SELECT extensions.dblink_disconnect('post_outcome_rollback_resolver');
SELECT extensions.dblink_disconnect('post_outcome_rollback_writer');

SELECT extensions.ok(
  (SELECT payload ->> 'status' = 'not_written'
     AND (
       SELECT pg_catalog.array_agg(outcome_key.key ORDER BY outcome_key.key)
       FROM pg_catalog.jsonb_object_keys(payload) AS outcome_key(key)
     ) = ARRAY['status']::text[]
   FROM csf_post_outcome_results WHERE key = 'rollback_resolution'),
  'after rollback the queued resolver resolves not_written without invented post state'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcements
   WHERE id = (
     SELECT (payload ->> 'postId')::uuid
     FROM csf_post_outcome_results
     WHERE key = 'rollback_write'
   )),
  0,
  'the rolled-back scenario persists no post under the returned postId'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = (
     SELECT request_id FROM csf_post_outcome_requests WHERE key = 'rollback'
   )),
  0,
  'the rolled-back scenario persists no receipt'
);

-- Denials run against the genuinely committed receipt from scenario one; no
-- receipt row is ever fabricated by hand.
UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = 'fcde1001-0000-4000-8000-000000000001'
  AND user_id = 'fcde0001-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  (SELECT pg_catalog.format(
    $$ SELECT plugin_data.csf_resolve_post_mutation_outcome(
      'fcde1001-0000-4000-8000-000000000001',
      'fcde0001-0000-4000-8000-000000000001',
      %L
    ) $$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'commit'),
  'P0001',
  'Not authorized to manage CSF posts.',
  'a revoked officer cannot resolve a committed request outcome'
);
UPDATE public.organization_members SET status = 'active'
WHERE organization_id = 'fcde1001-0000-4000-8000-000000000001'
  AND user_id = 'fcde0001-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  (SELECT pg_catalog.format(
    $$ SELECT plugin_data.csf_resolve_post_mutation_outcome(
      'fcde1001-0000-4000-8000-000000000001',
      'fcde0001-0000-4000-8000-000000000002',
      %L
    ) $$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'commit'),
  'P0001',
  'Not authorized to manage CSF posts.',
  'a foreign chapter officer cannot resolve another chapter outcome'
);
SELECT extensions.is(
  (SELECT plugin_data.csf_resolve_post_mutation_outcome(
    'fcde1001-0000-4000-8000-000000000002',
    'fcde0001-0000-4000-8000-000000000002',
    (SELECT request_id FROM csf_post_outcome_requests WHERE key = 'commit')
  ) ->> 'status'),
  'not_written',
  'a foreign chapter request lookup cannot surface another chapter receipt'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_resolve_post_mutation_outcome(
    'fcde1001-0000-4000-8000-000000000001',
    'fcde0001-0000-4000-8000-000000000001',
    NULL
  ) $$,
  'P0001',
  'A stable post request identifier is required.',
  'outcome resolution requires a stable request identifier'
);

-- Same-chapter privacy: a second, genuinely authorized org-A admin still may
-- not learn about actor A's committed request. The resolver binds outcomes to
-- the requesting actor, so a peer lookup resolves the exact bounded
-- not-written shape and nothing from the receipt.
SELECT extensions.is(
  plugin_data.csf_resolve_post_mutation_outcome(
    'fcde1001-0000-4000-8000-000000000001',
    'fcde0001-0000-4000-8000-000000000003',
    (SELECT request_id FROM csf_post_outcome_requests WHERE key = 'commit')
  ),
  pg_catalog.jsonb_build_object('status', 'not_written'),
  'a second active same-chapter admin resolves only a bounded not_written for a peer request'
);

-- Scenario three: authorization is re-checked after the advisory-lock wait. A
-- real writer holds the reauth request key while the resolver queues behind
-- it; actor A is revoked only once the resolver is provably waiting, then the
-- writer rolls back. The resolver must fail its post-wait authorization check.
-- dblink_get_result would surface the remote error and abort the pgTAP run,
-- so the resolver connection carries a session-temporary SECURITY INVOKER
-- capture helper that calls the real resolver and returns only the bounded
-- sqlstate and message; it dies with the connection.
SELECT extensions.dblink_connect(
  'post_outcome_reauth_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec('post_outcome_reauth_writer', 'BEGIN');
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'reauth_write', payload::jsonb
FROM extensions.dblink(
  'post_outcome_reauth_writer',
  (SELECT pg_catalog.format(
    $query$
      SELECT plugin_data.csf_mutate_post(
        'fcde1001-0000-4000-8000-000000000001'::uuid,
        'create',
        NULL,
        '{"title":"Outcome reauth probe","body":"Synthetic reauthorization fixture.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
        'fcde0001-0000-4000-8000-000000000001'::uuid,
        %L::uuid
      )::text
    $query$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'reauth')
) AS result(payload text);
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'reauth_writer_pid', pg_catalog.jsonb_build_object('pid', payload::integer)
FROM extensions.dblink(
  'post_outcome_reauth_writer',
  'SELECT pg_catalog.pg_backend_pid()::text'
) AS result(payload text);

SELECT extensions.dblink_connect(
  'post_outcome_reauth_resolver',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'reauth_resolver_pid', pg_catalog.jsonb_build_object('pid', payload::integer)
FROM extensions.dblink(
  'post_outcome_reauth_resolver',
  'SELECT pg_catalog.pg_backend_pid()::text'
) AS result(payload text);
SELECT extensions.dblink_exec(
  'post_outcome_reauth_resolver',
  $setup$
    CREATE FUNCTION pg_temp.csf_capture_post_outcome(
      p_organization_id uuid,
      p_actor_user_id uuid,
      p_request_id uuid
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = ''
    AS $capture$
    DECLARE
      v_sqlstate text;
      v_message text;
    BEGIN
      PERFORM plugin_data.csf_resolve_post_mutation_outcome(
        p_organization_id,
        p_actor_user_id,
        p_request_id
      );
      RETURN pg_catalog.jsonb_build_object(
        'sqlstate', '00000',
        'message', 'resolver returned without error'
      )::text;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_message = MESSAGE_TEXT;
      RETURN pg_catalog.jsonb_build_object(
        'sqlstate', v_sqlstate,
        'message', v_message
      )::text;
    END
    $capture$;
    REVOKE ALL ON FUNCTION pg_temp.csf_capture_post_outcome(uuid, uuid, uuid) FROM PUBLIC;
  $setup$
);
SELECT extensions.dblink_send_query(
  'post_outcome_reauth_resolver',
  (SELECT pg_catalog.format(
    $query$
      SELECT pg_temp.csf_capture_post_outcome(
        'fcde1001-0000-4000-8000-000000000001'::uuid,
        'fcde0001-0000-4000-8000-000000000001'::uuid,
        %L::uuid
      )
    $query$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'reauth')
);

DO $wait_for_reauth_overlap$
DECLARE
  v_request uuid := (
    SELECT request_id FROM csf_post_outcome_requests WHERE key = 'reauth'
  );
  v_key bigint := pg_catalog.hashtextextended(
    'plugin_data.csf_post_mutation_request:' ||
      'fcde1001-0000-4000-8000-000000000001' || ':' ||
      v_request::text,
    0
  );
  v_classid bigint := (v_key >> 32) & 4294967295;
  v_objid bigint := v_key & 4294967295;
  v_writer_pid integer := (
    SELECT (payload ->> 'pid')::integer
    FROM csf_post_outcome_results
    WHERE key = 'reauth_writer_pid'
  );
  v_resolver_pid integer := (
    SELECT (payload ->> 'pid')::integer
    FROM csf_post_outcome_results
    WHERE key = 'reauth_resolver_pid'
  );
  v_waiting boolean := false;
  v_holder_shares boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks AS waiter
      WHERE waiter.locktype = 'advisory'
        AND NOT waiter.granted
        AND waiter.objsubid = 1
        AND waiter.classid::bigint = v_classid
        AND waiter.objid::bigint = v_objid
        AND waiter.pid = v_resolver_pid
    )
    INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_locks AS holder
    WHERE holder.locktype = 'advisory'
      AND holder.granted
      AND holder.objsubid = 1
      AND holder.classid::bigint = v_classid
      AND holder.objid::bigint = v_objid
      AND holder.pid = v_writer_pid
  )
  INTO v_holder_shares;
  INSERT INTO csf_post_outcome_results (key, payload)
  VALUES (
    'reauth_overlap',
    pg_catalog.jsonb_build_object(
      'resolverWaiting', v_waiting,
      'writerHoldsSameKey', v_holder_shares
    )
  );
END
$wait_for_reauth_overlap$;

SELECT extensions.ok(
  (SELECT payload ->> 'status' = 'published'
     AND (payload ->> 'idempotent')::boolean = false
   FROM csf_post_outcome_results WHERE key = 'reauth_write'),
  'the reauthorization writer performs a real post mutation before any revocation'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'resolverWaiting')::boolean
   FROM csf_post_outcome_results WHERE key = 'reauth_overlap'),
  'the resolver backend is observed waiting ungranted on the reauth advisory key before revocation'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'writerHoldsSameKey')::boolean
   FROM csf_post_outcome_results WHERE key = 'reauth_overlap'),
  'the open writer holds the exact advisory key the queued resolver waits on'
);

-- Revocation commits (autocommit) strictly after the waiting proof and
-- strictly before the writer releases the lock, so a passing test can only
-- come from an authorization check performed after the wait completes.
UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = 'fcde1001-0000-4000-8000-000000000001'
  AND user_id = 'fcde0001-0000-4000-8000-000000000001';
SELECT extensions.dblink_exec('post_outcome_reauth_writer', 'ROLLBACK');
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'reauth_resolution', payload::jsonb
FROM extensions.dblink_get_result('post_outcome_reauth_resolver', false)
  AS result(payload text);
SELECT extensions.dblink_disconnect('post_outcome_reauth_resolver');
SELECT extensions.dblink_disconnect('post_outcome_reauth_writer');

SELECT extensions.is(
  (SELECT payload ->> 'sqlstate'
   FROM csf_post_outcome_results WHERE key = 'reauth_resolution'),
  'P0001',
  'the resolver revoked mid-wait fails with SQLSTATE P0001 after acquiring the lock'
);
SELECT extensions.is(
  (SELECT payload ->> 'message'
   FROM csf_post_outcome_results WHERE key = 'reauth_resolution'),
  'Not authorized to manage CSF posts.',
  'the post-wait authorization failure carries the exact management denial message'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcements
   WHERE id = (
     SELECT (payload ->> 'postId')::uuid
     FROM csf_post_outcome_results
     WHERE key = 'reauth_write'
   )),
  0,
  'the rolled-back reauthorization scenario persists no post under the returned postId'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = (
     SELECT request_id FROM csf_post_outcome_requests WHERE key = 'reauth'
   )),
  0,
  'the rolled-back reauthorization scenario persists no receipt'
);

UPDATE public.organization_members SET status = 'active'
WHERE organization_id = 'fcde1001-0000-4000-8000-000000000001'
  AND user_id = 'fcde0001-0000-4000-8000-000000000001';

-- Scenario four: authorization is also checked BEFORE the advisory-lock wait.
-- A real writer transaction holds the preauth request key for the whole
-- scenario. Actor A is revoked (committed in autocommit) before the resolver
-- is invoked as actor A through the same bounded pg_temp SECURITY INVOKER
-- capture helper, so a resolver that authorizes up front must complete with
-- the exact P0001 denial while the writer still holds the key. Completion is
-- observed by dblink_is_busy polling — never by sleeping and hoping — and the
-- resolver backend pid must never appear in pg_locks as an ungranted waiter
-- on that advisory key. A resolver that only authorized after the lock wait
-- would sit queued behind the open writer and fail these assertions.
SELECT extensions.dblink_connect(
  'post_outcome_preauth_writer',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
SELECT extensions.dblink_exec('post_outcome_preauth_writer', 'BEGIN');
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'preauth_write', payload::jsonb
FROM extensions.dblink(
  'post_outcome_preauth_writer',
  (SELECT pg_catalog.format(
    $query$
      SELECT plugin_data.csf_mutate_post(
        'fcde1001-0000-4000-8000-000000000001'::uuid,
        'create',
        NULL,
        '{"title":"Outcome preauth probe","body":"Synthetic preauthorization fixture.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
        'fcde0001-0000-4000-8000-000000000001'::uuid,
        %L::uuid
      )::text
    $query$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'preauth')
) AS result(payload text);
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'preauth_writer_pid', pg_catalog.jsonb_build_object('pid', payload::integer)
FROM extensions.dblink(
  'post_outcome_preauth_writer',
  'SELECT pg_catalog.pg_backend_pid()::text'
) AS result(payload text);

SELECT extensions.dblink_connect(
  'post_outcome_preauth_resolver',
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'preauth_resolver_pid', pg_catalog.jsonb_build_object('pid', payload::integer)
FROM extensions.dblink(
  'post_outcome_preauth_resolver',
  'SELECT pg_catalog.pg_backend_pid()::text'
) AS result(payload text);
SELECT extensions.dblink_exec(
  'post_outcome_preauth_resolver',
  $setup$
    CREATE FUNCTION pg_temp.csf_capture_post_outcome(
      p_organization_id uuid,
      p_actor_user_id uuid,
      p_request_id uuid
    )
    RETURNS text
    LANGUAGE plpgsql
    SECURITY INVOKER
    SET search_path = ''
    AS $capture$
    DECLARE
      v_sqlstate text;
      v_message text;
    BEGIN
      PERFORM plugin_data.csf_resolve_post_mutation_outcome(
        p_organization_id,
        p_actor_user_id,
        p_request_id
      );
      RETURN pg_catalog.jsonb_build_object(
        'sqlstate', '00000',
        'message', 'resolver returned without error'
      )::text;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_message = MESSAGE_TEXT;
      RETURN pg_catalog.jsonb_build_object(
        'sqlstate', v_sqlstate,
        'message', v_message
      )::text;
    END
    $capture$;
    REVOKE ALL ON FUNCTION pg_temp.csf_capture_post_outcome(uuid, uuid, uuid) FROM PUBLIC;
  $setup$
);

-- The revocation commits strictly before the resolver is invoked, while the
-- writer transaction stays open on the preauth key.
UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = 'fcde1001-0000-4000-8000-000000000001'
  AND user_id = 'fcde0001-0000-4000-8000-000000000001';

SELECT extensions.dblink_send_query(
  'post_outcome_preauth_resolver',
  (SELECT pg_catalog.format(
    $query$
      SELECT pg_temp.csf_capture_post_outcome(
        'fcde1001-0000-4000-8000-000000000001'::uuid,
        'fcde0001-0000-4000-8000-000000000001'::uuid,
        %L::uuid
      )
    $query$,
    request.request_id
  )
   FROM csf_post_outcome_requests AS request
   WHERE request.key = 'preauth')
);

DO $wait_for_preauth_denial$
DECLARE
  v_request uuid := (
    SELECT request_id FROM csf_post_outcome_requests WHERE key = 'preauth'
  );
  v_key bigint := pg_catalog.hashtextextended(
    'plugin_data.csf_post_mutation_request:' ||
      'fcde1001-0000-4000-8000-000000000001' || ':' ||
      v_request::text,
    0
  );
  v_classid bigint := (v_key >> 32) & 4294967295;
  v_objid bigint := v_key & 4294967295;
  v_writer_pid integer := (
    SELECT (payload ->> 'pid')::integer
    FROM csf_post_outcome_results
    WHERE key = 'preauth_writer_pid'
  );
  v_resolver_pid integer := (
    SELECT (payload ->> 'pid')::integer
    FROM csf_post_outcome_results
    WHERE key = 'preauth_resolver_pid'
  );
  v_busy integer := 1;
  v_sampled_waiting boolean := false;
  v_ever_waited boolean := false;
  v_writer_still_holds boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '2 seconds';
BEGIN
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks AS waiter
      WHERE waiter.locktype = 'advisory'
        AND NOT waiter.granted
        AND waiter.objsubid = 1
        AND waiter.classid::bigint = v_classid
        AND waiter.objid::bigint = v_objid
        AND waiter.pid = v_resolver_pid
    )
    INTO v_sampled_waiting;
    v_ever_waited := v_ever_waited OR v_sampled_waiting;
    SELECT extensions.dblink_is_busy('post_outcome_preauth_resolver')
    INTO v_busy;
    EXIT WHEN v_busy = 0 OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_locks AS holder
    WHERE holder.locktype = 'advisory'
      AND holder.granted
      AND holder.objsubid = 1
      AND holder.classid::bigint = v_classid
      AND holder.objid::bigint = v_objid
      AND holder.pid = v_writer_pid
  )
  INTO v_writer_still_holds;
  INSERT INTO csf_post_outcome_results (key, payload)
  VALUES (
    'preauth_denial_timing',
    pg_catalog.jsonb_build_object(
      'completedBeforeRelease', v_busy = 0,
      'everWaitedOnKey', v_ever_waited,
      'writerStillHoldsKey', v_writer_still_holds
    )
  );
END
$wait_for_preauth_denial$;

-- The writer releases only after the completion evidence is recorded; the
-- rollback here also guarantees dblink_get_result cannot hang if a wrong
-- implementation queued behind the lock.
SELECT extensions.dblink_exec('post_outcome_preauth_writer', 'ROLLBACK');
INSERT INTO csf_post_outcome_results (key, payload)
SELECT 'preauth_resolution', payload::jsonb
FROM extensions.dblink_get_result('post_outcome_preauth_resolver', false)
  AS result(payload text);
SELECT extensions.dblink_disconnect('post_outcome_preauth_resolver');
SELECT extensions.dblink_disconnect('post_outcome_preauth_writer');

SELECT extensions.ok(
  (SELECT payload ->> 'status' = 'published'
     AND (payload ->> 'idempotent')::boolean = false
   FROM csf_post_outcome_results WHERE key = 'preauth_write'),
  'the preauthorization writer performs a real post mutation before actor revocation'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'completedBeforeRelease')::boolean
   FROM csf_post_outcome_results WHERE key = 'preauth_denial_timing'),
  'the revoked resolver call completes before the writer releases the advisory key'
);
SELECT extensions.ok(
  (SELECT (payload ->> 'writerStillHoldsKey')::boolean
   FROM csf_post_outcome_results WHERE key = 'preauth_denial_timing'),
  'the writer still holds the exact preauth advisory key when the denial completes'
);
SELECT extensions.ok(
  (SELECT NOT (payload ->> 'everWaitedOnKey')::boolean
   FROM csf_post_outcome_results WHERE key = 'preauth_denial_timing'),
  'the revoked resolver backend never appears as an ungranted waiter on the preauth advisory key'
);
SELECT extensions.is(
  (SELECT payload ->> 'sqlstate'
   FROM csf_post_outcome_results WHERE key = 'preauth_resolution'),
  'P0001',
  'the resolver revoked before invocation fails with SQLSTATE P0001 without touching the lock'
);
SELECT extensions.is(
  (SELECT payload ->> 'message'
   FROM csf_post_outcome_results WHERE key = 'preauth_resolution'),
  'Not authorized to manage CSF posts.',
  'the pre-lock authorization failure carries the exact management denial message'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcements
   WHERE id = (
     SELECT (payload ->> 'postId')::uuid
     FROM csf_post_outcome_results
     WHERE key = 'preauth_write'
   )),
  0,
  'the rolled-back preauthorization scenario persists no post under the returned postId'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE correlation_id = (
     SELECT request_id FROM csf_post_outcome_requests WHERE key = 'preauth'
   )),
  0,
  'the rolled-back preauthorization scenario persists no receipt'
);

UPDATE public.organization_members SET status = 'active'
WHERE organization_id = 'fcde1001-0000-4000-8000-000000000001'
  AND user_id = 'fcde0001-0000-4000-8000-000000000001';

-- dblink committed durable org-A rows. The audit receipt is immutable at
-- runtime and this file never bypasses triggers, so the org-A fixture chain
-- (user, org, membership, posts, receipts) intentionally stays in its
-- dedicated fcde namespace; fresh per-run request UUIDs keep reruns collision
-- free. Org B and the second org-A admin carry no receipts and are removed
-- normally.
DELETE FROM public.organization_members
WHERE organization_id = 'fcde1001-0000-4000-8000-000000000001'
  AND user_id = 'fcde0001-0000-4000-8000-000000000003';
DELETE FROM auth.users
WHERE id = 'fcde0001-0000-4000-8000-000000000003';
DELETE FROM public.organization_members
WHERE organization_id = 'fcde1001-0000-4000-8000-000000000002';
DELETE FROM public.organizations
WHERE id = 'fcde1001-0000-4000-8000-000000000002';
DELETE FROM auth.users
WHERE id = 'fcde0001-0000-4000-8000-000000000002';

DROP TABLE csf_post_outcome_results;
DROP TABLE csf_post_outcome_requests;

SELECT * FROM extensions.finish();
