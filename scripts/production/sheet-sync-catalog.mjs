export const sheetSyncDefinitions = [
  [
    "plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean)",
    "7bffe46ef22b0708ba8a75627ce19935",
    "bf373eb3587d58f590682eb03dddf61e",
    true,
  ],
  [
    "plugin_data.csf_assert_sheet_sync_destination_lease(uuid,uuid,uuid,text,uuid,text)",
    "b6c1234cdf6fce0781f1833961c7074b",
    "b62830780cbd9f8145772079702ef8bc",
    true,
  ],
  [
    "plugin_data.csf_bind_sheet_sync_thread(uuid,uuid,uuid,uuid,uuid,text,text,text)",
    "a3350b9c70b3cdc83e45a38fdc1a34bf",
    "f273618b0339613f4b10a2c2fd6f5679",
    true,
  ],
  [
    "plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean)",
    "8f224f0cc0eea34a317e97af834fb96f",
    "b7cbf881cb51606583994987a0119ddd",
    true,
  ],
  [
    "plugin_data.csf_claim_sheet_sync_exports(uuid,uuid,uuid,integer)",
    "8af39234ad3a4df644c2b8fd04053137",
    "ab67233d3e35e3f560f91c98adbc0813",
    true,
  ],
  [
    "plugin_data.csf_claim_sheet_sync_test_copy(uuid,uuid,uuid,text,uuid)",
    "c2d871c6f939159b925e60643f45d707",
    "22585248fe8400d6771afb7459e13fa7",
    true,
  ],
  [
    "plugin_data.csf_configure_sheet_sync_destination(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb)",
    "7b7eb3ce160ad6e0617dedee4bd171ee",
    "48a0e9b4bdaef63c8aba2a58651555ec",
    true,
  ],
  [
    "plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text)",
    "8c5e2fffdee7938c4db8f1c82477430b",
    "9766dc7a13252d680b54d764da389fa0",
    true,
  ],
  [
    "plugin_data.csf_finish_sheet_sync_test_copy(uuid,uuid,uuid,text,text,text)",
    "75ab636b6891cd782a1629214d1b1b75",
    "2a2cf64524176d190009127e092fca27",
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
    "876a08b06b58746ab8a61889c60a8340",
    "ac00412fab8b0e085a85a49938c41484",
    false,
  ],
  [
    "plugin_data.csf_queue_cohort_sheet_sync_records()",
    "c3e16eb1b5dafa2e3f2dc3efe6abf31f",
    "ca1b60885f44750e46d9011499e15247",
    false,
  ],
  [
    "plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid)",
    "ce3fd4856913102a7ed8c6c600793ce2",
    "a5de7e6fed8867b5b8e65727a0571173",
    true,
  ],
  [
    "plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text)",
    "f1810a17d2355d4513401c691a6c3208",
    "fb7fc4799b637b4ebbe6b52245af6ac9",
    true,
  ],
  [
    "plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb)",
    "d604f6432c65c826da11c5ebd44c272f",
    "498b1939020b98e8b5585d3055512729",
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
    "aa7d9e558f1ef85cee964679a9cc75ba",
    "350742dc49d951dd1bf1868af8a5eaa6",
    true,
  ],
  [
    "plugin_data.csf_register_sheet_sync_test_workspace(uuid,uuid)",
    "26574abd02ac7124455e041714c3c9d5",
    "93aba3007f3e663e05c4d4145c02b40c",
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
    "072f6bd204b8382083b63800eff39133",
    "ce42541a673f512b4bd6784555697439",
    true,
  ],
  [
    "plugin_data.csf_seed_sheet_sync_destination(uuid,uuid,uuid,uuid,integer)",
    "7cda62425dfeb4331bec9cd7679fd1c9",
    "9c4009583adc94126b5671abc3f5facc",
    true,
  ],
  [
    "plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text)",
    "edf1986a1958fbd20d9acb01d1386387",
    "c220f03f42c64b380e8a16d214522fa8",
    true,
  ],
  [
    "plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid)",
    "4183cc2216f69323a77013c7923483c1",
    "f0a0bb9dc605da2b76262be6caf2d775",
    true,
  ],
  [
    "plugin_data.csf_sheet_sync_snapshot(uuid,text,uuid)",
    "6f1bf6a0c28d7cb7e7f6aff22c29aa27",
    "e1a25952718bf9ccfec2d775ab684650",
    true,
  ],
];
export const sheetSyncTables = [
  ["csf_sheet_writeback_ledger", "7f533e933b817a613e00257ebb6a3fbb", false],
  ["csf_sheet_sync_test_workspaces", "687f12674bf6c706124714d95d7b53fb", false],
  ["csf_sheet_sync_test_files", "ae45abad052eeb78153d320c06ecea37", false],
  ["csf_sheet_sync_destinations", "cdfc7cdc32f22270bf2b26b26d6858f5", false],
  ["csf_sheet_sync_bindings", "d287cd51b739fc5d41ac4496935b965e", false],
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
    "csf_application_status_events",
    "csf_sheet_sync_application_reviews",
    "a031c2cd39314e852e2c78b64643a4e1",
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
    "csf_profile_cohort_memberships",
    "csf_sheet_sync_cohort_memberships",
    "b8cbcd40eb02119b5a909cafb1b4132f",
    29,
    "plugin_data.csf_queue_cohort_sheet_sync_records()",
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
