export const automaticSheetDefinitions = [
  [
    "plugin_data.csf_dispatch_automatic_class_preview()",
    "7d5b942fa15f30e27fb097efbfb01b1e",
    "1bcff39902cd58eab35369fc44ba83c6",
    true,
  ],
  [
    "plugin_data.csf_queue_automatic_class_preview(uuid,uuid)",
    "d2f0168530fe10d84a09dbb1b537b4d9",
    "fc67974fe2b0011d6b962e753f73a7c6",
    true,
  ],
  [
    "plugin_data.csf_claim_automatic_class_workbook_check()",
    "d5f9e319a3d24ae3c2bfd719f60b7a43",
    "418857c0f9ce356d34a97020e82dcf21",
    true,
  ],
  [
    "plugin_data.csf_finish_automatic_class_workbook_check(uuid,uuid,bigint,uuid,uuid,uuid,text,text,text)",
    "f44874d6cacabea5c84066be40516f34",
    "191e0b1cf2b706fd71f784b3be3e1f65",
    true,
  ],
  [
    "plugin_data.csf_assert_automatic_import_scope(uuid,uuid)",
    "426846ef4c2b7de0a4a64a7c0f1b89a2",
    "e18d55a8ed7483c3f384119ef3b0c65a",
    false,
  ],
  [
    "plugin_data.csf_assert_automatic_sheet_preview_current(uuid,uuid,uuid)",
    "f0ac228bcb86346950010ede99349566",
    "1d80408727b61f14cea08e68d7e8e71d",
    false,
  ],
  [
    "plugin_data.csf_assert_sheet_automatic_update_lease(uuid,uuid,bigint,uuid)",
    "525ce9719570f5c9474eeee14e1cf8c4",
    "4d7e56f0e47501d9a1d1d6f0df9d9d2b",
    true,
  ],
  [
    "plugin_data.csf_automatic_application_new_profile_is_safe(uuid,uuid)",
    "22e022f7c32d0650abb0337f83d6e2e3",
    "c9aaa5cc19ded52ea1c53c9c4adfca55",
    false,
  ],
  [
    "plugin_data.csf_automatic_import_scope_current(uuid,uuid)",
    "66f0fc362160bca67dd1b4f2f2f237a4",
    "6dd9fba0f696195a6683c2c2fbd60bd4",
    false,
  ],
  [
    "plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid)",
    "6ae995cb42a4f2cb2da45cc90b00eb6c",
    "34bc3e0caa53ebf3a01c51aa4c4dc50c",
    true,
  ],
  [
    "plugin_data.csf_claim_import_commit_attempt(uuid,uuid,uuid,integer,uuid)",
    "a4c98fad2f906eb043c81ec8fa68562d",
    "f48c73db8052fde20c16250f4281b29f",
    true,
  ],
  [
    "plugin_data.csf_claim_sheet_automatic_update_check(text)",
    "c7aa778fe6b3f6419aa89e932c815632",
    "dfc473290ecebc280dcaa26268258486",
    true,
  ],
  [
    "plugin_data.csf_commit_import_row_for_attempt(uuid,uuid,uuid)",
    "ef0455e31696b9407e2618823473d2a2",
    "0f0e2335349e8775818b748330d54e4e",
    true,
  ],
  [
    "plugin_data.csf_finish_sheet_automatic_update_check(uuid,uuid,bigint,uuid,text,text,uuid)",
    "3f3251bc648f8617b88c30d03f6e0214",
    "8dd007eedca6a2c6ab9275fa9d45adf5",
    true,
  ],
  [
    "plugin_data.csf_import_automatic_scope_state(uuid,uuid,uuid)",
    "5b754a88b9d51f597c00d7f4d49f2415",
    "3df0c438fe6b006ee862f48f281f6663",
    true,
  ],
  [
    "plugin_data.csf_import_preview_claim_blockers(uuid,uuid)",
    "fccea22040fe0c0d9de0d2dd1aebddb3",
    "33696c4f7db39b1add6861e81f55eab1",
    true,
  ],
  [
    "plugin_data.csf_import_preview_evidence_blockers(uuid,uuid,boolean)",
    "8b8ad555196d39da2eb365c1e516c455",
    "04c3d7ced743a80db308f87cd1a9e801",
    false,
  ],
  [
    "plugin_data.csf_prepare_automatic_application_profiles(uuid,uuid)",
    "17fdf56c6ebc1031febb4f32a8a9afc3",
    "053450acb5e2392393492618ef6fda80",
    true,
  ],
  [
    "plugin_data.csf_queue_automatic_import_preview(uuid,uuid)",
    "70a2f010c456cac98797f41861f7dd4d",
    "4febd0646a6345f331fbc7b518b525bb",
    true,
  ],
  [
    "plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)",
    "21216b81d527a15ecb1b1622ca59db56",
    "45fab827290bb1b5fa48adcb4dee745f",
    false,
  ],
  [
    "plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid)",
    "73a76bc92739225524c0a6f89bd84b1e",
    "f3d8374c17abbebd2451610ad631a3f7",
    true,
  ],
  [
    "plugin_data.csf_sheet_automatic_update_authorization_current(uuid,uuid)",
    "f3a049f18fc661c7cca5888b24f0b14e",
    "ddebc40b3b4bc1396177acf8f8bc2db5",
    false,
  ],
  [
    "plugin_data.csf_sheet_automatic_update_mapping_hash(uuid,uuid)",
    "80497537fd89a9564a454079a13824ff",
    "011d1dd03afe8fdcb79b35aaa9603278",
    false,
  ],
];

export const automaticSheetFunctionSnapshotQuery = `SELECT expected.signature, md5(jsonb_build_object(
 'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
 'acl',p.proacl::text,'kind',p.prokind,'parallel',p.proparallel,'leakproof',p.proleakproof,
 'support',p.prosupport::regproc::text,'cost',p.procost,'rows',p.prorows
)::text) AS digest, md5(p.prosrc) AS body_digest,
has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM (VALUES ${automaticSheetDefinitions.map(([signature]) => `('${signature}')`).join(",")}) expected(signature)
LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)`;

export function automaticSheetUpdatesPosture(relationSnapshotQuery) {
  const functionValues = automaticSheetDefinitions
    .map(
      ([signature, digest, bodyDigest, service]) =>
        `('${signature}','${digest}','${bodyDigest}',${service})`,
    )
    .join(",");
  const tableDefinitions = [
    [
      "csf_automatic_import_approval_rows",
      "4f49d866eabadf1ead30d6ebe714af41",
      true,
    ],
    [
      "csf_automatic_import_approvals",
      "c8651855cef644d066fcc4d02e274062",
      true,
    ],
    [
      "csf_sheet_automatic_update_authorizations",
      "250b2dd36d46a64d7aad9e493e3dfcff",
      false,
    ],
  ];
  const tableValues = tableDefinitions
    .map(([name, digest, denied]) => `('${name}','${digest}',${denied})`)
    .join(",");
  const tableQuery = relationSnapshotQuery.replace(
    /FROM pg_class c WHERE[\s\S]*$/u,
    "FROM pg_class c WHERE c.relpersistence='p' AND c.oid IN (" +
      tableDefinitions
        .map(([name]) => `to_regclass('plugin_data.${name}')`)
        .join(",") +
      ")",
  );
  return `AND (
    SELECT count(*)=23 AND coalesce(bool_and(
      actual.signature IS NOT NULL AND actual.digest=expected.digest AND actual.body_digest=expected.body_digest
      AND actual.service_execute=expected.service_execute
      AND NOT actual.anon_execute AND NOT actual.authenticated_execute
    ),false) FROM (VALUES ${functionValues}) expected(signature,digest,body_digest,service_execute)
    LEFT JOIN (${automaticSheetFunctionSnapshotQuery}) actual ON actual.signature=expected.signature
  ) AND (
    SELECT count(*)=3 AND coalesce(bool_and(actual.relname IS NOT NULL AND actual.digest=expected.digest
      AND actual.runtime_denied=expected.runtime_denied),false)
    FROM (VALUES ${tableValues}) expected(relname,digest,runtime_denied)
    LEFT JOIN (${tableQuery}) actual ON actual.relname=expected.relname
  ) AND EXISTS (
    SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('plugin_data.csf_sheet_automatic_update_request_receipt')
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      AND pg_get_indexdef(i.indexrelid)=$index$CREATE UNIQUE INDEX csf_sheet_automatic_update_request_receipt ON plugin_data.csf_admin_audit_events USING btree (organization_id, ((after_data ->> 'requestId'::text))) WHERE (action = 'sheets.automatic_update_authorization_changed'::text)$index$
  )`;
}
