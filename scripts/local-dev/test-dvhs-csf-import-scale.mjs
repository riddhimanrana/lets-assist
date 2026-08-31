#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { getCsfIsolatedSupabaseEnv } from "./dv-local-env.mjs";

const ROW_COUNT = 1_000;
const BATCH_SIZE = 10;
const MAX_DURATION_MS = 10 * 60 * 1_000;

const { dbUrl } = getCsfIsolatedSupabaseEnv();

const sql = String.raw`
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'ce000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'import-scale-officer@local.test', now(),
  '{}', '{}', now(), now()
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'CSF Import Scale Fixture', 'csf-import-scale-fixture', 'school', '973501'
);

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  'ce100000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',
  'admin', 'active'
);

INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'ce150000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  2030, 'Class of 2030'
);

INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, source_type, title, cohort_id, provider,
  drive_access_state, drive_trashed, drive_file_name, drive_mime_type,
  uploaded_file_path, settings
) VALUES (
  'ce200000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'student_roster', 'Synthetic 1,000-row roster',
  'ce150000-0000-4000-8000-000000000001',
  'uploaded_xlsx', 'accessible', false, 'Synthetic roster.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ce100000-0000-4000-8000-000000000001/ce200000-0000-4000-8000-000000000001/1.xlsx',
  jsonb_build_object(
    'sourceKind', 'student_roster',
    'stagedUpload', true,
    'stagingObjectId', 'ce210000-0000-4000-8000-000000000001',
    'stagingGeneration', 1,
    'stagingContentHash', repeat('5', 64),
    'stagingByteLength', 2048,
    'stagingReadyAt', now(),
    'evidenceRevision', repeat('5', 64)
  )
);

INSERT INTO plugin_data.csf_sheet_import_staging_objects (
  id, organization_id, source_id, generation, status, bucket, object_path,
  file_extension, content_hash, byte_length, upload_expires_at, ready_at,
  ready_expires_at
) VALUES (
  'ce210000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  1, 'ready', 'plugins',
  'ce100000-0000-4000-8000-000000000001/ce200000-0000-4000-8000-000000000001/1.xlsx',
  'xlsx', repeat('5', 64), 2048,
  now() + interval '1 hour', now(), now() + interval '1 hour'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_file_id, source_file_name, source_sheet_tab, source_range,
  source_modified_at, source_file_metadata, mapping_snapshot, mapping_version,
  source_content_hash, snapshot_hash, snapshot_row_count,
  snapshot_contract_version
) VALUES (
  'ce300000-0000-4000-8000-000000000001',
  'ce100000-0000-4000-8000-000000000001',
  'ce200000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',
  'preview', 'completed', 'student_roster',
  'ce210000-0000-4000-8000-000000000001',
  'Synthetic roster.xlsx', 'Roster', 'Roster!A1:C1001', now(),
  jsonb_build_object(
    'id', 'ce210000-0000-4000-8000-000000000001',
    'sourceProvider', 'uploaded_xlsx',
    'name', 'Synthetic roster.xlsx',
    'mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'headRevisionId', repeat('5', 64),
    'stagingGeneration', 1,
    'readyAt', now(),
    'accessState', 'accessible',
    'trashed', false
  ),
  jsonb_build_object(
    'version', 1,
    'sourceType', 'student_roster',
    'sourceFileId', 'ce210000-0000-4000-8000-000000000001',
    'sourceProvider', 'uploaded_xlsx',
    'tabs', jsonb_build_array(jsonb_build_object(
      'tabName', 'Roster', 'range', 'Roster!A1:C1001', 'headerRow', 1
    ))
  ),
  1, repeat('5', 64), repeat('2', 64), 1000,
  'csf-normalized-import/v1'
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, source_id, cohort_id, sheet_tab_name,
  row_number, source_range, import_status, row_hash, normalized_data
)
SELECT
  md5('csf-import-scale-row-' || fixture_number::text)::uuid,
  'ce100000-0000-4000-8000-000000000001'::uuid,
  'ce300000-0000-4000-8000-000000000001'::uuid,
  'ce200000-0000-4000-8000-000000000001'::uuid,
  'ce150000-0000-4000-8000-000000000001'::uuid,
  'Roster', fixture_number + 1, 'Roster!A1:C1001', 'pending',
  md5('csf-import-scale-hash-' || fixture_number::text)
    || md5('csf-import-scale-hash-' || fixture_number::text),
  jsonb_build_object('commitPayload', jsonb_build_object(
    'version', 'csf-commit-payload/v1',
    'sourceType', 'student_roster',
    'identity', jsonb_build_object(
      'firstName', 'Synthetic',
      'lastName', 'Fixture' || lpad(fixture_number::text, 4, '0'),
      'normalizedFirstName', 'synthetic',
      'normalizedLastName', 'fixture' || lpad(fixture_number::text, 4, '0')
    ),
    'canonicalEmails', jsonb_build_object(
      'schoolEmail', 'import-scale-' || lpad(fixture_number::text, 4, '0')
        || '@students.local.test',
      'normalizedSchoolEmail', 'import-scale-'
        || lpad(fixture_number::text, 4, '0') || '@students.local.test'
    )
  ))
FROM generate_series(1, 1000) AS fixture_number;

CREATE TEMP TABLE import_scale_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
CREATE TEMP TABLE import_scale_metrics (
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  replayed_batches integer NOT NULL DEFAULT 0
);
INSERT INTO import_scale_metrics (started_at) VALUES (clock_timestamp());

INSERT INTO import_scale_state (key, value)
SELECT 'claim', plugin_data.csf_claim_import_commit_attempt(
  'ce100000-0000-4000-8000-000000000001',
  'ce300000-0000-4000-8000-000000000001',
  'ce000000-0000-4000-8000-000000000001',
  3600,
  (plugin_data.csf_issue_uploaded_source_evidence(
    'ce100000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    'ce200000-0000-4000-8000-000000000001',
    'ce300000-0000-4000-8000-000000000001'
  ) ->> 'evidenceToken')::uuid
);

DO $benchmark$
DECLARE
  batch_number integer;
  attempt_id uuid := (
    SELECT (value ->> 'attemptId')::uuid
    FROM import_scale_state
    WHERE key = 'claim'
  );
  request_id uuid;
  row_ids uuid[];
  receipt jsonb;
  replay jsonb;
BEGIN
  FOR batch_number IN 0..99 LOOP
    request_id := md5('csf-import-scale-batch-' || batch_number::text)::uuid;
    SELECT array_agg(import_row.id ORDER BY import_row.row_number)
    INTO row_ids
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND import_row.job_id = 'ce300000-0000-4000-8000-000000000001'
      AND import_row.row_number BETWEEN batch_number * 10 + 2
        AND batch_number * 10 + 11;

    receipt := plugin_data.csf_commit_import_row_batch(
      'ce100000-0000-4000-8000-000000000001',
      attempt_id,
      request_id,
      row_ids
    );
    IF (receipt ->> 'succeeded')::integer <> 10
      OR (receipt ->> 'failed')::integer <> 0
    THEN
      RAISE EXCEPTION 'Import scale batch % did not settle cleanly.', batch_number;
    END IF;

    replay := plugin_data.csf_commit_import_row_batch(
      'ce100000-0000-4000-8000-000000000001',
      attempt_id,
      request_id,
      row_ids
    );
    IF replay IS DISTINCT FROM receipt THEN
      RAISE EXCEPTION 'Import scale batch % replay changed its receipt.', batch_number;
    END IF;
    UPDATE import_scale_metrics
    SET replayed_batches = replayed_batches + 1;
  END LOOP;
END
$benchmark$;

INSERT INTO import_scale_state (key, value)
SELECT 'finalize', plugin_data.csf_finalize_import_commit_attempt(
  'ce100000-0000-4000-8000-000000000001',
  (SELECT (value ->> 'attemptId')::uuid
   FROM import_scale_state WHERE key = 'claim'),
  '{"fictionalScaleFixture":true,"rows":1000}'::jsonb
);

UPDATE import_scale_metrics SET finished_at = clock_timestamp();

SELECT jsonb_build_object(
  'ok', (SELECT value ->> 'status' FROM import_scale_state WHERE key = 'finalize') = 'completed',
  'fictional', true,
  'rows', 1000,
  'batchSize', 10,
  'batches', 100,
  'replayedBatches', (SELECT replayed_batches FROM import_scale_metrics),
  'profilesCreated', (
    SELECT count(*) FROM plugin_data.csf_profiles
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
  ),
  'unknownOutcomes', (
    SELECT count(*) FROM plugin_data.csf_sheet_import_rows
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
      AND commit_outcome_state IN ('unknown', 'historical_unknown')
  ),
  'duplicateWrites', (
    SELECT count(*) - count(DISTINCT import_row_id)
    FROM plugin_data.csf_import_row_batch_outcomes
    WHERE organization_id = 'ce100000-0000-4000-8000-000000000001'
  ),
  'durationMs', (
    SELECT round(extract(epoch FROM (finished_at - started_at)) * 1000, 1)
    FROM import_scale_metrics
  )
)::text;

ROLLBACK;
`;

const result = spawnSync(
  "psql",
  [dbUrl, "-X", "-v", "ON_ERROR_STOP=1", "-tA"],
  {
    input: sql,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PGCONNECT_TIMEOUT: "10" },
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  const detail = result.stderr.trim().split("\n").slice(-8).join("\n");
  throw new Error(`CSF import scale benchmark failed.\n${detail}`);
}

const output = result.stdout
  .trim()
  .split("\n")
  .findLast((line) => line.trim().startsWith("{"));
if (!output) throw new Error("CSF import scale benchmark returned no receipt.");

const receipt = JSON.parse(output);
if (
  receipt.ok !== true ||
  receipt.rows !== ROW_COUNT ||
  receipt.batchSize !== BATCH_SIZE ||
  receipt.profilesCreated !== ROW_COUNT ||
  receipt.unknownOutcomes !== 0 ||
  receipt.duplicateWrites !== 0 ||
  Number(receipt.durationMs) > MAX_DURATION_MS
) {
  throw new Error(
    `CSF import scale acceptance failed: ${JSON.stringify(receipt)}`,
  );
}

console.log(JSON.stringify(receipt, null, 2));
