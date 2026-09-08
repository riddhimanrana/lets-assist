export const matchingTabDefinitions = [
  [
    "plugin_data.csf_class_sheet_layout_matches(uuid,uuid,uuid)",
    "6f8733019ccba982a50bd651629016c5",
    "bf59027785e33a3243f4abf821af7435",
    false,
  ],
  [
    "plugin_data.csf_inherit_matching_class_tab_authorization(uuid,uuid)",
    "dbd407d1cb3f829f0c67ca81058e8b2a",
    "ef56f68e20a862714478b7b09bdba305",
    true,
  ],
  [
    "plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid)",
    "c3bca582e0a75c8acc45aba702f1cf57",
    "b4a5fd5627772328258bf99975afe237",
    true,
  ],
  [
    "plugin_data.csf_set_sheet_automatic_update_authorization(uuid,uuid,uuid,integer,text,uuid,uuid,boolean)",
    "0d96784a6ccf827156c498def725d378",
    "3a721a04503dff6b1dff4ac999b3cfc1",
    true,
  ],
  [
    "plugin_data.csf_set_sheet_automatic_update_authorization_tab_base(uuid,uuid,uuid,integer,text,uuid,uuid)",
    "910cc966772a2c1f07a07627585544d4",
    "f3d8374c17abbebd2451610ad631a3f7",
    false,
  ],
  [
    "plugin_data.csf_sheet_automatic_update_authorization_current(uuid,uuid)",
    "033a6393e6a76f511a7d00bdd21e313b",
    "f4b93e72e0713227dc6de98eb5333c67",
    false,
  ],
  [
    "plugin_data.csf_sheet_automatic_update_authorization_current_tab_base(uuid,uuid)",
    "48a1fd70187f99ceca16aa6b28148b56",
    "ddebc40b3b4bc1396177acf8f8bc2db5",
    false,
  ],
];

export const matchingTabReceiptPosture = `AND EXISTS (
  SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('plugin_data.csf_workbook_matching_tab_scope_request')
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
    AND pg_get_indexdef(i.indexrelid)=$index$CREATE UNIQUE INDEX csf_workbook_matching_tab_scope_request ON plugin_data.csf_admin_audit_events USING btree (organization_id, ((after_data ->> 'requestId'::text))) WHERE (action = 'sheets.matching_tab_scope_changed'::text)$index$
)`;
