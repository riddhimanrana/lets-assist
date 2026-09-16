BEGIN;

SELECT plan(9);

SELECT ok(
  (
    SELECT procedure.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)'::regprocedure
  ),
  'the internal merge was refreshed with a fixed empty search path'
);

SELECT ok(
  (
    SELECT procedure.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ),
  'the request-aware merge wrapper was refreshed with a fixed empty search path'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_merge_profiles',
  ARRAY['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'service_role',
  ARRAY[]::text[],
  'the internal merge remains unavailable to service role'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_merge_profiles',
  ARRAY['uuid', 'uuid', 'uuid', 'text', 'uuid', 'uuid'],
  'service_role',
  ARRAY['EXECUTE'],
  'service role can call only the retry-safe merge wrapper'
);

-- Each new merge concern renames the previous entry point to a `_base` and
-- wraps it, so the chain grows a link at a time. Walk it instead of pinning one
-- hop: what matters is that the public merge still reaches the canonical
-- preview, however many concerns sit in between.
--
-- The walk is seeded by OID. It used to select the entry point by comparing
-- `pg_get_function_identity_arguments()` to 'uuid, uuid, uuid, text, uuid',
-- which never matched: that function renders the declared parameter *names*
-- alongside the types, so a named overload reads as
-- 'p_organization_id uuid, p_source_profile_id uuid, ...'. The seed was empty,
-- the recursion had nothing to walk, and both checks below were false for a
-- reason that had nothing to do with the delegation chain. This is the same
-- trap 20260730001004 records, where it classified every canonical function as
-- obsolete. `regprocedure` resolves the overload the way the assertions above
-- already do.
SELECT ok(
  (
    WITH RECURSIVE delegation(signature, definition) AS (
      SELECT
        entry.oid::regprocedure::text,
        pg_get_functiondef(entry.oid)
      FROM pg_catalog.pg_proc AS entry
      WHERE entry.oid =
        'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)'::regprocedure
      UNION
      SELECT
        delegate.oid::regprocedure::text,
        pg_get_functiondef(delegate.oid)
      FROM delegation
      JOIN pg_catalog.pg_proc AS delegate
        ON delegation.definition
          LIKE '%plugin_data.' || delegate.proname || '(%'
      JOIN pg_catalog.pg_namespace AS delegate_schema
        ON delegate_schema.oid = delegate.pronamespace
      WHERE delegate_schema.nspname = 'plugin_data'
        AND delegate.proname LIKE 'csf_merge_profiles%_base'
    )
    SELECT
      EXISTS (
        SELECT 1 FROM delegation
        WHERE definition LIKE '%plugin_data.csf_profile_merge_preview(%'
      )
      AND EXISTS (
        SELECT 1 FROM delegation
        WHERE signature LIKE '%csf_merge_profiles_workbook_links_base%'
      )
  ),
  'the public merge delegates through its private implementations to the canonical preview'
);

SELECT ok(
  (
    SELECT procedure.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid =
      'plugin_data.csf_merge_profiles_workbook_links_base(uuid,uuid,uuid,text,uuid)'::regprocedure
  ),
  'the private workbook-link merge implementation retains its fixed empty search path'
);

SELECT function_privs_are(
  'plugin_data',
  'csf_merge_profiles_workbook_links_base',
  ARRAY['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'service_role',
  ARRAY[]::text[],
  'service role cannot bypass the workbook-link merge wrapper'
);

SELECT ok(
  pg_get_functiondef(
    'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ) LIKE '%plugin_data.csf_merge_profiles(%',
  'the retry-safe wrapper calls the refreshed internal merge by name'
);

-- The guard the previous form of this file needed and did not have. An empty
-- walk makes every reachability check above false, which reads as a broken
-- delegation chain when it is really a broken seed. Prove the seed resolves,
-- separately, so the two failures can never be confused again.
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS entry
    WHERE entry.oid =
      'plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)'::regprocedure
      AND pg_get_functiondef(entry.oid)
        LIKE '%plugin_data.csf_merge_profiles%_base(%'
  ),
  'the delegation walk has an entry point that hands off to a private base'
);

SELECT * FROM finish();

ROLLBACK;
