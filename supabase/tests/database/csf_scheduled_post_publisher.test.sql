-- Scheduled CSF posts publish only through the bounded, service-only worker.
-- Every fixture is synthetic and every write is rolled back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
-- Exact plan: an early SQL error must not make a truncated safety matrix pass.
SELECT extensions.plan(51);

SELECT extensions.has_column(
  'plugin_data', 'csf_announcements', 'scheduled_by',
  'a scheduled post retains its human scheduling actor'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_announcements', 'schedule_revision',
  'each distinct schedule has an idempotency coordinate'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_announcements', 'scheduled_publish_hold_reason',
  'automatic-publication refusal is durable operator state'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_announcements', 'scheduled_publish_held_at',
  'a schedule hold records its first durable time'
);
SELECT extensions.has_column(
  'plugin_data', 'csf_announcements', 'scheduled_publish_last_checked_at',
  'the last worker evaluation is durable'
);

SELECT extensions.has_function(
  'plugin_data', 'csf_publish_due_posts', ARRAY['integer', 'text'],
  'the bounded scheduled-post publisher exists'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_publish_due_posts(integer,text)',
    'EXECUTE'
  ),
  'service role can invoke the publisher boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_publish_due_posts(integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_publish_due_posts(integer,text)',
    'EXECUTE'
  ),
  'browser roles cannot invoke the publisher'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_mutate_post(uuid,text,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_mutate_post_atomic_inner(uuid,text,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'service callers retain only the guarded post mutation wrapper'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_guard_announcement_schedule_lifecycle()'::regprocedure
      AND procedure.prosecdef = false
  ),
  'the row lifecycle trigger executes with invoker rights'
);
SELECT extensions.is(
  (
    SELECT procedure.provolatile::text
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_post_mutation_state(plugin_data.csf_announcements)'::regprocedure
  ),
  's',
  'the timestamp-aware canonical state helper is truthfully STABLE'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.unnest(constraint_row.conkey) AS key_column(attnum)
      ON true
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = constraint_row.conrelid
     AND attribute.attnum = key_column.attnum
    WHERE constraint_row.conrelid =
      'plugin_data.csf_announcements'::regclass
      AND constraint_row.contype = 'f'
      AND attribute.attname = 'scheduled_by'
  ),
  'schedule actor provenance is not erased by or allowed to block auth deletion'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'plugin_data.csf_announcements'::regclass
      AND constraint_row.conname IN (
        'csf_announcements_schedule_hold_reason_check',
        'csf_announcements_schedule_hold_time_check',
        'csf_announcements_schedule_provenance_check',
        'csf_announcements_published_lifecycle_check',
        'csf_announcements_scheduled_lifecycle_check',
        'csf_announcements_archived_unpinned_check'
      )
      AND constraint_row.convalidated
  ),
  6,
  'all six scheduled-post lifecycle constraints are validated'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    WHERE index_class.relname = 'csf_announcements_due_publish_idx'
      AND pg_catalog.pg_get_expr(
        index_row.indpred,
        index_row.indrelid
      ) LIKE '%scheduled_publish_hold_reason IS NULL%'
  ),
  'the due scan excludes rows already placed on hold'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    WHERE index_class.relname =
      'csf_admin_audit_events_scheduled_publish_idx'
      AND index_row.indisunique
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    WHERE index_class.relname =
      'csf_admin_audit_events_scheduled_hold_idx'
      AND index_row.indisunique
  ),
  'publication and hold receipts are independently unique per schedule revision'
);
SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_publish_due_posts(integer,text)'::regprocedure
    ),
    'FOR UPDATE OF announcement SKIP LOCKED'
  ) > 0,
  'concurrent workers claim due posts with SKIP LOCKED'
);
SELECT extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'plugin_data.csf_publish_due_posts(integer,text)'::regprocedure
    ),
    'csf_communication_campaigns'
  ) = 0,
  'the publisher contains no email-campaign write path'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_publish_due_posts(0, 'pgtap-worker') $$,
  'P0001',
  'Scheduled post publisher limit must be between 1 and 50.',
  'the publisher refuses a zero batch'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_publish_due_posts(51, 'pgtap-worker') $$,
  'P0001',
  'Scheduled post publisher limit must be between 1 and 50.',
  'the publisher refuses an unbounded batch'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_publish_due_posts(1, 'bad worker id') $$,
  'P0001',
  'Scheduled post publisher worker id must be 1 to 96 routing characters.',
  'the publisher refuses an unbounded worker coordinate'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'scheduler-a@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'scheduler-b@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fb100000-0000-4000-8000-000000000001', 'Scheduled Posts A', 'scheduled-posts-a', 'school', '996101'),
  ('fb100000-0000-4000-8000-000000000002', 'Scheduled Posts B', 'scheduled-posts-b', 'school', '996102');

-- The publisher is intentionally global. Keep any synthetic scheduled rows
-- supplied by a broader local fixture outside this test's due window so the
-- bounded result below describes only the two chapters this transaction owns.
-- ROLLBACK restores those rows after the test.
UPDATE plugin_data.csf_announcements
SET scheduled_for = '2199-01-01T00:00:00Z'::timestamptz
WHERE status = 'scheduled'
  AND scheduled_for <= pg_catalog.statement_timestamp()
  AND organization_id NOT IN (
    'fb100000-0000-4000-8000-000000000001',
    'fb100000-0000-4000-8000-000000000002'
  );

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fb100000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000002', 'admin', 'active');

INSERT INTO public.organization_plugin_entitlements (
  id, organization_id, plugin_key, status, created_by
) VALUES
  ('fb150000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'dvhs-csf', 'active', 'fb000000-0000-4000-8000-000000000001'),
  ('fb150000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'dvhs-csf', 'active', 'fb000000-0000-4000-8000-000000000002');

INSERT INTO public.organization_plugin_installs (
  id, organization_id, plugin_key, installed_version, enabled, installed_by
) VALUES
  ('fb160000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'dvhs-csf', '0.1.0', true, 'fb000000-0000-4000-8000-000000000001'),
  ('fb160000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'dvhs-csf', '0.1.0', true, 'fb000000-0000-4000-8000-000000000002');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester,
  is_current, lifecycle_status
) VALUES
  ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open'),
  ('fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 'F99', 'Fall 2099', '2099-2100', 'fall', true, 'open');

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label, status
) VALUES
  ('fb250000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 2099, 'Class of 2099', 'active'),
  ('fb250000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000002', 2099, 'Class of 2099', 'active');

CREATE TEMP TABLE scheduled_post_results (
  key text PRIMARY KEY,
  result jsonb NOT NULL
);

INSERT INTO scheduled_post_results (key, result)
SELECT 'valid_schedule', plugin_data.csf_mutate_post(
  'fb100000-0000-4000-8000-000000000001', 'create', NULL,
  '{"title":"Scheduled chapter post","body":"Publish this once.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-01-02T12:00:00Z","sendEmail":false}'::jsonb,
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001'
);

SELECT extensions.ok(
  (
    SELECT result ->> 'status' = 'scheduled'
      AND (result ->> 'idempotent')::boolean = false
    FROM scheduled_post_results
    WHERE key = 'valid_schedule'
  ),
  'an authorized future schedule returns a committed receipt'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_announcements AS announcement
    WHERE announcement.id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'valid_schedule'
    )
      AND announcement.status = 'scheduled'
      AND announcement.published_at IS NULL
      AND announcement.scheduled_for = '2099-01-02T12:00:00Z'::timestamptz
      AND announcement.scheduled_by =
        'fb000000-0000-4000-8000-000000000001'
      AND announcement.schedule_revision IS NOT NULL
      AND announcement.scheduled_publish_hold_reason IS NULL
      AND announcement.email_requested = false
  ),
  'the schedule freezes actor/revision state and no email intent'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND correlation_id = 'fb300000-0000-4000-8000-000000000001'
      AND source_type = 'post_mutation_request'
  ),
  1,
  'scheduling writes one canonical mutation receipt'
);

INSERT INTO scheduled_post_results (key, result)
SELECT 'valid_schedule_replay', plugin_data.csf_mutate_post(
  'fb100000-0000-4000-8000-000000000001', 'create', NULL,
  '{"title":"Scheduled chapter post","body":"Publish this once.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-01-02T12:00:00Z","sendEmail":false}'::jsonb,
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001'
);
SELECT extensions.ok(
  (
    SELECT (result ->> 'idempotent')::boolean
    FROM scheduled_post_results
    WHERE key = 'valid_schedule_replay'
  ),
  'an exact schedule retry resolves the one committed receipt'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_announcements
    WHERE title = 'Scheduled chapter post'
  ),
  1,
  'an exact schedule retry cannot duplicate the post'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_mutate_post(
      'fb100000-0000-4000-8000-000000000001', 'create', NULL,
      '{"title":"Past schedule","body":"Never publish.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2020-01-02T12:00:00Z","sendEmail":false}'::jsonb,
      'fb000000-0000-4000-8000-000000000001',
      'fb300000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'Choose a future time, or publish the post now.',
  'a past time is refused instead of becoming an accidental immediate publish'
);

-- Move the synthetic fixture clock forward without sleeping. The trigger sees
-- a distinct time and creates the revision the worker will own.
UPDATE plugin_data.csf_announcements
SET scheduled_for = pg_catalog.statement_timestamp() - interval '1 minute',
    updated_by = 'fb000000-0000-4000-8000-000000000001'
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'valid_schedule'
);

INSERT INTO scheduled_post_results (key, result)
SELECT 'valid_publish', plugin_data.csf_publish_due_posts(
  10, 'pgtap-valid-publisher'
);
SELECT extensions.ok(
  (
    SELECT result ->> 'examined' = '1'
      AND result ->> 'published' = '1'
      AND result ->> 'held' = '0'
      AND result -> 'organizationIds' @>
        '["fb100000-0000-4000-8000-000000000001"]'::jsonb
    FROM scheduled_post_results
    WHERE key = 'valid_publish'
  ),
  'the worker reports one bounded publication and its changed chapter'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_announcements
    WHERE id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'valid_schedule'
    )
      AND status = 'published'
      AND published_at IS NOT NULL
      AND scheduled_for IS NULL
      AND scheduled_by IS NULL
      AND schedule_revision IS NULL
      AND scheduled_publish_hold_reason IS NULL
      AND scheduled_publish_held_at IS NULL
      AND email_requested = false
  ),
  'publication is live and clears every actionable schedule coordinate'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'valid_schedule'
    )
      AND action = 'post_published_automatically'
      AND source_type = 'scheduled_post_publisher'
      AND actor_user_id IS NULL
      AND after_data ->> 'systemActor' = 'csf_scheduled_post_publisher'
      AND after_data ->> 'emailQueued' = 'false'
  ),
  1,
  'automatic publication writes one bounded system audit with no email claim'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_campaigns
    WHERE source_announcement_id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'valid_schedule'
    )
  ),
  0,
  'automatic publication creates no communication campaign'
);
SELECT extensions.ok(
  (
    SELECT result ->> 'examined' = '0'
      AND result ->> 'published' = '0'
      AND result ->> 'held' = '0'
    FROM (
      SELECT plugin_data.csf_publish_due_posts(
        10, 'pgtap-valid-retry'
      ) AS result
    ) AS retry
  ),
  'a worker retry cannot publish the row twice'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'valid_schedule'
    )
      AND source_type = 'scheduled_post_publisher'
  ),
  1,
  'a worker retry cannot duplicate publication history'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_mutate_post(
      'fb100000-0000-4000-8000-000000000001', 'create', NULL,
      '{"title":"Scheduled chapter post","body":"Publish this once.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-01-02T12:00:00Z","sendEmail":false}'::jsonb,
      'fb000000-0000-4000-8000-000000000001',
      'fb300000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'The committed post change is no longer current. Reload the feed before trying again.',
  'the original save cannot pretend the automatically published row is still scheduled'
);
SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_mutate_post(
        'fb100000-0000-4000-8000-000000000001', 'update', %L,
        '{"title":"Stay live","body":"Live edit.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":null,"sendEmail":false}'::jsonb,
        'fb000000-0000-4000-8000-000000000001',
        'fb300000-0000-4000-8000-000000000003'
      )
    $$,
    (
      SELECT result ->> 'postId'
      FROM scheduled_post_results
      WHERE key = 'valid_schedule'
    )
  ),
  'P0001',
  'Published post edits stay live. Archive the post or create a new scheduled post.',
  'a published edit cannot misleadingly return the post to draft'
);
SELECT extensions.throws_ok(
  format(
    $$
      SELECT plugin_data.csf_mutate_post(
        'fb100000-0000-4000-8000-000000000001', 'update', %L,
        '{"title":"Stay live","body":"Live edit.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-03-04T12:00:00Z","sendEmail":false}'::jsonb,
        'fb000000-0000-4000-8000-000000000001',
        'fb300000-0000-4000-8000-000000000004'
      )
    $$,
    (
      SELECT result ->> 'postId'
      FROM scheduled_post_results
      WHERE key = 'valid_schedule'
    )
  ),
  'P0001',
  'Published post edits stay live. Archive the post or create a new scheduled post.',
  'a published edit cannot misleadingly become scheduled'
);

-- Account deletion must succeed, retain immutable scheduling provenance, and
-- make the next worker pass hold rather than publish the post.
INSERT INTO scheduled_post_results (key, result)
SELECT 'deleted_actor_schedule', plugin_data.csf_mutate_post(
  'fb100000-0000-4000-8000-000000000002', 'create', NULL,
  '{"title":"Deleted actor schedule","body":"Hold this.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-02-02T12:00:00Z","sendEmail":false}'::jsonb,
  'fb000000-0000-4000-8000-000000000002',
  'fb300000-0000-4000-8000-000000000010'
);
UPDATE plugin_data.csf_announcements
SET scheduled_for = pg_catalog.statement_timestamp() - interval '1 minute',
    updated_by = 'fb000000-0000-4000-8000-000000000002'
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'deleted_actor_schedule'
);
DELETE FROM public.organization_members
WHERE organization_id = 'fb100000-0000-4000-8000-000000000002'
  AND user_id = 'fb000000-0000-4000-8000-000000000002';
SELECT extensions.lives_ok(
  $$ DELETE FROM auth.users WHERE id = 'fb000000-0000-4000-8000-000000000002' $$,
  'deleting a scheduling account is never blocked by announcement provenance'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_announcements
    WHERE id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'deleted_actor_schedule'
    )
      AND status = 'scheduled'
      AND scheduled_by = 'fb000000-0000-4000-8000-000000000002'
      AND created_by IS NULL
      AND updated_by IS NULL
  ),
  'auth deletion retains the unreferenced actor UUID while FK-backed editor fields clear'
);

INSERT INTO scheduled_post_results (key, result)
SELECT 'deleted_actor_hold', plugin_data.csf_publish_due_posts(
  10, 'pgtap-deleted-actor'
);
SELECT extensions.ok(
  (
    SELECT result ->> 'examined' = '1'
      AND result ->> 'published' = '0'
      AND result ->> 'held' = '1'
      AND result -> 'holds' ->> 'actorUnavailable' = '1'
      AND result -> 'organizationIds' @>
        '["fb100000-0000-4000-8000-000000000002"]'::jsonb
    FROM scheduled_post_results
    WHERE key = 'deleted_actor_hold'
  ),
  'a deleted scheduling actor produces one named hold and zero publication'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_announcements
    WHERE id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'deleted_actor_schedule'
    )
      AND status = 'scheduled'
      AND published_at IS NULL
      AND scheduled_publish_hold_reason = 'schedule_actor_unavailable'
      AND scheduled_publish_held_at IS NOT NULL
      AND scheduled_publish_last_checked_at IS NOT NULL
  ),
  'the deleted-actor post remains unpublished with durable recovery state'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'deleted_actor_schedule'
    )
      AND action = 'post_schedule_held'
      AND source_type = 'scheduled_post_publisher_hold'
      AND reason_code = 'schedule_actor_unavailable'
  ),
  1,
  'the deleted-actor hold writes exactly one immutable receipt'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_campaigns
    WHERE source_announcement_id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'deleted_actor_schedule'
    )
  ),
  0,
  'the deleted-actor hold has no email/provider side effect'
);

UPDATE plugin_data.csf_announcements
SET scheduled_publish_hold_reason = NULL,
    scheduled_publish_held_at = NULL,
    scheduled_publish_last_checked_at = NULL
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'deleted_actor_schedule'
);
SELECT extensions.is(
  (
    SELECT scheduled_publish_hold_reason
    FROM plugin_data.csf_announcements
    WHERE id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'deleted_actor_schedule'
    )
  ),
  'schedule_actor_unavailable',
  'a same-revision direct edit cannot clear the worker hold'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES (
  'fb000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
  'replacement-b@local.test', now(), '{}', '{}', now(), now()
);
INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'fb100000-0000-4000-8000-000000000002',
  'fb000000-0000-4000-8000-000000000003', 'admin', 'active'
);
UPDATE plugin_data.csf_announcements
SET scheduled_for = '2099-04-05T12:00:00Z'::timestamptz,
    updated_by = 'fb000000-0000-4000-8000-000000000003'
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'deleted_actor_schedule'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_announcements
    WHERE id = (
      SELECT (result ->> 'postId')::uuid
      FROM scheduled_post_results
      WHERE key = 'deleted_actor_schedule'
    )
      AND scheduled_by = 'fb000000-0000-4000-8000-000000000003'
      AND scheduled_publish_hold_reason IS NULL
      AND schedule_revision IS DISTINCT FROM (
        SELECT correlation_id
        FROM plugin_data.csf_admin_audit_events
        WHERE target_id = (
          SELECT (result ->> 'postId')::uuid
          FROM scheduled_post_results
          WHERE key = 'deleted_actor_schedule'
        )
          AND source_type = 'scheduled_post_publisher_hold'
      )
  ),
  'an authorized officer choosing a distinct future time creates the one recovery path'
);

UPDATE plugin_data.csf_announcements
SET scheduled_for = pg_catalog.statement_timestamp() - interval '1 minute',
    updated_by = 'fb000000-0000-4000-8000-000000000003'
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'deleted_actor_schedule'
);
UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000002'
  AND user_id = 'fb000000-0000-4000-8000-000000000003';
INSERT INTO scheduled_post_results (key, result)
SELECT 'revoked_actor_hold', plugin_data.csf_publish_due_posts(
  10, 'pgtap-revoked-actor'
);
SELECT extensions.ok(
  (
    SELECT result ->> 'published' = '0'
      AND result ->> 'held' = '1'
      AND result -> 'holds' ->> 'actorUnavailable' = '1'
    FROM scheduled_post_results
    WHERE key = 'revoked_actor_hold'
  ),
  'revoking an existing scheduler also produces zero publication'
);

-- Plugin availability is checked at execution, not trusted from save time.
INSERT INTO scheduled_post_results (key, result)
SELECT 'plugin_hold_schedule', plugin_data.csf_mutate_post(
  'fb100000-0000-4000-8000-000000000001', 'create', NULL,
  '{"title":"Plugin hold","body":"Do not publish while disabled.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-05-06T12:00:00Z","sendEmail":false}'::jsonb,
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000020'
);
UPDATE plugin_data.csf_announcements
SET scheduled_for = pg_catalog.statement_timestamp() - interval '1 minute',
    updated_by = 'fb000000-0000-4000-8000-000000000001'
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'plugin_hold_schedule'
);
UPDATE public.organization_plugin_installs
SET enabled = false
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND plugin_key = 'dvhs-csf';
INSERT INTO scheduled_post_results (key, result)
SELECT 'plugin_hold', plugin_data.csf_publish_due_posts(
  10, 'pgtap-plugin-hold'
);
SELECT extensions.ok(
  (
    SELECT result ->> 'published' = '0'
      AND result ->> 'held' = '1'
      AND result -> 'holds' ->> 'pluginUnavailable' = '1'
    FROM scheduled_post_results
    WHERE key = 'plugin_hold'
  ),
  'a disabled private plugin holds its due post with zero publication'
);
UPDATE public.organization_plugin_installs
SET enabled = true
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND plugin_key = 'dvhs-csf';
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_mutate_post(
      'fb100000-0000-4000-8000-000000000001', 'create', NULL,
      '{"title":"Plugin hold","body":"Do not publish while disabled.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-05-06T12:00:00Z","sendEmail":false}'::jsonb,
      'fb000000-0000-4000-8000-000000000001',
      'fb300000-0000-4000-8000-000000000020'
    )
  $$,
  'P0001',
  'The committed post change is no longer current. Reload the feed before trying again.',
  'a held schedule retry becomes the saved-but-reload outcome instead of claiming success'
);

-- Exercise each remaining execution-time refusal in one bounded batch.
INSERT INTO scheduled_post_results (key, result)
SELECT 'term_hold_schedule', plugin_data.csf_mutate_post(
  'fb100000-0000-4000-8000-000000000001', 'create', NULL,
  '{"title":"Term hold","body":"Closed term.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-06-01T12:00:00Z","sendEmail":false}'::jsonb,
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000021'
);
INSERT INTO scheduled_post_results (key, result)
SELECT 'cohort_hold_schedule', plugin_data.csf_mutate_post(
  'fb100000-0000-4000-8000-000000000001', 'create', NULL,
  '{"title":"Cohort hold","body":"Inactive class.","audience":"class","audienceCohortId":"fb250000-0000-4000-8000-000000000001","pinned":false,"publish":false,"scheduledFor":"2099-06-02T12:00:00Z","sendEmail":false}'::jsonb,
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000022'
);
INSERT INTO scheduled_post_results (key, result)
SELECT 'expired_hold_schedule', plugin_data.csf_mutate_post(
  'fb100000-0000-4000-8000-000000000001', 'create', NULL,
  '{"title":"Expiry hold","body":"Expired content.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2099-06-03T12:00:00Z","sendEmail":false}'::jsonb,
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000023'
);

UPDATE plugin_data.csf_announcements
SET term_id = 'fb200000-0000-4000-8000-000000000001',
    scheduled_for = pg_catalog.statement_timestamp() - interval '1 minute',
    updated_by = 'fb000000-0000-4000-8000-000000000001'
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'term_hold_schedule'
);
UPDATE plugin_data.csf_announcements
SET scheduled_for = pg_catalog.statement_timestamp() - interval '1 minute',
    updated_by = 'fb000000-0000-4000-8000-000000000001'
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'cohort_hold_schedule'
);
UPDATE plugin_data.csf_announcements
SET scheduled_for = pg_catalog.statement_timestamp() - interval '1 minute',
    expires_at = pg_catalog.statement_timestamp() - interval '2 minutes',
    updated_by = 'fb000000-0000-4000-8000-000000000001'
WHERE id = (
  SELECT (result ->> 'postId')::uuid
  FROM scheduled_post_results
  WHERE key = 'expired_hold_schedule'
);
INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  scheduled_for, email_requested, created_by, updated_by
) VALUES (
  'fb400000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'Legacy scheduled email', 'Never queue email.', 'members', 'scheduled', false,
  pg_catalog.statement_timestamp() - interval '1 minute', true,
  'fb000000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000001'
);
INSERT INTO plugin_data.csf_term_closures (
  id, organization_id, term_id, policy_version, summary, decisions,
  closed_by, revision, correlation_id
) VALUES (
  'fb500000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'fb200000-0000-4000-8000-000000000001',
  1,
  '{"fixture":"scheduled publisher closed-term hold"}'::jsonb,
  '[]'::jsonb,
  'fb000000-0000-4000-8000-000000000001',
  1,
  'fb500000-0000-4000-8000-000000000002'
);
INSERT INTO plugin_data.csf_term_close_authorizations (
  transaction_id, organization_id, term_id, closure_id,
  closure_revision, actor_user_id, correlation_id
) VALUES (
  pg_catalog.txid_current(),
  'fb100000-0000-4000-8000-000000000001',
  'fb200000-0000-4000-8000-000000000001',
  'fb500000-0000-4000-8000-000000000001',
  1,
  'fb000000-0000-4000-8000-000000000001',
  'fb500000-0000-4000-8000-000000000002'
);
UPDATE plugin_data.csf_terms
SET lifecycle_status = 'closed',
    is_current = false,
    closed_at = now(),
    closed_by = 'fb000000-0000-4000-8000-000000000001',
    closure_policy_version = 1,
    closure_revision = 1,
    latest_closure_id = 'fb500000-0000-4000-8000-000000000001',
    active_closure_id = 'fb500000-0000-4000-8000-000000000001'
WHERE id = 'fb200000-0000-4000-8000-000000000001';
DELETE FROM plugin_data.csf_term_close_authorizations
WHERE transaction_id = pg_catalog.txid_current()
  AND organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND term_id = 'fb200000-0000-4000-8000-000000000001';
UPDATE plugin_data.csf_cohorts
SET status = 'inactive'
WHERE id = 'fb250000-0000-4000-8000-000000000001';

INSERT INTO scheduled_post_results (key, result)
SELECT 'mixed_holds', plugin_data.csf_publish_due_posts(
  10, 'pgtap-mixed-holds'
);
SELECT extensions.ok(
  (
    SELECT result ->> 'examined' = '4'
      AND result ->> 'published' = '0'
      AND result ->> 'held' = '4'
      AND result -> 'holds' ->> 'termUnavailable' = '1'
      AND result -> 'holds' ->> 'cohortUnavailable' = '1'
      AND result -> 'holds' ->> 'expired' = '1'
      AND result -> 'holds' ->> 'scheduledEmailUnsupported' = '1'
      AND pg_catalog.jsonb_array_length(result -> 'organizationIds') = 1
    FROM scheduled_post_results
    WHERE key = 'mixed_holds'
  ),
  'term, cohort, expiry, and scheduled-email refusals are distinct and bounded'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_announcements
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND title IN (
        'Term hold', 'Cohort hold', 'Expiry hold', 'Legacy scheduled email'
      )
      AND status = 'scheduled'
      AND published_at IS NULL
      AND scheduled_publish_hold_reason IS NOT NULL
  ),
  4,
  'all four refused rows remain unpublished and visibly held'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_communication_campaigns
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  ),
  0,
  'the entire scheduled-post test lane creates no email campaigns'
);
SELECT extensions.ok(
  (
    SELECT result ->> 'examined' = '0'
      AND result ->> 'published' = '0'
      AND result ->> 'held' = '0'
    FROM (
      SELECT plugin_data.csf_publish_due_posts(
        50, 'pgtap-held-retry'
      ) AS result
    ) AS retry
  ),
  'held revisions are not repeatedly processed or audited'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE organization_id IN (
      'fb100000-0000-4000-8000-000000000001',
      'fb100000-0000-4000-8000-000000000002'
    )
      AND source_type = 'scheduled_post_publisher_hold'
  ),
  7,
  'each of the seven held revisions has exactly one immutable hold receipt'
);

SELECT * FROM extensions.finish();
ROLLBACK;
