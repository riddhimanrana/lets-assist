import {
  sheetRecoveryDefinitions,
  sheetRecoveryTables,
} from "./sheet-recovery-catalog.mjs";
const overrides = [
  [
    "plugin_data.csf_claim_sheet_sync_destination(uuid,uuid,boolean)",
    "ebee5ae3795ea0fdb556558d6fb0c60c",
    "2b1723eb780ad38ef57dc02e61fb67b7",
    true,
  ],
  [
    "plugin_data.csf_review_sheet_sync_change(uuid,uuid,uuid,boolean,text)",
    "9f0ac702c347b6b268ee7e637f831010",
    "8e4298ee58c85b2df7468c30a7eddb2b",
    true,
  ],
  [
    "plugin_data.csf_complete_sheet_sync_observation(uuid,uuid,uuid,boolean)",
    "aedcf00245cd1d4776945166a13d87a2",
    "422bcc1e62bab1ffa0402410b8f62833",
    true,
  ],
];
export const sheetObservationDefinitions = [
  ...sheetRecoveryDefinitions.filter(
    ([name]) => !overrides.some(([signature]) => signature === name),
  ),
  ...overrides,
];
export const sheetObservationTables = sheetRecoveryTables.map((row) =>
  row[0] === "csf_sheet_sync_destinations"
    ? [row[0], "d3c32a890093bf3379dfd0e8668c3661", false]
    : row,
);
