BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'b5000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'activity-optional-start@local.test',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'b5100000-0000-4000-8000-000000000001',
  'Optional activity start fixture',
  'optional-activity-start-fixture',
  'school',
  '505505'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'b5100000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  'admin',
  'active'
);

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  lifecycle_status, is_current
) VALUES (
  'b5200000-0000-4000-8000-000000000001',
  'b5100000-0000-4000-8000-000000000001',
  'F40',
  'Fall 2040',
  '2040-2041',
  'fall',
  'open',
  true
);

SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'postgres',
    'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'the activity implementation remains owner-only'
);

SELECT extensions.ok(
  pg_get_functiondef(
    'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure
  ) NOT LIKE '%A start date is required before publishing.%'
  AND pg_get_functiondef(
    'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure
  ) LIKE '%The activity end time must be after its start time.%'
  AND pg_get_functiondef(
    'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure
  ) LIKE '%Add a start before giving the activity an end time.%'
  AND pg_get_functiondef(
    'plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)'::regprocedure
  ) LIKE '%Activity dates and linked project must be valid.%',
  'only the published start-date requirement is removed from the date guards'
);

SET LOCAL ROLE service_role;

SELECT extensions.lives_ok(
  $$SELECT plugin_data.csf_create_activity(
    'b5100000-0000-4000-8000-000000000001',
    'b5200000-0000-4000-8000-000000000001',
    NULL,
    '{"title":"Published without a start","status":"published","signupMode":"none","pointValue":1,"pointCap":1}'::jsonb,
    'b5000000-0000-4000-8000-000000000001',
    'b5300000-0000-4000-8000-000000000001'
  )$$,
  'a published activity may omit its start date'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT status
    FROM plugin_data.csf_opportunities
    WHERE organization_id = 'b5100000-0000-4000-8000-000000000001'
      AND title = 'Published without a start'
  ),
  'published',
  'the no-start activity is stored as published'
);

SELECT extensions.ok(
  (
    SELECT starts_at IS NULL AND published_at IS NOT NULL
    FROM plugin_data.csf_opportunities
    WHERE organization_id = 'b5100000-0000-4000-8000-000000000001'
      AND title = 'Published without a start'
  ),
  'the published activity keeps a null start and a publication timestamp'
);

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_activity(
    'b5100000-0000-4000-8000-000000000001',
    'b5200000-0000-4000-8000-000000000001',
    NULL,
    '{"title":"Published with only an end","status":"published","signupMode":"none","endsAt":"2040-09-15T17:00:00Z","pointValue":1,"pointCap":1}'::jsonb,
    'b5000000-0000-4000-8000-000000000001',
    'b5300000-0000-4000-8000-000000000004'
  )$$,
  'P0001',
  'Add a start before giving the activity an end time.',
  'an activity end without a start remains blocked'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_opportunities
    WHERE organization_id = 'b5100000-0000-4000-8000-000000000001'
      AND title = 'Published with only an end'
  ),
  0,
  'the rejected end-only activity creates no row'
);

SET LOCAL ROLE service_role;

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_activity(
    'b5100000-0000-4000-8000-000000000001',
    'b5200000-0000-4000-8000-000000000001',
    NULL,
    '{"title":"Invalid date","status":"published","signupMode":"none","startsAt":"not-a-date","pointValue":1,"pointCap":1}'::jsonb,
    'b5000000-0000-4000-8000-000000000001',
    'b5300000-0000-4000-8000-000000000002'
  )$$,
  '22007',
  'invalid input syntax for type timestamp with time zone: "not-a-date"',
  'invalid activity dates remain blocked'
);

SELECT extensions.throws_ok(
  $$SELECT plugin_data.csf_create_activity(
    'b5100000-0000-4000-8000-000000000001',
    'b5200000-0000-4000-8000-000000000001',
    NULL,
    '{"title":"Backwards dates","status":"published","signupMode":"none","startsAt":"2040-09-14T17:00:00Z","endsAt":"2040-09-13T17:00:00Z","pointValue":1,"pointCap":1}'::jsonb,
    'b5000000-0000-4000-8000-000000000001',
    'b5300000-0000-4000-8000-000000000003'
  )$$,
  'P0001',
  'The activity end time must be after its start time.',
  'an end before the supplied start remains blocked'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_opportunities
    WHERE organization_id = 'b5100000-0000-4000-8000-000000000001'
  ),
  1,
  'failed date validations create no activity rows'
);

SELECT * FROM extensions.finish();

ROLLBACK;
