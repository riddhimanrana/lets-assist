-- Prove that batch approval ignores client array order when it locks previews.
-- This fixture remains committed because the two dblink writers must see it.
-- The database replay is disposable. Import rows plus the test-only function
-- and trigger are removed before the file finishes. The organization, officer,
-- membership, and immutable audit rows remain until the isolated database is
-- discarded so cleanup cannot mutate the audit ledger.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(4);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'dfd7520e-db84-45e2-958a-b0c02a2dcd62',
  'authenticated', 'authenticated', 'batch-lock-order-officer@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'c0e2767b-bbca-47a1-8759-af35a6ed7d2b',
  'Canonical Batch Lock Fixtures', 'canonical-batch-lock-fixtures', 'school', '997231'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'c0e2767b-bbca-47a1-8759-af35a6ed7d2b',
  'dfd7520e-db84-45e2-958a-b0c02a2dcd62',
  'admin', 'active'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, provider, spreadsheet_id,
  drive_file_id, sync_status, settings
) VALUES (
  'f3f2c84e-5b6b-47fa-bb16-2c035b12fbd9',
  'c0e2767b-bbca-47a1-8759-af35a6ed7d2b',
  'student_roster', 'Batch lock source', 'google_sheets',
  'batch-lock-source', 'batch-lock-source', 'not_synced',
  '{"sourceKind":"student_roster","mappingVersion":1}'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  mapping_version
) VALUES
  (
    'c09fa116-2dc5-4e15-bc6f-3173c3dc3f59',
    'c0e2767b-bbca-47a1-8759-af35a6ed7d2b',
    'f3f2c84e-5b6b-47fa-bb16-2c035b12fbd9',
    'dfd7520e-db84-45e2-958a-b0c02a2dcd62',
    'preview', 'completed', 'student_roster', 1
  ),
  (
    '99308a09-a5ce-49df-bf05-82c91b2190ea',
    'c0e2767b-bbca-47a1-8759-af35a6ed7d2b',
    'f3f2c84e-5b6b-47fa-bb16-2c035b12fbd9',
    'dfd7520e-db84-45e2-958a-b0c02a2dcd62',
    'preview', 'completed', 'student_roster', 1
  );

CREATE OR REPLACE FUNCTION plugin_data.csf_test_import_batch_lock_barrier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request_id uuid;
BEGIN
  SELECT batch.request_id
  INTO v_request_id
  FROM plugin_data.csf_import_approval_batches AS batch
  WHERE batch.organization_id = NEW.organization_id
    AND batch.id = NEW.batch_id;

  IF v_request_id = '1182579e-6db4-42af-8463-0911a6797512'
    AND NEW.preview_job_id = 'c09fa116-2dc5-4e15-bc6f-3173c3dc3f59'
  THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(91234, 56789);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_test_import_batch_lock_barrier()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER csf_test_import_batch_lock_barrier
BEFORE INSERT ON plugin_data.csf_import_approval_batch_items
FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_test_import_batch_lock_barrier();

CREATE OR REPLACE FUNCTION plugin_data.csf_test_queue_import_batch_lock_order(
  p_preview_job_ids uuid[],
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'accepted',
    'receipt', plugin_data.csf_queue_import_preview_batch(
      'c0e2767b-bbca-47a1-8759-af35a6ed7d2b',
      'dfd7520e-db84-45e2-958a-b0c02a2dcd62',
      p_preview_job_ids,
      p_request_id
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'refused',
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_test_queue_import_batch_lock_order(uuid[], uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pg_temp.csf_import_batch_lock_dsn()
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

CREATE FUNCTION pg_temp.wait_for_import_batch_writer(p_connection text)
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

CREATE FUNCTION pg_temp.wait_for_import_batch_barrier(p_writer_pid integer)
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
      FROM pg_catalog.pg_locks AS lock
      WHERE lock.pid = p_writer_pid
        AND lock.locktype = 'advisory'
        AND NOT lock.granted
    ) INTO v_waiting;
    EXIT WHEN v_waiting OR pg_catalog.clock_timestamp() >= v_deadline;
    PERFORM pg_catalog.pg_sleep(0.01);
  END LOOP;
  RETURN v_waiting;
END;
$$;

CREATE TEMP TABLE csf_import_batch_lock_results (
  writer text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE csf_import_batch_writer_pids (
  writer text PRIMARY KEY,
  pid integer NOT NULL
) ON COMMIT PRESERVE ROWS;

SELECT extensions.dblink_connect(
  'csf_import_batch_barrier',
  pg_temp.csf_import_batch_lock_dsn()
);
SELECT extensions.dblink_connect(
  'csf_import_batch_writer_a',
  pg_temp.csf_import_batch_lock_dsn()
);
SELECT extensions.dblink_connect(
  'csf_import_batch_writer_b',
  pg_temp.csf_import_batch_lock_dsn()
);

SELECT extensions.dblink_exec(
  'csf_import_batch_barrier',
  'DO $lock$ BEGIN PERFORM pg_advisory_lock(91234, 56789); END $lock$'
);

INSERT INTO csf_import_batch_writer_pids (writer, pid)
SELECT 'a', pid
FROM extensions.dblink(
  'csf_import_batch_writer_a',
  'SELECT pg_backend_pid()'
) AS result(pid integer);

SELECT extensions.dblink_send_query(
  'csf_import_batch_writer_a',
  $query$
    SELECT plugin_data.csf_test_queue_import_batch_lock_order(
      ARRAY[
        'c09fa116-2dc5-4e15-bc6f-3173c3dc3f59',
        '99308a09-a5ce-49df-bf05-82c91b2190ea'
      ]::uuid[],
      '1182579e-6db4-42af-8463-0911a6797512'
    )::text
  $query$
);

SELECT extensions.ok(
  pg_temp.wait_for_import_batch_barrier(
    (SELECT pid FROM csf_import_batch_writer_pids WHERE writer = 'a')
  ),
  'the first approval pauses after locking the lower preview ID'
);

SELECT extensions.dblink_send_query(
  'csf_import_batch_writer_b',
  $query$
    SELECT plugin_data.csf_test_queue_import_batch_lock_order(
      ARRAY[
        '99308a09-a5ce-49df-bf05-82c91b2190ea',
        'c09fa116-2dc5-4e15-bc6f-3173c3dc3f59'
      ]::uuid[],
      'bea8f487-1329-40c5-bebb-71c0731ee1ed'
    )::text
  $query$
);

SELECT pg_catalog.pg_sleep(0.1);
SELECT extensions.is(
  extensions.dblink_is_busy('csf_import_batch_writer_b'),
  1,
  'the reverse-order approval waits on the same canonical first preview'
);

SELECT extensions.dblink_exec(
  'csf_import_batch_barrier',
  'DO $unlock$ BEGIN PERFORM pg_advisory_unlock(91234, 56789); END $unlock$'
);

SELECT extensions.ok(
  pg_temp.wait_for_import_batch_writer('csf_import_batch_writer_a')
    AND pg_temp.wait_for_import_batch_writer('csf_import_batch_writer_b'),
  'both overlapping approvals settle after the barrier is released'
);

INSERT INTO csf_import_batch_lock_results (writer, payload)
SELECT 'a', payload::jsonb
FROM extensions.dblink_get_result('csf_import_batch_writer_a', false)
  AS result(payload text);
INSERT INTO csf_import_batch_lock_results (writer, payload)
SELECT 'b', payload::jsonb
FROM extensions.dblink_get_result('csf_import_batch_writer_b', false)
  AS result(payload text);

SELECT extensions.ok(
  (
    SELECT pg_catalog.count(*) = 2
    FROM csf_import_batch_lock_results
    WHERE payload ->> 'outcome' = 'accepted'
      AND payload #>> '{receipt,replayed}' = 'false'
  )
  AND (
    SELECT pg_catalog.count(*) = 2
    FROM plugin_data.csf_import_approval_batches AS batch
    WHERE batch.organization_id = 'c0e2767b-bbca-47a1-8759-af35a6ed7d2b'
      AND batch.request_id IN (
        '1182579e-6db4-42af-8463-0911a6797512',
        'bea8f487-1329-40c5-bebb-71c0731ee1ed'
      )
  )
  AND (
    SELECT pg_catalog.count(*) = 4
    FROM plugin_data.csf_import_approval_batch_items AS item
    INNER JOIN plugin_data.csf_import_approval_batches AS batch
      ON batch.organization_id = item.organization_id
      AND batch.id = item.batch_id
    WHERE item.organization_id = 'c0e2767b-bbca-47a1-8759-af35a6ed7d2b'
      AND batch.request_id IN (
        '1182579e-6db4-42af-8463-0911a6797512',
        'bea8f487-1329-40c5-bebb-71c0731ee1ed'
      )
  ),
  'both opposite-order approvals produce complete durable receipts without deadlock'
);

SELECT extensions.dblink_disconnect('csf_import_batch_barrier');
SELECT extensions.dblink_disconnect('csf_import_batch_writer_a');
SELECT extensions.dblink_disconnect('csf_import_batch_writer_b');

DROP TRIGGER csf_test_import_batch_lock_barrier
  ON plugin_data.csf_import_approval_batch_items;
DROP FUNCTION plugin_data.csf_test_import_batch_lock_barrier();
DROP FUNCTION plugin_data.csf_test_queue_import_batch_lock_order(uuid[], uuid);

DELETE FROM plugin_data.csf_import_approval_batch_items
WHERE organization_id = 'c0e2767b-bbca-47a1-8759-af35a6ed7d2b';
DELETE FROM plugin_data.csf_import_approval_batches
WHERE organization_id = 'c0e2767b-bbca-47a1-8759-af35a6ed7d2b';
DELETE FROM plugin_data.csf_sheet_import_jobs
WHERE organization_id = 'c0e2767b-bbca-47a1-8759-af35a6ed7d2b';
DELETE FROM plugin_data.csf_sheet_sources
WHERE organization_id = 'c0e2767b-bbca-47a1-8759-af35a6ed7d2b';

SELECT * FROM extensions.finish();
