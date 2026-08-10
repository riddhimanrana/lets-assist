-- Atomic, audited, response-loss-safe CSF post mutations. Synthetic only.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(52);

SELECT extensions.has_function(
  'plugin_data',
  'csf_mutate_post',
  ARRAY['uuid', 'text', 'uuid', 'jsonb', 'uuid', 'uuid'],
  'the canonical post mutation RPC exists'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_mutate_post(uuid,text,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'service role can call the post mutation boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_mutate_post(uuid,text,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot mutate posts'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_mutate_post(uuid,text,uuid,jsonb,uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated callers cannot mutate posts directly'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_post_mutation_state(plugin_data.csf_announcements)',
    'EXECUTE'
  ),
  'the canonical state helper remains internal'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    WHERE index_class.relname =
      'csf_admin_audit_events_post_mutation_request_idx'
      AND index_row.indisunique
      AND pg_catalog.pg_get_expr(
        index_row.indpred,
        index_row.indrelid
      ) LIKE '%source_type = ''post_mutation_request''%'
  ),
  'request receipt uniqueness is scoped to the new post source namespace'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin-a@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'member-a@local.test', now(), '{}', '{}', now(), now()),
  ('fa000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'admin-b@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fa100000-0000-4000-8000-000000000001', 'Atomic Posts A', 'atomic-posts-a', 'school', '994201'),
  ('fa100000-0000-4000-8000-000000000002', 'Atomic Posts B', 'atomic-posts-b', 'school', '994202');

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fa100000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('fa100000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_cohorts (
  id, organization_id, graduation_year, label
) VALUES
  ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 2098, 'Class of 2098'),
  ('fa200000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 2098, 'Other Class of 2098');

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, pinned,
  email_requested, created_by, updated_by
) VALUES
  ('fa400000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'Existing draft', 'Before update.', 'members', 'draft', false, true, 'fa000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001'),
  ('fa400000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 'Other chapter', 'Private to B.', 'members', 'draft', false, false, 'fa000000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000003');

CREATE TEMP TABLE post_mutation_results (
  key text PRIMARY KEY,
  result jsonb NOT NULL
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'create', NULL,
    '{"title":"Denied","body":"No authority.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
    'fa000000-0000-4000-8000-000000000002',
    'fa300000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Not authorized to manage CSF posts.',
  'authorization fails before any request receipt or post write'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcements WHERE title = 'Denied'),
  0,
  'unauthorized create writes no post'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000001'),
  0,
  'unauthorized create writes no receipt'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'create', NULL,
    '{"title":"Wrong cohort","body":"Cross chapter.","audience":"class","audienceCohortId":"fa200000-0000-4000-8000-000000000002","pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'That graduating class does not belong to this chapter.',
  'a post cannot target another chapter cohort'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcements WHERE title = 'Wrong cohort'),
  0,
  'cross-chapter cohort rejection writes no post'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000002'),
  0,
  'cross-chapter cohort rejection writes no receipt'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'create', NULL,
    '{"title":"Bad schedule","body":"Malformed date.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"not-a-dateZ","sendEmail":false}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000010'
  ) $$,
  'P0001',
  'Choose a valid scheduled post time.',
  'malformed Z timestamps fail with bounded validation copy'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'create', NULL,
    '{"title":"Bad offset","body":"Malformed offset.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":"2098-01-02T03:04:05+99:99","sendEmail":false}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000011'
  ) $$,
  'P0001',
  'Choose a valid scheduled post time.',
  'invalid timezone displacement fails with bounded validation copy'
);

-- An old audit can share the UUID because it is outside the receipt namespace.
INSERT INTO plugin_data.csf_admin_audit_events (
  organization_id, actor_user_id, action, target_type, target_id,
  correlation_id, source_type, source_id, reason_code
) VALUES (
  'fa100000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  'post_created', 'csf_announcement',
  'fa400000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000003',
  'legacy_manual', 'legacy', 'legacy_post_created'
);

INSERT INTO post_mutation_results (key, result)
SELECT 'create', plugin_data.csf_mutate_post(
  'fa100000-0000-4000-8000-000000000001', ' CREATE ', NULL,
  '{"title":"  Hello chapter  ","body":"  Body with detail.  ","audience":"MEMBERS","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":true}'::jsonb,
  'fa000000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000003'
);
SELECT extensions.ok(
  (SELECT result ->> 'status' = 'published' AND (result ->> 'idempotent')::boolean = false FROM post_mutation_results WHERE key = 'create'),
  'create returns a bounded committed receipt'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_announcements
    WHERE id = (SELECT (result ->> 'postId')::uuid FROM post_mutation_results WHERE key = 'create')
      AND title = 'Hello chapter'
      AND body = 'Body with detail.'
      AND audience = 'members'
      AND status = 'published'
      AND published_at IS NOT NULL
      AND email_requested = true
  ),
  'create persists DB-normalized post state and sticky email intent'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000003' AND source_type = 'post_mutation_request'),
  1,
  'create writes exactly one namespaced audit receipt beside the legacy audit'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'fa300000-0000-4000-8000-000000000003'
      AND source_type = 'post_mutation_request'
      AND action = 'post_created'
      AND actor_user_id = 'fa000000-0000-4000-8000-000000000001'
      AND after_data ? 'requestFingerprint'
      AND after_data ? 'stateFingerprint'
      AND after_data -> 'postState' ? 'emailRequested'
      AND NOT (after_data -> 'postState' ? 'emailCampaignId')
  ),
  'create receipt freezes actor, canonical fingerprints, and mutation-owned state only'
);

INSERT INTO post_mutation_results (key, result)
SELECT 'create_replay', plugin_data.csf_mutate_post(
  'fa100000-0000-4000-8000-000000000001', 'create', NULL,
  '{"title":"Hello chapter","body":"Body with detail.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":true}'::jsonb,
  'fa000000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000003'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean AND result ->> 'postId' = (SELECT result ->> 'postId' FROM post_mutation_results WHERE key = 'create') FROM post_mutation_results WHERE key = 'create_replay'),
  'an exact create retry returns the committed post'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcements WHERE title = 'Hello chapter'),
  1,
  'an exact create retry cannot duplicate the post'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000003' AND source_type = 'post_mutation_request'),
  1,
  'an exact create retry cannot duplicate history'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'create', NULL,
    '{"title":"Different","body":"Body with detail.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":true}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'That post request identifier is already bound to a different change.',
  'the create UUID cannot be reused with different normalized intent'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcements WHERE title IN ('Hello chapter', 'Different')),
  1,
  'a conflicting create retry cannot write another post'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000003' AND source_type = 'post_mutation_request'),
  1,
  'a conflicting create retry cannot write another receipt'
);

UPDATE public.organization_members SET status = 'inactive'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND user_id = 'fa000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'create', NULL,
    '{"title":"Hello chapter","body":"Body with detail.","audience":"members","audienceCohortId":null,"pinned":false,"publish":true,"scheduledFor":null,"sendEmail":true}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Not authorized to manage CSF posts.',
  'revoked authority is checked before a committed receipt replay'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000003' AND source_type = 'post_mutation_request'),
  1,
  'revoked replay leaves its receipt untouched'
);
UPDATE public.organization_members SET status = 'active'
WHERE organization_id = 'fa100000-0000-4000-8000-000000000001'
  AND user_id = 'fa000000-0000-4000-8000-000000000001';

INSERT INTO post_mutation_results (key, result)
SELECT 'update', plugin_data.csf_mutate_post(
  'fa100000-0000-4000-8000-000000000001', 'update',
  'fa400000-0000-4000-8000-000000000001',
  '{"title":"  Updated draft  ","body":"  Published now.  ","audience":"class","audienceCohortId":"fa200000-0000-4000-8000-000000000001","pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  'fa000000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000004'
);
SELECT extensions.ok(
  (SELECT result ->> 'status' = 'published' AND (result ->> 'emailRequested')::boolean FROM post_mutation_results WHERE key = 'update'),
  'update returns the committed status and sticky prior email intent'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_announcements
    WHERE id = 'fa400000-0000-4000-8000-000000000001'
      AND title = 'Updated draft'
      AND body = 'Published now.'
      AND audience = 'class'
      AND audience_cohort_id = 'fa200000-0000-4000-8000-000000000001'
      AND status = 'published'
      AND email_requested = true
      AND updated_by = 'fa000000-0000-4000-8000-000000000001'
  ),
  'update persists normalized content without clearing email_requested'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'fa300000-0000-4000-8000-000000000004'
      AND source_type = 'post_mutation_request'
      AND action = 'post_updated'
      AND before_data IS NOT NULL
      AND after_data -> 'postState' ->> 'status' = 'published'
  ),
  'update commits one canonical before/after audit receipt'
);

INSERT INTO post_mutation_results (key, result)
SELECT 'update_replay', plugin_data.csf_mutate_post(
  'fa100000-0000-4000-8000-000000000001', 'update',
  'fa400000-0000-4000-8000-000000000001',
  '{"title":"Updated draft","body":"Published now.","audience":"class","audienceCohortId":"fa200000-0000-4000-8000-000000000001","pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
  'fa000000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000004'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean FROM post_mutation_results WHERE key = 'update_replay'),
  'an exact update retry returns its committed receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000004' AND source_type = 'post_mutation_request'),
  1,
  'an exact update retry cannot duplicate history'
);

INSERT INTO post_mutation_results (key, result)
SELECT 'pin', plugin_data.csf_mutate_post(
  'fa100000-0000-4000-8000-000000000001', 'pin',
  'fa400000-0000-4000-8000-000000000001', '{"pinned":true}'::jsonb,
  'fa000000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000005'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean = false FROM post_mutation_results WHERE key = 'pin')
    AND (SELECT pinned FROM plugin_data.csf_announcements WHERE id = 'fa400000-0000-4000-8000-000000000001'),
  'pin mutates the row once and returns a committed result'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000005' AND action = 'post_pinned' AND source_type = 'post_mutation_request'),
  1,
  'pin commits exactly one history row'
);

INSERT INTO post_mutation_results (key, result)
SELECT 'pin_replay', plugin_data.csf_mutate_post(
  'fa100000-0000-4000-8000-000000000001', 'pin',
  'fa400000-0000-4000-8000-000000000001', '{"pinned":true}'::jsonb,
  'fa000000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000005'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean FROM post_mutation_results WHERE key = 'pin_replay'),
  'an exact pin retry returns the original receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000005' AND source_type = 'post_mutation_request'),
  1,
  'an exact pin retry cannot duplicate history'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'update',
    'fa400000-0000-4000-8000-000000000001',
    '{"title":"Updated draft","body":"Published now.","audience":"class","audienceCohortId":"fa200000-0000-4000-8000-000000000001","pinned":false,"publish":true,"scheduledFor":null,"sendEmail":false}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'The committed post change is no longer current. Reload the feed before trying again.',
  'a later pin makes an old update replay truthfully stale'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000004' AND source_type = 'post_mutation_request'),
  1,
  'stale update replay cannot add history'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'pin',
    'fa400000-0000-4000-8000-000000000001', '{"pinned":false}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'That post request identifier is already bound to a different change.',
  'a pin request UUID cannot be rebound to the opposite state'
);
SELECT extensions.ok(
  (SELECT pinned FROM plugin_data.csf_announcements WHERE id = 'fa400000-0000-4000-8000-000000000001'),
  'conflicting pin retry leaves current state unchanged'
);

INSERT INTO post_mutation_results (key, result)
SELECT 'archive', plugin_data.csf_mutate_post(
  'fa100000-0000-4000-8000-000000000001', 'archive',
  'fa400000-0000-4000-8000-000000000001', '{}'::jsonb,
  'fa000000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000006'
);
SELECT extensions.ok(
  (SELECT result ->> 'status' = 'archived' AND (result ->> 'idempotent')::boolean = false FROM post_mutation_results WHERE key = 'archive'),
  'archive returns a committed archived result'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_announcements
    WHERE id = 'fa400000-0000-4000-8000-000000000001'
      AND status = 'archived'
      AND pinned = false
  ),
  'archive atomically removes the post pin'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000006' AND action = 'post_archived' AND source_type = 'post_mutation_request'),
  1,
  'archive commits exactly one history row'
);

INSERT INTO post_mutation_results (key, result)
SELECT 'archive_replay', plugin_data.csf_mutate_post(
  'fa100000-0000-4000-8000-000000000001', 'archive',
  'fa400000-0000-4000-8000-000000000001', '{}'::jsonb,
  'fa000000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000006'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean FROM post_mutation_results WHERE key = 'archive_replay'),
  'an exact archive retry returns its committed receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000006' AND source_type = 'post_mutation_request'),
  1,
  'an exact archive retry cannot duplicate history'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'archive',
    'fa400000-0000-4000-8000-000000000001', '{}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000007'
  ) $$,
  'P0001',
  'An archived post is history; create a new post instead.',
  'a new request cannot archive an already archived post again'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000007' AND source_type = 'post_mutation_request'),
  0,
  're-archive rejection writes no history'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'pin',
    'fa400000-0000-4000-8000-000000000001', '{"pinned":true}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'The committed post change is no longer current. Reload the feed before trying again.',
  'archive makes the earlier pin receipt stale'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000005' AND source_type = 'post_mutation_request'),
  1,
  'stale pin replay cannot duplicate history'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000002', 'update',
    'fa400000-0000-4000-8000-000000000001',
    '{"title":"Cross tenant","body":"No access.","audience":"members","audienceCohortId":null,"pinned":false,"publish":false,"scheduledFor":null,"sendEmail":false}'::jsonb,
    'fa000000-0000-4000-8000-000000000003',
    'fa300000-0000-4000-8000-000000000008'
  ) $$,
  'P0001',
  'That post was not found in this chapter.',
  'an authorized officer cannot mutate another chapter post through their own org'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000008' AND source_type = 'post_mutation_request'),
  0,
  'cross-tenant update writes no receipt'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post(
    'fa100000-0000-4000-8000-000000000001', 'pin',
    'fa400000-0000-4000-8000-000000000099', '{"pinned":true}'::jsonb,
    'fa000000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000009'
  ) $$,
  'P0001',
  'That post was not found in this chapter.',
  'pin of a missing post fails closed'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fa300000-0000-4000-8000-000000000009' AND source_type = 'post_mutation_request'),
  0,
  'missing-post pin writes no history'
);

SELECT * FROM extensions.finish();
ROLLBACK;
