-- The public organization page fetches membership rows through this
-- security-invoker view, then resolves the permitted public profile projection
-- through the server-only data-access layer. Keeping the profile join here made
-- an anonymous membership query require direct SELECT on public.profiles.

BEGIN;

DROP VIEW public.organization_public_member_read_model;

CREATE VIEW public.organization_public_member_read_model
WITH (security_invoker = true)
AS
SELECT
  om.id,
  om.organization_id,
  om.user_id,
  om.role,
  om.joined_at
FROM public.organization_members om
JOIN public.organizations o ON o.id = om.organization_id
WHERE o.show_members_publicly
  AND coalesce(om.is_visible, true)
  AND coalesce(om.status, 'active') <> 'removed';

COMMENT ON VIEW public.organization_public_member_read_model IS
  'Public-safe organization member identifiers and roles. Public profile fields are resolved separately through the server-only public profile data-access layer.';

REVOKE ALL ON public.organization_public_member_read_model
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_public_member_read_model
  TO anon, authenticated;

COMMIT;
