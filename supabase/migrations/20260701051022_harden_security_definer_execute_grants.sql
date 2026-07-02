-- Reduce direct execution grants on public SECURITY DEFINER functions.
--
-- Trigger-only helpers do not need Data API/RPC execution grants. RLS helper
-- functions are only needed by authenticated table access policies. Browser
-- RPCs remain narrowly granted where current product flows require them.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.before_insert_org_member() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_insert_project(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_insert_project(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_email_exists(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_username_unique() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_profile_exists(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_public_attendees(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_auto_join_on_signup() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_project_organizer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_trusted_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_plugin_audit(uuid, text, text, uuid, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_plugin_execution_metrics(uuid, text, integer, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_profile_email(uuid, text) FROM PUBLIC, anon, authenticated;

-- RLS helper functions used by authenticated policies.
GRANT EXECUTE ON FUNCTION public.can_insert_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_project(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_keep_or_set_public_visibility(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_organizer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_trusted_member(uuid) TO authenticated;

-- Current browser RPCs. These are documented and still required by public
-- project attendee display and anonymous signup email-account checks.
GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_attendees(uuid) TO anon, authenticated;

-- Server-side plugin telemetry now uses the service-role admin client.
GRANT EXECUTE ON FUNCTION public.log_plugin_audit(uuid, text, text, uuid, text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_plugin_execution_metrics(uuid, text, integer, boolean, text) TO service_role;

COMMIT;
