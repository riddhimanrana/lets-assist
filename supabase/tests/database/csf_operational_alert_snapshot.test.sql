BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

SELECT extensions.has_function(
  'plugin_data',
  'csf_get_worker_alert_snapshot',
  ARRAY[]::text[],
  'the count-only worker alert snapshot exists'
);

SELECT extensions.function_privs_are(
  'plugin_data', 'csf_get_worker_alert_snapshot', ARRAY[]::text[],
  'service_role', ARRAY['EXECUTE'],
  'service role can read worker alert counts'
);
SELECT extensions.function_privs_are(
  'plugin_data', 'csf_get_worker_alert_snapshot', ARRAY[]::text[],
  'authenticated', ARRAY[]::text[],
  'signed-in browsers cannot read worker alert counts'
);
SELECT extensions.function_privs_are(
  'plugin_data', 'csf_get_worker_alert_snapshot', ARRAY[]::text[],
  'anon', ARRAY[]::text[],
  'anonymous callers cannot read worker alert counts'
);

SELECT extensions.ok(
  (plugin_data.csf_get_worker_alert_snapshot()
    ? 'communicationBacklogOlderThanFiveMinutes'),
  'the snapshot reports old communication work'
);
SELECT extensions.ok(
  (plugin_data.csf_get_worker_alert_snapshot() ? 'unresolvedImportBatches'),
  'the snapshot reports unresolved import approval batches'
);
SELECT extensions.ok(
  (plugin_data.csf_get_worker_alert_snapshot() ? 'blockedImportCommits'),
  'the snapshot reports blocked import commits'
);
SELECT extensions.ok(
  (plugin_data.csf_get_worker_alert_snapshot()
    ->> 'communicationBacklogOlderThanFiveMinutes')::bigint >= 0
  AND (plugin_data.csf_get_worker_alert_snapshot()
    ->> 'unresolvedImportBatches')::bigint >= 0
  AND (plugin_data.csf_get_worker_alert_snapshot()
    ->> 'blockedImportCommits')::bigint >= 0,
  'every alert count is non-negative'
);

SELECT * FROM extensions.finish();
ROLLBACK;
