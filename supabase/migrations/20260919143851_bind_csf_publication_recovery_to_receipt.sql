-- Bind publication recovery to the actor and immutable post mutation receipt
-- that created the recoverable outcome.
BEGIN;

CREATE OR REPLACE FUNCTION plugin_data.csf_resolve_post_publication_completion(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_announcement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request plugin_data.csf_post_publication_requests%ROWTYPE;
  v_mutation_receipt plugin_data.csf_admin_audit_events%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL
    OR p_request_id IS NULL OR p_announcement_id IS NULL THEN
    RAISE EXCEPTION 'The post publication recovery request is invalid.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    plugin_data.csf_staff_access_lock_key(p_organization_id)
  );
  IF plugin_data.csf_actor_has_permission(
    p_organization_id, p_actor_user_id, 'manage_posts'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_request
  FROM plugin_data.csf_post_publication_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'complete');
  END IF;
  IF v_request.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'That post request belongs to another officer.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_mutation_receipt
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'post_mutation_request'
    AND audit.action IN ('post_created', 'post_updated')
  LIMIT 1;
  IF NOT FOUND
    OR v_mutation_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id
    OR v_mutation_receipt.target_type IS DISTINCT FROM 'csf_announcement'
    OR v_mutation_receipt.target_id IS DISTINCT FROM p_announcement_id THEN
    RAISE EXCEPTION 'That post request does not match the committed post mutation.'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.announcement_id IS NOT NULL
    AND v_request.announcement_id IS DISTINCT FROM p_announcement_id THEN
    RAISE EXCEPTION 'That post request is bound to another post.' USING ERRCODE = '55000';
  END IF;

  UPDATE plugin_data.csf_post_publication_requests AS request
  SET announcement_id = p_announcement_id, updated_at = now()
  WHERE request.organization_id = p_organization_id
    AND request.request_id = p_request_id
    AND request.actor_user_id = p_actor_user_id
    AND (request.announcement_id IS NULL
      OR request.announcement_id = p_announcement_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That post request changed before recovery could finish.'
      USING ERRCODE = '40001';
  END IF;

  IF v_request.attachment_status <> 'saved' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'incomplete', 'reason', 'attachments_not_saved'
    );
  END IF;
  IF v_request.email_status = 'pending' THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'incomplete', 'reason', 'email_preparation_unresolved'
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'complete');
END;
$$;

ALTER FUNCTION plugin_data.csf_resolve_post_publication_completion(
  uuid, uuid, uuid, uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION plugin_data.csf_resolve_post_publication_completion(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_post_publication_completion(
  uuid, uuid, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_resolve_post_publication_completion(
  uuid, uuid, uuid, uuid
) IS
  'Service-only recovery for a CSF post publication. Revalidates officer permission, request ownership, and the matching immutable post mutation receipt before binding a publication request to its announcement.';

COMMIT;
