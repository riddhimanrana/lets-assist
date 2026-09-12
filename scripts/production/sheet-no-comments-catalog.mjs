import { sheetToggleDefinitions } from "./sheet-toggle-catalog.mjs";

const overrides = [
  [
    "plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text)",
    "9b853e618876d9cb5c9b48b70457e0a0",
    "24e4de79e17bc5ce8a36891c9a6f6ca5",
    true,
  ],
  [
    "plugin_data.csf_queue_changed_sheet_sync_record()",
    "49185542b46d06ce6fa6162344375c38",
    "e1ef35a5e743988fe97f844a26821ff7",
    false,
  ],
  [
    "plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text)",
    "e0b23b6940ffb13848fbb86a6802517e",
    "4c8c8dd465f70c036e79e68ff506a738",
    true,
  ],
  [
    "plugin_data.csf_sheet_discussion_configuration(uuid)",
    "2d8b14c04e326df51e23ce2be331abd4",
    "ce4b88e0b35ead346a4aff021735f175",
    false,
  ],
];

export const sheetNoCommentsDefinitions = sheetToggleDefinitions.map(
  (row) => overrides.find(([name]) => name === row[0]) ?? row,
);
