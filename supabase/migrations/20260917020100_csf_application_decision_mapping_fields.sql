-- The full per-source decision mapping, saved race-safely.
--
-- The first cut stored only the decision and reason columns. Reading a verdict
-- needs more than that: which column carries the response identity the sync
-- matches on, what range and tab the mapping describes, and which fills mean
-- what. The chapter's live workbook makes the last one concrete — its rows
-- alternate between white and `#f8f9fa` banding, which is a theme fill and not
-- a decision, so the set of fills to ignore has to be configuration rather
-- than a guess in the reader.
--
-- The save also has to survive two officers editing at once. `p_expected_version`
-- is checked against the stored version under the row lock, so the second save
-- is refused instead of silently overwriting the first.

BEGIN;

ALTER TABLE plugin_data.csf_application_decision_mappings
  -- Which columns carry the response identity the sync matches on. Never the
  -- student's editable account contact: this is the original form response.
  ADD COLUMN identity_columns jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(identity_columns) = 'object'),
  -- The tab, range, and header row the column numbers are relative to. A
  -- mapping is meaningless without the frame it was drawn against.
  ADD COLUMN scope jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(scope) = 'object'),
  -- Explicit fill allowlists, including the fills that mean nothing at all.
  ADD COLUMN colors jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(colors) = 'object');

COMMENT ON COLUMN plugin_data.csf_application_decision_mappings.colors IS
  'Explicit fill allowlists per decision, plus ignoredFills for theme and banding colours that are not decisions.';

-- The six-argument first cut is replaced rather than extended: a mapping is one
-- coherent document, and saving half of it is how the identity columns would
-- get lost.
DROP FUNCTION plugin_data.csf_set_application_decision_mapping(
  uuid, uuid, uuid, integer[], integer[], boolean
);

CREATE FUNCTION plugin_data.csf_set_application_decision_mapping(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_mapping jsonb,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mapping jsonb := coalesce(p_mapping, '{}'::jsonb);
  v_decision integer[];
  v_reason integer[];
  v_note boolean := coalesce((v_mapping ->> 'readsCellNote')::boolean, false);
  v_identity jsonb := coalesce(v_mapping -> 'identityColumns', '{}'::jsonb);
  v_scope jsonb := coalesce(v_mapping -> 'scope', '{}'::jsonb);
  v_colors jsonb := coalesce(v_mapping -> 'colors', '{}'::jsonb);
  v_existing plugin_data.csf_application_decision_mappings%ROWTYPE;
  v_changed boolean;
  v_row plugin_data.csf_application_decision_mappings%ROWTYPE;
BEGIN
  PERFORM plugin_data.csf_assert_sheet_decision_authority(
    p_organization_id, p_actor_user_id, 'manage_sheet_sync',
    'Not authorized to configure CSF application decision columns.'
  );

  IF pg_catalog.jsonb_typeof(v_mapping) <> 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023', MESSAGE = 'The decision mapping must be an object.';
  END IF;
  IF pg_catalog.jsonb_typeof(v_identity) <> 'object'
    OR pg_catalog.jsonb_typeof(v_scope) <> 'object'
    OR pg_catalog.jsonb_typeof(v_colors) <> 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'identityColumns, scope, and colors must each be an object.';
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(value::integer ORDER BY value::integer),
    ARRAY[]::integer[]
  )
  INTO v_decision
  FROM pg_catalog.jsonb_array_elements_text(
    CASE WHEN pg_catalog.jsonb_typeof(v_mapping -> 'decisionColumns') = 'array'
      THEN v_mapping -> 'decisionColumns' ELSE '[]'::jsonb END
  ) AS value;

  SELECT coalesce(
    pg_catalog.array_agg(value::integer ORDER BY value::integer),
    ARRAY[]::integer[]
  )
  INTO v_reason
  FROM pg_catalog.jsonb_array_elements_text(
    CASE WHEN pg_catalog.jsonb_typeof(v_mapping -> 'reasonColumns') = 'array'
      THEN v_mapping -> 'reasonColumns' ELSE '[]'::jsonb END
  ) AS value;

  IF pg_catalog.array_length(v_decision, 1) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Choose at least one column that carries the decision.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(v_decision || v_reason) AS column_number
    WHERE column_number < 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Decision and reason columns are one-based positions.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_sources AS source
    WHERE source.id = p_source_id
      AND source.organization_id = p_organization_id
      AND source.source_type = 'application_responses'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'no_data_found',
      MESSAGE = 'That application response source does not exist in this chapter.';
  END IF;

  SELECT * INTO v_existing
  FROM plugin_data.csf_application_decision_mappings
  WHERE organization_id = p_organization_id AND source_id = p_source_id
  FOR UPDATE;

  -- Optimistic concurrency, resolved while this transaction holds the row.
  IF FOUND THEN
    IF p_expected_version IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '40001',
        MESSAGE = 'This source already has a decision mapping. Reload it and save again.',
        DETAIL = 'CSF_DECISION_MAPPING_VERSION=' || v_existing.mapping_version::text;
    END IF;
    IF p_expected_version <> v_existing.mapping_version THEN
      RAISE EXCEPTION USING
        ERRCODE = '40001',
        MESSAGE = 'Someone else changed this decision mapping. Reload it and save again.',
        DETAIL = 'CSF_DECISION_MAPPING_VERSION=' || v_existing.mapping_version::text;
    END IF;
  ELSIF p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'This source has no decision mapping yet. Save it as a new mapping.',
      DETAIL = 'CSF_DECISION_MAPPING_VERSION=0';
  END IF;

  v_changed := v_existing.id IS NULL
    OR v_existing.decision_columns IS DISTINCT FROM v_decision
    OR v_existing.reason_columns IS DISTINCT FROM v_reason
    OR v_existing.reads_cell_note IS DISTINCT FROM v_note
    OR v_existing.identity_columns IS DISTINCT FROM v_identity
    OR v_existing.scope IS DISTINCT FROM v_scope
    OR v_existing.colors IS DISTINCT FROM v_colors;

  INSERT INTO plugin_data.csf_application_decision_mappings AS mapping (
    organization_id, source_id, decision_columns, reason_columns,
    reads_cell_note, identity_columns, scope, colors, updated_by
  )
  VALUES (
    p_organization_id, p_source_id, v_decision, v_reason, v_note,
    v_identity, v_scope, v_colors, p_actor_user_id
  )
  ON CONFLICT (organization_id, source_id) DO UPDATE SET
    decision_columns = EXCLUDED.decision_columns,
    reason_columns = EXCLUDED.reason_columns,
    reads_cell_note = EXCLUDED.reads_cell_note,
    identity_columns = EXCLUDED.identity_columns,
    scope = EXCLUDED.scope,
    colors = EXCLUDED.colors,
    mapping_version = mapping.mapping_version
      + CASE WHEN v_changed THEN 1 ELSE 0 END,
    updated_by = EXCLUDED.updated_by,
    updated_at = pg_catalog.now()
  RETURNING * INTO v_row;

  IF v_changed THEN
    INSERT INTO plugin_data.csf_admin_audit_events (
      organization_id, actor_user_id, action, target_type, target_id,
      before_data, after_data, source_type, source_id
    )
    VALUES (
      p_organization_id, p_actor_user_id, 'application_decision_mapping.updated',
      'csf_sheet_sources', p_source_id,
      CASE WHEN v_existing.id IS NULL THEN NULL
        ELSE pg_catalog.to_jsonb(v_existing) END,
      pg_catalog.to_jsonb(v_row),
      'sheet_application_review', p_source_id::text
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'sourceId', v_row.source_id,
    'decisionColumns', pg_catalog.to_jsonb(v_row.decision_columns),
    'reasonColumns', pg_catalog.to_jsonb(v_row.reason_columns),
    'readsCellNote', v_row.reads_cell_note,
    'identityColumns', v_row.identity_columns,
    'scope', v_row.scope,
    'colors', v_row.colors,
    'mappingVersion', v_row.mapping_version,
    'changed', v_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_set_application_decision_mapping(uuid, uuid, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_set_application_decision_mapping(uuid, uuid, uuid, jsonb, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION plugin_data.csf_list_application_decision_mappings(
  p_organization_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id, p_actor_user_id, 'manage_sheet_sync'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Not authorized to read CSF application decision columns.';
  END IF;

  RETURN coalesce((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sourceId', source.id,
      'title', source.title,
      'spreadsheetFileId', coalesce(source.drive_file_id, source.spreadsheet_id),
      'configured', mapping.id IS NOT NULL,
      'decisionColumns', coalesce(pg_catalog.to_jsonb(mapping.decision_columns), '[]'::jsonb),
      'reasonColumns', coalesce(pg_catalog.to_jsonb(mapping.reason_columns), '[]'::jsonb),
      'readsCellNote', coalesce(mapping.reads_cell_note, false),
      'identityColumns', coalesce(mapping.identity_columns, '{}'::jsonb),
      'scope', coalesce(mapping.scope, '{}'::jsonb),
      'colors', coalesce(mapping.colors, '{}'::jsonb),
      'mappingVersion', mapping.mapping_version
    ) ORDER BY source.title)
    FROM plugin_data.csf_sheet_sources AS source
    LEFT JOIN plugin_data.csf_application_decision_mappings AS mapping
      ON mapping.organization_id = source.organization_id
     AND mapping.source_id = source.id
    WHERE source.organization_id = p_organization_id
      AND source.source_type = 'application_responses'
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_list_application_decision_mappings(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_list_application_decision_mappings(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_set_application_decision_mapping(uuid, uuid, uuid, jsonb, integer) IS
  'Saves one source''s full decision mapping. p_expected_version is checked under the row lock, so a concurrent save is refused rather than overwritten.';

COMMIT;
