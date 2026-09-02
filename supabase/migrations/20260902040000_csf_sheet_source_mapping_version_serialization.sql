BEGIN;

-- Header contents can change parser behavior without changing the selected
-- range. Persist the bounded digest beside the source mapping so two different
-- header snapshots cannot claim the same mapping version.
CREATE OR REPLACE FUNCTION plugin_data.csf_sheet_source_settings_schema()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '{
    "sourceKind": "string",
    "sourceVariant": "string",
    "targetStrategy": "string",
    "mappingVersion": "number",
    "headerRow": "number",
    "headerSignature": "string",
    "selectedTabs": "array",
    "availableTabs": "array",
    "visibleTabs": "array",
    "hiddenTabCount": "number",
    "workbookFormat": "string",
    "fileHash": "string",
    "contentHash": "string",
    "meetingId": "string",
    "termId": "string",
    "partnerClubId": "string",
    "batchId": "string",
    "latestPreviewJobId": "string",
    "sheetImportSourceId": "string",
    "sheetImportPreviewJobId": "string",
    "sheetImportCorrelationId": "string",
    "skippedHistoricalTabs": "array"
  }'::jsonb;
$$;

COMMENT ON FUNCTION plugin_data.csf_sheet_source_settings_schema() IS
  'The closed caller-owned settings vocabulary for CSF import sources. A headerSignature is an exact lowercase SHA-256 digest used as mapping identity; attachment and provider-evidence coordinates remain system-owned and excluded.';

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_source_settings_schema()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_source_settings_schema()
  TO postgres;

CREATE OR REPLACE FUNCTION plugin_data.csf_assert_sheet_source_settings(
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  c_mapping_version_max constant bigint := 2147483647;
  v_schema jsonb := plugin_data.csf_sheet_source_settings_schema();
  v_attachment text[] := plugin_data.csf_sheet_source_attachment_keys();
  v_key text;
  v_expected text;
  v_header_signature text;
  v_mapping_version_text text;
BEGIN
  IF p_settings IS NULL OR pg_catalog.jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'CSF source settings must be a JSON object.' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.octet_length(p_settings::text) > 20000 THEN
    RAISE EXCEPTION 'These CSF source settings are too large to accept.' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT key FROM pg_catalog.jsonb_object_keys(p_settings) AS keys(key)
  LOOP
    IF v_key = ANY (v_attachment) THEN
      RAISE EXCEPTION
        'CSF source settings may not state "%": the staged generation is written only by csf_attach_sheet_source_generation and the provider evidence only by csf_refresh_sheet_source_evidence.',
        v_key USING ERRCODE = '23514';
    END IF;
    v_expected := v_schema ->> v_key;
    IF v_expected IS NULL THEN
      RAISE EXCEPTION 'CSF source settings may not carry "%".', v_key USING ERRCODE = '23514';
    END IF;
    IF pg_catalog.jsonb_typeof(p_settings -> v_key) NOT IN (v_expected, 'null') THEN
      RAISE EXCEPTION 'CSF source setting "%" must be a % or null.', v_key, v_expected
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_settings ? 'mappingVersion' THEN
    IF pg_catalog.jsonb_typeof(p_settings -> 'mappingVersion') <> 'number' THEN
      RAISE EXCEPTION
        'The requested import source mapping version is invalid.'
        USING ERRCODE = '22023';
    END IF;
    v_mapping_version_text := p_settings ->> 'mappingVersion';
    IF v_mapping_version_text IS NULL
      OR v_mapping_version_text !~ '^[1-9][0-9]{0,9}$'
    THEN
      RAISE EXCEPTION
        'The requested import source mapping version is invalid.'
        USING ERRCODE = '22023';
    END IF;
    IF v_mapping_version_text::bigint > c_mapping_version_max THEN
      RAISE EXCEPTION
        'The requested import source mapping version is invalid.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_settings ? 'headerSignature' THEN
    IF pg_catalog.jsonb_typeof(p_settings -> 'headerSignature') <> 'string' THEN
      RAISE EXCEPTION
        'CSF source setting "headerSignature" must be a lowercase SHA-256 digest.'
        USING ERRCODE = '22023';
    END IF;
    v_header_signature := p_settings ->> 'headerSignature';
    IF v_header_signature IS NULL
      OR v_header_signature !~ '^[0-9a-f]{64}$'
    THEN
      RAISE EXCEPTION
        'CSF source setting "headerSignature" must be a lowercase SHA-256 digest.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN p_settings;
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_assert_sheet_source_settings(jsonb) IS
  'Validates the closed caller-owned source settings vocabulary, including the bounded header mapping digest.';

REVOKE ALL ON FUNCTION plugin_data.csf_assert_sheet_source_settings(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_assert_sheet_source_settings(jsonb)
  TO postgres;

-- The application proposes a mapping version after reading the source. That
-- read and the later registry update are separate requests, so two officers
-- can both propose version N + 1 for different mappings. Serialize the final
-- decision at the row that owns the mapping. The trigger sees the latest OLD
-- row after PostgreSQL resolves a concurrent update, then validates that the
-- caller's version corresponds to the mapping actually being stored.
CREATE OR REPLACE FUNCTION plugin_data.csf_enforce_sheet_source_mapping_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_mapping_version_max constant bigint := 2147483647;
  v_old_settings jsonb;
  v_new_settings jsonb;
  v_old_version_text text;
  v_requested_version_text text;
  v_old_version bigint := 1;
  v_requested_version bigint;
  v_assigned_version bigint;
  v_mapping_changed boolean;
  v_old_material jsonb;
  v_new_material jsonb;
BEGIN
  v_old_settings := coalesce(OLD.settings, '{}'::jsonb);
  v_new_settings := coalesce(NEW.settings, '{}'::jsonb);

  IF pg_catalog.jsonb_typeof(v_old_settings) <> 'object' THEN
    RAISE EXCEPTION
      'This import source has no valid mapping settings. Save its mapping again.'
      USING ERRCODE = '23514';
  END IF;
  IF pg_catalog.jsonb_typeof(v_new_settings) <> 'object' THEN
    RAISE EXCEPTION
      'The requested import source mapping settings are invalid.'
      USING ERRCODE = '22023';
  END IF;

  IF v_new_settings ? 'headerSignature' THEN
    IF pg_catalog.jsonb_typeof(v_new_settings -> 'headerSignature') <> 'string' THEN
      RAISE EXCEPTION
        'CSF source setting "headerSignature" must be a lowercase SHA-256 digest.'
        USING ERRCODE = '22023';
    END IF;
    IF v_new_settings ->> 'headerSignature' !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION
        'CSF source setting "headerSignature" must be a lowercase SHA-256 digest.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Version 1 is the compatibility value for sources created before the key.
  IF v_old_settings ? 'mappingVersion' THEN
    IF pg_catalog.jsonb_typeof(v_old_settings -> 'mappingVersion') <> 'number' THEN
      RAISE EXCEPTION
        'This import source has no valid mapping version. Save its mapping again.'
        USING ERRCODE = '23514';
    END IF;
    v_old_version_text := v_old_settings ->> 'mappingVersion';
    IF v_old_version_text IS NULL
      OR v_old_version_text !~ '^[1-9][0-9]{0,9}$'
    THEN
      RAISE EXCEPTION
        'This import source has no valid mapping version. Save its mapping again.'
        USING ERRCODE = '23514';
    END IF;
    IF v_old_version_text::bigint > c_mapping_version_max THEN
      RAISE EXCEPTION
        'This import source has no valid mapping version. Save its mapping again.'
        USING ERRCODE = '23514';
    END IF;
    v_old_version := v_old_version_text::bigint;
  END IF;

  IF v_new_settings ? 'mappingVersion' THEN
    IF pg_catalog.jsonb_typeof(v_new_settings -> 'mappingVersion') <> 'number' THEN
      RAISE EXCEPTION
        'The requested import source mapping version is invalid.'
        USING ERRCODE = '22023';
    END IF;
    v_requested_version_text := v_new_settings ->> 'mappingVersion';
    IF v_requested_version_text IS NULL
      OR v_requested_version_text !~ '^[1-9][0-9]{0,9}$'
    THEN
      RAISE EXCEPTION
        'The requested import source mapping version is invalid.'
        USING ERRCODE = '22023';
    END IF;
    IF v_requested_version_text::bigint > c_mapping_version_max THEN
      RAISE EXCEPTION
        'The requested import source mapping version is invalid.'
        USING ERRCODE = '22023';
    END IF;
    v_requested_version := v_requested_version_text::bigint;
  END IF;

  -- This is the complete source state that can change how rows are interpreted
  -- or where they land. Provider evidence, sync status, attachment coordinates,
  -- preview receipts and display metadata are intentionally outside this tuple.
  v_old_material := pg_catalog.jsonb_build_object(
    'cohortId', OLD.cohort_id,
    'sourceType', OLD.source_type,
    'targetStrategy', OLD.target_strategy,
    'duplicatePolicy', OLD.duplicate_policy,
    'columnMappings', OLD.column_mappings,
    'tabMappings', OLD.tab_mappings,
    'settings', pg_catalog.jsonb_build_object(
      'sourceKind', v_old_settings -> 'sourceKind',
      'sourceVariant', v_old_settings -> 'sourceVariant',
      'targetStrategy', v_old_settings -> 'targetStrategy',
      'headerRow', v_old_settings -> 'headerRow',
      'headerSignature', v_old_settings -> 'headerSignature',
      'selectedTabs', v_old_settings -> 'selectedTabs',
      'workbookFormat', v_old_settings -> 'workbookFormat',
      'meetingId', v_old_settings -> 'meetingId',
      'termId', v_old_settings -> 'termId',
      'partnerClubId', v_old_settings -> 'partnerClubId',
      'batchId', v_old_settings -> 'batchId'
    )
  );
  v_new_material := pg_catalog.jsonb_build_object(
    'cohortId', NEW.cohort_id,
    'sourceType', NEW.source_type,
    'targetStrategy', NEW.target_strategy,
    'duplicatePolicy', NEW.duplicate_policy,
    'columnMappings', NEW.column_mappings,
    'tabMappings', NEW.tab_mappings,
    'settings', pg_catalog.jsonb_build_object(
      'sourceKind', v_new_settings -> 'sourceKind',
      'sourceVariant', v_new_settings -> 'sourceVariant',
      'targetStrategy', v_new_settings -> 'targetStrategy',
      'headerRow', v_new_settings -> 'headerRow',
      'headerSignature', v_new_settings -> 'headerSignature',
      'selectedTabs', v_new_settings -> 'selectedTabs',
      'workbookFormat', v_new_settings -> 'workbookFormat',
      'meetingId', v_new_settings -> 'meetingId',
      'termId', v_new_settings -> 'termId',
      'partnerClubId', v_new_settings -> 'partnerClubId',
      'batchId', v_new_settings -> 'batchId'
    )
  );
  v_mapping_changed := v_old_material IS DISTINCT FROM v_new_material;

  IF v_mapping_changed THEN
    IF v_old_version >= c_mapping_version_max THEN
      RAISE EXCEPTION
        'This import source mapping version is exhausted. Create a new source.'
        USING ERRCODE = '54000';
    END IF;
    IF v_requested_version IS DISTINCT FROM v_old_version + 1 THEN
      RAISE EXCEPTION
        'This import source mapping changed after it was loaded. Reload it and try again.'
        USING ERRCODE = '40001';
    END IF;
    v_assigned_version := v_requested_version;
  ELSIF v_requested_version IS NULL THEN
    -- Internal writers that do not reconfigure a mapping may omit the hint.
    v_assigned_version := v_old_version;
  ELSIF v_requested_version = v_old_version THEN
    -- An exact lost-response replay carries the version it committed. Keeping
    -- the locked row's current version makes that replay idempotent.
    v_assigned_version := v_old_version;
  ELSIF v_requested_version = v_old_version + 1 THEN
    -- Some adapters version parser semantics that are not stored as source
    -- columns, such as a changed header signature. Preserve that one-step bump.
    v_assigned_version := v_requested_version;
  ELSIF v_requested_version > v_old_version + 1 THEN
    RAISE EXCEPTION
      'An import source mapping version may advance by only one step.'
      USING ERRCODE = '23514';
  ELSE
    RAISE EXCEPTION
      'This import source mapping changed after it was loaded. Reload it and try again.'
      USING ERRCODE = '40001';
  END IF;

  NEW.settings := pg_catalog.jsonb_set(
    v_new_settings,
    ARRAY['mappingVersion'],
    pg_catalog.to_jsonb(v_assigned_version::integer),
    true
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_enforce_sheet_source_mapping_version()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_enforce_sheet_source_mapping_version()
  TO postgres;

DROP TRIGGER IF EXISTS csf_sheet_sources_mapping_version_before_update
  ON plugin_data.csf_sheet_sources;
CREATE TRIGGER csf_sheet_sources_mapping_version_before_update
BEFORE UPDATE OF
  cohort_id,
  source_type,
  target_strategy,
  duplicate_policy,
  column_mappings,
  tab_mappings,
  settings
ON plugin_data.csf_sheet_sources
FOR EACH ROW
EXECUTE FUNCTION plugin_data.csf_enforce_sheet_source_mapping_version();

COMMENT ON FUNCTION plugin_data.csf_enforce_sheet_source_mapping_version() IS
  'Owner-only trigger boundary that validates a monotonic source mapping version under the source row lock. Different material mappings receive different versions; exact replays keep the locked version.';
COMMENT ON TRIGGER csf_sheet_sources_mapping_version_before_update
  ON plugin_data.csf_sheet_sources IS
  'Serializes mapping-version compare-and-swap validation for every source reconfiguration, including concurrent csf_register_sheet_source calls.';

-- Before this trigger existed, two different mappings could be stored under
-- one version. Invalidate every source-backed preview that can still produce a
-- row transition. The 0202 fence will then refuse those previews and require a
-- new preview under the post-migration version. Historical settled previews do
-- not need a version bump.
DO $$
DECLARE
  c_mapping_version_max constant bigint := 2147483647;
  v_bad_count bigint;
BEGIN
  SELECT pg_catalog.count(*)
  INTO v_bad_count
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.settings ? 'headerSignature'
    AND (
      pg_catalog.jsonb_typeof(source.settings -> 'headerSignature') <> 'string'
      OR source.settings ->> 'headerSignature' !~ '^[0-9a-f]{64}$'
    );
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'CSF mapping serialization rollout stopped: % header signature(s) are invalid.',
      v_bad_count USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_bad_count
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.settings ? 'mappingVersion'
    AND pg_catalog.jsonb_typeof(source.settings -> 'mappingVersion') <> 'number';
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'CSF mapping serialization rollout stopped: % source mapping version(s) have the wrong JSON type.',
      v_bad_count USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_bad_count
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.settings ? 'mappingVersion'
    AND (
      source.settings ->> 'mappingVersion' IS NULL
      OR source.settings ->> 'mappingVersion' !~ '^[1-9][0-9]{0,9}$'
    );
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'CSF mapping serialization rollout stopped: % source mapping version(s) are not positive integers.',
      v_bad_count USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_bad_count
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.settings ? 'mappingVersion'
    AND (source.settings ->> 'mappingVersion')::bigint >= c_mapping_version_max;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'CSF mapping serialization rollout stopped: % source mapping version(s) cannot advance.',
      v_bad_count USING ERRCODE = '54000';
  END IF;
END;
$$;

WITH affected_sources AS (
  SELECT DISTINCT source.id, source.organization_id
  FROM plugin_data.csf_sheet_sources AS source
  JOIN plugin_data.csf_sheet_import_jobs AS preview
    ON preview.organization_id = source.organization_id
   AND preview.source_id = source.id
   AND preview.mode = 'preview'
  WHERE preview.status IN ('pending', 'running', 'needs_resolution', 'partially_completed')
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_sheet_import_rows AS import_row
      WHERE import_row.organization_id = preview.organization_id
        AND import_row.job_id = preview.id
        AND import_row.import_status IN (
          'pending', 'ambiguous', 'duplicate', 'conflict', 'error', 'resolved'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM plugin_data.csf_import_commit_queue AS queue
      WHERE queue.organization_id = preview.organization_id
        AND queue.preview_job_id = preview.id
        AND queue.status IN ('queued', 'running')
    )
)
UPDATE plugin_data.csf_sheet_sources AS source
SET settings = pg_catalog.jsonb_set(
      source.settings,
      ARRAY['mappingVersion'],
      pg_catalog.to_jsonb(
        (
          CASE
            WHEN source.settings ? 'mappingVersion'
              THEN (source.settings ->> 'mappingVersion')::integer
            ELSE 1
          END
        ) + 1
      ),
      true
    ),
    updated_at = now()
FROM affected_sources AS affected
WHERE source.id = affected.id
  AND source.organization_id = affected.organization_id;

COMMIT;
