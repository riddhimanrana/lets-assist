BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

SELECT extensions.ok(NOT has_function_privilege('anon',
  'plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)', 'EXECUTE'),
  'Anonymous users cannot authorize email dispatch');
SELECT extensions.ok(NOT has_function_privilege('authenticated',
  'plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)', 'EXECUTE'),
  'Signed-in users cannot authorize email dispatch directly');
SELECT extensions.ok(has_function_privilege('service_role',
  'plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)', 'EXECUTE'),
  'The service worker retains dispatch authorization');
SELECT extensions.ok(has_function_privilege('postgres',
  'plugin_data.csf_authorize_communication_dispatch(uuid,uuid,text,text)', 'EXECUTE'),
  'The database owner retains dispatch authorization');

SELECT * FROM extensions.finish();
ROLLBACK;
