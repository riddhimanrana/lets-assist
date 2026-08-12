-- Give the bounded application queue one batch read of the same canonical
-- approval preflight used by detail and the locked decision transaction.
-- The service reduces this private result to a permission-neutral summary
-- before it crosses the server/client boundary.

BEGIN;

CREATE FUNCTION plugin_data.csf_application_decision_readiness_page(
  p_organization_id uuid,
  p_application_ids uuid[]
)
RETURNS TABLE (
  application_id uuid,
  readiness jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    application.id,
    plugin_data.csf_application_decision_readiness(
      p_organization_id,
      application.id
    )
  FROM plugin_data.csf_term_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.id = ANY (
      (coalesce(p_application_ids, ARRAY[]::uuid[]))[1:100]
    )
  ORDER BY array_position(
    (coalesce(p_application_ids, ARRAY[]::uuid[]))[1:100],
    application.id
  );
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_application_decision_readiness_page(
  uuid, uuid[]
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_application_decision_readiness_page(
  uuid, uuid[]
)
  TO service_role;

COMMENT ON FUNCTION plugin_data.csf_application_decision_readiness_page(
  uuid, uuid[]
) IS
  'Server-only bounded tenant-scoped batch of the canonical application approval preflight for one already-keyset-paged queue page.';

COMMIT;
