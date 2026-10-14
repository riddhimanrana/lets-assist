-- READ ONLY: one SELECT, no claims/RPCs/settings/DDL/writes.
-- $1 = inspectCsfIsolatedWorkDir(workdir).runId;
-- $2 = inspectCsfIsolatedWorkDir(workdir).projectId.
-- Execute only after independently validating that exact ready marker, live
-- Docker ownership and loopback DB/API/Mailpit ports. Parameters alone cannot
-- prove which database this query is using. Retired dv7114 is always rejected.
-- Return aggregates only. No row identity, email, name or secret is emitted.
WITH binding AS (
  SELECT $1::text AS run_id, $2::text AS project_id,
    coalesce($1::text ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$'
      AND $1::text <> 'dv7114'
      AND $2::text = 'lets-assist-csf-browser-'||$1::text, false) AS valid
), expected AS MATERIALIZED (
  SELECT ('c8a61100-0001-4000-8000-'||lpad(n::text,12,'0'))::uuid AS id,
    'hours-acceptance-c8a61100-'||n||'@local.lets-assist.test' AS email,
    'ha_c8a61100_'||n AS username,
    'Fictional hours volunteer '||n AS auth_full_name
  FROM generate_series(1,1110) n
), scoped_users AS MATERIALIZED (
  SELECT users.* FROM auth.users users
  WHERE left(users.id::text,9) = 'c8a61100-'
    OR left(users.email,length('hours-acceptance-c8a61100-')) = 'hours-acceptance-c8a61100-'
    OR users.raw_app_meta_data->>'local_fixture_namespace' = 'hours-acceptance-c8a61100'
    OR users.raw_user_meta_data->>'local_fixture_namespace' = 'hours-acceptance-c8a61100'
), scoped_profiles AS MATERIALIZED (
  SELECT profiles.* FROM public.profiles profiles
  WHERE left(profiles.id::text,9) = 'c8a61100-'
    OR left(profiles.email,length('hours-acceptance-c8a61100-')) = 'hours-acceptance-c8a61100-'
    OR left(profiles.username,length('ha_c8a61100_')) = 'ha_c8a61100_'
    OR EXISTS(SELECT 1 FROM scoped_users users WHERE users.id = profiles.id)
), auth_checks AS (
  SELECT count(*)::integer AS scoped,
    count(*) FILTER (WHERE expected.id IS NOT NULL)::integer AS expected,
    count(*) FILTER (WHERE (
      expected.id IS NOT NULL
      AND users.email = expected.email
      AND users.aud = 'authenticated'
      AND users.role = 'authenticated'
      AND users.email_confirmed_at IS NOT NULL
      AND users.phone IS NULL
      AND coalesce(users.encrypted_password,'') = ''
      AND users.raw_user_meta_data->>'username' = expected.username
      AND users.raw_user_meta_data->>'full_name' = expected.auth_full_name
      AND users.raw_user_meta_data->'local_fixture' = 'true'::jsonb
      AND users.raw_app_meta_data->'local_fixture' = 'true'::jsonb
      AND users.raw_user_meta_data->>'local_fixture_namespace' = 'hours-acceptance-c8a61100'
      AND users.raw_app_meta_data->>'local_fixture_namespace' = 'hours-acceptance-c8a61100'
      AND users.raw_user_meta_data->>'local_fixture_run_id' = binding.run_id
      AND users.raw_app_meta_data->>'local_fixture_run_id' = binding.run_id
      AND users.raw_user_meta_data->>'local_fixture_project_id' = binding.project_id
      AND users.raw_app_meta_data->>'local_fixture_project_id' = binding.project_id
    ) IS NOT TRUE)::integer AS violations
  FROM scoped_users users LEFT JOIN expected ON expected.id = users.id CROSS JOIN binding
), profile_checks AS (
  SELECT count(*)::integer AS scoped,
    count(*) FILTER (WHERE expected.id IS NOT NULL)::integer AS expected,
    count(*) FILTER (WHERE (
      expected.id IS NOT NULL
      AND profiles.email = expected.email
      AND profiles.username = expected.username
      AND profiles.full_name = 'Fictional hours volunteer'
      AND profiles.phone IS NULL
      AND profiles.avatar_url IS NULL
      AND EXISTS(SELECT 1 FROM scoped_users users WHERE users.id = profiles.id)
    ) IS NOT TRUE)::integer AS violations
  FROM scoped_profiles profiles LEFT JOIN expected ON expected.id = profiles.id
)
SELECT jsonb_build_object(
  'proofVersion',1,
  'namespace','hours-acceptance-c8a61100',
  'exactMarkerBinding',binding.valid,
  'expectedIdentityCount',1110,
  'scopedAuthCount',auth_checks.scoped,
  'matchedAuthCount',auth_checks.expected,
  'authMappingViolations',auth_checks.violations,
  'scopedProfileCount',profile_checks.scoped,
  'matchedProfileCount',profile_checks.expected,
  'profileMappingViolations',profile_checks.violations,
  'proofValid',binding.valid
    AND auth_checks.scoped = 1110 AND auth_checks.expected = 1110 AND auth_checks.violations = 0
    AND profile_checks.scoped = 1110 AND profile_checks.expected = 1110 AND profile_checks.violations = 0
) AS value
FROM binding CROSS JOIN auth_checks CROSS JOIN profile_checks;
