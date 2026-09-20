WITH namespaces AS (
  SELECT oid, nspname, nspowner, nspacl FROM pg_catalog.pg_namespace
  WHERE nspname IN ('public', 'plugin_data', 'app_private')
), objects AS (
  SELECT 'function:' || n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS identity,
    pg_catalog.jsonb_build_object('definition', pg_catalog.pg_get_functiondef(p.oid),
      'owner', pg_catalog.pg_get_userbyid(p.proowner), 'acl', p.proacl::text) AS definition
  FROM pg_catalog.pg_proc p JOIN namespaces n ON n.oid=p.pronamespace
  WHERE p.prokind <> 'a' AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass
      AND d.objid=p.oid AND d.deptype='e')
  UNION ALL
  SELECT 'relation:' || n.nspname || '.' || c.relname,
    pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(c.relowner),
      'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
      'acl',c.relacl::text,'options',c.reloptions,
      'view',CASE WHEN c.relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(c.oid) END,
      'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attname,
        pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated,a.attacl::text)
        ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d
        ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(k.conname,
        pg_catalog.pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred)
        ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
      'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        pg_catalog.pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive)
        ORDER BY pg_catalog.pg_get_indexdef(i.indexrelid) COLLATE "C")
        FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid),
      'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        pg_catalog.pg_get_triggerdef(t.oid),t.tgenabled) ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
      'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.polname,
        p.polcmd,p.polpermissive,(SELECT pg_catalog.array_agg(CASE WHEN r=0 THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(r) END ORDER BY r) FROM pg_catalog.unnest(p.polroles) r),
        pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
        ORDER BY p.polname) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid))
  FROM pg_catalog.pg_class c JOIN namespaces n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S') AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::regclass
      AND d.objid=c.oid AND d.deptype='e')
  UNION ALL
  SELECT 'schema:'||nspname,pg_catalog.jsonb_build_object(
    'owner',pg_catalog.pg_get_userbyid(nspowner),'acl',nspacl::text) FROM namespaces
  UNION ALL
  SELECT 'enum:'||n.nspname||'.'||t.typname,
    pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(t.typowner),
      'acl',t.typacl::text,'labels',(SELECT pg_catalog.jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
       FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid))
  FROM pg_catalog.pg_type t JOIN namespaces n ON n.oid=t.typnamespace WHERE t.typtype='e'
  UNION ALL
  SELECT 'cron:retain-cron-execution-history',pg_catalog.jsonb_build_object(
    'schedule',schedule,'command',command,'username',username,'active',active,
    'current_database',database=current_database()) FROM cron.job WHERE jobname='retain-cron-execution-history'
)
SELECT identity,pg_catalog.md5(definition::text) AS digest FROM objects ORDER BY identity COLLATE "C"
