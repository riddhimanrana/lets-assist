-- The publication bell has its own release-bound switch without changing the
-- four-worker contract consumed by an already deployed host.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);
DO $receipt$
DECLARE v_receipt jsonb;
BEGIN
WITH signatures(signature) AS (
  VALUES
    ('public.read_csf_release_worker_controls_v2(text)'),
    ('app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)')
), functions AS (
  SELECT signature,md5(pg_get_functiondef(p.oid)) AS definition_md5,
    pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,
    p.provolatile AS volatility,p.proconfig AS settings,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
    (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type)
      FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS acl
  FROM signatures JOIN pg_proc p ON p.oid=to_regprocedure(signature)
), relations AS (
SELECT c.relname, md5(jsonb_build_object(
  'owner', pg_get_userbyid(c.relowner), 'kind', c.relkind,
  'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
  'acl', c.relacl::text,
  'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname,
    format_type(a.atttypid,a.atttypmod), a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid), a.attidentity, a.attgenerated, a.attacl::text)
    ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d
    ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT jsonb_agg(jsonb_build_array(k.conname,
    pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred)
    ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
  'indexes', (SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),
    i.indisvalid,i.indisready) ORDER BY pg_get_indexdef(i.indexrelid) COLLATE "C")
    FROM pg_index i WHERE i.indrelid=c.oid),
  'triggers', (SELECT jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),
    t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
    WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)
)::text) AS digest,
NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(name)
  WHERE has_table_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) AS runtime_denied
FROM pg_class c WHERE c.relpersistence = 'p' AND c.oid IN (
  to_regclass('app_private.csf_release_worker_controls'),
  to_regclass('app_private.csf_release_worker_receipts'))
), tables AS (
  SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
    has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
    has_table_privilege('service_role',c.oid,'SELECT') AS service_select,
    has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE') AS service_write
  FROM pg_class c WHERE c.oid IN ('app_private.csf_release_worker_controls'::regclass,
    'app_private.csf_release_worker_receipts'::regclass)
)
SELECT jsonb_build_object('migration','20260914044610','functionCount',(SELECT count(*) FROM functions),
  'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY signature) FROM functions f),
  'relations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY relname) FROM relations r),
  'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM tables t)) INTO v_receipt
;
RAISE NOTICE 'publication_control_schema_receipt: %', v_receipt;
END;
$receipt$;

SELECT extensions.is(
  (SELECT count(*)::integer FROM jsonb_object_keys(public.read_csf_release_worker_controls(repeat('e',40))->'workers')),
  4,
  'legacy worker reads keep exactly four flags'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM jsonb_object_keys(public.read_csf_release_worker_controls_v2(repeat('e',40))->'workers')),
  5,
  'v2 worker reads expose exactly five flags'
);
SELECT extensions.is(
  public.read_csf_release_worker_controls_v2(repeat('e',40))->'workers'->>'publication_notifications',
  'false',
  'publication notifications default off for an unknown release'
);
SELECT extensions.ok(
  has_function_privilege('service_role','public.read_csf_release_worker_controls_v2(text)','EXECUTE'),
  'the host runtime can read v2 controls'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon','public.read_csf_release_worker_controls_v2(text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.read_csf_release_worker_controls_v2(text)','EXECUTE'),
  'browser roles cannot read v2 controls'
);
SELECT extensions.ok(
  NOT has_function_privilege('service_role','app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)','EXECUTE'),
  'the host runtime still cannot change controls'
);

CREATE TEMP TABLE publication_worker_receipts(kind text PRIMARY KEY, receipt jsonb NOT NULL);
INSERT INTO publication_worker_receipts VALUES (
  'publication',
  app_private.set_csf_release_worker_control(
    repeat('e',40),'publication_notifications',true,0,
    'ee010000-0000-4000-8000-000000000001','fixture-operator','fixture publication activation'
  )
);
SELECT extensions.is(
  (SELECT receipt->'workers'->>'publication_notifications' FROM publication_worker_receipts WHERE kind='publication'),
  'true',
  'publication notifications can be enabled independently'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM publication_worker_receipts, jsonb_object_keys(receipt->'workers') WHERE kind='publication'),
  5,
  'publication transitions return the v2 receipt'
);
SELECT extensions.is(
  public.read_csf_release_worker_controls(repeat('e',40))->'workers' ? 'publication_notifications',
  false,
  'legacy reads do not gain the new field after activation'
);

INSERT INTO publication_worker_receipts VALUES (
  'legacy',
  app_private.set_csf_release_worker_control(
    repeat('e',40),'workbook_refresh',true,1,
    'ee010000-0000-4000-8000-000000000002','fixture-operator','fixture legacy activation'
  )
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM publication_worker_receipts, jsonb_object_keys(receipt->'workers') WHERE kind='legacy'),
  4,
  'new legacy transitions retain the four-worker receipt shape'
);
SELECT extensions.is(
  public.read_csf_release_worker_controls_v2(repeat('e',40))->'workers'->>'publication_notifications',
  'true',
  'a legacy transition preserves the independent publication flag'
);
SELECT extensions.is(
  app_private.set_csf_release_worker_control(
    repeat('e',40),'workbook_refresh',true,1,
    'ee010000-0000-4000-8000-000000000002','fixture-operator','fixture legacy activation'
  ),
  (SELECT receipt FROM publication_worker_receipts WHERE kind='legacy'),
  'a lost legacy response replays its exact four-worker receipt'
);
SELECT extensions.throws_ok(
  $$SELECT app_private.set_csf_release_worker_control(repeat('e',40),'scheduled_post_publisher',true,2,'ee010000-0000-4000-8000-000000000003','fixture-operator','fixture retired activation')$$,
  '55000','Scheduled publishing has been removed',
  'retired scheduled publishing remains impossible'
);
SELECT extensions.is(
  (SELECT publication_notifications FROM app_private.csf_release_worker_controls WHERE release_sha=repeat('e',40)),
  true,
  'the publication flag is persisted on the release row'
);
SELECT extensions.throws_ok(
  $$SELECT public.read_csf_release_worker_controls_v2('development')$$,
  '22023','Invalid release identity',
  'v2 reads require an exact release identity'
);

SELECT * FROM extensions.finish();
ROLLBACK;
