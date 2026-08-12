-- Replace the provider-unaware Drive metadata write with a locked
-- compare-and-set boundary. A delayed provider response may update provenance
-- only while the source still names the exact provider and file that were read.

BEGIN;

REVOKE ALL ON FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(
  uuid, uuid, uuid, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(
  uuid, uuid, uuid, jsonb
);

CREATE FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_expected_provider text,
  p_expected_file_id text,
  p_provider_file_id text,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
BEGIN
  IF p_expected_provider IS DISTINCT FROM 'google_sheets' THEN
    RAISE EXCEPTION 'CSF source expected provider must be google_sheets.'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_file_id IS NULL
    OR pg_catalog.btrim(p_expected_file_id) = ''
  THEN
    RAISE EXCEPTION 'CSF source expected file id must be nonblank.'
      USING ERRCODE = '22023';
  END IF;

  -- Preserve the established auth-first boundary before waiting on mutable
  -- staff access.
  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id,
    p_actor_user_id,
    p_source_id
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );

  -- Role and position authorization are mutable state. Re-read them only after
  -- this request owns the canonical organization staff-access lock.
  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id,
    p_actor_user_id,
    p_source_id
  );

  SELECT source.*
  INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.id = p_source_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_source.organization_id IS DISTINCT FROM p_organization_id
  THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '42501';
  END IF;

  -- Reauthorize the exact source after its row is locked and before accepting
  -- any provider response or mutating provenance.
  PERFORM plugin_data.csf_assert_import_actor_for_source(
    p_organization_id,
    p_actor_user_id,
    p_source_id
  );

  IF v_source.provider IS DISTINCT FROM p_expected_provider THEN
    RAISE EXCEPTION
      'The CSF source provider changed before its metadata could be refreshed.'
      USING ERRCODE = '40001';
  END IF;

  IF v_source.spreadsheet_id IS DISTINCT FROM p_expected_file_id THEN
    RAISE EXCEPTION
      'The CSF source file changed before its metadata could be refreshed.'
      USING ERRCODE = '40001';
  END IF;

  IF p_provider_file_id IS NOT NULL
    AND p_provider_file_id IS DISTINCT FROM p_expected_file_id
  THEN
    RAISE EXCEPTION 'The provider answered for a different CSF source file.'
      USING ERRCODE = '23514';
  END IF;

  IF p_metadata IS NULL
    OR pg_catalog.jsonb_typeof(p_metadata) <> 'object'
  THEN
    RAISE EXCEPTION 'CSF source drive metadata must be a JSON object.'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key IN
    SELECT key
    FROM pg_catalog.jsonb_object_keys(p_metadata) AS keys(key)
  LOOP
    IF NOT (v_key = ANY (ARRAY[
      'name', 'modifiedAt', 'mimeType', 'webViewLink', 'trashed', 'accessState'
    ])) THEN
      RAISE EXCEPTION 'CSF source drive metadata may not carry "%".', v_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  UPDATE plugin_data.csf_sheet_sources AS source
  SET drive_file_name =
        coalesce(nullif(p_metadata ->> 'name', ''), source.drive_file_name),
      drive_modified_at =
        coalesce(
          nullif(p_metadata ->> 'modifiedAt', '')::timestamptz,
          source.drive_modified_at
        ),
      drive_mime_type =
        coalesce(
          nullif(p_metadata ->> 'mimeType', ''),
          source.drive_mime_type
        ),
      drive_web_view_link =
        coalesce(
          nullif(p_metadata ->> 'webViewLink', ''),
          source.drive_web_view_link
        ),
      drive_trashed = CASE
        WHEN p_metadata ? 'trashed' THEN (p_metadata ->> 'trashed')::boolean
        ELSE source.drive_trashed
      END,
      drive_access_state =
        coalesce(
          nullif(p_metadata ->> 'accessState', ''),
          source.drive_access_state
        ),
      drive_access_checked_at = now(),
      updated_at = now()
  WHERE source.id = p_source_id
    AND source.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '42501';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'sourceId',
    p_source_id,
    'refreshed',
    true
  );
END;
$$;

COMMENT ON FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(
  uuid, uuid, uuid, text, text, text, jsonb
) IS
  'Service-only CSF Drive provenance refresh. Validates the Google Sheet expectation, authorizes before and after the canonical organization staff-access lock, locks the source row, reauthorizes the exact source, and compare-and-sets organization, provider, stored spreadsheet id, and any returned provider file id before updating the closed metadata vocabulary.';

REVOKE ALL ON FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(
  uuid, uuid, uuid, text, text, text, jsonb
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION plugin_data.csf_refresh_sheet_source_drive_metadata(
  uuid, uuid, uuid, text, text, text, jsonb
)
TO service_role;

COMMIT;
