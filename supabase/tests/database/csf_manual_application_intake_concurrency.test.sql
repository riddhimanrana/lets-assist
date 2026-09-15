CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('ac000000-0000-4000-8000-000000000001','authenticated','authenticated','intake-race-admin@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code) VALUES
('ac100000-0000-4000-8000-000000000001','Application intake race fixture','csf-intake-race-fixture','school','850002');
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES
('ac100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001','admin','active');
INSERT INTO plugin_data.csf_terms(id,organization_id,code,label,school_year,semester) VALUES
('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','F29','Fall 2029','2029-2030','fall');
INSERT INTO plugin_data.csf_cohorts(id,organization_id,graduation_year,label) VALUES
('ac500000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001',2030,'Class of 2030');
INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name) VALUES
('ac300000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','Concurrent','Applicant','concurrent','applicant');

SELECT extensions.dblink_connect('intake_closer','hostaddr='||coalesce(host(inet_server_addr()),'127.0.0.1')||' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
SELECT extensions.dblink_connect('intake_applicant','hostaddr='||coalesce(host(inet_server_addr()),'127.0.0.1')||' port='||current_setting('port')||' dbname='||current_database()||' user='||current_user||' password='||current_user||' sslmode=disable');
CREATE TEMP TABLE intake_closer_pid AS
SELECT pid FROM extensions.dblink('intake_closer','SELECT pg_backend_pid()') AS result(pid integer);
CREATE TEMP TABLE intake_applicant_pid AS
SELECT pid FROM extensions.dblink('intake_applicant','SELECT pg_backend_pid()') AS result(pid integer);
CREATE TEMP TABLE intake_lock_key AS
SELECT pg_catalog.hashtextextended(
  'ac100000-0000-4000-8000-000000000001:ac200000-0000-4000-8000-000000000001',
  0
) AS value;

SELECT extensions.dblink_send_query(
  'intake_closer',
  $query$
    WITH closed AS MATERIALIZED (
      SELECT plugin_data.csf_set_application_intake(
        'ac100000-0000-4000-8000-000000000001',
        'ac200000-0000-4000-8000-000000000001',
        false,
        'ac000000-0000-4000-8000-000000000001'
      ) AS result
    )
    SELECT closed.result::text
    FROM closed
    CROSS JOIN LATERAL (
      SELECT pg_sleep(2 + pg_catalog.length(closed.result::text) * 0)
    ) AS delayed
  $query$
);

DO $$
BEGIN
  FOR attempt IN 1..100 LOOP
    EXIT WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks, intake_closer_pid, intake_lock_key
      WHERE pg_locks.pid = intake_closer_pid.pid
        AND pg_locks.locktype = 'advisory'
        AND pg_locks.granted
        AND pg_locks.classid::bigint = ((intake_lock_key.value >> 32) & 4294967295)
        AND pg_locks.objid::bigint = (intake_lock_key.value & 4294967295)
        AND pg_locks.objsubid = 1
    );
    PERFORM pg_catalog.pg_sleep(0.02);
  END LOOP;
END;
$$;

SELECT extensions.ok(
  (SELECT count(*) = 1 FROM pg_catalog.pg_locks, intake_closer_pid, intake_lock_key
    WHERE pg_locks.pid = intake_closer_pid.pid
      AND pg_locks.locktype = 'advisory'
      AND pg_locks.granted
      AND pg_locks.classid::bigint = ((intake_lock_key.value >> 32) & 4294967295)
      AND pg_locks.objid::bigint = (intake_lock_key.value & 4294967295)
      AND pg_locks.objsubid = 1),
  'the concurrent close holds the canonical term advisory lock'
);

SELECT extensions.dblink_send_query(
  'intake_applicant',
  $query$
    INSERT INTO plugin_data.csf_term_applications(
      organization_id,profile_id,cohort_id,term_id,source,status
    ) VALUES (
      'ac100000-0000-4000-8000-000000000001',
      'ac300000-0000-4000-8000-000000000001',
      'ac500000-0000-4000-8000-000000000001',
      'ac200000-0000-4000-8000-000000000001',
      'native','submitted'
    )
  $query$
);

DO $$
BEGIN
  FOR attempt IN 1..100 LOOP
    EXIT WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.pg_locks, intake_applicant_pid, intake_lock_key
      WHERE pg_locks.pid = intake_applicant_pid.pid
        AND pg_locks.locktype = 'advisory'
        AND NOT pg_locks.granted
        AND pg_locks.classid::bigint = ((intake_lock_key.value >> 32) & 4294967295)
        AND pg_locks.objid::bigint = (intake_lock_key.value & 4294967295)
        AND pg_locks.objsubid = 1
    );
    PERFORM pg_catalog.pg_sleep(0.02);
  END LOOP;
END;
$$;
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_locks, intake_applicant_pid, intake_lock_key
    WHERE pg_locks.pid = intake_applicant_pid.pid
      AND pg_locks.locktype = 'advisory'
      AND NOT pg_locks.granted
      AND pg_locks.classid::bigint = ((intake_lock_key.value >> 32) & 4294967295)
      AND pg_locks.objid::bigint = (intake_lock_key.value & 4294967295)
      AND pg_locks.objsubid = 1
  ),
  'the native insert waits on the same canonical term lock'
);
SELECT * FROM extensions.dblink_get_result('intake_closer',false) AS result(payload text);
SELECT * FROM extensions.dblink_get_result('intake_applicant',false) AS result(payload text);

SELECT extensions.ok(
  position('New applications are closed for this semester.' IN extensions.dblink_error_message('intake_applicant')) > 0,
  'a native insert queued behind a concurrent close observes the closed state'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_term_applications WHERE organization_id='ac100000-0000-4000-8000-000000000001'),
  0,
  'the losing concurrent insert creates no application'
);

SELECT extensions.dblink_disconnect('intake_closer');
SELECT extensions.dblink_disconnect('intake_applicant');

SELECT * FROM extensions.finish();
