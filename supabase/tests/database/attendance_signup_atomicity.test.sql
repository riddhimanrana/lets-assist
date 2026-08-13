BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(41);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'public.complete_participant_checkout(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute participant checkout'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.complete_participant_checkout(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass participant checkout'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.complete_participant_checkout(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can execute participant checkout'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.project_signups', 'INSERT'),
  'anonymous clients cannot insert project signups directly'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.project_signups', 'INSERT'),
  'authenticated clients cannot bypass atomic signup insertion'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.insert_project_signup_with_capacity(uuid,text,uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the capacity insert directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.insert_project_signup_with_capacity(uuid,text,uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'the server role can execute the capacity insert'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.confirm_anonymous_signup_with_capacity(uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot promote pending anonymous signups directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.confirm_anonymous_signup_with_capacity(uuid)',
    'EXECUTE'
  ),
  'the server role can atomically confirm anonymous signups'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.project_signups', 'DELETE'),
  'authenticated clients cannot hard-delete project signups'
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    'ad000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'atomic-one@local.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    'ad000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'atomic-two@local.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

INSERT INTO public.projects (
  id,
  creator_id,
  title,
  location,
  description,
  event_type,
  verification_method,
  schedule,
  require_login
)
VALUES
  (
    'ad100000-0000-4000-8000-000000000001',
    'ad000000-0000-4000-8000-000000000001',
    'Current checkout window',
    'Local',
    'Atomic attendance fixture',
    'oneTime',
    'manual',
    jsonb_build_object(
      'oneTime',
      jsonb_build_object(
        'date', to_char(
          (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '1 hour',
          'YYYY-MM-DD'
        ),
        'startTime', to_char(
          (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '1 hour',
          'HH24:MI'
        ),
        'endTime', to_char(
          (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '1 hour',
          'HH24:MI'
        ),
        'volunteers', 2
      )
    ),
    true
  ),
  (
    'ad100000-0000-4000-8000-000000000002',
    'ad000000-0000-4000-8000-000000000001',
    'Future checkout window',
    'Local',
    'Atomic attendance fixture',
    'oneTime',
    'manual',
    jsonb_build_object(
      'oneTime',
      jsonb_build_object(
        'date', to_char(
          (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') + interval '1 day',
          'YYYY-MM-DD'
        ),
        'startTime', '10:00',
        'endTime', '12:00',
        'volunteers', 2
      )
    ),
    true
  ),
  (
    'ad100000-0000-4000-8000-000000000003',
    'ad000000-0000-4000-8000-000000000001',
    'Past checkout window',
    'Local',
    'Atomic attendance fixture',
    'oneTime',
    'manual',
    jsonb_build_object(
      'oneTime',
      jsonb_build_object(
        'date', to_char(
          (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '1 day',
          'YYYY-MM-DD'
        ),
        'startTime', '10:00',
        'endTime', '12:00',
        'volunteers', 2
      )
    ),
    true
  ),
  (
    'ad100000-0000-4000-8000-000000000004',
    'ad000000-0000-4000-8000-000000000001',
    'Capacity insert window',
    'Local',
    'Atomic capacity fixture',
    'oneTime',
    'manual',
    jsonb_build_object(
      'oneTime',
      jsonb_build_object(
        'date', to_char(clock_timestamp() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD'),
        'startTime', '00:00',
        'endTime', '23:59',
        'volunteers', 1
      )
    ),
    true
  ),
  (
    'ad100000-0000-4000-8000-000000000005',
    'ad000000-0000-4000-8000-000000000001',
    'Anonymous confirmation window',
    'Local',
    'Atomic capacity fixture',
    'oneTime',
    'manual',
    jsonb_build_object(
      'oneTime',
      jsonb_build_object(
        'date', to_char(clock_timestamp() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD'),
        'startTime', '00:00',
        'endTime', '23:59',
        'volunteers', 1
      )
    ),
    false
  );

INSERT INTO public.project_signups (
  id,
  project_id,
  user_id,
  schedule_id,
  status,
  check_in_time
)
VALUES
  (
    'ad200000-0000-4000-8000-000000000001',
    'ad100000-0000-4000-8000-000000000001',
    'ad000000-0000-4000-8000-000000000001',
    'oneTime',
    'attended',
    clock_timestamp() - interval '30 minutes'
  ),
  (
    'ad200000-0000-4000-8000-000000000002',
    'ad100000-0000-4000-8000-000000000002',
    'ad000000-0000-4000-8000-000000000001',
    'oneTime',
    'attended',
    clock_timestamp()
  ),
  (
    'ad200000-0000-4000-8000-000000000003',
    'ad100000-0000-4000-8000-000000000003',
    'ad000000-0000-4000-8000-000000000001',
    'oneTime',
    'attended',
    (
      to_char(
        (clock_timestamp() AT TIME ZONE 'America/Los_Angeles') - interval '1 day',
        'YYYY-MM-DD'
      ) || ' 10:30'
    )::timestamp AT TIME ZONE 'America/Los_Angeles'
  ),
  (
    'ad200000-0000-4000-8000-000000000004',
    'ad100000-0000-4000-8000-000000000001',
    'ad000000-0000-4000-8000-000000000002',
    'oneTime',
    'approved',
    NULL
  ),
  (
    'ad200000-0000-4000-8000-000000000005',
    'ad100000-0000-4000-8000-000000000001',
    'ad000000-0000-4000-8000-000000000002',
    'rejected-slot',
    'rejected',
    NULL
  ),
  (
    'ad200000-0000-4000-8000-000000000006',
    'ad100000-0000-4000-8000-000000000001',
    'ad000000-0000-4000-8000-000000000002',
    'attended-slot',
    'attended',
    clock_timestamp() - interval '30 minutes'
  );

SELECT extensions.is(
  (
    SELECT checkout.outcome
    FROM public.complete_participant_checkout(
      'ad200000-0000-4000-8000-000000000001',
      'ad000000-0000-4000-8000-000000000001',
      NULL
    ) AS checkout
  ),
  'completed',
  'the first owned checkout completes'
);
SELECT extensions.ok(
  (
    SELECT signups.check_out_time IS NOT NULL
    FROM public.project_signups AS signups
    WHERE signups.id = 'ad200000-0000-4000-8000-000000000001'
  ),
  'the first checkout persists a server timestamp'
);
SELECT extensions.is(
  (
    SELECT checkout.outcome
    FROM public.complete_participant_checkout(
      'ad200000-0000-4000-8000-000000000001',
      'ad000000-0000-4000-8000-000000000001',
      NULL
    ) AS checkout
  ),
  'already_checked_out',
  'checkout replay is idempotent'
);
SELECT extensions.is(
  (
    SELECT checkout.check_out_time
    FROM public.complete_participant_checkout(
      'ad200000-0000-4000-8000-000000000001',
      'ad000000-0000-4000-8000-000000000001',
      NULL
    ) AS checkout
  ),
  (
    SELECT signups.check_out_time
    FROM public.project_signups AS signups
    WHERE signups.id = 'ad200000-0000-4000-8000-000000000001'
  ),
  'checkout replay returns the original timestamp without extending hours'
);
SELECT extensions.is(
  (
    SELECT checkout.outcome
    FROM public.complete_participant_checkout(
      'ad200000-0000-4000-8000-000000000001',
      'ad000000-0000-4000-8000-000000000002',
      NULL
    ) AS checkout
  ),
  'not_found',
  'a different registered user cannot check out the signup'
);
SELECT extensions.is(
  (
    SELECT checkout.outcome
    FROM public.complete_participant_checkout(
      'ad200000-0000-4000-8000-000000000002',
      'ad000000-0000-4000-8000-000000000001',
      NULL
    ) AS checkout
  ),
  'before_event_window',
  'participant checkout is rejected before the event window'
);
SELECT extensions.is(
  (
    SELECT checkout.outcome
    FROM public.complete_participant_checkout(
      'ad200000-0000-4000-8000-000000000003',
      'ad000000-0000-4000-8000-000000000001',
      NULL
    ) AS checkout
  ),
  'completed',
  'a delayed checkout completes at the event boundary'
);
SELECT extensions.ok(
  (
    SELECT signups.check_out_time = slot.ends_at
    FROM public.project_signups AS signups
    CROSS JOIN private.resolve_project_schedule_slot(
      signups.project_id,
      signups.schedule_id
    ) AS slot
    WHERE signups.id = 'ad200000-0000-4000-8000-000000000003'
  ),
  'delayed checkout is capped at the scheduled event end'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ad000000-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET check_in_time = clock_timestamp(), status = 'attended'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  '42501',
  'attendance timestamps require a server-authorized operation',
  'a participant cannot forge check-in time'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET check_out_time = clock_timestamp()
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  '42501',
  'participant checkout requires the server-authorized operation',
  'a participant cannot bypass atomic checkout'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'attended'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  '42501',
  'participants may only cancel their own signup',
  'a participant cannot forge attended status'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET project_id = 'ad100000-0000-4000-8000-000000000002'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  '42501',
  'project signup identity fields are immutable for client roles',
  'a participant cannot reassign a signup to another project'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET schedule_id = 'forged-slot'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  '42501',
  'project signup identity fields are immutable for client roles',
  'a participant cannot reassign a signup to another schedule'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET user_id = 'ad000000-0000-4000-8000-000000000001'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  '42501',
  'project signup identity fields are immutable for client roles',
  'a participant cannot transfer a signup to another user'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET user_id = NULL,
        anonymous_id = 'ad300000-0000-4000-8000-000000000099'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  '42501',
  'project signup identity fields are immutable for client roles',
  'a participant cannot convert a signup to an anonymous identity'
);
SELECT extensions.lives_ok(
  $$
    UPDATE public.project_signups
    SET volunteer_calendar_event_id = 'participant-calendar-event',
        volunteer_synced_at = clock_timestamp()
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  'a participant may update their own calendar metadata'
);
SELECT extensions.lives_ok(
  $$
    UPDATE public.project_signups
    SET status = 'cancelled'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  'a participant may soft-cancel their own signup'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'ad200000-0000-4000-8000-000000000004'
  ),
  'cancelled',
  'participant cancellation persists as a soft state transition'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'cancelled'
    WHERE id = 'ad200000-0000-4000-8000-000000000005'
  $$,
  '42501',
  'participants may only cancel their own signup',
  'a rejected participant cannot relabel the signup as cancelled'
);
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'cancelled'
    WHERE id = 'ad200000-0000-4000-8000-000000000006'
  $$,
  '42501',
  'participants may only cancel their own signup',
  'an attended participant cannot erase attendance by cancelling'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ad000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Rejection owes the volunteer a notification, so it left client status
-- moderation entirely and now belongs to public.reject_project_signup.
SELECT extensions.throws_ok(
  $$
    UPDATE public.project_signups
    SET status = 'rejected'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  '42501',
  'signup rejection requires the server-authorized operation',
  'even a project manager cannot reject a signup with a direct update'
);
SELECT extensions.lives_ok(
  $$
    UPDATE public.project_signups
    SET status = 'approved'
    WHERE id = 'ad200000-0000-4000-8000-000000000004'
  $$,
  'a project manager retains the rest of signup status moderation'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.id = 'ad200000-0000-4000-8000-000000000004'
  ),
  'approved',
  'manager status moderation persists'
);

RESET ROLE;

SELECT extensions.is(
  (
    SELECT inserted.outcome
    FROM public.insert_project_signup_with_capacity(
      'ad100000-0000-4000-8000-000000000004',
      'oneTime',
      'ad000000-0000-4000-8000-000000000001',
      NULL,
      'approved',
      NULL,
      NULL
    ) AS inserted
  ),
  'inserted',
  'the first capacity-locked signup is inserted'
);
SELECT extensions.is(
  (
    SELECT inserted.outcome
    FROM public.insert_project_signup_with_capacity(
      'ad100000-0000-4000-8000-000000000004',
      'oneTime',
      'ad000000-0000-4000-8000-000000000002',
      NULL,
      'approved',
      NULL,
      NULL
    ) AS inserted
  ),
  'slot_full',
  'the next active signup cannot overbook the slot'
);

INSERT INTO public.anonymous_signups (
  id,
  project_id,
  email,
  name,
  token
)
VALUES
  (
    'ad300000-0000-4000-8000-000000000001',
    'ad100000-0000-4000-8000-000000000005',
    'anonymous-one@local.test',
    'Anonymous One',
    'ad400000-0000-4000-8000-000000000001'
  ),
  (
    'ad300000-0000-4000-8000-000000000002',
    'ad100000-0000-4000-8000-000000000005',
    'anonymous-two@local.test',
    'Anonymous Two',
    'ad400000-0000-4000-8000-000000000002'
  );

SELECT extensions.is(
  (
    SELECT inserted.outcome
    FROM public.insert_project_signup_with_capacity(
      'ad100000-0000-4000-8000-000000000005',
      'oneTime',
      NULL,
      'ad300000-0000-4000-8000-000000000001',
      'pending',
      NULL,
      NULL
    ) AS inserted
  ),
  'inserted',
  'the first pending anonymous signup enters through the capacity lock'
);
SELECT extensions.is(
  (
    SELECT inserted.outcome
    FROM public.insert_project_signup_with_capacity(
      'ad100000-0000-4000-8000-000000000005',
      'oneTime',
      NULL,
      'ad300000-0000-4000-8000-000000000002',
      'pending',
      NULL,
      NULL
    ) AS inserted
  ),
  'inserted',
  'a second pending signup can wait without consuming active capacity'
);

SELECT extensions.is(
  (
    SELECT confirmation.outcome
    FROM public.confirm_anonymous_signup_with_capacity(
      'ad300000-0000-4000-8000-000000000001'
    ) AS confirmation
  ),
  'confirmed',
  'the first pending anonymous signup confirms atomically'
);
SELECT extensions.is(
  (
    SELECT confirmation.outcome
    FROM public.confirm_anonymous_signup_with_capacity(
      'ad300000-0000-4000-8000-000000000002'
    ) AS confirmation
  ),
  'slot_full',
  'a racing anonymous confirmation cannot overbook the slot'
);
SELECT extensions.ok(
  (
    SELECT signups.confirmed_at IS NULL
    FROM public.anonymous_signups AS signups
    WHERE signups.id = 'ad300000-0000-4000-8000-000000000002'
  ),
  'a full slot leaves the anonymous profile unconfirmed'
);
SELECT extensions.is(
  (
    SELECT signups.status
    FROM public.project_signups AS signups
    WHERE signups.anonymous_id = 'ad300000-0000-4000-8000-000000000002'
  ),
  'pending',
  'a full slot leaves the project signup pending rather than partially confirming'
);

SELECT * FROM extensions.finish();

ROLLBACK;
