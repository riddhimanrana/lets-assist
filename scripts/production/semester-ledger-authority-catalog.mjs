// Exact postconditions for the 581st migration, measured on an isolated replay.
export function semesterLedgerAuthorityCatalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")})=1
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('plugin_data.csf_guard_semester_write_destination_authority()',
          'dce998e3d881fb96c4528652e7b317ff'),
        ('plugin_data.csf_guard_semester_write_mapping_delete()',
          '9ac05eaa81b9bd1ccd95fae03ff46146'),
        ('plugin_data.csf_guard_workbook_link_unsettled_write()',
          'bed09085445ef97e0a34f0bab63e3828'),
        ('plugin_data.csf_guard_semester_write_link_owner()',
          '294c8d521ae3724d5561b619f60b3d49'),
        ('plugin_data.csf_guard_semester_write_membership()',
          '153fa284f3087ee8dd47c32080cd33a4'),
        ('plugin_data.csf_guard_membership_unsettled_semester_write()',
          '4cc2a9177c63f96d3313c159622facdd')
      ) expected(signature,digest)
      LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
      WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM expected.digest
        OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
        OR has_function_privilege('service_role',p.oid,'EXECUTE')
        OR has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR (SELECT count(*)<>1 OR NOT bool_and(a.grantee='postgres'::regrole
          AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
          AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
    ) AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('csf_semester_write_destination_authority',
          'plugin_data.csf_sheet_sync_destinations','plugin_data.csf_guard_semester_write_destination_authority()',27),
        ('csf_semester_write_mapping_delete',
          'plugin_data.csf_sheet_semester_ledger_mappings','plugin_data.csf_guard_semester_write_mapping_delete()',11),
        ('csf_workbook_link_unsettled_write',
          'plugin_data.csf_reviewed_workbook_profile_links','plugin_data.csf_guard_workbook_link_unsettled_write()',27),
        ('csf_semester_write_membership',
          'plugin_data.csf_sheet_semester_ledger_writes','plugin_data.csf_guard_semester_write_membership()',7),
        ('csf_membership_unsettled_semester_write',
          'plugin_data.csf_profile_cohort_memberships','plugin_data.csf_guard_membership_unsettled_semester_write()',27)
      ) expected(name,table_name,signature,trigger_type)
      LEFT JOIN pg_trigger t ON t.tgname=expected.name
        AND t.tgrelid=to_regclass(expected.table_name)
      WHERE t.oid IS NULL OR t.tgfoid IS DISTINCT FROM to_regprocedure(expected.signature)
        OR t.tgenabled<>'O' OR t.tgisinternal OR t.tgtype<>expected.trigger_type
    ) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
