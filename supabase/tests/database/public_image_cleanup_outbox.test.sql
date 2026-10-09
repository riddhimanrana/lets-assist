BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.ok(NOT has_table_privilege(role_name, 'app_private.public_image_cleanup_objects', 'SELECT,INSERT,UPDATE,DELETE'),
  role_name || ' has no direct cleanup table access') FROM (VALUES ('anon'),('authenticated'),('service_role')) actors(role_name);
SELECT extensions.ok(has_function_privilege('service_role', signature, 'EXECUTE')
  AND NOT has_function_privilege('anon', signature, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', signature, 'EXECUTE'), 'cleanup RPC is service-only: ' || signature)
FROM (VALUES ('public.reserve_public_image_cleanup(uuid,text,uuid,text,text,text)'),
  ('public.claim_public_image_cleanup(integer)'), ('public.finish_public_image_cleanup(uuid,uuid,boolean)')) routines(signature);
SELECT extensions.ok((SELECT bool_and(proconfig = ARRAY['search_path=""'] AND prosecdef) FROM pg_proc
  WHERE oid IN ('public.reserve_public_image_cleanup(uuid,text,uuid,text,text,text)'::regprocedure,
    'public.claim_public_image_cleanup(integer)'::regprocedure, 'public.finish_public_image_cleanup(uuid,uuid,boolean)'::regprocedure)),
  'service operations have a fixed empty search path');

SELECT extensions.ok(NOT has_table_privilege(role_name, 'app_private.auth_public_image_references', 'SELECT,INSERT,UPDATE,DELETE'),
  role_name || ' has no direct Auth reference metadata access') FROM (VALUES ('anon'),('authenticated'),('service_role')) actors(role_name);
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='app_private.auth_public_image_references'::regclass
  AND confrelid='auth.users'::regclass AND confdeltype='c'), 'Auth reference metadata cascades on account removal');
SELECT extensions.ok(to_regclass('public.profiles_public_image_reference_idx') IS NOT NULL
  AND to_regclass('public.organizations_public_image_reference_idx') IS NOT NULL
  AND to_regclass('app_private.auth_public_image_reference_key_idx') IS NOT NULL, 'all reference sources have a key lookup index');

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('fc170000-0000-4000-8000-000000000001','authenticated','authenticated','image-owner@local.test',now(),'{}','{}',now(),now()),
 ('fc170000-0000-4000-8000-000000000002','authenticated','authenticated','image-other@local.test',now(),'{}','{}',now(),now());
INSERT INTO public.organizations(id,name,username,type,join_code)
VALUES ('fc171000-0000-4000-8000-000000000001','Image cleanup synthetic','image-cleanup-synthetic','school','927171');
INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES ('fc171000-0000-4000-8000-000000000001','fc170000-0000-4000-8000-000000000001','admin','active');

CREATE TEMP TABLE image_fixture AS SELECT
  'fc170000-0000-4000-8000-000000000001'::uuid actor,
  'fc170000-0000-4000-8000-000000000002'::uuid other_actor,
  'fc171000-0000-4000-8000-000000000001'::uuid organization,
  'https://images.local.test/storage/v1/object/public/avatars/'::text base,
  'fc170000-0000-4000-8000-000000000001-123.jpg'::text old_path,
  'fc170000-0000-4000-8000-000000000001-00000000-0000-4000-8000-000000000001.webp'::text candidate;
GRANT SELECT ON image_fixture TO service_role, authenticated;
UPDATE public.profiles SET avatar_url = f.base || f.old_path FROM image_fixture f WHERE id = f.actor;
UPDATE auth.users SET raw_user_meta_data = jsonb_build_object('avatar_url', f.base || f.old_path)
  FROM image_fixture f WHERE id = f.actor;

SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$UPDATE public.profiles SET avatar_url=f.base || f.old_path FROM image_fixture f WHERE id=f.actor$$,
 'service image writes can maintain the pure reference expression index');
RESET ROLE;
SELECT extensions.ok(has_function_privilege('authenticated','app_private.public_image_reference_key(text)','EXECUTE')
 AND has_function_privilege('authenticated','app_private.public_image_object_key(text,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','app_private.public_image_is_referenced(text)','EXECUTE'),
 'browser writers can hash only their inputs and cannot inspect stored references');
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
SELECT 'fc170000-0000-4000-8000-000000000003','authenticated','authenticated','image-initial@local.test','{}',
 jsonb_build_object('picture',base || old_path) FROM image_fixture;
SELECT extensions.is((SELECT count(*)::integer FROM app_private.auth_public_image_references
 WHERE user_id='fc170000-0000-4000-8000-000000000003'),1,'an initial Auth image reference satisfies its parent foreign key');
DELETE FROM auth.users WHERE id='fc170000-0000-4000-8000-000000000003';

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$SELECT public.reserve_public_image_cleanup(actor, 'avatars', actor, base || old_path, old_path, candidate) FROM image_fixture$$,
 '42501', NULL, 'a browser cannot register cleanup intent for a chosen actor');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.reserve_public_image_cleanup(other_actor, 'avatars', actor, base || old_path, old_path, candidate) FROM image_fixture$$,
 '42501', 'Image update is not authorized.', 'another account cannot reserve an avatar');
SELECT extensions.throws_ok($$SELECT public.reserve_public_image_cleanup(actor, 'avatars', actor, null, old_path, candidate) FROM image_fixture$$,
 'PT409', 'The image changed before cleanup was reserved.', 'reservation rechecks the current image');
SELECT extensions.throws_ok($$SELECT public.reserve_public_image_cleanup(actor, 'avatars', actor, base || old_path, old_path, other_actor::text || '-123.webp') FROM image_fixture$$,
 '22023', 'Invalid candidate image path.', 'a candidate must belong to the exact owner');
SELECT extensions.lives_ok($$SELECT public.reserve_public_image_cleanup(actor, 'avatars', actor, base || old_path, old_path, candidate) FROM image_fixture$$,
 'both cleanup intents persist before upload');
RESET ROLE;
SELECT extensions.is((SELECT count(*)::integer FROM app_private.public_image_cleanup_objects WHERE object_name IN (SELECT old_path FROM image_fixture UNION ALL SELECT candidate FROM image_fixture)), 2, 'candidate and predecessor both have durable intent');
SELECT extensions.is((SELECT count(*)::integer FROM storage.objects o, image_fixture f WHERE o.bucket_id='avatars' AND o.name=f.candidate), 0,
 'reservation does not fabricate a Storage object');
SELECT extensions.is(jsonb_array_length(public.claim_public_image_cleanup(20)), 1, 'only the predecessor is due before the upload grace period');
SELECT extensions.is((SELECT state FROM app_private.public_image_cleanup_objects q, image_fixture f WHERE q.object_name=f.old_path), 'retained',
 'a current profile or Auth reference prevents cleanup');

INSERT INTO storage.objects(bucket_id,name,owner,metadata)
SELECT 'avatars',candidate,actor,'{"mimetype":"image/webp"}' FROM image_fixture;
UPDATE public.profiles SET avatar_url = f.base || f.candidate FROM image_fixture f WHERE id = f.actor;
SELECT extensions.is((SELECT state FROM app_private.public_image_cleanup_objects q, image_fixture f WHERE q.object_name=f.old_path), 'pending',
 'reference replacement atomically requeues the predecessor');
SELECT extensions.is((public.claim_public_image_cleanup(20)->0->>'retained')::boolean, true, 'a failed Auth metadata sync still protects its old avatar');
UPDATE auth.users SET raw_user_meta_data = jsonb_build_object('avatar_url', f.base || f.candidate) FROM image_fixture f WHERE id = f.actor;
CREATE TEMP TABLE image_claim AS SELECT public.claim_public_image_cleanup(1)->0 payload;
SELECT extensions.is((SELECT payload->>'object_name' FROM image_claim), (SELECT old_path FROM image_fixture), 'detached predecessor can be claimed');
SELECT extensions.is(jsonb_array_length(public.claim_public_image_cleanup(20)), 0, 'another worker cannot steal a live claim');
SELECT extensions.throws_ok($$UPDATE public.profiles SET avatar_url = f.base || f.old_path FROM image_fixture f WHERE id = f.actor$$,
 '23514', 'This image has been retired. Upload a new image.', 'a claimed key cannot be reattached');
SELECT extensions.throws_ok($$UPDATE auth.users SET raw_user_meta_data = jsonb_build_object('picture', f.base || f.old_path || '?cache=1') FROM image_fixture f WHERE id = f.actor$$,
 '23514', 'This image has been retired. Upload a new image.', 'Auth aliases and query strings cannot reattach a retired key');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner) SELECT 'avatars',old_path,actor FROM image_fixture$$,
 '23514', 'This image object has been retired.', 'a late upload cannot publish metadata after the cleanup claim');
SELECT extensions.is((SELECT public.finish_public_image_cleanup((payload->>'id')::uuid, gen_random_uuid(), true) FROM image_claim), false,
 'the acknowledgement rejects another claim token');
SELECT extensions.is((SELECT public.finish_public_image_cleanup((payload->>'id')::uuid, (payload->>'claim_token')::uuid, true) FROM image_claim), true,
 'confirmed absent predecessor completes');
SELECT extensions.ok((SELECT object_name IS NULL AND claim_token IS NULL AND completed_at IS NOT NULL
  FROM app_private.public_image_cleanup_objects WHERE id=(SELECT (payload->>'id')::uuid FROM image_claim)),
 'completed tombstones clear object paths and lease identifiers');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner) SELECT 'avatars',old_path,actor FROM image_fixture$$,
 '23514', 'This image object has been retired.', 'the minimal tombstone still blocks key reuse after completion');
SELECT extensions.throws_ok($$UPDATE public.profiles SET avatar_url = replace(f.base || f.old_path,'fc170000','%66c170000') FROM image_fixture f WHERE id = f.other_actor$$,
 '23514', 'This image has been retired. Upload a new image.', 'percent encoding and a different reference owner do not bypass the key fence');

UPDATE app_private.public_image_cleanup_objects SET available_at=now()-interval '1 second' WHERE state='pending' AND object_name=(SELECT candidate FROM image_fixture);
SELECT extensions.is((public.claim_public_image_cleanup(20)->0->>'retained')::boolean, true, 'an uncertain commit is reconciled from its live references');
UPDATE public.profiles SET avatar_url=NULL FROM image_fixture f WHERE id=f.actor;
UPDATE auth.users SET raw_user_meta_data='{}' FROM image_fixture f WHERE id=f.actor;
TRUNCATE image_claim;
INSERT INTO image_claim SELECT public.claim_public_image_cleanup(1)->0;
SELECT extensions.is((SELECT public.finish_public_image_cleanup((payload->>'id')::uuid,(payload->>'claim_token')::uuid,true) FROM image_claim), false,
 'a success acknowledgement cannot conceal a remaining Storage object');
UPDATE app_private.public_image_cleanup_objects SET available_at=now()-interval '1 second' WHERE state='deleting' AND object_name=(SELECT candidate FROM image_fixture);
CREATE TEMP TABLE retry_claim AS SELECT public.claim_public_image_cleanup(1)->0 payload;
SELECT extensions.ok((SELECT c.payload->>'claim_token' <> r.payload->>'claim_token' FROM image_claim c,retry_claim r), 'retry rotates the lease token');
SELECT extensions.is((SELECT public.finish_public_image_cleanup((payload->>'id')::uuid,(payload->>'claim_token')::uuid,true) FROM image_claim), false,
 'a prior worker cannot settle a newer claim');
SELECT extensions.throws_ok($$UPDATE storage.objects SET metadata='{}' WHERE name=(SELECT candidate FROM image_fixture) AND bucket_id='avatars'$$,
 '23514', 'This image object has been retired.', 'a late upsert cannot replace a retiring object');
-- SQL-only fixture emulates the catalog effect; the owned API rehearsal proves blob removal separately.
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects WHERE bucket_id='avatars' AND name=(SELECT candidate FROM image_fixture);
SELECT extensions.is((SELECT public.finish_public_image_cleanup((payload->>'id')::uuid,(payload->>'claim_token')::uuid,true) FROM retry_claim), true,
 'cleanup succeeds only after independent catalog absence');

SET LOCAL ROLE service_role;
SELECT extensions.throws_ok($$SELECT public.reserve_public_image_cleanup(other_actor,'organization-logos',organization,NULL,NULL,organization::text || '.00000000-0000-4000-8000-000000000002.webp') FROM image_fixture$$,
 '42501','Image update is not authorized.','organization cleanup requires a current active admin');
SELECT extensions.lives_ok($$SELECT public.reserve_public_image_cleanup(actor,'organization-logos',organization,NULL,NULL,organization::text || '.00000000-0000-4000-8000-000000000002.webp') FROM image_fixture$$,
 'an active organization admin can reserve a logo');
RESET ROLE;
DELETE FROM public.organizations WHERE id=(SELECT organization FROM image_fixture);
SELECT extensions.is((SELECT count(*)::integer FROM app_private.public_image_cleanup_objects WHERE bucket_id='organization-logos'),1,
 'organization deletion retains its outstanding object intent');
SELECT extensions.throws_ok($$SELECT public.claim_public_image_cleanup(21)$$,'22023','Invalid image cleanup batch size.','worker batch size is bounded');
SELECT extensions.ok(app_private.public_image_reference_key('https://images.local.test/storage/v1/object/public/avatars/%00') IS NULL,
 'invalid URL bytes are not reference keys');
SELECT extensions.is(public.preflight_account_deletion((SELECT other_actor FROM image_fixture),
  (SELECT other_actor FROM image_fixture), 'self_delete',true), '{}'::jsonb, 'internal image metadata does not block normal account deletion');
UPDATE auth.users SET raw_user_meta_data = jsonb_build_object('picture', f.base || f.other_actor::text || '-123.jpg')
  FROM image_fixture f WHERE id=f.other_actor;
SELECT extensions.is((SELECT count(*)::integer FROM app_private.auth_public_image_references WHERE user_id=(SELECT other_actor FROM image_fixture)),1,
  'Auth picture changes maintain hashed references');
DELETE FROM auth.users WHERE id=(SELECT other_actor FROM image_fixture);
SELECT extensions.is((SELECT count(*)::integer FROM app_private.auth_public_image_references WHERE user_id=(SELECT other_actor FROM image_fixture)),0,
  'account deletion removes every mirrored identifier');
SELECT extensions.ok(app_private.public_image_reference_key('HTTPS://images.local.test/storage/v1/object/public/avatars/fc170000-0000-4000-8000-000000000001-123.JPG') IS NOT NULL,
 'legacy uppercase raster extensions and URL schemes remain recognizable');
SELECT extensions.is(app_private.public_image_reference_key(base || old_path || '?cache=' || repeat('x',5000)),
 app_private.public_image_reference_key(base || old_path),'long irrelevant query strings cannot hide a current image reference') FROM image_fixture;
SELECT * FROM extensions.finish();
ROLLBACK;
