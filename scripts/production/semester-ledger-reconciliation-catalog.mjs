// Exact postconditions for the 577th migration. Measured on an isolated replay.
export const semesterLedgerReconciliationDefinitions = [
  [
    "plugin_data.csf_profile_merge_preview_semester_ledger_base(uuid,uuid,uuid)",
    "23ea2120b5fa3169af8b78df80d93902",
    false,
  ],
  [
    "plugin_data.csf_reconcile_sheet_semester_ledger_write(uuid,uuid,uuid,boolean,text,text)",
    "f43d2748697aefbe585cb17b7f12dcd8",
    true,
  ],
  [
    "plugin_data.csf_guard_semester_write_link_owner()",
    "45766bcd4803ef8cbd7d4605f7744b47",
    false,
  ],
  [
    "plugin_data.csf_guard_workbook_link_unsettled_write()",
    "681310b4b440be1ed2fe8ff92baabbb9",
    false,
  ],
];

export function semesterLedgerReconciliationCatalog(previous) {
  const definitions = semesterLedgerReconciliationDefinitions
    .map(
      ([signature, digest, service]) =>
        `('${signature}','${digest}',${service})`,
    )
    .join(",");
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")})=1
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES ${definitions}) expected(signature,digest,service_execute)
      LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
      WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM expected.digest
        OR p.proowner <> 'postgres'::regrole OR NOT p.prosecdef
        OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM expected.service_execute
        OR has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE')
    ) AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('csf_semester_write_link_owner','plugin_data.csf_sheet_semester_ledger_writes','plugin_data.csf_guard_semester_write_link_owner()'),
        ('csf_workbook_link_unsettled_write','plugin_data.csf_reviewed_workbook_profile_links','plugin_data.csf_guard_workbook_link_unsettled_write()')
      ) expected(name,relation,procedure)
      LEFT JOIN pg_trigger t ON t.tgname=expected.name
        AND t.tgrelid=to_regclass(expected.relation)
        AND t.tgfoid=to_regprocedure(expected.procedure)
      WHERE t.oid IS NULL OR t.tgenabled<>'O' OR t.tgisinternal
    ) THEN 1 ELSE 0 END AS valid;`;
}
