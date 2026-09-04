-- These probes run in real sessions because a single pgTAP transaction cannot
-- prove advisory-lock contention. No roster fixtures are needed: the committed
-- helper catches the expected validation error after each wrapper has taken its
-- organization identity lock.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(21);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role can enter the class-code join wrapper'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot enter the class-code join wrapper directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'the preserved class-code join body is owner-only'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'service_role can enter the passive confirmation wrapper'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'browser roles cannot enter the passive confirmation wrapper directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_confirm_class_code_account_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_confirm_class_code_account_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_confirm_class_code_account_name_match_identity_base(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'the preserved passive confirmation body is owner-only'
);

CREATE OR REPLACE FUNCTION plugin_data.csf_test_class_join_identity_lock_probe(
  p_boundary text,
  p_organization_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_boundary = 'join' THEN
    PERFORM plugin_data.csf_join_class_by_code(
      p_organization_id,
      'LOCK01',
      'c5f00000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'Lock',
      'Probe',
      NULL,
      NULL,
      NULL
    );
  ELSIF p_boundary = 'confirm' THEN
    PERFORM plugin_data.csf_confirm_class_code_account_name_match(
      p_organization_id,
      'c5f00000-0000-4000-8000-000000000002'::uuid,
      'c5f00000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'c5f00000-0000-4000-8000-000000000003'::uuid,
      'c5f00000-0000-4000-8000-000000000004'::uuid,
      'lock',
      'probe',
      pg_catalog.repeat('0', 64)
    );
  ELSIF p_boundary = 'confirm_v4' THEN
    PERFORM plugin_data.csf_confirm_class_code_account_name_match_v4(
      p_organization_id,
      'c5f00000-0000-4000-8000-000000000002'::uuid,
      'c5f00000-0000-4000-8000-000000000001'::uuid,
      NULL,
      'c5f00000-0000-4000-8000-000000000003'::uuid,
      'c5f00000-0000-4000-8000-000000000004'::uuid,
      'lock', 'probe', pg_catalog.repeat('0', 64)
    );
  ELSE
    RAISE EXCEPTION 'Unknown class join lock probe.';
  END IF;

  RETURN 'unexpected success';
EXCEPTION
  WHEN OTHERS THEN
    RETURN SQLSTATE || ':' || SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_test_class_join_identity_lock_probe(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pg_temp.csf_class_join_lock_dsn()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'hostaddr=' || host(inet_server_addr()) ||
    ' port=' || current_setting('port') ||
    ' dbname=' || current_database() ||
    ' user=' || current_user ||
    ' password=' || current_user ||
    ' sslmode=disable'
$$;

CREATE FUNCTION pg_temp.wait_for_csf_class_join_result(p_connection text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_complete boolean := false;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '5 seconds';
BEGIN
  LOOP
    v_complete := extensions.dblink_is_busy(p_connection) = 0;
    EXIT WHEN v_complete OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_complete;
END;
$$;

CREATE TEMP TABLE csf_class_join_lock_results (
  label text PRIMARY KEY,
  payload text NOT NULL
) ON COMMIT PRESERVE ROWS;

SELECT extensions.dblink_connect(
  'class_join_same_org',
  pg_temp.csf_class_join_lock_dsn()
);
SELECT extensions.dblink_connect(
  'class_join_cross_org',
  pg_temp.csf_class_join_lock_dsn()
);

BEGIN;
SELECT plugin_data.csf_lock_identity_mutation(
  'c5f00000-0000-4000-8000-000000000010'::uuid
);
SELECT extensions.dblink_send_query(
  'class_join_same_org',
  $query$
    SELECT plugin_data.csf_test_class_join_identity_lock_probe(
      'join',
      'c5f00000-0000-4000-8000-000000000010'::uuid
    )
  $query$
);
SELECT extensions.dblink_send_query(
  'class_join_cross_org',
  $query$
    SELECT plugin_data.csf_test_class_join_identity_lock_probe(
      'join',
      'c5f00000-0000-4000-8000-000000000020'::uuid
    )
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_class_join_result('class_join_cross_org'),
  'a cross-organization class-code join remains independent'
);
SELECT extensions.is(
  extensions.dblink_is_busy('class_join_same_org'),
  1,
  'a same-organization class-code join waits for the identity lock'
);
INSERT INTO csf_class_join_lock_results (label, payload)
SELECT 'join_cross_org', payload
FROM extensions.dblink_get_result('class_join_cross_org', false)
  AS result(payload text);
SELECT extensions.is(
  (SELECT payload FROM csf_class_join_lock_results WHERE label = 'join_cross_org'),
  'P0001:A verified account email is required.',
  'the cross-organization class-code join reaches the preserved body'
);
COMMIT;

SELECT extensions.ok(
  pg_temp.wait_for_csf_class_join_result('class_join_same_org'),
  'the same-organization class-code join completes after lock release'
);
INSERT INTO csf_class_join_lock_results (label, payload)
SELECT 'join_same_org', payload
FROM extensions.dblink_get_result('class_join_same_org', false)
  AS result(payload text);
SELECT extensions.is(
  (SELECT payload FROM csf_class_join_lock_results WHERE label = 'join_same_org'),
  'P0001:A verified account email is required.',
  'the queued class-code join delegates after acquiring the lock'
);

SELECT extensions.dblink_disconnect('class_join_same_org');
SELECT extensions.dblink_disconnect('class_join_cross_org');
SELECT extensions.dblink_connect(
  'class_confirm_same_org',
  pg_temp.csf_class_join_lock_dsn()
);
SELECT extensions.dblink_connect(
  'class_confirm_cross_org',
  pg_temp.csf_class_join_lock_dsn()
);

BEGIN;
SELECT plugin_data.csf_lock_identity_mutation(
  'c5f00000-0000-4000-8000-000000000010'::uuid
);
SELECT extensions.dblink_send_query(
  'class_confirm_same_org',
  $query$
    SELECT plugin_data.csf_test_class_join_identity_lock_probe(
      'confirm',
      'c5f00000-0000-4000-8000-000000000010'::uuid
    )
  $query$
);
SELECT extensions.dblink_send_query(
  'class_confirm_cross_org',
  $query$
    SELECT plugin_data.csf_test_class_join_identity_lock_probe(
      'confirm',
      'c5f00000-0000-4000-8000-000000000020'::uuid
    )
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_class_join_result('class_confirm_cross_org'),
  'a cross-organization passive confirmation remains independent'
);
SELECT extensions.is(
  extensions.dblink_is_busy('class_confirm_same_org'),
  1,
  'a same-organization passive confirmation waits for the identity lock'
);
INSERT INTO csf_class_join_lock_results (label, payload)
SELECT 'confirm_cross_org', payload
FROM extensions.dblink_get_result('class_confirm_cross_org', false)
  AS result(payload text);
SELECT extensions.is(
  (SELECT payload FROM csf_class_join_lock_results WHERE label = 'confirm_cross_org'),
  'P0001:A verified account email is required.',
  'the cross-organization passive confirmation reaches the preserved body'
);
COMMIT;

SELECT extensions.ok(
  pg_temp.wait_for_csf_class_join_result('class_confirm_same_org'),
  'the same-organization passive confirmation completes after lock release'
);
INSERT INTO csf_class_join_lock_results (label, payload)
SELECT 'confirm_same_org', payload
FROM extensions.dblink_get_result('class_confirm_same_org', false)
  AS result(payload text);
SELECT extensions.is(
  (SELECT payload FROM csf_class_join_lock_results WHERE label = 'confirm_same_org'),
  'P0001:A verified account email is required.',
  'the queued passive confirmation delegates after acquiring the lock'
);

SELECT extensions.dblink_disconnect('class_confirm_same_org');
SELECT extensions.dblink_disconnect('class_confirm_cross_org');

SELECT extensions.dblink_connect(
  'class_confirm_v4_same_org',
  pg_temp.csf_class_join_lock_dsn()
);
SELECT extensions.dblink_connect(
  'class_confirm_v4_cross_org',
  pg_temp.csf_class_join_lock_dsn()
);

BEGIN;
SELECT plugin_data.csf_lock_identity_mutation(
  'c5f00000-0000-4000-8000-000000000010'::uuid
);
SELECT extensions.dblink_send_query(
  'class_confirm_v4_same_org',
  $query$
    SELECT plugin_data.csf_test_class_join_identity_lock_probe(
      'confirm_v4',
      'c5f00000-0000-4000-8000-000000000010'::uuid
    )
  $query$
);
SELECT extensions.dblink_send_query(
  'class_confirm_v4_cross_org',
  $query$
    SELECT plugin_data.csf_test_class_join_identity_lock_probe(
      'confirm_v4',
      'c5f00000-0000-4000-8000-000000000020'::uuid
    )
  $query$
);
SELECT extensions.ok(
  pg_temp.wait_for_csf_class_join_result('class_confirm_v4_cross_org'),
  'a cross-organization version 4 confirmation remains independent'
);
SELECT extensions.is(
  extensions.dblink_is_busy('class_confirm_v4_same_org'),
  1,
  'a same-organization version 4 confirmation waits for the identity lock'
);
INSERT INTO csf_class_join_lock_results (label, payload)
SELECT 'confirm_v4_cross_org', payload
FROM extensions.dblink_get_result('class_confirm_v4_cross_org', false)
  AS result(payload text);
SELECT extensions.is(
  (SELECT payload FROM csf_class_join_lock_results WHERE label = 'confirm_v4_cross_org'),
  'P0001:A verified account email is required.',
  'the cross-organization version 4 confirmation reaches the claim body'
);
COMMIT;

SELECT extensions.ok(
  pg_temp.wait_for_csf_class_join_result('class_confirm_v4_same_org'),
  'the same-organization version 4 confirmation completes after lock release'
);
INSERT INTO csf_class_join_lock_results (label, payload)
SELECT 'confirm_v4_same_org', payload
FROM extensions.dblink_get_result('class_confirm_v4_same_org', false)
  AS result(payload text);
SELECT extensions.is(
  (SELECT payload FROM csf_class_join_lock_results WHERE label = 'confirm_v4_same_org'),
  'P0001:A verified account email is required.',
  'the queued version 4 confirmation continues after acquiring the lock'
);

SELECT extensions.dblink_disconnect('class_confirm_v4_same_org');
SELECT extensions.dblink_disconnect('class_confirm_v4_cross_org');

DROP FUNCTION plugin_data.csf_test_class_join_identity_lock_probe(text, uuid);

SELECT * FROM extensions.finish();
