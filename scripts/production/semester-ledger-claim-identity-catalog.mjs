// Exact postconditions for the 578th migration, measured on an isolated replay.
export function semesterLedgerClaimIdentityCatalog(previous, claimDigest) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")})=1
    AND EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(
        'plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)')
      AND md5(pg_get_functiondef(p.oid))='${claimDigest}'
      AND p.proowner='postgres'::regrole AND p.prosecdef
      AND has_function_privilege('service_role',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND (SELECT count(*)=2 AND bool_and(a.grantee IN
        ('postgres'::regrole,'service_role'::regrole)
        AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
        AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
    )
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('plugin_data.csf_guard_sheet_semester_ledger_immutable()'),
        ('plugin_data.csf_guard_semester_write_link_owner()'),
        ('plugin_data.csf_guard_workbook_link_unsettled_write()')
      ) expected(signature)
      LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
      WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
        OR has_function_privilege('service_role',p.oid,'EXECUTE')
        OR has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR (SELECT count(*)<>1 OR NOT bool_and(a.grantee='postgres'::regrole
          AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
          AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
    ) THEN 1 ELSE 0 END AS valid;`;
}
