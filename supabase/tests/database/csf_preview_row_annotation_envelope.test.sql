BEGIN;

SELECT plan(7);

-- The writer (support-import-preview-rows.ts) records acquisition-time cell
-- fills and notes into normalized_data.annotations, and the settlement RPC
-- requires that evidence -- but until 20260816230000 the append RPC's closed
-- envelope refused the key outright, so the first live Sheets preview failed.
-- The settlement pgTAP seeds rows directly and never crossed the RPC; this
-- suite goes THROUGH it, so the two contracts can never drift apart silently
-- again.

INSERT INTO auth.users (id, email)
VALUES ('a2a20000-0000-4000-8000-000000000001', 'annotation-envelope@local.test');
INSERT INTO public.organizations (id, name, username, type, join_code, created_by)
VALUES ('a2a20000-0000-4000-8000-000000000002', 'Annotation Envelope Org',
        'annotation-envelope-org', 'school', '990002',
        'a2a20000-0000-4000-8000-000000000001');
-- The append RPC asserts an active org membership for the actor; admin skips
-- the per-permission staff checks.
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('a2a20000-0000-4000-8000-000000000002',
        'a2a20000-0000-4000-8000-000000000001', 'admin', 'active');
INSERT INTO plugin_data.csf_sheet_sources (
  id, organization_id, title, provider, spreadsheet_id
) VALUES (
  'a2a20000-0000-4000-8000-000000000003',
  'a2a20000-0000-4000-8000-000000000002',
  'Envelope fixture workbook', 'google_sheets', 'envelope-fixture'
);
INSERT INTO plugin_data.csf_sheet_import_jobs (
  id, organization_id, source_id, initiated_by, mode, status, source_type,
  source_sheet_tab, mapping_version
) VALUES (
  'a2a20000-0000-4000-8000-000000000004',
  'a2a20000-0000-4000-8000-000000000002',
  'a2a20000-0000-4000-8000-000000000003',
  'a2a20000-0000-4000-8000-000000000001',
  'preview', 'running', 'class_history', 'F23', 1
);

CREATE OR REPLACE FUNCTION pg_temp.envelope_record()
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'identity', jsonb_build_object(
      'firstName', 'Rowan', 'lastName', 'Testerson',
      'normalizedFirstName', 'rowan', 'normalizedLastName', 'testerson'
    )
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.envelope_row(p_annotations jsonb)
RETURNS jsonb
LANGUAGE sql
AS $$
  -- `raw_data` on a central row must be empty or exactly the canonical record;
  -- anything wider is refused as a second copy of discarded source data.
  SELECT jsonb_build_object(
    'sheet_tab_name', 'F23',
    'row_number', 2,
    'raw_data', pg_temp.envelope_record(),
    'normalized_data',
      jsonb_strip_nulls(jsonb_build_object(
        'contractVersion', 'csf-normalized-import/v1',
        'sourceType', 'class_history',
        'record', pg_temp.envelope_record(),
        'annotations', p_annotations
      )),
    'import_status', 'pending'
  );
$$;

-- A row with well-formed annotations is accepted through the RPC.
SELECT lives_ok(
  $$SELECT plugin_data.csf_append_import_preview_rows(
      'a2a20000-0000-4000-8000-000000000002',
      'a2a20000-0000-4000-8000-000000000001',
      'a2a20000-0000-4000-8000-000000000004',
      jsonb_build_array(pg_temp.envelope_row(
        '{"1": {"background": "#b6d7a8"}, "15": {"background": "#ea9999", "note": "Officer said appeal approved"}}'::jsonb
      ))
    )$$,
  'annotated preview row is accepted'
);

SELECT is(
  (SELECT normalized_data -> 'annotations' -> '15' ->> 'note'
   FROM plugin_data.csf_sheet_import_rows
   WHERE job_id = 'a2a20000-0000-4000-8000-000000000004'
     AND row_number = 2),
  'Officer said appeal approved',
  'the note survives into the stored row'
);

-- Absent annotations remain fine: the empty-object write and the omitted key.
SELECT lives_ok(
  $$SELECT plugin_data.csf_append_import_preview_rows(
      'a2a20000-0000-4000-8000-000000000002',
      'a2a20000-0000-4000-8000-000000000001',
      'a2a20000-0000-4000-8000-000000000004',
      jsonb_build_array(pg_temp.envelope_row('{}'::jsonb) || '{"row_number": 3}'::jsonb)
    )$$,
  'an empty annotations object is accepted'
);

-- Shape violations fail closed.
SELECT throws_like(
  $$SELECT plugin_data.csf_append_import_preview_rows(
      'a2a20000-0000-4000-8000-000000000002',
      'a2a20000-0000-4000-8000-000000000001',
      'a2a20000-0000-4000-8000-000000000004',
      jsonb_build_array(pg_temp.envelope_row(
        '{"header": {"background": "#b6d7a8"}}'::jsonb
      ) || '{"row_number": 4}'::jsonb)
    )$$,
  '%keyed by column number%',
  'non-numeric annotation keys are refused'
);

SELECT throws_like(
  $$SELECT plugin_data.csf_append_import_preview_rows(
      'a2a20000-0000-4000-8000-000000000002',
      'a2a20000-0000-4000-8000-000000000001',
      'a2a20000-0000-4000-8000-000000000004',
      jsonb_build_array(pg_temp.envelope_row(
        '{"1": {"background": "B6D7A8"}}'::jsonb
      ) || '{"row_number": 5}'::jsonb)
    )$$,
  '%lowercase #rrggbb%',
  'a non-normalized background color is refused'
);

SELECT throws_like(
  $$SELECT plugin_data.csf_append_import_preview_rows(
      'a2a20000-0000-4000-8000-000000000002',
      'a2a20000-0000-4000-8000-000000000001',
      'a2a20000-0000-4000-8000-000000000004',
      jsonb_build_array(pg_temp.envelope_row(
        '{"1": {"background": "#b6d7a8", "author": "someone"}}'::jsonb
      ) || '{"row_number": 6}'::jsonb)
    )$$,
  '%only "background" and "note"%',
  'unknown annotation fields are refused'
);

SELECT throws_like(
  $$SELECT plugin_data.csf_append_import_preview_rows(
      'a2a20000-0000-4000-8000-000000000002',
      'a2a20000-0000-4000-8000-000000000001',
      'a2a20000-0000-4000-8000-000000000004',
      jsonb_build_array(pg_temp.envelope_row(
        (SELECT jsonb_object_agg(n::text, '{"background": "#b6d7a8"}'::jsonb)
         FROM generate_series(1, 61) AS n)
      ) || '{"row_number": 7}'::jsonb)
    )$$,
  '%more than 60 annotated columns%',
  'the annotated-column bound holds'
);

SELECT * FROM finish();
ROLLBACK;
