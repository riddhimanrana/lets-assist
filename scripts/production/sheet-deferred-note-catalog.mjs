import { sheetObservationDefinitions } from "./sheet-observation-catalog.mjs";
const replacement = [
  "plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid)",
  "eecd5eea312491b6e1bba0fa64e83668",
  "fa78bc95b754c5e202fe5da5dd137e20",
  true,
];
export const sheetDeferredNoteDefinitions = sheetObservationDefinitions.map(
  (row) => (row[0] === replacement[0] ? replacement : row),
);
