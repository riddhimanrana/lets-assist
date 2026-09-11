import { sheetDeferredNoteDefinitions } from "./sheet-deferred-note-catalog.mjs";
const overrides = [
  [
    "plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text)",
    "6f3a4de65784cd0aee352da1dc47fd5e",
    "f6d62983671d65cb184738ae5837782c",
    true,
  ],
  [
    "plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text)",
    "136a4ac8ddd8ca64dd516faa9f89ecb3",
    "ad09f43e71c24d40ce5f0424d6d13e54",
    true,
  ],
];
export const sheetToggleDefinitions = sheetDeferredNoteDefinitions.map(
  (row) => overrides.find(([name]) => name === row[0]) ?? row,
);
