BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(16);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'aa510000-0000-4000-8000-000000000001',
  'CSF Readiness Projection',
  'csf-readiness-projection',
  'school',
  '511025'
);

INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, mode, status, source_type, source_sheet_tab,
  mapping_version
) VALUES (
  'aa520000-0000-4000-8000-000000000001',
  'aa510000-0000-4000-8000-000000000001',
  'preview',
  'needs_resolution',
  'class_history',
  'S26',
  1
), (
  'aa520000-0000-4000-8000-000000000002',
  'aa510000-0000-4000-8000-000000000001',
  'preview',
  'needs_resolution',
  'meeting_attendance',
  'Responses',
  1
);

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number, import_status
) VALUES
  (
    'aa530000-0000-4000-8000-000000000001',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001',
    'S26', 2, 'pending'
  ),
  (
    'aa530000-0000-4000-8000-000000000002',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001',
    'S26', 3, 'conflict'
  );

INSERT INTO plugin_data.csf_sheet_import_rows (
  id, organization_id, job_id, sheet_tab_name, row_number, import_status, errors
) VALUES
  (
    'aa530000-0000-4000-8000-000000000003',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002',
    'Responses', 2, 'error',
    ARRAY['This response arrived before attendance opened and cannot count.']
  ),
  (
    'aa530000-0000-4000-8000-000000000004',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002',
    'Responses', 3, 'error',
    ARRAY['This response arrived after attendance closed and cannot count.']
  ),
  (
    'aa530000-0000-4000-8000-000000000005',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002',
    'Responses', 4, 'error',
    ARRAY['The submitted timestamp is not a valid date and must be corrected or explicitly excluded.']
  ),
  (
    'aa530000-0000-4000-8000-000000000006',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002',
    'Responses', 5, 'error',
    ARRAY[
      'This response arrived after attendance closed and cannot count.',
      'The submitted timestamp is not a valid date and must be corrected or explicitly excluded.'
    ]
  ),
  (
    'aa530000-0000-4000-8000-000000000007',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002',
    'Responses', 6, 'error',
    ARRAY[
      'This response arrived before attendance opened and cannot count.',
      'The submitted identity does not match a verified CSF profile.'
    ]
  ),
  (
    'aa530000-0000-4000-8000-000000000008',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002',
    'Responses', 7, 'error',
    ARRAY[
      'This response arrived after attendance closed and cannot count.',
      'A future reviewed error must continue to block attendance import.'
    ]
  ),
  (
    'aa530000-0000-4000-8000-000000000009',
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002',
    'Responses', 8, 'error',
    ARRAY[
      'This response arrived before attendance opened and cannot count.',
      NULL
    ]::text[]
  );

SELECT extensions.has_function(
  'plugin_data',
  'csf_import_preview_readiness',
  ARRAY['uuid', 'uuid'],
  'the exact readiness projection exists'
);

SELECT extensions.ok(
  NOT (
    SELECT proc.prosecdef
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = 'plugin_data.csf_import_preview_readiness(uuid,uuid)'::regprocedure
  ),
  'the service-only projection runs as SECURITY INVOKER'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_import_preview_readiness(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_import_preview_readiness(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_import_preview_readiness(uuid,uuid)',
    'EXECUTE'
  ),
  'only service_role can execute the readiness projection'
);

SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_class_history_source_key_value(jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'plugin_data.csf_class_history_has_stable_source_key(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_class_history_source_key_value(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'plugin_data.csf_class_history_has_stable_source_key(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_class_history_source_key_value(jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_class_history_has_stable_source_key(jsonb)',
    'EXECUTE'
  ),
  'the readiness projection helpers are executable only by the server role'
);

SET LOCAL ROLE service_role;

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'pendingMissingSourceKey')::integer,
  1,
  'service_role can execute class-history readiness through both helpers'
);

RESET ROLE;

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'total')::integer,
  2,
  'the projection counts the complete preview'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'pending')::integer,
  1,
  'pending rows are counted exactly'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'conflict')::integer,
  1,
  'conflict rows are counted exactly'
);

SELECT extensions.is(
  plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000001'
  )->>'commitState',
  'none',
  'a preview without a commit job reports no commit state'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002'
  )->>'error')::integer,
  7,
  'all attendance error rows remain excluded from credit'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002'
  )->>'attendanceWindowExcluded')::integer,
  2,
  'only the deterministic early and late rows are non-blocking exclusions'
);

SELECT extensions.is(
  (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002'
  )->>'error')::integer
  - (plugin_data.csf_import_preview_readiness(
    'aa510000-0000-4000-8000-000000000001',
    'aa520000-0000-4000-8000-000000000002'
  )->>'attendanceWindowExcluded')::integer,
  5,
  'mixed cutoff rows with malformed, identity, other, or null errors all remain blocking'
);

INSERT INTO plugin_data.csf_profiles(id,organization_id,first_name,last_name,normalized_first_name,normalized_last_name)
VALUES('aa540000-0000-4000-8000-000000000001','aa510000-0000-4000-8000-000000000001','Fictional','Attendee','fictional','attendee');
INSERT INTO plugin_data.csf_sheet_import_rows(organization_id,job_id,sheet_tab_name,row_number,import_status,matched_profile_id,errors)
VALUES
('aa510000-0000-4000-8000-000000000001','aa520000-0000-4000-8000-000000000002','Responses',10,'duplicate','aa540000-0000-4000-8000-000000000001',ARRAY['Attendance already exists and was not overwritten.']),
('aa510000-0000-4000-8000-000000000001','aa520000-0000-4000-8000-000000000002','Responses',11,'duplicate','aa540000-0000-4000-8000-000000000001',ARRAY['This student appears more than once.']),
('aa510000-0000-4000-8000-000000000001','aa520000-0000-4000-8000-000000000002','Responses',12,'duplicate',NULL,ARRAY['Attendance already exists and was not overwritten.']),
('aa510000-0000-4000-8000-000000000001','aa520000-0000-4000-8000-000000000002','Responses',13,'duplicate','aa540000-0000-4000-8000-000000000001',ARRAY['Attendance already exists and was not overwritten.', 'Identity needs review.']);
SELECT extensions.is((plugin_data.csf_import_preview_readiness(
 'aa510000-0000-4000-8000-000000000001','aa520000-0000-4000-8000-000000000002')->>'alreadyRecorded')::integer,1,
 'only a matched row with the exact settled result counts as already recorded');
SELECT extensions.is((plugin_data.csf_import_preview_readiness(
 'aa510000-0000-4000-8000-000000000001','aa520000-0000-4000-8000-000000000002')->>'duplicate')::integer,4,
 'all duplicate source rows remain preserved');
SELECT extensions.is((plugin_data.csf_import_preview_readiness(
 'aa510000-0000-4000-8000-000000000001','aa520000-0000-4000-8000-000000000001')->>'alreadyRecorded')::integer,0,
 'a class-history preview does not inherit attendance counts');
SELECT extensions.is((plugin_data.csf_import_preview_readiness(
 'aa510000-0000-4000-8000-000000000002','aa520000-0000-4000-8000-000000000002')->>'alreadyRecorded')::integer,0,
 'another organization cannot read this preview count');
SELECT * FROM extensions.finish();

ROLLBACK;
