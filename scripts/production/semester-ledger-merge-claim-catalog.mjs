// Exact postconditions for the 580th migration, measured on an isolated replay.
export function semesterLedgerMergeClaimCatalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")})=1
    AND EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure(
        'plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)')
        AND md5(pg_get_functiondef(p.oid))='1e4e11d23ea344399b5ec31195615abf'
        AND p.proowner='postgres'::regrole AND p.prosecdef
        AND has_function_privilege('service_role',p.oid,'EXECUTE')
        AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND (SELECT count(*)=2 AND bool_and(a.grantee IN
          ('postgres'::regrole,'service_role'::regrole)
          AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
          AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
        AND position('csf_staff_access_lock_key(p_organization_id)' IN p.prosrc)>0
        AND position('csf_staff_access_lock_key(p_organization_id)' IN p.prosrc)
          < position('csf_lock_identity_mutation(p_organization_id)' IN p.prosrc)
        AND position('csf_lock_identity_mutation(p_organization_id)' IN p.prosrc)
          < position('SELECT * INTO m' IN p.prosrc)
    ) THEN 1 ELSE 0 END AS valid;`;
}
