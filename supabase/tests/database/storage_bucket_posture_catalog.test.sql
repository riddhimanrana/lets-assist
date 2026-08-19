-- AUD-009: bucket posture and every client-reachable storage.objects policy are
-- reviewed as one fail-closed contract.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(25);

SELECT extensions.results_eq(
  $$
    SELECT
      bucket_id::text COLLATE "C",
      is_public,
      file_size_limit,
      allowed_mime_types,
      posture::text COLLATE "C"
    FROM app_private.storage_bucket_posture_catalog()
    ORDER BY bucket_id
  $$,
  $$
    SELECT
      bucket_id::text COLLATE "C",
      is_public,
      file_size_limit,
      allowed_mime_types,
      posture::text COLLATE "C"
    FROM (
      VALUES
        ('avatars'::text, true, 10485760::bigint, ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[], 'public'::text),
        ('plugins'::text, false, 20971520::bigint, ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[], 'server-only'::text),
        ('data-exports'::text, false, 52428800::bigint, ARRAY['application/zip']::text[], 'server-only'::text),
        ('organization-logos'::text, true, 10485760::bigint, ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[], 'public'::text),
        ('paper-signup-scans'::text, false, 8388608::bigint, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[], 'private-client'::text),
        ('plugin_form_uploads'::text, false, 10485760::bigint, ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[], 'private-client'::text),
        ('project-documents'::text, true, 20971520::bigint, ARRAY['application/pdf']::text[], 'public'::text),
        ('project-images'::text, true, 20971520::bigint, ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[], 'public'::text),
        ('waiver-signatures'::text, false, 10485760::bigint, ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']::text[], 'server-only'::text),
        ('waiver-uploads'::text, true, 20971520::bigint, ARRAY['application/pdf']::text[], 'public'::text),
        ('waivers'::text, true, 20971520::bigint, ARRAY['application/pdf']::text[], 'public'::text)
    ) AS expected(bucket_id, is_public, file_size_limit, allowed_mime_types, posture)
    ORDER BY bucket_id
  $$,
  'storage bucket posture catalog matches the reviewed eleven-bucket baseline'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'app_private.storage_bucket_posture_catalog()', 'EXECUTE'),
  'anon cannot execute the storage bucket posture catalog'
);

SELECT extensions.ok(
  NOT has_function_privilege('authenticated', 'app_private.storage_bucket_posture_catalog()', 'EXECUTE'),
  'authenticated cannot execute the storage bucket posture catalog'
);

SELECT extensions.ok(
  has_function_privilege('service_role', 'app_private.storage_bucket_posture_catalog()', 'EXECUTE'),
  'service_role can execute the storage bucket posture catalog'
);

SELECT extensions.ok(
  to_regprocedure('app_private.storage_object_policy_live_catalog()') IS NOT NULL
  AND to_regprocedure('app_private.storage_object_policy_catalog()') IS NOT NULL
  AND to_regprocedure('app_private.storage_object_policy_contract_violations()') IS NOT NULL,
  'fixed-context live reader, exact storage object policy catalog, and drift function exist'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon', 'app_private.storage_object_policy_live_catalog()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'app_private.storage_object_policy_live_catalog()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'app_private.storage_object_policy_catalog()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'app_private.storage_object_policy_catalog()', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'app_private.storage_object_policy_contract', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app_private.storage_object_policy_contract', 'SELECT'),
  'browser roles cannot read the reviewed policy contract'
);

SELECT extensions.ok(
  has_function_privilege('service_role', 'app_private.storage_object_policy_live_catalog()', 'EXECUTE')
  AND has_function_privilege('service_role', 'app_private.storage_object_policy_catalog()', 'EXECUTE')
  AND has_function_privilege('service_role', 'app_private.storage_object_policy_contract_violations()', 'EXECUTE')
  AND has_table_privilege('service_role', 'app_private.storage_object_policy_contract', 'SELECT'),
  'service_role can inspect the reviewed storage policy contract'
);

SELECT extensions.is(
  (SELECT count(*) FROM app_private.storage_object_policy_catalog()),
  21::bigint,
  'the exact reviewed storage.objects contract contains all twenty-one client policies'
);

SELECT extensions.is(
  (SELECT count(*) FROM app_private.storage_object_policy_contract_violations()),
  0::bigint,
  'every client-reachable live policy exactly matches identity, command, roles, shape, qual, and check'
);

-- The snapshot and the drift gate must deparse through the same fixed
-- search_path. A snapshot captured while public was visible would store
-- unqualified relation names and report every authority recheck as both missing
-- and unexpected on a clean replay.
SELECT extensions.is(
  (
    SELECT count(*)
    FROM app_private.storage_object_policy_catalog() AS reviewed
    WHERE concat_ws(
      ' ',
      reviewed.using_expression,
      reviewed.with_check_expression
    ) ~ 'FROM (organization_members|projects) '
  ),
  0::bigint,
  'no reviewed policy snapshot stores an unqualified public relation reference'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM app_private.storage_object_policy_catalog() AS reviewed
    WHERE concat_ws(
      ' ',
      reviewed.using_expression,
      reviewed.with_check_expression
    ) LIKE ANY (ARRAY['%public.organization_members%', '%public.projects%'])
  ),
  15::bigint,
  'all fifteen membership and project authority rechecks stay schema-qualified'
);

SELECT extensions.ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage'
      AND relation.relname = 'objects'
      AND relation.relkind IN ('r', 'p')
  ),
  'storage.objects enforces RLS before its client policy contract is evaluated'
);

SELECT extensions.is(
  (
    SELECT count(*)
    FROM app_private.storage_object_policy_catalog() AS policy_catalog
    JOIN app_private.storage_bucket_posture_catalog() AS bucket_catalog USING (bucket_id)
    WHERE bucket_catalog.posture = 'server-only'
  ),
  0::bigint,
  'server-only buckets have zero reviewed browser-direct read, write, or list paths'
);

SELECT extensions.results_eq(
  $$
    SELECT policy_catalog.policy_name::text COLLATE "C", policy_catalog.bucket_id::text COLLATE "C"
    FROM app_private.storage_object_policy_catalog() AS policy_catalog
    JOIN app_private.storage_bucket_posture_catalog() AS bucket_catalog USING (bucket_id)
    WHERE bucket_catalog.posture = 'private-client'
      AND policy_catalog.role_names = ARRAY['authenticated']::text[]
      AND policy_catalog.is_permissive
    ORDER BY policy_catalog.policy_name
  $$,
  $$
    SELECT policy_name::text COLLATE "C", bucket_id::text COLLATE "C"
    FROM (
      VALUES
        ('Authenticated users can delete own plugin form files'::text, 'plugin_form_uploads'::text),
        ('Authenticated users can upload own plugin form files'::text, 'plugin_form_uploads'::text),
        ('Authenticated users can view own plugin form files'::text, 'plugin_form_uploads'::text),
        ('Org staff can view their org plugin form files'::text, 'plugin_form_uploads'::text),
        ('Project managers can delete paper signup scans'::text, 'paper-signup-scans'::text),
        ('Project managers can read paper signup scans'::text, 'paper-signup-scans'::text),
        ('Project managers can upload paper signup scans'::text, 'paper-signup-scans'::text)
    ) AS expected(policy_name, bucket_id)
    ORDER BY policy_name
  $$,
  'all seven private-client policies retain exact authenticated bucket-scoped access'
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audit-probe-rogue-bucket',
  'audit-probe-rogue-bucket',
  false,
  1024,
  ARRAY['application/octet-stream']::text[]
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    LEFT JOIN app_private.storage_bucket_posture_catalog() AS catalog
      ON catalog.bucket_id = bucket.id
    WHERE catalog.bucket_id IS NULL
  ),
  'a rogue bucket is detected as unexpected catalog drift'
);

UPDATE storage.buckets SET public = true WHERE id = 'data-exports';

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_bucket_posture_catalog() AS catalog
    JOIN storage.buckets AS bucket ON bucket.id = catalog.bucket_id
    WHERE catalog.is_public IS DISTINCT FROM bucket.public
  ),
  'a flipped public flag is detected as property drift'
);

CREATE POLICY "audit probe broad authenticated storage read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (true);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE drift_kind = 'unexpected'
      AND policy_name = 'audit probe broad authenticated storage read'
      AND using_expression = 'true'
  ),
  'a broad authenticated USING true policy is rejected'
);

CREATE POLICY "audit probe bucketless authenticated storage write"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (name LIKE 'private/%');

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE drift_kind = 'unexpected'
      AND policy_name = 'audit probe bucketless authenticated storage write'
  ),
  'an authenticated policy omitting a bucket predicate is rejected'
);

CREATE POLICY "audit probe PUBLIC plugins read"
  ON storage.objects
  FOR SELECT
  TO PUBLIC
  USING (bucket_id = 'plugins');

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE drift_kind = 'unexpected'
      AND policy_name = 'audit probe PUBLIC plugins read'
      AND role_names = ARRAY['public']::text[]
  ),
  'a PUBLIC policy is client-reachable and exposes a server-only bucket violation'
);

CREATE ROLE audit_storage_policy_parent NOLOGIN;
GRANT audit_storage_policy_parent TO authenticated WITH INHERIT TRUE;

CREATE POLICY "audit probe inherited storage read"
  ON storage.objects
  FOR SELECT
  TO audit_storage_policy_parent
  USING (true);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE drift_kind = 'unexpected'
      AND policy_name = 'audit probe inherited storage read'
      AND role_names = ARRAY['audit_storage_policy_parent']::text[]
  ),
  'a policy reachable through inherited role membership is rejected'
);

DROP POLICY "Authenticated users can upload own avatars" ON storage.objects;
CREATE POLICY "Authenticated users can upload own avatars"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE policy_name = 'Authenticated users can upload own avatars'
      AND command = 'SELECT'
      AND drift_kind = 'unexpected'
  ),
  'reviewed policy command drift is rejected'
);

ALTER POLICY "Authenticated users can view own plugin form files"
  ON storage.objects
  TO PUBLIC;

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE policy_name = 'Authenticated users can view own plugin form files'
      AND role_names = ARRAY['public']::text[]
      AND drift_kind = 'unexpected'
  ),
  'reviewed policy role drift is rejected'
);

ALTER POLICY "Project managers can read paper signup scans"
  ON storage.objects
  USING (true);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE policy_name = 'Project managers can read paper signup scans'
      AND using_expression = 'true'
      AND drift_kind = 'unexpected'
  ),
  'reviewed policy USING expression drift is rejected'
);

ALTER POLICY "Project managers can upload paper signup scans"
  ON storage.objects
  WITH CHECK (true);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE policy_name = 'Project managers can upload paper signup scans'
      AND with_check_expression = 'true'
      AND drift_kind = 'unexpected'
  ),
  'reviewed policy WITH CHECK expression drift is rejected'
);

DROP POLICY "Project managers can delete paper signup scans" ON storage.objects;
CREATE POLICY "Project managers can delete paper signup scans"
  ON storage.objects
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'paper-signup-scans');

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM app_private.storage_object_policy_contract_violations()
    WHERE policy_name = 'Project managers can delete paper signup scans'
      AND NOT is_permissive
      AND drift_kind = 'unexpected'
  ),
  'reviewed permissive versus restrictive policy shape drift is rejected'
);

SELECT * FROM extensions.finish();

ROLLBACK;
