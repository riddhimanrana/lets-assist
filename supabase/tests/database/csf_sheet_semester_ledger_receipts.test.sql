BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='plugin_data' AND c.relname='csf_sheet_semester_ledger_mappings' AND c.relrowsecurity),
  'accepted semester mappings stay behind RLS');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='plugin_data' AND c.relname='csf_sheet_semester_ledger_writes' AND c.relrowsecurity),
  'semester write receipts stay behind RLS');
SELECT extensions.ok(
  NOT has_table_privilege('authenticated','plugin_data.csf_sheet_semester_ledger_mappings','SELECT')
  AND NOT has_table_privilege('authenticated','plugin_data.csf_sheet_semester_ledger_writes','SELECT'),
  'members cannot read mappings or write receipts');
SELECT extensions.ok(
  NOT has_table_privilege('service_role','plugin_data.csf_sheet_semester_ledger_mappings','INSERT')
  AND NOT has_table_privilege('service_role','plugin_data.csf_sheet_semester_ledger_writes','INSERT'),
  'service callers cannot bypass reviewed mapping and claim functions');
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_accept_sheet_semester_ledger_mapping(uuid,uuid,uuid,text,uuid,jsonb,text)','EXECUTE')
  AND has_function_privilege('service_role',
    'plugin_data.csf_accept_sheet_semester_ledger_mapping(uuid,uuid,uuid,text,uuid,jsonb,text)','EXECUTE'),
  'only the server may submit a reviewed mapping');
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)','EXECUTE')
  AND has_function_privilege('service_role',
    'plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)','EXECUTE'),
  'only the server may claim a reviewed cell write');
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_finish_sheet_semester_ledger_write(uuid,uuid,uuid,text,text)','EXECUTE')
  AND has_function_privilege('service_role',
    'plugin_data.csf_finish_sheet_semester_ledger_write(uuid,uuid,uuid,text,text)','EXECUTE'),
  'only the server may settle a provider outcome');
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'plugin_data.csf_sheet_semester_ledger_source_version(uuid,uuid,uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role',
    'plugin_data.csf_sheet_semester_ledger_source_version(uuid,uuid,uuid,uuid)','EXECUTE'),
  'only authorized server callers may read a versioned profile snapshot');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgname='csf_sheet_semester_mapping_immutable'
    AND NOT t.tgisinternal),
  'accepted mapping has an immutable trigger');
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgname='csf_sheet_semester_write_immutable'
    AND NOT t.tgisinternal),
  'write identity and receipt have an immutable trigger');

SELECT * FROM extensions.finish();
ROLLBACK;
