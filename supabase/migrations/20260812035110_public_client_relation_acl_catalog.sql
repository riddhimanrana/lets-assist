-- AUD-003 (existing-object residue): canonical public client relation grant
-- catalog for architecture gates and pgTAP. Every entry is a reviewed subset of the
-- effective anon/authenticated DML grants captured at 127.0.0.1:54322 on 2026-08-11.

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
      ('account_data_export_audit_logs'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('account_data_export_audit_logs'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('account_data_export_audit_logs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('account_data_export_audit_logs'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
      ('account_data_export_jobs'::text, 'authenticated'::text, 'DELETE'::text, NULL),
      ('account_data_export_jobs'::text, 'authenticated'::text, 'INSERT'::text, NULL),
      ('account_data_export_jobs'::text, 'authenticated'::text, 'SELECT'::text, NULL),
      ('account_data_export_jobs'::text, 'authenticated'::text, 'UPDATE'::text, NULL),
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

CREATE OR REPLACE FUNCTION app_private.client_relation_grant_expected_satisfied_by_actual(
  expected_column_name text,
  actual_column_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN expected_column_name IS NULL THEN actual_column_name IS NULL
    ELSE actual_column_name IS NULL OR actual_column_name = expected_column_name
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.client_relation_grant_actual_covered_by_expected(
  actual_column_name text,
  expected_column_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN actual_column_name IS NULL THEN expected_column_name IS NULL
    ELSE expected_column_name IS NULL OR expected_column_name = actual_column_name
  END;
$$;

REVOKE ALL ON FUNCTION app_private.client_relation_grant_expected_satisfied_by_actual(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.client_relation_grant_actual_covered_by_expected(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.client_relation_grant_expected_satisfied_by_actual(text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION app_private.client_relation_grant_actual_covered_by_expected(text, text)
  TO service_role;

DO $$
DECLARE
  rel record;
  grant_row record;
  grant_sql text;
  preflight_count integer;
  missing_count integer;
  extra_count integer;
  dangerous_count integer;
  public_grant_count integer;
BEGIN
  WITH catalog AS (
    SELECT * FROM app_private.client_relation_grant_catalog()
  ),
  catalog_expanded AS (
    SELECT relation_name, role_name, privilege, NULL::text AS column_name
    FROM catalog
    WHERE columns IS NULL
    UNION ALL
    SELECT c.relation_name, c.role_name, c.privilege, col.column_name
    FROM catalog c
    CROSS JOIN LATERAL unnest(c.columns) AS col(column_name)
    WHERE c.columns IS NOT NULL
  ),
  actual AS (
    SELECT table_name AS relation_name, grantee AS role_name, privilege_type AS privilege, NULL::text AS column_name
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    UNION ALL
    SELECT table_name, grantee, privilege_type, column_name
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  not_effective AS (
    SELECT ce.*
    FROM catalog_expanded ce
    WHERE NOT EXISTS (
      SELECT 1
      FROM actual a
      WHERE a.relation_name = ce.relation_name
        AND a.role_name = ce.role_name
        AND a.privilege = ce.privilege
        AND app_private.client_relation_grant_expected_satisfied_by_actual(
          ce.column_name,
          a.column_name
        )
    )
  )
  SELECT count(*) INTO preflight_count FROM not_effective;

  IF preflight_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL catalog preflight found % grant(s) not currently effective', preflight_count;
  END IF;

  FOR rel IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      rel.relname
    );
  END LOOP;

  FOR grant_row IN
    SELECT *
    FROM app_private.client_relation_grant_catalog()
    ORDER BY relation_name, role_name, privilege, columns
  LOOP
    IF grant_row.columns IS NULL THEN
      grant_sql := format(
        'GRANT %s ON TABLE public.%I TO %I',
        grant_row.privilege,
        grant_row.relation_name,
        grant_row.role_name
      );
    ELSE
      grant_sql := format(
        'GRANT %s (%s) ON TABLE public.%I TO %I',
        grant_row.privilege,
        (
          SELECT string_agg(format('%I', column_name), ', ' ORDER BY column_name)
          FROM unnest(grant_row.columns) AS column_name
        ),
        grant_row.relation_name,
        grant_row.role_name
      );
    END IF;

    EXECUTE grant_sql;
  END LOOP;

  WITH expected AS (
    SELECT relation_name, role_name, privilege, NULL::text AS column_name
    FROM app_private.client_relation_grant_catalog()
    WHERE columns IS NULL
    UNION ALL
    SELECT c.relation_name, c.role_name, c.privilege, col.column_name
    FROM app_private.client_relation_grant_catalog() c
    CROSS JOIN LATERAL unnest(c.columns) AS col(column_name)
    WHERE c.columns IS NOT NULL
  ),
  actual_relation AS (
    SELECT table_name AS relation_name, grantee AS role_name, privilege_type AS privilege, NULL::text AS column_name
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  actual_column AS (
    SELECT cp.table_name AS relation_name, cp.grantee AS role_name, cp.privilege_type AS privilege, cp.column_name
    FROM information_schema.column_privileges cp
    WHERE cp.table_schema = 'public'
      AND cp.grantee IN ('anon', 'authenticated')
      AND cp.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants rt
        WHERE rt.table_schema = cp.table_schema
          AND rt.table_name = cp.table_name
          AND rt.grantee = cp.grantee
          AND rt.privilege_type = cp.privilege_type
      )
  ),
  actual AS (
    SELECT * FROM actual_relation
    UNION ALL
    SELECT * FROM actual_column
  ),
  missing AS (
    SELECT e.*
    FROM expected e
    WHERE NOT EXISTS (
      SELECT 1
      FROM actual a
      WHERE a.relation_name = e.relation_name
        AND a.role_name = e.role_name
        AND a.privilege = e.privilege
        AND app_private.client_relation_grant_expected_satisfied_by_actual(
          e.column_name,
          a.column_name
        )
    )
  ),
  extra AS (
    SELECT a.*
    FROM actual a
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected e
      WHERE e.relation_name = a.relation_name
        AND e.role_name = a.role_name
        AND e.privilege = a.privilege
        AND app_private.client_relation_grant_actual_covered_by_expected(
          a.column_name,
          e.column_name
        )
    )
  )
  SELECT
    (SELECT count(*)::integer FROM missing),
    (SELECT count(*)::integer FROM extra)
  INTO missing_count, extra_count;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation missing % expected grant(s)', missing_count;
  END IF;

  IF extra_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation left % unexpected grant(s)', extra_count;
  END IF;

  SELECT count(*) INTO dangerous_count
  FROM (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl(grantor_oid, grantee_oid, privilege_type, is_grantable)
    JOIN pg_roles grantee ON grantee.oid = acl.grantee_oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND grantee.rolname IN ('anon', 'authenticated')
      AND acl.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) dangerous;

  IF dangerous_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation left % dangerous client grant(s)', dangerous_count;
  END IF;

  SELECT count(*) INTO public_grant_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) acl(grantor_oid, grantee_oid, privilege_type, is_grantable)
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND acl.grantee_oid = 0
    AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

  IF public_grant_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation left % PUBLIC relation grant(s)', public_grant_count;
  END IF;
END;
$$;
