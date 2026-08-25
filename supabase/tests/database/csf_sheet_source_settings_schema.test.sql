BEGIN;

SELECT plan(3);

SELECT is(
  plugin_data.csf_sheet_source_settings_schema() ->> 'skippedHistoricalTabs',
  'array',
  'historical discovery can register its bounded skipped-tab evidence'
);

SELECT lives_ok(
  $$SELECT plugin_data.csf_assert_sheet_source_settings(
    '{"sourceKind":"class_history","skippedHistoricalTabs":[]}'::jsonb
  )$$,
  'the registry accepts an array of skipped historical tabs'
);

SELECT throws_ok(
  $$SELECT plugin_data.csf_assert_sheet_source_settings(
    '{"sourceKind":"class_history","skippedHistoricalTabs":"F26"}'::jsonb
  )$$,
  '22023',
  'CSF source setting "skippedHistoricalTabs" must be a array or null.',
  'the closed schema rejects a non-array skipped-tab value'
);

SELECT * FROM finish();

ROLLBACK;
