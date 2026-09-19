// Pin the service-only attendance readiness projection to the rule that every
// error on a non-blocking cutoff row must be one of the reviewed cutoff errors.
export function csf619Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND (
      SELECT procedure_record.proowner = 'postgres'::regrole
        AND NOT procedure_record.prosecdef
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
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'pg_catalog.cardinality(import_row.errors) > 0'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'FROM pg_catalog.unnest(import_row.errors) AS row_error(message)'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'row_error.message IS NULL'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'row_error.message NOT IN ('
        ) > 0
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_import_preview_readiness(uuid,uuid)'::regprocedure
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
