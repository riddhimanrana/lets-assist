-- AUD-003 (existing-object residue): canonical public client relation grant
-- catalog for architecture gates and pgTAP. Every entry is a reviewed subset of the
-- effective anon/authenticated DML grants captured at 127.0.0.1:54322 on 2026-08-11.
-- This relation/column ACL layer is intentionally independent of storage.objects
-- policy reconciliation; each security catalog must fail or pass on its own truth.

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

DO $$
DECLARE
  rel record;
  column_acl record;
  grant_row record;
  grant_sql text;
  normalized_privilege text;
  invalid_catalog_count integer;
  preflight_count integer;
  direct_missing_count integer;
  direct_extra_count integer;
  effective_missing_count integer;
  effective_extra_count integer;
  dangerous_count integer;
  public_grant_count integer;
BEGIN
  SELECT count(*)::integer
  INTO invalid_catalog_count
  FROM app_private.client_relation_grant_catalog() AS catalog
  LEFT JOIN pg_roles AS role_entry
    ON role_entry.rolname = catalog.role_name
  LEFT JOIN LATERAL (
    SELECT relation.oid
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = catalog.relation_name
      AND relation.relkind IN ('r', 'p', 'v', 'm')
  ) AS relation ON true
  WHERE catalog.role_name NOT IN ('anon', 'authenticated')
     OR role_entry.oid IS NULL
     OR catalog.privilege NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
     OR (catalog.columns IS NOT NULL AND catalog.privilege = 'DELETE')
     OR (catalog.columns IS NOT NULL AND cardinality(catalog.columns) = 0)
     OR (
       catalog.columns IS NOT NULL
       AND cardinality(catalog.columns) IS DISTINCT FROM (
         SELECT count(DISTINCT catalog_column.column_name)::integer
         FROM unnest(catalog.columns) AS catalog_column(column_name)
       )
     )
     OR relation.oid IS NULL
     OR EXISTS (
       SELECT 1
       FROM unnest(catalog.columns) AS expected_column(column_name)
       LEFT JOIN pg_attribute AS attribute
         ON attribute.attrelid = relation.oid
        AND attribute.attname = expected_column.column_name
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
       WHERE attribute.attrelid IS NULL
     );

  IF invalid_catalog_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL catalog contains % invalid grant(s)', invalid_catalog_count;
  END IF;

  -- This is intentionally an effective-privilege preflight. A reviewed grant
  -- may currently arrive from a table ACL, a column ACL, role membership, or
  -- PUBLIC. We refuse to remove anything unless every reviewed capability is
  -- usable immediately before convergence.
  WITH catalog AS (
    SELECT * FROM app_private.client_relation_grant_catalog()
  ),
  expected AS (
    SELECT relation_name, role_name, privilege, NULL::text AS column_name
    FROM catalog
    WHERE columns IS NULL
    UNION ALL
    SELECT c.relation_name, c.role_name, c.privilege, col.column_name
    FROM catalog c
    CROSS JOIN LATERAL unnest(c.columns) AS col(column_name)
    WHERE c.columns IS NOT NULL
  ),
  not_effective AS (
    SELECT expected.*
    FROM expected
    JOIN pg_roles AS role_entry
      ON role_entry.rolname = expected.role_name
    JOIN pg_class AS relation
      ON relation.relname = expected.relation_name
     AND relation.relkind IN ('r', 'p', 'v', 'm')
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
     AND namespace.nspname = 'public'
    WHERE NOT CASE
      WHEN expected.column_name IS NULL THEN
        has_table_privilege(role_entry.oid, relation.oid, expected.privilege)
      ELSE
        has_column_privilege(
          role_entry.oid,
          relation.oid,
          expected.column_name,
          expected.privilege
        )
      END
  )
  SELECT count(*)::integer
  INTO preflight_count
  FROM not_effective;

  IF preflight_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL catalog preflight found % grant(s) not currently effective', preflight_count;
  END IF;

  -- Relation-level REVOKE does not touch independent pg_attribute.attacl
  -- entries. Remove both layers explicitly before restoring the catalog.
  FOR rel IN
    SELECT namespace.nspname, relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
    ORDER BY relation.relname
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, %I, %I',
      rel.nspname,
      rel.relname,
      'anon',
      'authenticated'
    );
  END LOOP;

  FOR column_acl IN
    SELECT
      namespace.nspname,
      relation.relname,
      attribute.attname,
      acl.privilege_type
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
    LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
    GROUP BY
      namespace.nspname,
      relation.relname,
      attribute.attnum,
      attribute.attname,
      acl.privilege_type
    ORDER BY relation.relname, attribute.attnum, acl.privilege_type
  LOOP
    normalized_privilege := CASE column_acl.privilege_type
      WHEN 'SELECT' THEN 'SELECT'
      WHEN 'INSERT' THEN 'INSERT'
      WHEN 'UPDATE' THEN 'UPDATE'
      WHEN 'REFERENCES' THEN 'REFERENCES'
      ELSE NULL
    END;

    IF normalized_privilege IS NULL THEN
      RAISE EXCEPTION 'public client column ACL contains unsafe privilege %', column_acl.privilege_type;
    END IF;

    EXECUTE format(
      'REVOKE %s (%I) ON TABLE %I.%I FROM PUBLIC, %I, %I',
      normalized_privilege,
      column_acl.attname,
      column_acl.nspname,
      column_acl.relname,
      'anon',
      'authenticated'
    );
  END LOOP;

  FOR grant_row IN
    SELECT *
    FROM app_private.client_relation_grant_catalog()
    ORDER BY relation_name, role_name, privilege, columns
  LOOP
    normalized_privilege := CASE grant_row.privilege
      WHEN 'SELECT' THEN 'SELECT'
      WHEN 'INSERT' THEN 'INSERT'
      WHEN 'UPDATE' THEN 'UPDATE'
      WHEN 'DELETE' THEN 'DELETE'
      ELSE NULL
    END;

    IF normalized_privilege IS NULL THEN
      RAISE EXCEPTION 'client relation ACL catalog contains unsafe privilege %', grant_row.privilege;
    END IF;

    IF grant_row.columns IS NULL THEN
      grant_sql := format(
        'GRANT %s ON TABLE %I.%I TO %I',
        normalized_privilege,
        'public',
        grant_row.relation_name,
        grant_row.role_name
      );
    ELSE
      grant_sql := format(
        'GRANT %s (%s) ON TABLE %I.%I TO %I',
        normalized_privilege,
        (
          SELECT string_agg(
            format('%I', grant_column.column_name),
            ', '
            ORDER BY grant_column.column_name
          )
          FROM unnest(grant_row.columns) AS grant_column(column_name)
        ),
        'public',
        grant_row.relation_name,
        grant_row.role_name
      );
    END IF;

    EXECUTE grant_sql;
  END LOOP;

  -- Compare raw relation and column ACLs independently. The standards view
  -- expands a whole-table grant into one row per column and therefore cannot
  -- distinguish an independent attacl entry hiding beside it.
  WITH expected AS (
    SELECT relation_name, role_name, privilege, NULL::text AS column_name
    FROM app_private.client_relation_grant_catalog()
    WHERE columns IS NULL
    UNION ALL
    SELECT catalog.relation_name, catalog.role_name, catalog.privilege, expected_column.column_name
    FROM app_private.client_relation_grant_catalog() AS catalog
    CROSS JOIN LATERAL unnest(catalog.columns) AS expected_column(column_name)
    WHERE catalog.columns IS NOT NULL
  ),
  actual AS (
    SELECT
      relation.relname::text AS relation_name,
      grantee.rolname::text AS role_name,
      acl.privilege_type AS privilege,
      NULL::text AS column_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
    JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
      AND grantee.rolname IN ('anon', 'authenticated')
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    UNION ALL
    SELECT
      relation.relname::text,
      grantee.rolname::text,
      acl.privilege_type,
      attribute.attname::text
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
    JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND grantee.rolname IN ('anon', 'authenticated')
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
  ),
  missing AS (
    SELECT expected.*
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM actual
      WHERE actual.relation_name = expected.relation_name
        AND actual.role_name = expected.role_name
        AND actual.privilege = expected.privilege
        AND actual.column_name IS NOT DISTINCT FROM expected.column_name
    )
  ),
  extra AS (
    SELECT actual.*
    FROM actual
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE expected.relation_name = actual.relation_name
        AND expected.role_name = actual.role_name
        AND expected.privilege = actual.privilege
        AND expected.column_name IS NOT DISTINCT FROM actual.column_name
    )
  )
  SELECT
    (SELECT count(*)::integer FROM missing),
    (SELECT count(*)::integer FROM extra)
  INTO direct_missing_count, direct_extra_count;

  IF direct_missing_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation missing % direct catalog grant(s)', direct_missing_count;
  END IF;

  IF direct_extra_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation left % unexpected direct grant(s)', direct_extra_count;
  END IF;

  -- A second comparison uses has_*_privilege so PUBLIC and inherited grants are
  -- included. Whole-table privileges are represented once at relation level;
  -- column rows are emitted only when no whole-table privilege covers them.
  WITH expected AS (
    SELECT relation_name, role_name, privilege, NULL::text AS column_name
    FROM app_private.client_relation_grant_catalog()
    WHERE columns IS NULL
    UNION ALL
    SELECT catalog.relation_name, catalog.role_name, catalog.privilege, expected_column.column_name
    FROM app_private.client_relation_grant_catalog() AS catalog
    CROSS JOIN LATERAL unnest(catalog.columns) AS expected_column(column_name)
    WHERE catalog.columns IS NOT NULL
  ),
  client_roles AS (
    SELECT oid, rolname::text AS role_name
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
  ),
  relations AS (
    SELECT relation.oid, relation.relname::text AS relation_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
  ),
  dml_privileges(privilege) AS (
    VALUES ('SELECT'::text), ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)
  ),
  actual AS (
    SELECT
      relations.relation_name,
      client_roles.role_name,
      dml_privileges.privilege,
      NULL::text AS column_name
    FROM relations
    CROSS JOIN client_roles
    CROSS JOIN dml_privileges
    WHERE has_table_privilege(client_roles.oid, relations.oid, dml_privileges.privilege)
    UNION ALL
    SELECT
      relations.relation_name,
      client_roles.role_name,
      dml_privileges.privilege,
      attribute.attname::text
    FROM relations
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = relations.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN client_roles
    CROSS JOIN dml_privileges
    WHERE dml_privileges.privilege IN ('SELECT', 'INSERT', 'UPDATE')
      AND NOT has_table_privilege(client_roles.oid, relations.oid, dml_privileges.privilege)
      AND has_column_privilege(
        client_roles.oid,
        relations.oid,
        attribute.attnum,
        dml_privileges.privilege
      )
  ),
  missing AS (
    SELECT expected.*
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM actual
      WHERE actual.relation_name = expected.relation_name
        AND actual.role_name = expected.role_name
        AND actual.privilege = expected.privilege
        AND actual.column_name IS NOT DISTINCT FROM expected.column_name
    )
  ),
  extra AS (
    SELECT actual.*
    FROM actual
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE expected.relation_name = actual.relation_name
        AND expected.role_name = actual.role_name
        AND expected.privilege = actual.privilege
        AND expected.column_name IS NOT DISTINCT FROM actual.column_name
    )
  )
  SELECT
    (SELECT count(*)::integer FROM missing),
    (SELECT count(*)::integer FROM extra)
  INTO effective_missing_count, effective_extra_count;

  IF effective_missing_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation missing % effective catalog grant(s)', effective_missing_count;
  END IF;

  IF effective_extra_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation left % unexpected effective grant(s)', effective_extra_count;
  END IF;

  WITH client_roles AS (
    SELECT oid
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
  ),
  relations AS (
    SELECT relation.oid
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
  ),
  dangerous_table_privileges(privilege) AS (
    VALUES
      ('TRUNCATE'::text),
      ('REFERENCES'::text),
      ('TRIGGER'::text),
      ('MAINTAIN'::text)
  ),
  dangerous AS (
    SELECT 1
    FROM relations
    CROSS JOIN client_roles
    CROSS JOIN dangerous_table_privileges
    WHERE has_table_privilege(
      client_roles.oid,
      relations.oid,
      dangerous_table_privileges.privilege
    )
    UNION ALL
    SELECT 1
    FROM relations
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = relations.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN client_roles
    WHERE NOT has_table_privilege(client_roles.oid, relations.oid, 'REFERENCES')
      AND has_column_privilege(client_roles.oid, relations.oid, attribute.attnum, 'REFERENCES')
  )
  SELECT count(*)::integer INTO dangerous_count FROM dangerous;

  IF dangerous_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation left % dangerous effective client grant(s)', dangerous_count;
  END IF;

  SELECT count(*)::integer
  INTO public_grant_count
  FROM (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
      AND acl.grantee = 0
    UNION ALL
    SELECT 1
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND acl.grantee = 0
  ) AS public_grants;

  IF public_grant_count > 0 THEN
    RAISE EXCEPTION 'client relation ACL reconciliation left % PUBLIC relation/column grant(s)', public_grant_count;
  END IF;
END;
$$;
