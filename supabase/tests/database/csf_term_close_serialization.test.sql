CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SELECT extensions.plan(4);

CREATE TEMP TABLE csf_term_close_serialization_fixture (
  admin_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  term_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  credit_id uuid NOT NULL,
  correlation_id uuid NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO csf_term_close_serialization_fixture
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid();

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) SELECT
  admin_id,
  'authenticated',
  'authenticated',
  'close-race-' || left(replace(admin_id::text, '-', ''), 12) || '@local.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
FROM csf_term_close_serialization_fixture;

INSERT INTO public.organizations (id, name, username, type, join_code)
SELECT
  organization_id,
  'CSF Close Serialization',
  'csf-close-serialization-' || left(replace(organization_id::text, '-', ''), 12),
  'school',
  (
    100000
    + (
      ('x' || substr(md5(organization_id::text), 1, 8))::bit(32)::bigint
      % 900000
    )
  )::text
FROM csf_term_close_serialization_fixture;

INSERT INTO public.organization_members (organization_id, user_id, role, status)
SELECT organization_id, admin_id, 'admin', 'active'
FROM csf_term_close_serialization_fixture;

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) SELECT
  term_id,
  organization_id,
  'S33-' || left(replace(term_id::text, '-', ''), 8),
  'Spring 2033',
  '2032-2033',
  'spring',
  'open',
  true
FROM csf_term_close_serialization_fixture;

INSERT INTO plugin_data.csf_term_policies (
  organization_id, term_id, policy_version, dues_required,
  total_points_required, max_drive_points, max_points_per_activity,
  required_meetings, allowed_absences
) SELECT
  organization_id,
  term_id,
  1,
  false,
  0,
  0,
  3,
  0,
  0
FROM csf_term_close_serialization_fixture;

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
SELECT cohort_id, organization_id, 2034, 'Class of 2034'
FROM csf_term_close_serialization_fixture;

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name,
  normalized_first_name, normalized_last_name
) SELECT
  profile_id,
  organization_id,
  'Concurrent',
  'Member',
  'concurrent',
  'member'
FROM csf_term_close_serialization_fixture;

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, status
) SELECT
  membership_id,
  organization_id,
  profile_id,
  term_id,
  cohort_id,
  'active'
FROM csf_term_close_serialization_fixture;

SELECT extensions.dblink_connect(
  'term_writer',
  -- Use the container interface rather than loopback. Supabase's local
  -- pg_hba trusts loopback, and dblink correctly refuses a non-superuser
  -- connection when the supplied password was not actually used.
  'hostaddr=' || host(inet_server_addr()) ||
  ' port=' || current_setting('port') ||
  ' dbname=' || current_database() ||
  -- The disposable local Supabase image uses its bootstrap role name as the
  -- bootstrap password. Build that connection value from the active role so
  -- no credential-shaped fixture is committed to the repository.
  ' user=' || current_user ||
  ' password=' || current_user ||
  ' sslmode=disable'
);

BEGIN;

SELECT plugin_data.csf_close_term_v2(
  (SELECT organization_id FROM csf_term_close_serialization_fixture),
  (SELECT term_id FROM csf_term_close_serialization_fixture),
  1,
  plugin_data.csf_term_closure_readiness(
    (SELECT organization_id FROM csf_term_close_serialization_fixture),
    (SELECT term_id FROM csf_term_close_serialization_fixture)
  )->>'evidenceHash',
  (SELECT admin_id FROM csf_term_close_serialization_fixture)
);

SELECT extensions.dblink_send_query(
  'term_writer',
  format(
    $query$
    INSERT INTO plugin_data.csf_credit_records (
      id, organization_id, profile_id, term_id,
      source, points, point_type, status
    ) VALUES (
      %L::uuid,
      %L::uuid,
      %L::uuid,
      %L::uuid,
      'manual', 1, 'non_drive', 'verified'
    )
    RETURNING id
    $query$,
    (SELECT credit_id FROM csf_term_close_serialization_fixture),
    (SELECT organization_id FROM csf_term_close_serialization_fixture),
    (SELECT profile_id FROM csf_term_close_serialization_fixture),
    (SELECT term_id FROM csf_term_close_serialization_fixture)
  )
);

SELECT pg_sleep(0.25);
SELECT extensions.is(
  extensions.dblink_is_busy('term_writer'),
  1,
  'a concurrent evidence insert waits on the semester-close transaction lock'
);

COMMIT;

SELECT *
FROM extensions.dblink_get_result('term_writer', false) AS result(id uuid);

SELECT extensions.ok(
  position(
    'Closed CSF semester evidence is immutable'
    IN extensions.dblink_error_message('term_writer')
  ) > 0,
  'the waiting writer fails after observing the committed closed semester'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_credit_records
    WHERE id = (SELECT credit_id FROM csf_term_close_serialization_fixture)
  ),
  0,
  'the concurrent insert is absent from the frozen semester'
);

SELECT extensions.dblink_disconnect('term_writer');

SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_reopen_term(
      (SELECT organization_id FROM csf_term_close_serialization_fixture),
      (SELECT term_id FROM csf_term_close_serialization_fixture),
      (SELECT active_closure_id FROM plugin_data.csf_terms
       WHERE id = (SELECT term_id FROM csf_term_close_serialization_fixture)),
      (SELECT closure_revision FROM plugin_data.csf_terms
       WHERE id = (SELECT term_id FROM csf_term_close_serialization_fixture)),
      'data_correction',
      'Reopen the synthetic term so the concurrency fixture can be removed.',
      (SELECT admin_id FROM csf_term_close_serialization_fixture),
      (SELECT correlation_id FROM csf_term_close_serialization_fixture)
    )
  $$,
  'the evidence guard preserves the audited semester-reopen path'
);

-- The close transaction intentionally commits so the second connection can
-- resume and observe the closed term. Keep this namespaced synthetic fixture
-- for the remainder of the disposable replay instead of defeating the
-- immutable-audit trigger with cleanup-only mutation.

SELECT * FROM extensions.finish();
