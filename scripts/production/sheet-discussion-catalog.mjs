import {
  sheetSyncDefinitions,
  sheetSyncTables,
} from "./sheet-sync-catalog.mjs";
const overrides = [
  [
    "plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text)",
    "8b35e5786a17db614e368b9f1c5af95a",
    "431880ec883fe6dba1a1f0c9bebcbacd",
    true,
  ],
  [
    "plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text,text)",
    "bd096402de759bf145a04ba29c88d34b",
    "0f45f311562cf1792261f4602a8eedea",
    true,
  ],
  [
    "plugin_data.csf_finish_sheet_sync_export(uuid,uuid,uuid,text,text,text)",
    "a6c9240b52f884f97d8b6f3b94459f90",
    "d13faaa3bc0b685d7aa4795eb863084c",
    true,
  ],
  [
    "plugin_data.csf_guard_sheet_sync_export_snapshot()",
    "82035d9b6e326555b51d308d4895a809",
    "7f1ec18a603a888ccfb17805cea6707a",
    false,
  ],
  [
    "plugin_data.csf_reconcile_sheet_sync_export(uuid,uuid,uuid,boolean,text,text)",
    "01f49a268920493d5f5e1670dc53801a",
    "46a828fb185ebf09e4ea8f4ab49d4038",
    true,
  ],
  [
    "plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text)",
    "c674867ff11b3d43775d09b2bf9276b0",
    "403bccf1c45dc18e9b2ac200af0519d0",
    true,
  ],
  [
    "plugin_data.csf_record_sheet_sync_change(uuid,uuid,text,uuid,text,text,jsonb,uuid)",
    "31b27cefaea8ce487d6f27883a557de1",
    "e42104aaf0c449a80bc563576a21db4a",
    true,
  ],
  [
    "plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text)",
    "4aef7edd8fc5e0af961306adef36d9f7",
    "888aee30e93c63ca11ed9369b52406e5",
    true,
  ],
  [
    "plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text)",
    "752978aaf7294b48d3446b98c9a4dae8",
    "b16f0b030dd1a825c1b375ec52db3591",
    true,
  ],
  [
    "plugin_data.csf_sheet_discussion_configuration(uuid)",
    "4e6e4b46ec80598341a59371dfda95d9",
    "ce4b88e0b35ead346a4aff021735f175",
    false,
  ],
];
const relations = [
  ["csf_sheet_sync_destinations", "75d1b163da7a60fa2f26f56f6ebdeabf", false],
  ["csf_sheet_sync_bindings", "879be2f7d8288133c8e6cc107ea5383c", false],
  ["csf_sheet_sync_changes", "82bc3be89618d68cd0e03987dfb53ec5", false],
];
export const sheetDiscussionDefinitions = [
  ...sheetSyncDefinitions.filter(
    ([signature]) => !overrides.some(([name]) => name === signature),
  ),
  ...overrides,
];
export const sheetDiscussionTables = sheetSyncTables.map(
  (row) => relations.find(([name]) => name === row[0]) ?? row,
);
