import { sheetToggleDefinitions } from "./sheet-toggle-catalog.mjs";
import { sheetObservationTables } from "./sheet-observation-catalog.mjs";

const overrides = [
  [
    "plugin_data.csf_configure_sheet_sync_destination_atomic(uuid,uuid,text,integer,text,uuid,uuid,boolean,integer,jsonb,text)",
    "fb410a434281fd5a6cf0e55f1625f2c2",
    "a6a29ffc42a302fd3f4a57bfbadd1636",
    true,
  ],
  [
    "plugin_data.csf_configure_sheet_discussion_transport(uuid,uuid,uuid,text)",
    "06266c48d39c43f57bf10b560d3f62c9",
    "24e4de79e17bc5ce8a36891c9a6f6ca5",
    true,
  ],
  [
    "plugin_data.csf_queue_changed_sheet_sync_record()",
    "745fbb6ec18093cecb445dd5be6273f1",
    "e1ef35a5e743988fe97f844a26821ff7",
    false,
  ],
  [
    "plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text)",
    "55c423adec03f617d38e2f6ad2d6b243",
    "4c8c8dd465f70c036e79e68ff506a738",
    true,
  ],
  [
    "plugin_data.csf_sheet_discussion_configuration(uuid)",
    "4e6e4b46ec80598341a59371dfda95d9",
    "ce4b88e0b35ead346a4aff021735f175",
    false,
  ],
  [
    "plugin_data.csf_sheet_sync_destination_snapshot(uuid,uuid,text,uuid)",
    "2c4f1e808da1e6d5d2c7268730e958d6",
    "6c24ad54b2cc483f2a5692060982cf8a",
    true,
  ],
  [
    "plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(uuid,uuid,text,uuid)",
    "2f4d6ca07905946fae100d8e4b4a4ec7",
    "fa78bc95b754c5e202fe5da5dd137e20",
    false,
  ],
];

export const sheetNoCommentsDefinitions = [
  ...sheetToggleDefinitions.map(
    (row) => overrides.find(([name]) => name === row[0]) ?? row,
  ),
  ...overrides.filter(
    ([name]) =>
      !sheetToggleDefinitions.some(([signature]) => signature === name),
  ),
];

const relationDigests = new Map([
  ["csf_sheet_writeback_ledger", "071bf14bd83e3a8fc8c9fa467bce2035"],
  ["csf_sheet_sync_test_workspaces", "d114eb1acf4802bc110bad2359ce1184"],
  ["csf_sheet_sync_test_files", "f78c5554d9278fd42e5be5eddf8e2388"],
  ["csf_sheet_sync_destinations", "74b7a44aa7551dc5d2ada9fde7c40674"],
  ["csf_sheet_sync_bindings", "f5c52d7bc0a2c8b3112419bad8a38cce"],
  ["csf_sheet_sync_changes", "fe39c3fcbb67d74ab31f7a8ca0f927b0"],
  ["csf_sheet_sync_test_copy_requests", "ad0c76f6fcf249543556446a5c5cdbcc"],
  ["csf_sheet_sync_local_messages", "3e801957686bf8d44f80713d9ebde977"],
  ["csf_sheet_sync_comments", "a978548c6e7d46f966ba09cf0d04c2c9"],
  ["csf_sheet_sync_acceptances", "6076b82f817eec257cd9995826c5727c"],
]);

export const sheetNoCommentsTables = sheetObservationTables.map(
  ([name, _digest, denied]) => [name, relationDigests.get(name), denied],
);
