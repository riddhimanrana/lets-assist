BEGIN;

-- Public-safe organization discovery surface. This deliberately excludes join
-- codes, staff invite tokens, auto-join domains, allowed domains, and creator
-- internals. Base-table reads are preserved in this migration for existing
-- server/project flows, but public pages should use this view.
DROP VIEW IF EXISTS public.organization_public_member_read_model;
DROP VIEW IF EXISTS public.organization_public_read_model;
DROP VIEW IF EXISTS public.organization_invitation_acceptance_read_model;

CREATE VIEW public.organization_public_read_model
WITH (security_invoker = true)
AS
SELECT
  o.id,
  o.username,
  o.name,
  o.description,
  o.website,
  o.logo_url,
  o.type,
  o.verified,
  o.created_at,
  o.show_members_publicly,
  CASE
    WHEN o.show_members_publicly THEN (
      SELECT count(*)::integer
      FROM public.organization_members om
      WHERE om.organization_id = o.id
        AND coalesce(om.is_visible, true)
        AND coalesce(om.status, 'active') <> 'removed'
    )
    ELSE 0
  END AS public_member_count
FROM public.organizations o;

CREATE VIEW public.organization_public_member_read_model
WITH (security_invoker = true)
AS
SELECT
  om.id,
  om.organization_id,
  om.user_id,
  om.role,
  om.joined_at,
  p.username,
  p.full_name,
  p.avatar_url
FROM public.organization_members om
JOIN public.organizations o ON o.id = om.organization_id
LEFT JOIN public.public_profile_read_model p ON p.id = om.user_id
WHERE o.show_members_publicly
  AND coalesce(om.is_visible, true)
  AND coalesce(om.status, 'active') <> 'removed';

CREATE VIEW public.organization_invitation_acceptance_read_model
WITH (security_invoker = true)
AS
SELECT
  oi.id,
  oi.organization_id,
  oi.token,
  oi.email,
  oi.role,
  oi.status,
  oi.expires_at,
  oi.invited_full_name,
  oi.invited_phone,
  oi.invited_profile_data,
  o.name AS organization_name,
  o.username AS organization_username,
  o.logo_url AS organization_logo_url
FROM public.organization_invitations oi
JOIN public.organizations o ON o.id = oi.organization_id;

COMMENT ON VIEW public.organization_public_read_model IS
  'Public-safe organization list/detail read model. Excludes org join codes, staff invite tokens, auto-join domains, allowed domains, and creator internals.';

COMMENT ON VIEW public.organization_public_member_read_model IS
  'Public-safe organization member directory read model gated by organizations.show_members_publicly and member visibility/status.';

COMMENT ON VIEW public.organization_invitation_acceptance_read_model IS
  'Narrow invitation acceptance shape. Underlying invitation RLS still requires the x-invitation-token request header.';

REVOKE ALL ON public.organization_public_read_model FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organization_public_member_read_model FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organization_invitation_acceptance_read_model FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_public_read_model TO anon, authenticated;
GRANT SELECT ON public.organization_public_member_read_model TO anon, authenticated;
GRANT SELECT ON public.organization_invitation_acceptance_read_model TO anon, authenticated;

-- Reduce anonymous organization-domain API surface. Anonymous clients only need
-- read access for public org discovery, public member directories, and invite
-- acceptance/join-code flows; all writes must be authenticated or server-side.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.organizations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.organization_members FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.organization_invitations FROM anon;
REVOKE ALL ON public.organization_calendar_syncs FROM anon;
REVOKE ALL ON public.organization_calendar_events FROM anon;
REVOKE ALL ON public.organization_sheet_syncs FROM anon;
REVOKE ALL ON public.organization_contact_import_jobs FROM anon;
REVOKE ALL ON public.organization_contact_import_rows FROM anon;
REVOKE ALL ON public.organization_plugin_installs FROM anon;
REVOKE ALL ON public.organization_plugin_entitlements FROM anon;
REVOKE ALL ON public.organization_plugin_feature_flags FROM anon;
REVOKE ALL ON public.organization_plugin_access FROM anon;
REVOKE ALL ON public.organization_plugin_routes FROM anon;
REVOKE ALL ON public.organization_plugin_data_boundaries FROM anon;
REVOKE ALL ON public.organization_data_isolation_profiles FROM anon;

-- Keep organization base-table reads for current project domain-restriction and
-- settings flows, but stop targeting PUBLIC policies. Future migrations can
-- move remaining base-table reads behind server actions/read models and then
-- reduce grants further.
DROP POLICY IF EXISTS "Allow anyone to read organizations" ON public.organizations;
CREATE POLICY "Organizations readable by app clients"
  ON public.organizations
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Organization member rows should not be globally readable. Public directory
-- visibility is only for organizations that explicitly allow it; authenticated
-- org members can still read rows needed by existing member/admin UI.
DROP POLICY IF EXISTS "Allow anyone to read organization members" ON public.organization_members;
DROP POLICY IF EXISTS "Organization members readable by public directory" ON public.organization_members;
DROP POLICY IF EXISTS "Organization members readable by authenticated scope" ON public.organization_members;

CREATE POLICY "Organization members readable by public directory"
  ON public.organization_members
  FOR SELECT
  TO anon
  USING (
    coalesce(is_visible, true)
    AND coalesce(status, 'active') <> 'removed'
    AND EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = organization_members.organization_id
        AND o.show_members_publicly
    )
  );

CREATE POLICY "Organization members readable by authenticated scope"
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.is_org_member(organization_id)
    OR (
      coalesce(is_visible, true)
      AND coalesce(status, 'active') <> 'removed'
      AND EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = organization_members.organization_id
          AND o.show_members_publicly
      )
    )
  );

-- Retarget sheet sync policies from PUBLIC to authenticated. These rows contain
-- external sheet URLs/configuration and should never be considered anonymous API
-- surface.
DROP POLICY IF EXISTS org_sheet_syncs_select_members ON public.organization_sheet_syncs;
DROP POLICY IF EXISTS org_sheet_syncs_insert_admins ON public.organization_sheet_syncs;
DROP POLICY IF EXISTS org_sheet_syncs_update_admins ON public.organization_sheet_syncs;
DROP POLICY IF EXISTS org_sheet_syncs_delete_admins ON public.organization_sheet_syncs;

CREATE POLICY org_sheet_syncs_select_members
  ON public.organization_sheet_syncs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_sheet_syncs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = ANY (ARRAY['admin', 'staff'])
    )
  );

CREATE POLICY org_sheet_syncs_insert_admins
  ON public.organization_sheet_syncs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_sheet_syncs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = 'admin'
    )
  );

CREATE POLICY org_sheet_syncs_update_admins
  ON public.organization_sheet_syncs
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_sheet_syncs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_sheet_syncs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = 'admin'
    )
  );

CREATE POLICY org_sheet_syncs_delete_admins
  ON public.organization_sheet_syncs
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = organization_sheet_syncs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role::text = 'admin'
    )
  );

COMMIT;
