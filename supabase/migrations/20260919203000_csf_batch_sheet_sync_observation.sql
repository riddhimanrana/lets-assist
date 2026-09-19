-- Bound the worker's per-record observation traffic without weakening the
-- existing destination snapshot or inbound-change transactions. Each item is
-- still evaluated by the canonical function, so scope, lease, authorization,
-- idempotency, and source-version checks stay in one place.

CREATE FUNCTION plugin_data.csf_sheet_sync_destination_snapshots(
  p_organization_id uuid,
  p_destination_id uuid,
  p_records jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item jsonb;
  result jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_records) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Sheet snapshot records must be an array.';
  END IF;
  IF jsonb_array_length(p_records) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Sheet snapshot batches must contain 1 to 100 records.';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR item - ARRAY['record_kind', 'record_id'] <> '{}'::jsonb
      OR jsonb_typeof(item->'record_kind') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'record_id') IS DISTINCT FROM 'string'
      OR item->>'record_kind' NOT IN ('application', 'point_submission', 'profile')
    THEN
      RAISE EXCEPTION 'Sheet snapshot record is invalid.';
    END IF;

    result := result || jsonb_build_array(jsonb_build_object(
      'record_kind', item->>'record_kind',
      'record_id', item->>'record_id',
      'snapshot', plugin_data.csf_sheet_sync_destination_snapshot(
        p_organization_id,
        p_destination_id,
        item->>'record_kind',
        (item->>'record_id')::uuid
      )
    ));
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshots(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshots(uuid,uuid,jsonb)
  TO service_role;

CREATE FUNCTION plugin_data.csf_record_sheet_sync_changes(
  p_organization_id uuid,
  p_destination_id uuid,
  p_destination_lease_token uuid,
  p_changes jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item jsonb;
  result jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Sheet changes must be an array.';
  END IF;
  IF jsonb_array_length(p_changes) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Sheet change batches must contain 1 to 100 records.';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_changes)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR item - ARRAY[
        'record_kind',
        'record_id',
        'source_version',
        'remote_version',
        'payload'
      ] <> '{}'::jsonb
      OR jsonb_typeof(item->'record_kind') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'record_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'source_version') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'remote_version') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'payload') IS DISTINCT FROM 'object'
      OR item->>'record_kind' NOT IN ('application', 'point_submission', 'profile')
    THEN
      RAISE EXCEPTION 'Sheet change record is invalid.';
    END IF;

    result := result || jsonb_build_array(jsonb_build_object(
      'record_kind', item->>'record_kind',
      'record_id', item->>'record_id',
      'result', plugin_data.csf_record_sheet_sync_change(
        p_organization_id,
        p_destination_id,
        item->>'record_kind',
        (item->>'record_id')::uuid,
        item->>'source_version',
        item->>'remote_version',
        item->'payload',
        p_destination_lease_token
      )
    ));
  END LOOP;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_record_sheet_sync_changes(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_record_sheet_sync_changes(uuid,uuid,uuid,jsonb)
  TO service_role;
