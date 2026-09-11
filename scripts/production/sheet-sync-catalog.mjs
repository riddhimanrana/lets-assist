export const sheetSyncDefinitions = [
  [
    "plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean)",
    "e7ea84968f401951dc39e65e1326fa11",
    "1f1f311304ef49975cd9017446419854",
    true,
  ],
  [
    "plugin_data.csf_assert_sheet_sync_destination_lease(uuid,uuid,uuid)",
    "71a427322140542d8f19feca0485615a",
    "52a03dc0c9d91c4361058a46c75575a9",
    true,
  ],
  [
    "plugin_data.csf_bind_sheet_sync_thread(uuid,uuid,uuid,uuid,uuid,text,text,text)",
    "2fa0ad0d61c184f4efad37f92e118e04",
    "af088bb73993dc85790533bfa0865de7",
    true,
  ],
  [
    "plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean)",
    "bea52f3ae957b75de51f092ddb01fc6f",
    "ef97bf75c34abe3ff050f303d004aa19",
    true,
  ],
  [
    "plugin_data.csf_claim_sheet_sync_exports(uuid,uuid,uuid,integer)",
    "49ed3cfc7925f3505df61eebca9c8c21",
    "07f9ea483b3b0b28862db0fea7cd3bcd",
    true,
  ],
  [
    "plugin_data.csf_claim_sheet_sync_test_copy(uuid,uuid,uuid,text,uuid)",
    "c661087efd6246081e484c4104fe53c1",
    "d5b87b019d3fadcc87c77d91587507e6",
    true,
  ],
  [
    "plugin_data.csf_configure_sheet_sync_destination(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb)",
    "ba3de75df0b79433bfb39a2ae59b4930",
    "9dfcad7109b46964298b4272796d7bab",
    true,
  ],
  [
    "plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text)",
    "aa47ccacd88385ae876babbba55ddb9a",
    "3f95c411104ae557265a972c86b09c32",
    true,
  ],
  [
    "plugin_data.csf_finish_sheet_sync_test_copy(uuid,uuid,uuid,text,text,text)",
    "1b7be02904c647f4887ca71cd660519c",
    "a652c171b750f77580d2a658e8d5ae02",
    true,
  ],
  [
    "plugin_data.csf_guard_sheet_sync_test_file()",
    "c17223756fbaccc569c5d6c958a5a67e",
    "b6d90b3920faff1e16ffaeaea30cf80b",
    false,
  ],
  [
    "plugin_data.csf_queue_changed_sheet_sync_record()",
    "f4b5cc87c2ff87db4ef95435e21cc5d9",
    "18b4fc170483d1ca2b31d282430cf5bb",
    false,
  ],
  [
    "plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid)",
    "abca33052ee57795360953a202e718bc",
    "c37bb6ff62a81632aec7cd704fc0861a",
    true,
  ],
  [
    "plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text)",
    "51919fcdad76150c6ba100bdb73c740c",
    "dd4b320b24b6651dccb77477c05dc3da",
    true,
  ],
  [
    "plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb)",
    "996c84a9fec1495ee6e92017b50b58cb",
    "b3ec527ad2ed21e5f2c5d0df2ad39962",
    true,
  ],
  [
    "plugin_data.csf_record_sheet_sync_comment(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,boolean,boolean)",
    "32fc5d5ca71d1f6c88045af4d5a920e6",
    "bc269be65d09d5b2f5b6853d66211006",
    true,
  ],
  [
    "plugin_data.csf_register_sheet_sync_test_file(uuid,uuid,text,text)",
    "6803260fc7fbfb075eec1f0992570c0f",
    "9ab53e460e86e20c108c3611b7436c24",
    true,
  ],
  [
    "plugin_data.csf_register_sheet_sync_test_workspace(uuid,uuid)",
    "6bb6a07e09c37d70faf97f6e8b5e795f",
    "34e9b039047c6e4cdb92b260bdb0ac55",
    true,
  ],
  [
    "plugin_data.csf_release_sheet_sync_destination(uuid,uuid,uuid)",
    "9387ae33b4218e53ec12213f329b47cb",
    "c433e79d204f92ef41233e4db1e962e6",
    true,
  ],
  [
    "plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text)",
    "6841a192d30eae8a975a364f02e355e2",
    "824acd93c95d7af85807025282bc9ce8",
    true,
  ],
  [
    "plugin_data.csf_seed_sheet_sync_destination(uuid,uuid,uuid,uuid,integer)",
    "fbbd100283694ec74c8a5e4eb5ed959d",
    "5ca2fdd63fc8ccd7f9b502f6b3969d71",
    true,
  ],
  [
    "plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text)",
    "6e2370ed63ab70e60b2665f3678b9175",
    "a2416949492ab25547d6b04413e8a544",
    true,
  ],
  [
    "plugin_data.csf_sheet_sync_snapshot(uuid,text,uuid)",
    "92b7cbf04d0a8cce519d3b5a1e55284c",
    "8ecfd6652fa03cda7ad95e94bd3a8f15",
    true,
  ],
];
export const sheetSyncTables = [
  ["csf_sheet_writeback_ledger", "7f533e933b817a613e00257ebb6a3fbb", false],
  ["csf_sheet_sync_test_workspaces", "687f12674bf6c706124714d95d7b53fb", false],
  ["csf_sheet_sync_test_files", "ae45abad052eeb78153d320c06ecea37", false],
  ["csf_sheet_sync_destinations", "cdfc7cdc32f22270bf2b26b26d6858f5", false],
  ["csf_sheet_sync_bindings", "3eb8d9c78d97cd87de29cdef4b89c278", false],
  ["csf_sheet_sync_changes", "6aa70e5f974062411d7bab926536d7cc", false],
  [
    "csf_sheet_sync_test_copy_requests",
    "e8d797f1d751abc4d1ce18fb0183a5af",
    false,
  ],
  ["csf_sheet_sync_local_messages", "afa7aaf1008067189fd21b317636cc4a", false],
  ["csf_sheet_sync_comments", "8439d2a366122e596c8afb0313c216db", false],
];
export const sheetSyncTriggers = [
  [
    "csf_application_files",
    "csf_sheet_sync_application_files",
    "c2bd83eb3eec4278af9ed6a2578b0c1c",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_class_workbooks",
    "csf_sheet_test_workbooks",
    "1c8ea1dbec45cf54492a2df09bf74813",
    23,
    "plugin_data.csf_guard_sheet_sync_test_file()",
  ],
  [
    "csf_credit_records",
    "csf_sheet_sync_credits",
    "3c3a09e95c82548efdf9d7a89658171b",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_point_submissions",
    "csf_sheet_sync_points",
    "3f7a0ee0f5f8ddc00fd4ae66ce0e4136",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_profile_accounts",
    "csf_sheet_sync_accounts",
    "84d1fc777450ee345d8cbdabde24f88d",
    29,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_profiles",
    "csf_sheet_sync_profiles",
    "d1913bb48fb050369c82c28732d38443",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_review_notes",
    "csf_sheet_sync_notes",
    "843a8e1c8b21c28f2066879fdaedde39",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_sheet_import_jobs",
    "csf_sheet_test_imports",
    "ed61ef6a108ec32e45f573ca684b0905",
    23,
    "plugin_data.csf_guard_sheet_sync_test_file()",
  ],
  [
    "csf_sheet_sources",
    "csf_sheet_test_sources",
    "36820e2dfd5581f21ddafb907e4ff477",
    23,
    "plugin_data.csf_guard_sheet_sync_test_file()",
  ],
  [
    "csf_sheet_sync_destinations",
    "csf_sheet_test_destinations",
    "cb994e0586bddc24c5fae4ec915ca6f6",
    23,
    "plugin_data.csf_guard_sheet_sync_test_file()",
  ],
  [
    "csf_sheet_writeback_ledger",
    "csf_sheet_test_writeback",
    "1cf7d9a68ef206d04a32eec11fb7aa96",
    23,
    "plugin_data.csf_guard_sheet_sync_test_file()",
  ],
  [
    "csf_submission_files",
    "csf_sheet_sync_submission_files",
    "dfd501f4de04a4981ce392d8ebe387be",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_submission_reviews",
    "csf_sheet_sync_point_reviews",
    "a31f4e115f66db0c9d44554346f2f7f0",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_term_applications",
    "csf_sheet_sync_application",
    "f71937f70b1d6df97a9cc3c22368dc38",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
  [
    "csf_term_applications",
    "csf_sheet_test_applications",
    "4d132bf973810a50a19a48742fdd4e1e",
    23,
    "plugin_data.csf_guard_sheet_sync_test_file()",
  ],
  [
    "csf_term_memberships",
    "csf_sheet_sync_memberships",
    "4a786f26309198634e56efac8a047964",
    21,
    "plugin_data.csf_queue_changed_sheet_sync_record()",
  ],
];
export const sheetSyncFunctionSnapshotQuery = `SELECT expected.signature, md5(jsonb_build_object(
 'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
 'acl',p.proacl::text,'kind',p.prokind,'parallel',p.proparallel,'leakproof',p.proleakproof,
 'support',p.prosupport::regproc::text,'cost',p.procost,'rows',p.prorows
)::text) AS digest, md5(p.prosrc) AS body_digest,
has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM (VALUES ${sheetSyncDefinitions.map(([signature]) => `('${signature}')`).join(",")}) expected(signature)
LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)`;

export function sheetSyncPosture(relationSnapshotQuery) {
  const functions = sheetSyncDefinitions
    .map(
      ([signature, digest, body, service]) =>
        `('${signature}','${digest}','${body}',${service})`,
    )
    .join(",");
  const tables = sheetSyncTables
    .map(([name, digest, denied]) => `('${name}','${digest}',${denied})`)
    .join(",");
  const tableQuery = relationSnapshotQuery.replace(
    /FROM pg_class c WHERE[\s\S]*$/u,
    "FROM pg_class c WHERE c.relpersistence='p' AND c.oid IN (" +
      sheetSyncTables
        .map(([name]) => `to_regclass('plugin_data.${name}')`)
        .join(",") +
      ")",
  );
  const triggers = sheetSyncTriggers
    .map(
      ([table, name, digest, type, helper]) =>
        `('${table}','${name}','${digest}',${type},'${helper}')`,
    )
    .join(",");
  return `AND (
    SELECT count(*)=${sheetSyncDefinitions.length} AND coalesce(bool_and(
      actual.signature IS NOT NULL AND actual.digest=expected.digest AND actual.body_digest=expected.body_digest
      AND actual.service_execute=expected.service_execute AND NOT actual.anon_execute AND NOT actual.authenticated_execute
    ),false) FROM (VALUES ${functions}) expected(signature,digest,body_digest,service_execute)
    LEFT JOIN (${sheetSyncFunctionSnapshotQuery}) actual ON actual.signature=expected.signature
  ) AND (
    SELECT count(*)=${sheetSyncTables.length} AND coalesce(bool_and(actual.relname IS NOT NULL AND actual.digest=expected.digest
      AND actual.runtime_denied=expected.runtime_denied),false)
    FROM (VALUES ${tables}) expected(relname,digest,runtime_denied)
    LEFT JOIN (${tableQuery}) actual ON actual.relname=expected.relname
  ) AND (
    SELECT count(*)=${sheetSyncTriggers.length} AND coalesce(bool_and(t.oid IS NOT NULL
      AND md5(pg_get_triggerdef(t.oid))=expected.digest AND t.tgtype=expected.kind AND t.tgenabled='O'
      AND t.tgfoid=to_regprocedure(expected.helper)
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND t.tgqual IS NULL
    ),false) FROM (VALUES ${triggers}) expected(relname,name,digest,kind,helper)
    LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('plugin_data.'||expected.relname) AND t.tgname=expected.name
  ) AND NOT EXISTS (
    SELECT 1 FROM (VALUES ${sheetSyncTables.map(([name]) => `('plugin_data.${name}')`).join(",")}) expected(name)
    CROSS JOIN (VALUES ('anon'),('authenticated')) roles(name)
    WHERE has_table_privilege(roles.name,to_regclass(expected.name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(roles.name,to_regclass(expected.name),'SELECT,INSERT,UPDATE,REFERENCES')
  )`;
}
