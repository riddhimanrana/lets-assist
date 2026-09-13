import { sheetNoCommentsDefinitions } from "./sheet-no-comments-catalog.mjs";

export const sheetDiscussionWriteDefinitions = sheetNoCommentsDefinitions.map(
  (entry) =>
    entry[0] ===
    "plugin_data.csf_add_sheet_sync_local_message(uuid,uuid,uuid,uuid,text,text,boolean)"
      ? [
          entry[0],
          "17f9750edb3002982f412b0049236f5f",
          "bd6c8251c5da723fbc9a1055f8e60a92",
          true,
        ]
      : entry,
);
