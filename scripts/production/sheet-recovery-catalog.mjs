import {
  sheetDiscussionDefinitions,
  sheetDiscussionTables,
} from "./sheet-discussion-catalog.mjs";
const overrides = [
  [
    "plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean)",
    "64c9035bbc10178be6543a74b699ac87",
    "ecad3e3463c26ed0b5cbd7e73ac95d10",
    true,
  ],
  [
    "plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean)",
    "3cd61c35ff186647be3f88c46c206ec5",
    "98edcbeabf2ffc1598e5ce487211fd41",
    true,
  ],
  [
    "plugin_data.csf_queue_sheet_sync_record(uuid,uuid,uuid,text,uuid)",
    "a403aeabc21e7561b0b4c0d368baf70b",
    "a9b26cbe31e99be711c7dd9218b0b49f",
    true,
  ],
  [
    "plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text,text)",
    "90f34f70b55f58ee0f4901fe7f35abd0",
    "c5304b355dbded4d2a1db85e9e8f8e7c",
    true,
  ],
  [
    "plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text)",
    "7fa475099e62f9c32eb96bde183bc75d",
    "fa2ffc5cd157f7cb480da984631a58ce",
    true,
  ],
  [
    "plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb,uuid)",
    "05d560adcc4990475fe6b7f6720a312c",
    "7c9caa02ca0c0abce536a282a5dc0cde",
    true,
  ],
  [
    "plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text)",
    "9ebd418ea79aae501053792f6775872e",
    "6b5d5f707506e4fc4d81fe2c3ed7e2e0",
    true,
  ],
];
const relationOverrides = [
  ["csf_sheet_sync_bindings", "f5c52d7bc0a2c8b3112419bad8a38cce", false],
  ["csf_sheet_sync_changes", "a323872898237ee87ab96933c6bf73cf", false],
];
export const sheetRecoveryDefinitions = [
  ...sheetDiscussionDefinitions.filter(
    ([name]) => !overrides.some(([signature]) => signature === name),
  ),
  ...overrides,
];
export const sheetRecoveryTables = sheetDiscussionTables.map(
  (row) => relationOverrides.find(([name]) => name === row[0]) ?? row,
);
