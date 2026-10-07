BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
 raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('fc000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
 'deletion-fence@local.test', now(), '{}', '{}', now(), now());

SELECT extensions.ok(app_private.account_deletion_actor_is_active(
 'fc000000-0000-4000-8000-000000000001'), 'an account without a deletion operation can write');
SELECT extensions.ok(NOT has_table_privilege('service_role',
 'app_private.account_deletion_operations', 'SELECT'), 'service callers must use reviewed receipt functions');
SELECT extensions.ok(NOT has_function_privilege('anon',
 'public.account_deletion_pending()', 'EXECUTE'), 'anonymous callers cannot read deletion status');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
 'app_private.account_deletion_actor_is_active(uuid)', 'EXECUTE'), 'browser callers cannot query other actors');

SELECT set_config('request.jwt.claim.sub', 'fc000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT extensions.is(public.account_deletion_pending(), false, 'the account sees its own active status');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO app_private.account_deletion_operations
 (target_user_id, requested_by, mode, phase, db_transaction_id)
VALUES ('fc000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001',
 'self_delete', 'blocked', txid_current());
SELECT extensions.ok(app_private.account_deletion_actor_is_active(
 'fc000000-0000-4000-8000-000000000001'), 'a refused preflight does not freeze the account');
UPDATE app_private.account_deletion_operations SET phase = 'external_pending';
SELECT extensions.ok(NOT app_private.account_deletion_actor_is_active(
 'fc000000-0000-4000-8000-000000000001'), 'postcommit cleanup freezes the account');
SELECT set_config('request.jwt.claim.sub', 'fc000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT extensions.is(public.account_deletion_pending(), true, 'the account can read its pending status');
SELECT extensions.throws_ok($$UPDATE public.profiles SET full_name = 'Changed' WHERE false$$,
 '42501', 'Account deletion is pending or complete.', 'the statement fence also refuses zero-row client writes');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT extensions.throws_ok($$INSERT INTO public.notifications (user_id, title, body, type)
 VALUES ('fc000000-0000-4000-8000-000000000001', 'Synthetic', 'Synthetic', 'general')$$,
 '42501', 'Cannot create a reference to an account being deleted.', 'service writes cannot add new user dependencies');
UPDATE app_private.account_deletion_operations SET phase = 'database_pending', db_transaction_id = txid_current();
SELECT extensions.lives_ok($$UPDATE public.profiles SET full_name = 'Synthetic' WHERE
 id = 'fc000000-0000-4000-8000-000000000001'$$, 'the database owner can perform the atomic cleanup phase');
SELECT extensions.is((SELECT count(*) FROM pg_trigger WHERE tgname = 'account_deletion_write_fence'
 AND tgrelid = 'storage.objects'::regclass), 1::bigint, 'Storage client writes use the same account fence');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public', 'plugin_data') AND c.relkind = 'r' AND NOT EXISTS (
 SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'account_deletion_write_fence')),
 'every current platform and plugin table receives the client write fence');
UPDATE app_private.account_deletion_operations SET phase = 'completed', completed_at = now();
SELECT extensions.ok(NOT app_private.account_deletion_actor_is_active(
 'fc000000-0000-4000-8000-000000000001'), 'completed blacklist receipts keep retained Auth accounts frozen');
SELECT extensions.lives_ok($$DELETE FROM auth.users WHERE id = 'fc000000-0000-4000-8000-000000000001'$$,
 'removing Auth does not remove or invalidate the durable operation');
SELECT * FROM extensions.finish();
ROLLBACK;
