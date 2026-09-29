BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);
SELECT extensions.ok((SELECT proconfig @> ARRAY['statement_timeout=60s', 'search_path=""'] FROM pg_proc WHERE oid='plugin_data.csf_release_reviewed_sheet_decisions(uuid,uuid,uuid,uuid,text)'::regprocedure), 'reviewed publication has a finite function timeout and empty search path');
SELECT extensions.ok(NOT has_function_privilege('anon','plugin_data.csf_release_reviewed_sheet_decisions(uuid,uuid,uuid,uuid,text)','EXECUTE'), 'anonymous clients cannot publish');
SELECT extensions.ok(NOT has_function_privilege('authenticated','plugin_data.csf_release_reviewed_sheet_decisions(uuid,uuid,uuid,uuid,text)','EXECUTE'), 'browser clients cannot publish directly');
SELECT extensions.ok(has_function_privilege('service_role','plugin_data.csf_release_reviewed_sheet_decisions(uuid,uuid,uuid,uuid,text)','EXECUTE'), 'the authorized server action retains publication access');
SELECT * FROM extensions.finish();
ROLLBACK;
