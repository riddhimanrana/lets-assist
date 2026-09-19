-- Keep a post edit and its attachment metadata replacement in one database
-- transaction. Storage objects are uploaded before this boundary; a failed
-- transaction leaves those uploads unreferenced so the service can remove
-- them without exposing a partially updated audience.
BEGIN;

CREATE FUNCTION plugin_data.csf_update_post_with_attachments(
  p_organization_id uuid,
  p_post_id uuid,
  p_payload jsonb,
  p_attachments jsonb,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mutation jsonb;
BEGIN
  IF p_attachments IS NULL
    OR pg_catalog.jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'Choose up to four valid post images.' USING ERRCODE = '22023';
  END IF;

  v_mutation := plugin_data.csf_mutate_post(
    p_organization_id,
    'update',
    p_post_id,
    p_payload,
    p_actor_user_id,
    p_request_id
  );

  PERFORM plugin_data.csf_replace_post_attachments(
    p_organization_id,
    p_post_id,
    p_actor_user_id,
    p_attachments,
    p_request_id
  );

  RETURN v_mutation;
END;
$$;

ALTER FUNCTION plugin_data.csf_update_post_with_attachments(
  uuid, uuid, jsonb, jsonb, uuid, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_update_post_with_attachments(
  uuid, uuid, jsonb, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_update_post_with_attachments(
  uuid, uuid, jsonb, jsonb, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_update_post_with_attachments(
  uuid, uuid, jsonb, jsonb, uuid, uuid
) IS
  'Service-only atomic CSF post update and attachment metadata replacement. Reuses both stable request receipts so exact retries remain idempotent.';

COMMIT;
