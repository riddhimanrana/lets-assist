BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);
SELECT extensions.ok(
 (SELECT prosrc ~ 'csf_staff_access_lock_key[^;]+;[[:space:]]+IF NOT plugin_data.csf_actor_has_permission' FROM pg_proc WHERE oid='plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)'::regprocedure),
 'staff connection rechecks authorization after the shared staff access lock'
);
SELECT extensions.ok(
 (SELECT strpos(prosrc,'csf_staff_access_lock_key') < strpos(prosrc,'csf_lock_identity_mutation') AND strpos(prosrc,'csf_staff_access_lock_key') > 0 FROM pg_proc WHERE oid='plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)'::regprocedure),
 'staff connection acquires staff access before identity lock in the import lock order'
);
SELECT extensions.ok(
 NOT has_function_privilege('authenticated','plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)','EXECUTE') AND NOT has_function_privilege('anon','plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)','EXECUTE'),
 'forward authority repair preserves browser execution denial'
);
SELECT extensions.ok(
 has_function_privilege('service_role','plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)','EXECUTE'),
 'forward authority repair preserves server execution'
);
SELECT * FROM extensions.finish();
ROLLBACK;
