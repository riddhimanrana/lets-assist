export function reviewedWorkbookLinksPosture(
  relationSnapshotQuery,
  sheetSync = false,
) {
  const tableQuery = relationSnapshotQuery
    .replaceAll(
      "app_private.csf_release_worker_controls",
      "plugin_data.csf_reviewed_workbook_profile_links",
    )
    .replaceAll(
      "app_private.csf_release_worker_receipts",
      "plugin_data.csf_reviewed_workbook_profile_links",
    );
  return `AND (
    SELECT count(*)=3 AND coalesce(bool_and(
      p.oid IS NOT NULL AND p.proowner='postgres'::regrole AND p.prosecdef
      AND p.prorettype=expected.return_type::regtype AND l.lanname='plpgsql'
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
      AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
      AND p.pronargdefaults=0 AND p.proconfig=ARRAY['search_path=""']
      AND p.proargnames=expected.arguments AND md5(p.prosrc)=expected.digest
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND (SELECT count(*)=1 AND bool_and(a.grantee=expected.grantee::regrole
        AND a.privilege_type='EXECUTE' AND NOT a.is_grantable AND a.grantor='postgres'::regrole)
        FROM aclexplode(p.proacl) a)
    ),false) FROM (VALUES
      ('plugin_data.csf_confirm_workbook_profile_link(uuid,uuid,uuid,uuid,uuid,text)',
        '83c0f31158e1eb84c98f1955ae9f637b','jsonb','service_role',
        ARRAY['p_organization_id','p_row_id','p_profile_id','p_actor_user_id','p_request_id','p_reason']),
      ('plugin_data.csf_revoke_workbook_profile_link(uuid,uuid,uuid,text)',
        '91f1cdcc24f99599a888b8ae21aebbad','jsonb','service_role',
        ARRAY['p_organization_id','p_link_id','p_actor_user_id','p_reason']),
      ('plugin_data.csf_class_history_source_key_target(uuid,uuid)',
        'fd95f4567bb4fe926695e7233cd0e9a4','uuid','postgres',
        ARRAY['p_organization_id','p_import_row_id'])
    ) expected(signature,digest,return_type,grantee,arguments)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    LEFT JOIN pg_language l ON l.oid=p.prolang
  ) AND EXISTS (
    SELECT 1 FROM (${tableQuery}) snapshot
    WHERE snapshot.relname='csf_reviewed_workbook_profile_links'
      AND snapshot.digest='${sheetSync ? "26e1961c0e127c76250c5a81f689c758" : "4db39e32056870608efc1d18528f2eef"}'
  ) AND EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('plugin_data.csf_workbook_profile_link_request_receipt')
      AND i.indisvalid AND i.indisready AND i.indisunique
      AND pg_get_indexdef(i.indexrelid)=$index$CREATE UNIQUE INDEX csf_workbook_profile_link_request_receipt ON plugin_data.csf_admin_audit_events USING btree (organization_id, ((after_data ->> 'requestId'::text))) WHERE (action = 'sheets.workbook_profile_link_confirmed'::text)$index$
  )`;
}
