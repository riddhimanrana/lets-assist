-- Read-only schema receipts for the normal isolated CI database. No tenant rows.
BEGIN TRANSACTION READ ONLY;
WITH signatures(signature) AS (
  VALUES
    ('plugin_data.csf_publication_account_is_owned(uuid,uuid,uuid)'),
    ('plugin_data.csf_publication_recipient_allowed(uuid,text,uuid,uuid)'),
    ('plugin_data.csf_record_publication_notifications()'),
    ('plugin_data.csf_claim_publication_notifications(integer)'),
    ('plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)'),
    ('plugin_data.csf_finish_publication_notification(uuid,uuid,uuid,text)'),
    ('plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)'),
    ('plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)')
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
  to_regclass('plugin_data.csf_publication_events'),
  to_regclass('plugin_data.csf_publication_notification_deliveries'))
), tables AS (
  SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
    has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
    has_table_privilege('service_role',c.oid,'SELECT') AS service_select,
    has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE') AS service_write
  FROM pg_class c WHERE c.oid IN ('plugin_data.csf_publication_events'::regclass,
    'plugin_data.csf_publication_notification_deliveries'::regclass)
)
SELECT jsonb_build_object('migration','20260914033117','functionCount',(SELECT count(*) FROM functions),
  'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY signature) FROM functions f),
  'relations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY relname) FROM relations r),
  'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM tables t)) AS receipt
;
ROLLBACK;
