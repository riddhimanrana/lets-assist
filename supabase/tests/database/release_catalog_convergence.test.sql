BEGIN;
SELECT plan(7);
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE n.nspname IN ('public','plugin_data') AND c.relowner='postgres'::regrole
    AND c.relkind IN ('r','p','m','v')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
      AND d.objid=c.oid AND d.deptype='e')
    AND a.privilege_type='MAINTAIN' AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)
), 'runtime roles cannot perform table maintenance');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclrole='postgres'::regrole AND n.nspname IN ('public','plugin_data')
    AND a.privilege_type='MAINTAIN'
), 'repository defaults do not introduce maintenance grants');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM (VALUES
    ('dv_sd_judge_assignments','idx_dv_sd_assignments_org'),
    ('dv_sd_parent_student_links','idx_dv_sd_links_org'),
    ('dv_sd_signup_forms','idx_dv_sd_forms_org'),
    ('dv_sd_signup_questions','idx_dv_sd_questions_org'),
    ('dv_sd_signup_submissions','idx_dv_sd_submissions_org'),
    ('dv_sd_submission_answers','idx_dv_sd_answers_org')
  ) expected(table_name,index_name)
  LEFT JOIN pg_index i ON i.indexrelid=to_regclass('plugin_data.'||expected.index_name)
  WHERE i.indexrelid IS NULL OR NOT i.indisvalid OR NOT i.indisready
    OR pg_get_indexdef(i.indexrelid) IS DISTINCT FROM format(
      'CREATE INDEX %I ON plugin_data.%I USING btree (organization_id)',expected.index_name,expected.table_name)
), 'all six organization indexes retain their reviewed canonical definition');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM (VALUES ('judge_assignments'),('parent_student_links'),('signup_forms'),
    ('signup_questions'),('signup_submissions'),('submission_answers')) suffix(name)
  WHERE to_regclass('plugin_data.idx_dv_sd_'||suffix.name||'_org') IS NOT NULL
), 'equivalent alternate indexes do not remain duplicated');
SELECT is(md5(pg_get_functiondef('plugin_data.csf_actor_can_manage_staff(uuid,uuid)'::regprocedure)),
  'aa7d27b251ae2219ed91263b7fe4aafa', 'staff authority matches the final reviewed term-bound implementation');
SELECT ok(has_function_privilege('service_role','plugin_data.csf_actor_can_manage_staff(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','plugin_data.csf_actor_can_manage_staff(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','plugin_data.csf_actor_can_manage_staff(uuid,uuid)','EXECUTE'),
  'staff authority remains server-only');
SELECT ok(has_table_privilege('authenticated','public.profiles','SELECT')
  AND has_table_privilege('service_role','public.profiles','UPDATE'),
  'ordinary application permissions remain available');
SELECT * FROM finish();
ROLLBACK;
