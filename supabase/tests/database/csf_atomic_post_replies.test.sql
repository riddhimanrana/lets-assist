-- Atomic, tenant-consistent, replay-safe officer follow-up replies. Synthetic only.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(47);

SELECT extensions.has_function(
  'plugin_data',
  'csf_mutate_post_reply',
  ARRAY['uuid', 'text', 'uuid', 'uuid', 'text', 'uuid', 'uuid'],
  'the canonical follow-up mutation RPC exists'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_mutate_post_reply(uuid,text,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'service role can call the follow-up mutation boundary'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_mutate_post_reply(uuid,text,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot mutate follow-ups'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_mutate_post_reply(uuid,text,uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'browser-authenticated callers cannot mutate follow-ups directly'
);
SELECT extensions.ok(
  has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'SELECT'
  ),
  'service role can read follow-ups for the server-rendered feed'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'INSERT'
  ),
  'service role cannot bypass the add transaction'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'UPDATE'
  ),
  'service role cannot introduce an unaudited edit path'
);
SELECT extensions.ok(
  NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'TRUNCATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'REFERENCES'
  )
  AND NOT has_table_privilege(
    'service_role',
    'plugin_data.csf_announcement_replies',
    'TRIGGER'
  ),
  'service role cannot bypass the transaction or alter the table boundary'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname =
      'csf_announcement_replies_announcement_organization_fkey'
      AND constraint_row.contype = 'f'
      AND constraint_row.convalidated
  ),
  'the reply-to-announcement tenant foreign key is present and validated'
);
SELECT extensions.ok(
  (
    SELECT count(*) = 2
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'plugin_data.csf_announcement_replies'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid =
        'plugin_data.csf_announcements'::regclass
      AND constraint_row.confdeltype = 'r'
  ),
  'both reply parent foreign keys restrict unaudited announcement cascades'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'service_role',
    'plugin_data.csf_purge_recovery_foundations_without_post_replies(uuid)',
    'EXECUTE'
  ),
  'the prior teardown implementation is owner-only behind the reviewed wrapper'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    WHERE index_class.relname =
      'csf_admin_audit_events_post_reply_request_idx'
      AND index_row.indisunique
      AND pg_catalog.pg_get_expr(
        index_row.indpred,
        index_row.indrelid
      ) LIKE '%post_reply_mutation_request%'
  ),
  'follow-up request receipts are unique inside their own source namespace'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin-a-replies@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'member-a-replies@local.test', now(), '{}', '{}', now(), now()),
  ('fb000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'admin-b-replies@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  ('fb100000-0000-4000-8000-000000000001', 'Atomic Replies A', 'atomic-replies-a', 'school', '994301'),
  ('fb100000-0000-4000-8000-000000000002', 'Atomic Replies B', 'atomic-replies-b', 'school', '994302');

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('fb100000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000003', 'admin', 'active');

INSERT INTO plugin_data.csf_announcements (
  id, organization_id, title, body, audience, status, published_at, created_by
) VALUES
  ('fb200000-0000-4000-8000-000000000001', 'fb100000-0000-4000-8000-000000000001', 'Published A', 'Visible in A.', 'members', 'published', now(), 'fb000000-0000-4000-8000-000000000001'),
  ('fb200000-0000-4000-8000-000000000002', 'fb100000-0000-4000-8000-000000000001', 'Draft A', 'Not visible.', 'members', 'draft', NULL, 'fb000000-0000-4000-8000-000000000001'),
  ('fb200000-0000-4000-8000-000000000003', 'fb100000-0000-4000-8000-000000000002', 'Published B', 'Visible in B.', 'members', 'published', now(), 'fb000000-0000-4000-8000-000000000003');

CREATE TEMP TABLE post_reply_mutation_results (
  key text PRIMARY KEY,
  result jsonb NOT NULL
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000001', 'add',
    'fb200000-0000-4000-8000-000000000001', NULL, 'Denied.',
    'fb000000-0000-4000-8000-000000000002',
    'fb300000-0000-4000-8000-000000000001'
  ) $$,
  'P0001',
  'Not authorized to manage CSF post follow-ups.',
  'authorization fails before caller-controlled record inspection'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_replies WHERE body = 'Denied.'),
  0,
  'unauthorized add writes no reply'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb300000-0000-4000-8000-000000000001'),
  0,
  'unauthorized add writes no receipt'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000002', 'add',
    'fb200000-0000-4000-8000-000000000001', NULL, 'Cross tenant.',
    'fb000000-0000-4000-8000-000000000003',
    'fb300000-0000-4000-8000-000000000002'
  ) $$,
  'P0001',
  'Follow-ups attach to published posts only.',
  'an authorized officer cannot attach through another chapter post id'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb300000-0000-4000-8000-000000000002'),
  0,
  'cross-tenant add writes no receipt'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000001', 'add',
    'fb200000-0000-4000-8000-000000000002', NULL, 'Too early.',
    'fb000000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000003'
  ) $$,
  'P0001',
  'Follow-ups attach to published posts only.',
  'a draft post cannot receive a follow-up'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000001', 'add',
    'fb200000-0000-4000-8000-000000000001', NULL, '   ',
    'fb000000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000004'
  ) $$,
  'P0001',
  'A follow-up is 1 to 4000 characters.',
  'the transaction independently refuses a blank body'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000001', 'add',
    'fb200000-0000-4000-8000-000000000001', NULL, 'No request.',
    'fb000000-0000-4000-8000-000000000001', NULL
  ) $$,
  'P0001',
  'A stable follow-up request identifier is required.',
  'every mutation requires an explicit stable request id'
);

INSERT INTO post_reply_mutation_results (key, result)
SELECT 'add', plugin_data.csf_mutate_post_reply(
  'fb100000-0000-4000-8000-000000000001', ' ADD ',
  'fb200000-0000-4000-8000-000000000001', NULL,
  '  Rescheduled to 9 AM.  ',
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000005'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean = false AND result ? 'replyId' FROM post_reply_mutation_results WHERE key = 'add'),
  'add returns a bounded committed result'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_announcement_replies
    WHERE id = (SELECT (result ->> 'replyId')::uuid FROM post_reply_mutation_results WHERE key = 'add')
      AND organization_id = 'fb100000-0000-4000-8000-000000000001'
      AND announcement_id = 'fb200000-0000-4000-8000-000000000001'
      AND body = 'Rescheduled to 9 AM.'
      AND created_by = 'fb000000-0000-4000-8000-000000000001'
  ),
  'add stores normalized body and server-derived tenant, parent, and actor'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'fb300000-0000-4000-8000-000000000005'
      AND source_type = 'post_reply_mutation_request'
      AND action = 'post_reply_added'
      AND after_data ? 'requestFingerprint'
      AND after_data -> 'replyState' ? 'bodyHash'
      AND after_data ->> 'bodyLength' = '20'
      AND NOT (after_data ? 'body')
  ),
  'add atomically records bounded provenance without copying reply text into history'
);

INSERT INTO post_reply_mutation_results (key, result)
SELECT 'add_replay', plugin_data.csf_mutate_post_reply(
  'fb100000-0000-4000-8000-000000000001', 'add',
  'fb200000-0000-4000-8000-000000000001', NULL,
  'Rescheduled to 9 AM.',
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000005'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean AND result ->> 'replyId' = (SELECT result ->> 'replyId' FROM post_reply_mutation_results WHERE key = 'add') FROM post_reply_mutation_results WHERE key = 'add_replay'),
  'an exact add retry returns the committed reply'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_replies WHERE body = 'Rescheduled to 9 AM.'),
  1,
  'an exact add retry cannot duplicate the reply'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb300000-0000-4000-8000-000000000005' AND source_type = 'post_reply_mutation_request'),
  1,
  'an exact add retry cannot duplicate history'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000001', 'add',
    'fb200000-0000-4000-8000-000000000001', NULL, 'Different body.',
    'fb000000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'That follow-up request identifier is already bound to a different change.',
  'a request id cannot be rebound to different normalized intent'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_replies WHERE body IN ('Rescheduled to 9 AM.', 'Different body.')),
  1,
  'a conflicting retry writes no second reply'
);

UPDATE public.organization_members
SET status = 'inactive'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND user_id = 'fb000000-0000-4000-8000-000000000001';
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000001', 'add',
    'fb200000-0000-4000-8000-000000000001', NULL,
    'Rescheduled to 9 AM.',
    'fb000000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000005'
  ) $$,
  'P0001',
  'Not authorized to manage CSF post follow-ups.',
  'revoked authority is checked before receipt replay'
);
UPDATE public.organization_members
SET status = 'active'
WHERE organization_id = 'fb100000-0000-4000-8000-000000000001'
  AND user_id = 'fb000000-0000-4000-8000-000000000001';

INSERT INTO post_reply_mutation_results (key, result)
SELECT 'author_delete', plugin_data.csf_mutate_post_reply(
  'fb100000-0000-4000-8000-000000000001', 'delete', NULL,
  (SELECT (result ->> 'replyId')::uuid FROM post_reply_mutation_results WHERE key = 'add'),
  NULL,
  'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000009'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean = false FROM post_reply_mutation_results WHERE key = 'author_delete'),
  'the current author can delete their own follow-up'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_announcement_replies
    WHERE id = (SELECT (result ->> 'replyId')::uuid FROM post_reply_mutation_results WHERE key = 'add')
  ),
  0,
  'author delete removes the reply'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'fb300000-0000-4000-8000-000000000009'
      AND action = 'post_reply_deleted'
      AND before_data ->> 'authoredByActor' = 'true'
  ),
  'author delete records the author decision inside its receipt'
);

INSERT INTO plugin_data.csf_announcement_replies (
  id, organization_id, announcement_id, body, created_by
) VALUES (
  'fb400000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  'fb200000-0000-4000-8000-000000000001',
  'Admin-authored reply.',
  'fb000000-0000-4000-8000-000000000001'
);

SELECT extensions.throws_ok(
  $$ DELETE FROM plugin_data.csf_announcements
     WHERE id = 'fb200000-0000-4000-8000-000000000001' $$,
  '23503',
  NULL,
  'deleting a parent post cannot cascade around the reply mutation boundary'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000002', 'delete', NULL,
    'fb400000-0000-4000-8000-000000000001', NULL,
    'fb000000-0000-4000-8000-000000000003',
    'fb300000-0000-4000-8000-000000000006'
  ) $$,
  'P0001',
  'That follow-up no longer exists.',
  'an administrator cannot delete another chapter reply through their own tenant'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_replies WHERE id = 'fb400000-0000-4000-8000-000000000001'),
  1,
  'cross-tenant delete leaves the reply intact'
);

INSERT INTO public.organization_members (
  organization_id, user_id, role, status
) VALUES (
  'fb100000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000003',
  'admin',
  'active'
);
INSERT INTO post_reply_mutation_results (key, result)
SELECT 'admin_delete', plugin_data.csf_mutate_post_reply(
  'fb100000-0000-4000-8000-000000000001', 'delete', NULL,
  'fb400000-0000-4000-8000-000000000001', NULL,
  'fb000000-0000-4000-8000-000000000003',
  'fb300000-0000-4000-8000-000000000007'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean = false AND result ->> 'replyId' = 'fb400000-0000-4000-8000-000000000001' FROM post_reply_mutation_results WHERE key = 'admin_delete'),
  'a current organization admin can delete another author reply'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_announcement_replies WHERE id = 'fb400000-0000-4000-8000-000000000001'),
  0,
  'the authorized delete removes the reply'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events
    WHERE correlation_id = 'fb300000-0000-4000-8000-000000000007'
      AND source_type = 'post_reply_mutation_request'
      AND action = 'post_reply_deleted'
      AND before_data ->> 'authoredByActor' = 'false'
      AND after_data ? 'requestFingerprint'
  ),
  'delete commits author-or-admin evidence beside the mutation'
);

INSERT INTO post_reply_mutation_results (key, result)
SELECT 'admin_delete_replay', plugin_data.csf_mutate_post_reply(
  'fb100000-0000-4000-8000-000000000001', 'delete', NULL,
  'fb400000-0000-4000-8000-000000000001', NULL,
  'fb000000-0000-4000-8000-000000000003',
  'fb300000-0000-4000-8000-000000000007'
);
SELECT extensions.ok(
  (SELECT (result ->> 'idempotent')::boolean FROM post_reply_mutation_results WHERE key = 'admin_delete_replay'),
  'an exact delete retry succeeds from its durable receipt'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb300000-0000-4000-8000-000000000007' AND source_type = 'post_reply_mutation_request'),
  1,
  'an exact delete retry cannot duplicate history'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000001', 'add',
    'fb200000-0000-4000-8000-000000000001', NULL, 'Rebound operation.',
    'fb000000-0000-4000-8000-000000000003',
    'fb300000-0000-4000-8000-000000000007'
  ) $$,
  'P0001',
  'That follow-up request identifier is already bound to a different change.',
  'a delete request id cannot be rebound to an add'
);

SELECT extensions.throws_ok(
  $$ INSERT INTO plugin_data.csf_announcement_replies (
    organization_id, announcement_id, body, created_by
  ) VALUES (
    'fb100000-0000-4000-8000-000000000001',
    'fb200000-0000-4000-8000-000000000003',
    'Forged tenant pair.',
    'fb000000-0000-4000-8000-000000000001'
  ) $$,
  '23503',
  NULL,
  'the composite foreign key rejects a forged tenant-parent pair'
);

SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_mutate_post_reply(
    'fb100000-0000-4000-8000-000000000001', 'delete', NULL,
    'fb400000-0000-4000-8000-000000000099', NULL,
    'fb000000-0000-4000-8000-000000000001',
    'fb300000-0000-4000-8000-000000000008'
  ) $$,
  'P0001',
  'That follow-up no longer exists.',
  'a missing reply delete fails closed'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events WHERE correlation_id = 'fb300000-0000-4000-8000-000000000008'),
  0,
  'a missing reply delete writes no receipt'
);

INSERT INTO post_reply_mutation_results (key, result)
SELECT 'teardown_add', plugin_data.csf_mutate_post_reply(
  'fb100000-0000-4000-8000-000000000002', 'add',
  'fb200000-0000-4000-8000-000000000003', NULL,
  'Synthetic teardown follow-up.',
  'fb000000-0000-4000-8000-000000000003',
  'fb300000-0000-4000-8000-000000000010'
);
SELECT extensions.lives_ok(
  $$ SELECT plugin_data.csf_purge_recovery_foundations(
    'fb100000-0000-4000-8000-000000000002'
  ) $$,
  'the reviewed plugin teardown explicitly retires organization replies'
);
SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_announcement_replies
    WHERE organization_id = 'fb100000-0000-4000-8000-000000000002'
  ),
  0,
  'plugin teardown leaves no organization reply behind'
);
SELECT extensions.lives_ok(
  $$ DELETE FROM plugin_data.csf_announcements
     WHERE id = 'fb200000-0000-4000-8000-000000000003' $$,
  'the lifecycle can delete a reply-free announcement after its purge RPC'
);

SELECT * FROM extensions.finish();
ROLLBACK;
