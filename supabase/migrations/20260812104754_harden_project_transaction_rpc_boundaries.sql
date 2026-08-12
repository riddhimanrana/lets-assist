-- Keep the existing authenticated project lifecycle RPC signatures while
-- moving their privileged transactions out of the Data API schema. The public
-- SECURITY INVOKER wrappers retain browser behavior; the private fixed-path
-- implementations continue to derive auth.uid() and revalidate authority under
-- the existing locks. Remove the standalone duplicate of the canonical
-- projects (id, organization_id) constraint index.

BEGIN;

REVOKE ALL ON FUNCTION public.cancel_project_transactional(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.cancel_project_transactional(uuid, text)
  SET SCHEMA private;
REVOKE ALL ON FUNCTION private.cancel_project_transactional(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.cancel_project_transactional(uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_project_transactional(
  p_project_id uuid,
  p_cancellation_reason text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.cancel_project_transactional(
    p_project_id,
    p_cancellation_reason
  );
$$;

REVOKE ALL ON FUNCTION public.cancel_project_transactional(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_project_transactional(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION private.cancel_project_transactional(uuid, text) IS
  'Private SECURITY DEFINER transaction for an upcoming-to-cancelled transition. Derives the authenticated actor, rechecks management permission under the project lock, and atomically freezes the approved recipient/channel ledger.';
COMMENT ON FUNCTION public.cancel_project_transactional(uuid, text) IS
  'Authenticated SECURITY INVOKER RPC preserving the existing cancellation signature while delegating to the private permission-rechecked transaction.';

REVOKE ALL ON FUNCTION public.unreject_project_signup_with_capacity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.unreject_project_signup_with_capacity(uuid)
  SET SCHEMA private;
REVOKE ALL ON FUNCTION private.unreject_project_signup_with_capacity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.unreject_project_signup_with_capacity(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.unreject_project_signup_with_capacity(
  p_signup_id uuid
)
RETURNS TABLE (
  outcome text,
  project_id uuid
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT transition.outcome, transition.project_id
  FROM private.unreject_project_signup_with_capacity(p_signup_id) AS transition;
$$;

REVOKE ALL ON FUNCTION public.unreject_project_signup_with_capacity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unreject_project_signup_with_capacity(uuid)
  TO authenticated;

COMMENT ON FUNCTION private.unreject_project_signup_with_capacity(uuid) IS
  'Private SECURITY DEFINER rejected-to-approved transaction. Derives the authenticated actor, rechecks project authority, and preserves canonical capacity and lock ordering.';
COMMENT ON FUNCTION public.unreject_project_signup_with_capacity(uuid) IS
  'Authenticated SECURITY INVOKER RPC preserving the existing unrejection signature while delegating to the private permission-rechecked transaction.';

DROP INDEX public.projects_id_organization_id_uidx;

COMMIT;
