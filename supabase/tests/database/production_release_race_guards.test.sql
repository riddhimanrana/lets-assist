BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(10);

SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'public.submit_project_feedback_from_request(uuid,smallint,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot invoke the service feedback writer'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.submit_project_feedback_from_request(uuid,smallint,text)',
    'EXECUTE'
  ),
  'the reviewed service role can invoke the atomic feedback writer'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'app_private.block_entitlement_write_during_plugin_transition()',
    'EXECUTE'
  ),
  'the entitlement guard is trigger-only'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('ef000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'race-creator@local.test', now(), '{}', '{"username":"race_creator"}', now(), now()),
  ('ef000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'race-attendee@local.test', now(), '{}', '{"username":"race_attendee"}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ef100000-0000-4000-8000-000000000001',
  'Race Guard Org',
  'race_guard_org',
  'nonprofit',
  '619274'
);
INSERT INTO public.plugins (key, name, visibility, is_active)
VALUES ('race-guard-plugin', 'Race Guard Plugin', 'private', true);

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ef000000-0000-4000-8000-000000000001","role":"service_role"}';

SELECT extensions.ok(
  public.acquire_plugin_control_plane_transition_lock(
    'ef100000-0000-4000-8000-000000000001',
    'race-guard-plugin',
    'ef200000-0000-4000-8000-000000000001',
    900
  ),
  'plugin deletion can acquire the shared control-plane lease'
);

SELECT extensions.throws_ok(
  $$
    INSERT INTO public.organization_plugin_entitlements (
      organization_id, plugin_key, status, is_forced
    ) VALUES (
      'ef100000-0000-4000-8000-000000000001',
      'race-guard-plugin',
      'active',
      true
    )
  $$,
  '40001',
  'plugin entitlement transition is locked',
  'a forced entitlement cannot cross an active deletion lease'
);

SELECT extensions.ok(
  public.release_plugin_control_plane_transition_lock(
    'ef100000-0000-4000-8000-000000000001',
    'race-guard-plugin',
    'ef200000-0000-4000-8000-000000000001'
  ),
  'the deletion lease can be released by its owner'
);

INSERT INTO public.organization_plugin_entitlements (
  organization_id, plugin_key, status, is_forced
) VALUES (
  'ef100000-0000-4000-8000-000000000001',
  'race-guard-plugin',
  'active',
  true
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.organization_plugin_entitlements
    WHERE organization_id = 'ef100000-0000-4000-8000-000000000001'
      AND plugin_key = 'race-guard-plugin'
  ),
  1::bigint,
  'entitlement writes resume after the lease is released'
);

INSERT INTO public.projects (
  id, creator_id, title, location, description, event_type,
  verification_method, schedule, require_login, status
)
VALUES (
  'ef300000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000001',
  'Race feedback fixture', 'Local', 'Race feedback fixture', 'oneTime',
  'manual',
  jsonb_build_object('oneTime', jsonb_build_object(
    'date', to_char(current_date - 2, 'YYYY-MM-DD'),
    'startTime', '10:00', 'endTime', '12:00', 'volunteers', 5)),
  true, 'completed'
);

INSERT INTO public.project_signups (
  id, project_id, user_id, schedule_id, status
)
VALUES (
  'ef400000-0000-4000-8000-000000000001',
  'ef300000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000002',
  'oneTime',
  'attended'
);

INSERT INTO public.project_feedback_requests (
  id, project_id, signup_id, user_id, recipient_email_hash, eligible_at
)
VALUES (
  'ef500000-0000-4000-8000-000000000001',
  'ef300000-0000-4000-8000-000000000001',
  'ef400000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000002',
  repeat('a', 64),
  now() - interval '1 hour'
);

SELECT extensions.ok(
  public.submit_project_feedback_from_request(
    'ef500000-0000-4000-8000-000000000001',
    5::smallint,
    'Atomic feedback'
  ) IS NOT NULL,
  'an attended volunteer can submit token feedback for a completed project'
);

UPDATE public.project_signups
SET status = 'approved'
WHERE id = 'ef400000-0000-4000-8000-000000000001';

SELECT extensions.throws_ok(
  $$
    SELECT public.submit_project_feedback_from_request(
      'ef500000-0000-4000-8000-000000000001',
      1::smallint,
      'No longer eligible'
    )
  $$,
  '42501',
  'feedback request is not eligible',
  'corrected non-attendance blocks token feedback atomically'
);

SELECT extensions.is(
  (
    SELECT rating::integer
    FROM public.project_feedback
    WHERE project_id = 'ef300000-0000-4000-8000-000000000001'
      AND user_id = 'ef000000-0000-4000-8000-000000000002'
  ),
  5,
  'an ineligible retry cannot overwrite the accepted rating'
);

SELECT * FROM extensions.finish();
ROLLBACK;
