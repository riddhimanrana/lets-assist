-- An organization role grants no authority after membership is deactivated.
-- Preserve project creators, per-object plugin uploaders, and service_role
-- server paths while closing role-only Storage and project helper predicates.

BEGIN;

CREATE OR REPLACE FUNCTION app_private.is_project_organizer(
  p_project_id uuid,
  p_user uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_user IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.projects AS projects
      WHERE projects.id = p_project_id
        AND (
          projects.creator_id = p_user
          OR (
            projects.organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.organization_members AS members
              WHERE members.organization_id = projects.organization_id
                AND members.user_id = p_user
                AND members.status = 'active'
                AND (
                  members.role = 'admin'
                  OR (
                    members.role = 'staff'
                    AND projects.can_be_managed_by_staff IS TRUE
                  )
                )
            )
          )
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION app_private.is_project_organizer(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_project_organizer(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.can_manage_project(
  p_project_id uuid,
  p_user uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_user IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.projects AS projects
      WHERE projects.id = p_project_id
        AND (
          projects.creator_id = p_user
          OR EXISTS (
            SELECT 1
            FROM public.organization_members AS members
            WHERE members.organization_id = projects.organization_id
              AND members.user_id = p_user
              AND members.status = 'active'
              AND (
                members.role = 'admin'
                OR (
                  members.role = 'staff'
                  AND projects.can_be_managed_by_staff IS TRUE
                )
              )
          )
        )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION app_private.can_manage_project(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_manage_project(uuid, uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can upload organization logos"
  ON storage.objects;
CREATE POLICY "Authenticated users can upload organization logos"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'organization-logos'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS organization_member
      WHERE organization_member.organization_id = split_part(name, '.', 1)::uuid
        AND organization_member.user_id = auth.uid()
        AND organization_member.status = 'active'
        AND organization_member.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can update organization logos"
  ON storage.objects;
CREATE POLICY "Authenticated users can update organization logos"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'organization-logos'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS organization_member
      WHERE organization_member.organization_id = split_part(name, '.', 1)::uuid
        AND organization_member.user_id = auth.uid()
        AND organization_member.status = 'active'
        AND organization_member.role IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    bucket_id = 'organization-logos'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS organization_member
      WHERE organization_member.organization_id = split_part(name, '.', 1)::uuid
        AND organization_member.user_id = auth.uid()
        AND organization_member.status = 'active'
        AND organization_member.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can delete organization logos"
  ON storage.objects;
CREATE POLICY "Authenticated users can delete organization logos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'organization-logos'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS organization_member
      WHERE organization_member.organization_id = split_part(name, '.', 1)::uuid
        AND organization_member.user_id = auth.uid()
        AND organization_member.status = 'active'
        AND organization_member.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Org staff can view their org plugin form files"
  ON storage.objects;
CREATE POLICY "Org staff can view their org plugin form files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'plugin_form_uploads'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS organization_member
      WHERE organization_member.organization_id::text = (string_to_array(name, '/'))[1]
        AND organization_member.user_id = auth.uid()
        AND organization_member.status = 'active'
        AND organization_member.role IN ('admin', 'staff')
    )
  );

-- Refresh only the four reviewed expressions changed above. The live reader
-- deparses under its fixed empty search_path, exactly as the drift gate does.
WITH refreshed_policy(policy_name) AS (
  VALUES
    ('Authenticated users can upload organization logos'::text),
    ('Authenticated users can update organization logos'::text),
    ('Authenticated users can delete organization logos'::text),
    ('Org staff can view their org plugin form files'::text)
)
UPDATE app_private.storage_object_policy_contract AS contract
SET
  command = live.command,
  role_names = live.role_names,
  is_permissive = live.is_permissive,
  using_expression = live.using_expression,
  with_check_expression = live.with_check_expression
FROM refreshed_policy
JOIN app_private.storage_object_policy_live_catalog() AS live
  ON live.policy_name = refreshed_policy.policy_name
WHERE contract.policy_name = refreshed_policy.policy_name;

DO $$
DECLARE
  storage_violation_count integer;
BEGIN
  SELECT count(*)::integer
  INTO storage_violation_count
  FROM app_private.storage_object_policy_contract_violations();

  IF storage_violation_count > 0 THEN
    RAISE EXCEPTION
      'active-membership Storage hardening left % exact contract violation(s)',
      storage_violation_count;
  END IF;
END;
$$;

-- Caller inventory:
-- * audit logs are written only through getAdminClient();
-- * export jobs are inserted/read by the authenticated account workflow;
-- * export job updates are performed only by the service worker;
-- * neither source path issues an export job delete.
REVOKE ALL PRIVILEGES
  ON TABLE public.account_data_export_audit_logs
  FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE
  ON TABLE public.account_data_export_jobs
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.account_data_export_audit_logs
  TO service_role;

CREATE OR REPLACE FUNCTION app_private.client_relation_grant_catalog()
RETURNS TABLE (
  relation_name text,
  role_name text,
  privilege text,
  columns text[]
)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT *
  FROM (
    VALUES
      ('account_data_export_jobs'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('account_data_export_jobs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('anonymous_signups'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('certificate_verification_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('certificate_verification_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('certificates'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('content_flags'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('content_reports'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('content_reports'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('content_reports'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('content_reports'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('feedback'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('notification_settings'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('notifications'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_calendar_events'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_contact_import_jobs'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_contact_import_rows'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_invitation_acceptance_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_invitation_acceptance_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_invitations'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_members'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_members'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_members'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_plugin_access'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_entitlements'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_feature_flags'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_installs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_plugin_routes'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('organization_public_member_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_public_member_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organization_public_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('organization_public_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('organizations'::text, 'anon'::text, 'SELECT'::text, ARRAY['allowed_email_domains', 'created_at', 'description', 'id', 'logo_url', 'name', 'show_members_publicly', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('organizations'::text, 'authenticated'::text, 'INSERT'::text, ARRAY['allowed_email_domains', 'auto_join_domain', 'created_at', 'created_by', 'description', 'id', 'join_code', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'staff_join_token', 'staff_join_token_created_at', 'staff_join_token_expires_at', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'SELECT'::text, ARRAY['allowed_email_domains', 'created_at', 'description', 'id', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'type', 'username', 'verified', 'website']::text[]),
      ('organizations'::text, 'authenticated'::text, 'UPDATE'::text, ARRAY['allowed_email_domains', 'auto_join_domain', 'created_at', 'created_by', 'description', 'id', 'join_code', 'logo_url', 'name', 'setup_checklist_dismissed_at', 'show_members_publicly', 'staff_join_token', 'staff_join_token_created_at', 'staff_join_token_expires_at', 'type', 'username', 'verified', 'website']::text[]),
      ('plugin_audit_logs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugin_runtime_contracts'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugin_versions'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('plugins'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('profiles'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_discovery_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('project_discovery_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_drafts'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_feedback'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('project_paper_roster_entries'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_batches'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_images'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_paper_scan_rows'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_signups'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('project_signups'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('projects'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('projects'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('projects_with_creator'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('projects_with_creator'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('public_profile_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('public_profile_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('system_banners'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('trusted_member'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_calendar_connections'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('user_certificate_read_model'::text, 'anon'::text, 'SELECT'::text, NULL),
      ('user_certificate_read_model'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_emails'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_emails'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('user_plugin_display_preferences'::text, 'authenticated'::text, 'UPDATE'::text, NULL)
  ) AS catalog(relation_name, role_name, privilege, columns);
$$;

REVOKE ALL ON FUNCTION app_private.client_relation_grant_catalog()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.client_relation_grant_catalog()
  TO service_role;

DO $$
DECLARE
  invalid_export_grant_count integer;
BEGIN
  SELECT count(*)::integer
  INTO invalid_export_grant_count
  FROM app_private.client_relation_grant_catalog() AS catalog
  WHERE (
      catalog.relation_name = 'account_data_export_audit_logs'
      AND catalog.role_name = 'authenticated'
    )
    OR (
      catalog.relation_name = 'account_data_export_jobs'
      AND catalog.role_name = 'authenticated'
      AND catalog.privilege NOT IN ('INSERT', 'SELECT')
    );

  IF invalid_export_grant_count > 0 THEN
    RAISE EXCEPTION
      'export relation ACL catalog retains % server-only client grant(s)',
      invalid_export_grant_count;
  END IF;

  IF has_table_privilege(
    'authenticated',
    'public.account_data_export_audit_logs',
    'SELECT'
  )
  OR has_table_privilege(
    'authenticated',
    'public.account_data_export_audit_logs',
    'INSERT'
  )
  OR has_table_privilege(
    'authenticated',
    'public.account_data_export_audit_logs',
    'UPDATE'
  )
  OR has_table_privilege(
    'authenticated',
    'public.account_data_export_audit_logs',
    'DELETE'
  )
  OR NOT has_table_privilege(
    'authenticated',
    'public.account_data_export_jobs',
    'SELECT'
  )
  OR NOT has_table_privilege(
    'authenticated',
    'public.account_data_export_jobs',
    'INSERT'
  )
  OR has_table_privilege(
    'authenticated',
    'public.account_data_export_jobs',
    'UPDATE'
  )
  OR has_table_privilege(
    'authenticated',
    'public.account_data_export_jobs',
    'DELETE'
  ) THEN
    RAISE EXCEPTION
      'export relation effective authenticated ACL does not match caller inventory';
  END IF;
END;
$$;

COMMIT;
