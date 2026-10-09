BEGIN;
-- Match the Storage API transaction setting while testing its database role.
SET LOCAL storage.allow_delete_query = 'true';
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
SELECT extensions.is((SELECT count(*) FROM app_private.storage_object_policy_contract_violations()),
  0::bigint, 'public image policies match the reviewed Storage contract');
SELECT extensions.is((SELECT count(*) FROM app_private.storage_object_policy_catalog()
  WHERE bucket_id IN ('avatars', 'organization-logos') AND NOT is_permissive
    AND role_names = ARRAY['anon','authenticated']::text[]),
  6::bigint, 'both browser roles have restrictive image mutation policies');

-- A future permissive grant must not reopen image writes or cross-bucket moves.
CREATE POLICY image_write_regression_broad_grant ON storage.objects
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
INSERT INTO storage.objects(bucket_id, name, metadata) VALUES
  ('avatars','fc180000-0000-4000-8000-000000000001-111.webp','{"mimetype":"image/webp"}'),
  ('organization-logos','fc181000-0000-4000-8000-000000000001.111.webp','{"mimetype":"image/webp"}'),
  ('project-images','image-boundary-regression.png','{"mimetype":"image/png"}');

SET LOCAL ROLE anon;
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name)
  VALUES ('avatars','synthetic-direct-upload.webp')$$, '42501', NULL,
  'anon cannot upload avatars even with a broad permissive grant');
WITH changed AS (UPDATE storage.objects SET metadata='{"modified":true}'
  WHERE bucket_id='avatars' AND name='fc180000-0000-4000-8000-000000000001-111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'anon cannot overwrite avatars');
WITH changed AS (DELETE FROM storage.objects
  WHERE bucket_id='avatars' AND name='fc180000-0000-4000-8000-000000000001-111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'anon cannot delete avatars');
WITH changed AS (UPDATE storage.objects SET bucket_id='project-images'
  WHERE bucket_id='avatars' AND name='fc180000-0000-4000-8000-000000000001-111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'anon cannot move a protected image out of avatars');
SELECT extensions.throws_ok($$UPDATE storage.objects SET bucket_id='avatars'
  WHERE bucket_id='project-images' AND name='image-boundary-regression.png'$$, '42501', NULL,
  'anon cannot move another object into avatars');
SELECT extensions.is((SELECT count(*) FROM storage.objects WHERE bucket_id='avatars' AND name='fc180000-0000-4000-8000-000000000001-111.webp'),
  1::bigint, 'image write restriction leaves anon read policy evaluation unchanged');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name)
  VALUES ('organization-logos','synthetic-direct-upload.webp')$$, '42501', NULL,
  'anon cannot upload organization-logos even with a broad permissive grant');
WITH changed AS (UPDATE storage.objects SET metadata='{"modified":true}'
  WHERE bucket_id='organization-logos' AND name='fc181000-0000-4000-8000-000000000001.111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'anon cannot overwrite organization-logos');
WITH changed AS (DELETE FROM storage.objects
  WHERE bucket_id='organization-logos' AND name='fc181000-0000-4000-8000-000000000001.111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'anon cannot delete organization-logos');
WITH changed AS (UPDATE storage.objects SET bucket_id='project-images'
  WHERE bucket_id='organization-logos' AND name='fc181000-0000-4000-8000-000000000001.111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'anon cannot move a protected image out of organization-logos');
SELECT extensions.throws_ok($$UPDATE storage.objects SET bucket_id='organization-logos'
  WHERE bucket_id='project-images' AND name='image-boundary-regression.png'$$, '42501', NULL,
  'anon cannot move another object into organization-logos');
SELECT extensions.is((SELECT count(*) FROM storage.objects WHERE bucket_id='organization-logos' AND name='fc181000-0000-4000-8000-000000000001.111.webp'),
  1::bigint, 'image write restriction leaves anon read policy evaluation unchanged');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name)
  VALUES ('avatars','synthetic-direct-upload.webp')$$, '42501', NULL,
  'authenticated cannot upload avatars even with a broad permissive grant');
WITH changed AS (UPDATE storage.objects SET metadata='{"modified":true}'
  WHERE bucket_id='avatars' AND name='fc180000-0000-4000-8000-000000000001-111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'authenticated cannot overwrite avatars');
WITH changed AS (DELETE FROM storage.objects
  WHERE bucket_id='avatars' AND name='fc180000-0000-4000-8000-000000000001-111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'authenticated cannot delete avatars');
WITH changed AS (UPDATE storage.objects SET bucket_id='project-images'
  WHERE bucket_id='avatars' AND name='fc180000-0000-4000-8000-000000000001-111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'authenticated cannot move a protected image out of avatars');
SELECT extensions.throws_ok($$UPDATE storage.objects SET bucket_id='avatars'
  WHERE bucket_id='project-images' AND name='image-boundary-regression.png'$$, '42501', NULL,
  'authenticated cannot move another object into avatars');
SELECT extensions.is((SELECT count(*) FROM storage.objects WHERE bucket_id='avatars' AND name='fc180000-0000-4000-8000-000000000001-111.webp'),
  1::bigint, 'image write restriction leaves authenticated read policy evaluation unchanged');
SELECT extensions.throws_ok($$INSERT INTO storage.objects(bucket_id,name)
  VALUES ('organization-logos','synthetic-direct-upload.webp')$$, '42501', NULL,
  'authenticated cannot upload organization-logos even with a broad permissive grant');
WITH changed AS (UPDATE storage.objects SET metadata='{"modified":true}'
  WHERE bucket_id='organization-logos' AND name='fc181000-0000-4000-8000-000000000001.111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'authenticated cannot overwrite organization-logos');
WITH changed AS (DELETE FROM storage.objects
  WHERE bucket_id='organization-logos' AND name='fc181000-0000-4000-8000-000000000001.111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'authenticated cannot delete organization-logos');
WITH changed AS (UPDATE storage.objects SET bucket_id='project-images'
  WHERE bucket_id='organization-logos' AND name='fc181000-0000-4000-8000-000000000001.111.webp' RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  0::bigint, 'authenticated cannot move a protected image out of organization-logos');
SELECT extensions.throws_ok($$UPDATE storage.objects SET bucket_id='organization-logos'
  WHERE bucket_id='project-images' AND name='image-boundary-regression.png'$$, '42501', NULL,
  'authenticated cannot move another object into organization-logos');
SELECT extensions.is((SELECT count(*) FROM storage.objects WHERE bucket_id='organization-logos' AND name='fc181000-0000-4000-8000-000000000001.111.webp'),
  1::bigint, 'image write restriction leaves authenticated read policy evaluation unchanged');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT extensions.lives_ok($$INSERT INTO storage.objects(bucket_id,name)
  VALUES ('avatars','fc180000-0000-4000-8000-000000000001-222.webp'),
    ('organization-logos','fc181000-0000-4000-8000-000000000001.222.webp')$$,
  'trusted server Storage can upload both public image types');
WITH changed AS (UPDATE storage.objects SET metadata='{"checked":true}'
  WHERE name IN ('fc180000-0000-4000-8000-000000000001-222.webp',
    'fc181000-0000-4000-8000-000000000001.222.webp') RETURNING id)
SELECT extensions.is((SELECT count(*) FROM changed),
  2::bigint, 'trusted server Storage can maintain its image metadata');
RESET ROLE;
SELECT extensions.is((SELECT count(*) FROM storage.objects
  WHERE name IN ('fc180000-0000-4000-8000-000000000001-111.webp',
    'fc181000-0000-4000-8000-000000000001.111.webp') AND metadata='{"mimetype":"image/webp"}'::jsonb),
  2::bigint, 'browser mutation attempts preserved both original image records');
SELECT * FROM extensions.finish();
ROLLBACK;
