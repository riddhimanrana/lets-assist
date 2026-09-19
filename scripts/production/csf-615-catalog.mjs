// Keep cutoff exclusions uncredited while exposing their exact aggregate to the
// service-only readiness projection.
export function csf615Catalog(previous) {
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
          'attendance_window_excluded'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          $$preview.source_type = 'meeting_attendance'$$
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'This response arrived before attendance opened and cannot count.'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          'This response arrived after attendance closed and cannot count.'
        ) > 0
        AND pg_catalog.strpos(
          procedure_record.prosrc,
          $$'attendanceWindowExcluded', counts.attendance_window_excluded$$
        ) > 0
      FROM pg_catalog.pg_proc AS procedure_record
      WHERE procedure_record.oid =
        'plugin_data.csf_import_preview_readiness(uuid,uuid)'::regprocedure
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
