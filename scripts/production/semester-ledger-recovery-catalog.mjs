// Exact postconditions for the 579th migration, measured on an isolated replay.
export function semesterLedgerRecoveryCatalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")})=1
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('plugin_data.csf_guard_workbook_link_unsettled_write()',
          '5c99b2d7923d08d11466dc58e5524211',false),
        ('plugin_data.csf_reconcile_sheet_semester_ledger_write(uuid,uuid,uuid,boolean,text,text)',
          'dd5cb6c71170301102123cd714157921',true)
      ) expected(signature,digest,service_execute)
      LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
      WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM expected.digest
        OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
        OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM expected.service_execute
        OR has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR (SELECT count(*) IS DISTINCT FROM CASE WHEN expected.service_execute THEN 2 ELSE 1 END
          OR NOT bool_and(a.grantee IN ('postgres'::regrole,'service_role'::regrole)
            AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
            AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
    ) AND EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgname='csf_workbook_link_unsettled_write'
        AND t.tgrelid=to_regclass('plugin_data.csf_reviewed_workbook_profile_links')
        AND t.tgfoid=to_regprocedure('plugin_data.csf_guard_workbook_link_unsettled_write()')
        AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgtype=27
        AND pg_get_triggerdef(t.oid)='CREATE TRIGGER csf_workbook_link_unsettled_write BEFORE DELETE OR UPDATE OF profile_id, revoked_at ON plugin_data.csf_reviewed_workbook_profile_links FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_guard_workbook_link_unsettled_write()'
    ) AND EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indexrelid=to_regclass('plugin_data.csf_sheet_semester_ledger_nonaborted_receipt_unique')
        AND i.indrelid=to_regclass('plugin_data.csf_sheet_semester_ledger_writes')
        AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
        AND pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX csf_sheet_semester_ledger_nonaborted_receipt_unique ON plugin_data.csf_sheet_semester_ledger_writes USING btree (destination_id, profile_id, source_version, preview_digest) WHERE (status <> ''aborted''::text)'
    ) THEN 1 ELSE 0 END AS valid;`;
}
