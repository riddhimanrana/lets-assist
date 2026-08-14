-- A caller whose csf_mutate_post transaction ended with an ambiguous result
-- (timeout, dropped connection) needs a safe way to learn whether its request
-- receipt was committed before retrying. This read-only resolver serializes
-- against the in-flight mutation for the same request and answers only
-- "committed as post X via action Y" or "not written" -- never receipt
-- contents, fingerprints, or another actor's outcomes.

BEGIN;

CREATE FUNCTION plugin_data.csf_resolve_post_mutation_outcome(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_id uuid;
  v_action text;
BEGIN
  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_posts'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A stable post request identifier is required.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'plugin_data.csf_post_mutation_request:'
        || p_organization_id::text || ':' || p_request_id::text,
      0
    )
  );

  IF p_actor_user_id IS NULL
    OR plugin_data.csf_actor_has_permission(
      p_organization_id,
      p_actor_user_id,
      'manage_posts'
    ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Not authorized to manage CSF posts.';
  END IF;

  SELECT audit.target_id, audit.action
  INTO v_target_id, v_action
  FROM plugin_data.csf_admin_audit_events AS audit
  WHERE audit.organization_id = p_organization_id
    AND audit.correlation_id = p_request_id
    AND audit.source_type = 'post_mutation_request'
    AND audit.actor_user_id = p_actor_user_id
    AND audit.action IN (
      'post_created',
      'post_updated',
      'post_pinned',
      'post_unpinned',
      'post_archived'
    )
    AND audit.target_type = 'csf_announcement'
    AND audit.target_id IS NOT NULL
  LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'committed',
      'postId', v_target_id,
      'action', v_action
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object('status', 'not_written');
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_resolve_post_mutation_outcome(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_post_mutation_outcome(
  uuid, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_resolve_post_mutation_outcome(
  uuid, uuid, uuid
) IS 'Service-only, manage_posts-authorized outcome resolver for an ambiguous csf_mutate_post request: serializes on the same per-request advisory lock, then reports only whether the caller''s own receipt committed ({status,postId,action}) or not_written; receipt contents are never exposed.';

NOTIFY pgrst, 'reload schema';

COMMIT;
