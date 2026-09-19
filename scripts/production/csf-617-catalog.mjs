// Pin the bounded, service-only Sheet observation batch wrappers.
export function csf617Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND (
      SELECT count(*) = 2 AND bool_and(
        procedure_record.proowner = 'postgres'::regrole
        AND procedure_record.prosecdef
        AND procedure_record.proconfig = ARRAY['search_path=""']
        AND pg_catalog.has_function_privilege(
          'service_role', procedure_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege(
          'anon', procedure_record.oid, 'EXECUTE'
        )
        AND NOT pg_catalog.has_function_privilege(
          'authenticated', procedure_record.oid, 'EXECUTE'
        )
      )
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid IN (
        'plugin_data.csf_sheet_sync_destination_snapshots(uuid,uuid,jsonb)'::regprocedure,
        'plugin_data.csf_record_sheet_sync_changes(uuid,uuid,uuid,jsonb)'::regprocedure
      )
    )
    AND (
      SELECT pg_catalog.strpos(
          procedure_record.prosrc,
          'jsonb_array_length(p_records) NOT BETWEEN 1 AND 100'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'plugin_data.csf_sheet_sync_destination_snapshot('
        ) > 0
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_sheet_sync_destination_snapshots(uuid,uuid,jsonb)'::regprocedure
    )
    AND (
      SELECT pg_catalog.strpos(
          procedure_record.prosrc,
          'jsonb_array_length(p_changes) NOT BETWEEN 1 AND 100'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'plugin_data.csf_record_sheet_sync_change('
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'p_destination_lease_token'
        ) > 0
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_record_sheet_sync_changes(uuid,uuid,uuid,jsonb)'::regprocedure
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
