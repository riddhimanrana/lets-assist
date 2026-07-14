BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(29);

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), table_privileges(privilege_name) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT extensions.ok(
  NOT has_table_privilege(
    role_name,
    'public.waiver_storage_deletion_queue',
    privilege_name
  ),
  format('%s cannot %s the waiver Storage deletion outbox', role_name, privilege_name)
)
FROM client_roles
CROSS JOIN table_privileges;

WITH client_roles(role_name) AS (
  VALUES ('anon'), ('authenticated')
), protected_functions(signature) AS (
  VALUES
    ('public.archive_waiver_signatures_for_cleanup(uuid[])'),
    ('public.archive_anonymous_signups_for_cleanup(uuid[])'),
    ('public.filter_unreferenced_waiver_storage_deletions(uuid[])')
)
SELECT extensions.ok(
  NOT has_function_privilege(role_name, signature, 'EXECUTE'),
  format('%s cannot execute %s', role_name, signature)
)
FROM client_roles
CROSS JOIN protected_functions;

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.archive_waiver_signatures_for_cleanup(uuid[])',
    'EXECUTE'
  ),
  'service_role can archive waiver signatures transactionally'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.archive_anonymous_signups_for_cleanup(uuid[])',
    'EXECUTE'
  ),
  'service_role can archive anonymous signup dependencies transactionally'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'public.filter_unreferenced_waiver_storage_deletions(uuid[])',
    'EXECUTE'
  ),
  'service_role can re-check queued evidence references'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  'fc000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'waiver-cleanup-owner@local.test', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.projects (
  id, creator_id, title, location, description,
  event_type, verification_method, schedule, require_login
)
VALUES (
  'fc100000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000001',
  'Waiver Cleanup Outbox Project',
  'Local',
  'Outbox test fixture',
  'single',
  'manual',
  '{}'::jsonb,
  false
);

INSERT INTO public.anonymous_signups (id, project_id, email, name)
VALUES
  (
    'fc200000-0000-4000-8000-000000000001',
    'fc100000-0000-4000-8000-000000000001',
    'shared-waiver@local.test',
    'Shared Waiver'
  ),
  (
    'fc200000-0000-4000-8000-000000000002',
    'fc100000-0000-4000-8000-000000000001',
    'race-waiver@local.test',
    'Race Waiver'
  ),
  (
    'fc200000-0000-4000-8000-000000000003',
    'fc100000-0000-4000-8000-000000000001',
    'anonymous-cleanup@local.test',
    'Anonymous Cleanup'
  );

INSERT INTO public.project_signups (
  id, project_id, schedule_id, status, anonymous_id
)
VALUES
  (
    'fc300000-0000-4000-8000-000000000001',
    'fc100000-0000-4000-8000-000000000001',
    'shared-one', 'approved',
    'fc200000-0000-4000-8000-000000000001'
  ),
  (
    'fc300000-0000-4000-8000-000000000002',
    'fc100000-0000-4000-8000-000000000001',
    'shared-two', 'approved',
    'fc200000-0000-4000-8000-000000000001'
  ),
  (
    'fc300000-0000-4000-8000-000000000003',
    'fc100000-0000-4000-8000-000000000001',
    'race', 'approved',
    'fc200000-0000-4000-8000-000000000002'
  ),
  (
    'fc300000-0000-4000-8000-000000000004',
    'fc100000-0000-4000-8000-000000000001',
    'anonymous-cleanup', 'approved',
    'fc200000-0000-4000-8000-000000000003'
  );

INSERT INTO public.waiver_signatures (
  id, project_id, signup_id, anonymous_id,
  signer_name, signer_email, signature_type, signature_storage_path
)
VALUES
  (
    'fc400000-0000-4000-8000-000000000001',
    'fc100000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000001',
    'fc200000-0000-4000-8000-000000000001',
    'Shared Waiver', 'shared-waiver@local.test', 'draw',
    'signatures/shared-evidence.png'
  ),
  (
    'fc400000-0000-4000-8000-000000000002',
    'fc100000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000002',
    'fc200000-0000-4000-8000-000000000001',
    'Shared Waiver', 'shared-waiver@local.test', 'draw',
    'signatures/shared-evidence.png'
  ),
  (
    'fc400000-0000-4000-8000-000000000004',
    'fc100000-0000-4000-8000-000000000001',
    'fc300000-0000-4000-8000-000000000004',
    'fc200000-0000-4000-8000-000000000003',
    'Anonymous Cleanup', 'anonymous-cleanup@local.test', 'draw',
    'signatures/anonymous-cleanup.png'
  );

SELECT extensions.is(
  public.archive_waiver_signatures_for_cleanup(
    ARRAY['fc400000-0000-4000-8000-000000000001'::uuid]
  ),
  1::bigint,
  'the first shared-path waiver row is archived'
);

SELECT extensions.is(
  (
    SELECT count(*) FROM public.waiver_signatures
    WHERE id = 'fc400000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'the archived waiver row is deleted'
);

SELECT extensions.is(
  (
    SELECT count(*) FROM public.waiver_storage_deletion_queue
    WHERE object_path = 'signatures/shared-evidence.png'
  ),
  0::bigint,
  'a path still referenced by another waiver is not queued'
);

SELECT extensions.is(
  public.archive_waiver_signatures_for_cleanup(
    ARRAY['fc400000-0000-4000-8000-000000000002'::uuid]
  ),
  1::bigint,
  'the final shared-path waiver row is archived'
);

SELECT extensions.is(
  (
    SELECT count(*) FROM public.waiver_storage_deletion_queue
    WHERE object_path = 'signatures/shared-evidence.png'
  ),
  1::bigint,
  'the now-unreferenced shared path is queued once'
);

INSERT INTO public.waiver_signatures (
  id, project_id, signup_id, anonymous_id,
  signer_name, signer_email, signature_type, signature_storage_path
)
VALUES (
  'fc400000-0000-4000-8000-000000000003',
  'fc100000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000003',
  'fc200000-0000-4000-8000-000000000002',
  'Race Waiver', 'race-waiver@local.test', 'draw',
  'signatures/shared-evidence.png'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM public.filter_unreferenced_waiver_storage_deletions(
      ARRAY[(
        SELECT id FROM public.waiver_storage_deletion_queue
        WHERE object_path = 'signatures/shared-evidence.png'
      )]
    )
  ),
  0::bigint,
  'the final filter rejects a path that became referenced after enqueue'
);

SELECT extensions.is(
  (
    SELECT count(*) FROM public.waiver_storage_deletion_queue
    WHERE object_path = 'signatures/shared-evidence.png'
  ),
  0::bigint,
  'a newly referenced queue item is cancelled'
);

SELECT extensions.is(
  public.archive_anonymous_signups_for_cleanup(
    ARRAY['fc200000-0000-4000-8000-000000000003'::uuid]
  ),
  1::bigint,
  'anonymous profile cleanup commits its dependency deletion atomically'
);

SELECT extensions.is(
  (
    SELECT count(*) FROM public.anonymous_signups
    WHERE id = 'fc200000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'anonymous cleanup deletes the profile'
);

SELECT extensions.is(
  (
    SELECT count(*) FROM public.project_signups
    WHERE id = 'fc300000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'anonymous cleanup deletes dependent project signups'
);

SELECT extensions.is(
  (
    SELECT count(*) FROM public.waiver_signatures
    WHERE id = 'fc400000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'anonymous cleanup deletes dependent waiver records'
);

SELECT extensions.is(
  (
    SELECT count(*) FROM public.waiver_storage_deletion_queue
    WHERE object_path = 'signatures/anonymous-cleanup.png'
  ),
  1::bigint,
  'anonymous cleanup durably queues its now-unreferenced Storage object'
);

SELECT * FROM extensions.finish();

ROLLBACK;
