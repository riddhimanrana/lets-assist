-- AUD-009: canonical storage bucket posture catalog for architecture gates and
-- pgTAP. Values were captured from the local Supabase Postgres baseline at
-- 127.0.0.1:54322 on 2026-08-11.

CREATE OR REPLACE FUNCTION app_private.storage_bucket_posture_catalog()
RETURNS TABLE (
  bucket_id text,
  is_public boolean,
  file_size_limit bigint,
  allowed_mime_types text[],
  posture text
)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT *
  FROM (
    VALUES
      (
        'avatars'::text,
        true,
        10485760::bigint,
        ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[],
        'public'::text
      ),
      (
        'organization-logos'::text,
        true,
        10485760::bigint,
        ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[],
        'public'::text
      ),
      (
        'project-images'::text,
        true,
        20971520::bigint,
        ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[],
        'public'::text
      ),
      (
        'project-documents'::text,
        true,
        20971520::bigint,
        ARRAY['application/pdf']::text[],
        'public'::text
      ),
      (
        'waiver-uploads'::text,
        true,
        20971520::bigint,
        ARRAY['application/pdf']::text[],
        'public'::text
      ),
      (
        'waivers'::text,
        true,
        20971520::bigint,
        ARRAY['application/pdf']::text[],
        'public'::text
      ),
      (
        'csf-private'::text,
        false,
        20971520::bigint,
        ARRAY[
          'application/pdf',
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
          'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]::text[],
        'server-only'::text
      ),
      (
        'data-exports'::text,
        false,
        52428800::bigint,
        ARRAY['application/zip']::text[],
        'server-only'::text
      ),
      (
        'waiver-signatures'::text,
        false,
        10485760::bigint,
        ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']::text[],
        'server-only'::text
      ),
      (
        'paper-signup-scans'::text,
        false,
        8388608::bigint,
        ARRAY['image/jpeg', 'image/png', 'image/webp']::text[],
        'private-client'::text
      ),
      (
        'plugin_form_uploads'::text,
        false,
        10485760::bigint,
        ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[],
        'private-client'::text
      )
  ) AS catalog(bucket_id, is_public, file_size_limit, allowed_mime_types, posture);
$$;

REVOKE ALL ON FUNCTION app_private.storage_bucket_posture_catalog()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.storage_bucket_posture_catalog()
  TO service_role;

-- pg_get_expr() deparses names relative to the active search_path. Keep exactly
-- one fixed-search-path reader for both contract capture and later comparison;
-- otherwise a clean replay can report the same policy once missing and once
-- unexpected merely because one side qualifies public/app_private references.
CREATE OR REPLACE FUNCTION app_private.storage_object_policy_live_catalog()
RETURNS TABLE (
  policy_name text,
  command text,
  role_names text[],
  is_permissive boolean,
  using_expression text,
  with_check_expression text,
  is_client_reachable boolean
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH client_roles AS (
    SELECT role_entry.oid
    FROM pg_roles AS role_entry
    WHERE role_entry.rolname IN ('anon', 'authenticated')
  )
  SELECT
    policy.polname::text AS policy_name,
    CASE policy.polcmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      WHEN '*' THEN 'ALL'
      ELSE policy.polcmd::text
    END AS command,
    ARRAY(
      SELECT role_name
      FROM (
        SELECT CASE
          WHEN policy_role.role_oid = 0 THEN 'public'::text
          ELSE policy_role_entry.rolname::text
        END AS role_name
        FROM unnest(policy.polroles) AS policy_role(role_oid)
        LEFT JOIN pg_roles AS policy_role_entry ON policy_role_entry.oid = policy_role.role_oid
      ) AS policy_roles
      ORDER BY role_name COLLATE "C"
    ) AS role_names,
    policy.polpermissive AS is_permissive,
    pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
    pg_get_expr(policy.polwithcheck, policy.polrelid) AS with_check_expression,
    EXISTS (
      SELECT 1
      FROM unnest(policy.polroles) AS policy_role(role_oid)
      CROSS JOIN client_roles
      WHERE CASE
        WHEN policy_role.role_oid = 0 THEN true
        ELSE pg_has_role(client_roles.oid, policy_role.role_oid, 'USAGE')
      END
    ) AS is_client_reachable
  FROM pg_policy AS policy
  WHERE policy.polrelid = 'storage.objects'::regclass;
$$;

REVOKE ALL ON FUNCTION app_private.storage_object_policy_live_catalog()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.storage_object_policy_live_catalog()
  TO service_role;

-- Converge every policy reachable by anon/authenticated, including PUBLIC and
-- inherited-role policies, before recreating the complete reviewed surface.
-- Server-only roles are deliberately untouched; service_role bypasses RLS.
DO $$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policy_name
    FROM app_private.storage_object_policy_live_catalog()
    WHERE is_client_reachable
    ORDER BY policy_name
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', existing_policy.policy_name);
  END LOOP;
END;
$$;

-- Recreate the complete reviewed browser policy surface before snapshotting its
-- canonical pg_policy representation through the same reader used by the gate.
DROP POLICY IF EXISTS "Authenticated users can upload own avatars" ON storage.objects;
CREATE POLICY "Authenticated users can upload own avatars"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '%'
  );

DROP POLICY IF EXISTS "Authenticated users can update own avatars" ON storage.objects;
CREATE POLICY "Authenticated users can update own avatars"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '%'
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '%'
  );

DROP POLICY IF EXISTS "Authenticated users can delete own avatars" ON storage.objects;
CREATE POLICY "Authenticated users can delete own avatars"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '%'
  );

DROP POLICY IF EXISTS "Authenticated users can upload organization logos" ON storage.objects;
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
        AND organization_member.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can update organization logos" ON storage.objects;
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
        AND organization_member.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can delete organization logos" ON storage.objects;
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
        AND organization_member.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can upload own plugin form files" ON storage.objects;
CREATE POLICY "Authenticated users can upload own plugin form files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'plugin_form_uploads'
    AND auth.uid() IS NOT NULL
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Authenticated users can view own plugin form files" ON storage.objects;
CREATE POLICY "Authenticated users can view own plugin form files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'plugin_form_uploads'
    AND auth.uid() IS NOT NULL
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Org staff can view their org plugin form files" ON storage.objects;
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
        AND organization_member.role IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Authenticated users can delete own plugin form files" ON storage.objects;
CREATE POLICY "Authenticated users can delete own plugin form files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'plugin_form_uploads'
    AND auth.uid() IS NOT NULL
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Project managers can upload project images" ON storage.objects;
CREATE POLICY "Project managers can upload project images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-images'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can update project images" ON storage.objects;
CREATE POLICY "Project managers can update project images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-images'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    bucket_id = 'project-images'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can delete project images" ON storage.objects;
CREATE POLICY "Project managers can delete project images"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-images'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can upload project documents" ON storage.objects;
CREATE POLICY "Project managers can upload project documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-documents'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can update project documents" ON storage.objects;
CREATE POLICY "Project managers can update project documents"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    bucket_id = 'project-documents'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can delete project documents" ON storage.objects;
CREATE POLICY "Project managers can delete project documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-documents'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can upload project waiver files" ON storage.objects;
CREATE POLICY "Project managers can upload project waiver files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'waiver-uploads'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_waivers/([0-9a-fA-F-]{36})/')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can delete project waiver files" ON storage.objects;
CREATE POLICY "Project managers can delete project waiver files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'waiver-uploads'
    AND NOT private.waiver_source_storage_object_is_referenced(name)
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^project_waivers/([0-9a-fA-F-]{36})/')::uuid
        AND public.is_project_organizer(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can upload paper signup scans" ON storage.objects;
CREATE POLICY "Project managers can upload paper signup scans"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'paper-signup-scans'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^paper_signups/([0-9a-fA-F-]{36})/')::uuid
        AND app_private.can_manage_project(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can read paper signup scans" ON storage.objects;
CREATE POLICY "Project managers can read paper signup scans"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'paper-signup-scans'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^paper_signups/([0-9a-fA-F-]{36})/')::uuid
        AND app_private.can_manage_project(project.id, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Project managers can delete paper signup scans" ON storage.objects;
CREATE POLICY "Project managers can delete paper signup scans"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'paper-signup-scans'
    AND EXISTS (
      SELECT 1
      FROM public.projects AS project
      WHERE project.id = substring(name from '^paper_signups/([0-9a-fA-F-]{36})/')::uuid
        AND app_private.can_manage_project(project.id, (SELECT auth.uid()))
    )
  );

CREATE TABLE IF NOT EXISTS app_private.storage_object_policy_contract (
  policy_name text PRIMARY KEY,
  command text NOT NULL CHECK (command IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  role_names text[] NOT NULL CHECK (cardinality(role_names) > 0),
  is_permissive boolean NOT NULL,
  using_expression text,
  with_check_expression text,
  bucket_id text NOT NULL
);

TRUNCATE TABLE app_private.storage_object_policy_contract;

REVOKE ALL ON TABLE app_private.storage_object_policy_contract
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE app_private.storage_object_policy_contract
  TO service_role;

WITH reviewed_policy(policy_name, bucket_id) AS (
  VALUES
    ('Authenticated users can upload own avatars'::text, 'avatars'::text),
    ('Authenticated users can update own avatars'::text, 'avatars'::text),
    ('Authenticated users can delete own avatars'::text, 'avatars'::text),
    ('Authenticated users can upload organization logos'::text, 'organization-logos'::text),
    ('Authenticated users can update organization logos'::text, 'organization-logos'::text),
    ('Authenticated users can delete organization logos'::text, 'organization-logos'::text),
    ('Authenticated users can upload own plugin form files'::text, 'plugin_form_uploads'::text),
    ('Authenticated users can view own plugin form files'::text, 'plugin_form_uploads'::text),
    ('Org staff can view their org plugin form files'::text, 'plugin_form_uploads'::text),
    ('Authenticated users can delete own plugin form files'::text, 'plugin_form_uploads'::text),
    ('Project managers can upload project images'::text, 'project-images'::text),
    ('Project managers can update project images'::text, 'project-images'::text),
    ('Project managers can delete project images'::text, 'project-images'::text),
    ('Project managers can upload project documents'::text, 'project-documents'::text),
    ('Project managers can update project documents'::text, 'project-documents'::text),
    ('Project managers can delete project documents'::text, 'project-documents'::text),
    ('Project managers can upload project waiver files'::text, 'waiver-uploads'::text),
    ('Project managers can delete project waiver files'::text, 'waiver-uploads'::text),
    ('Project managers can upload paper signup scans'::text, 'paper-signup-scans'::text),
    ('Project managers can read paper signup scans'::text, 'paper-signup-scans'::text),
    ('Project managers can delete paper signup scans'::text, 'paper-signup-scans'::text)
)
INSERT INTO app_private.storage_object_policy_contract (
  policy_name,
  command,
  role_names,
  is_permissive,
  using_expression,
  with_check_expression,
  bucket_id
)
SELECT
  reviewed_policy.policy_name,
  policy.command,
  policy.role_names,
  policy.is_permissive,
  policy.using_expression,
  policy.with_check_expression,
  reviewed_policy.bucket_id
FROM reviewed_policy
JOIN app_private.storage_object_policy_live_catalog() AS policy
  ON policy.policy_name = reviewed_policy.policy_name;

DO $$
DECLARE
  reviewed_policy_count integer;
BEGIN
  SELECT count(*)::integer
  INTO reviewed_policy_count
  FROM app_private.storage_object_policy_contract;

  IF reviewed_policy_count <> 21 THEN
    RAISE EXCEPTION 'storage objects policy contract captured % of 21 reviewed policies', reviewed_policy_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.storage_object_policy_catalog()
RETURNS TABLE (
  policy_name text,
  command text,
  role_names text[],
  is_permissive boolean,
  using_expression text,
  with_check_expression text,
  bucket_id text
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    contract.policy_name,
    contract.command,
    contract.role_names,
    contract.is_permissive,
    contract.using_expression,
    contract.with_check_expression,
    contract.bucket_id
  FROM app_private.storage_object_policy_contract AS contract;
$$;

REVOKE ALL ON FUNCTION app_private.storage_object_policy_catalog()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.storage_object_policy_catalog()
  TO service_role;

CREATE OR REPLACE FUNCTION app_private.storage_object_policy_contract_violations()
RETURNS TABLE (
  drift_kind text,
  policy_name text,
  command text,
  role_names text[],
  is_permissive boolean,
  using_expression text,
  with_check_expression text
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH expected AS (
    SELECT
      catalog.policy_name,
      catalog.command,
      catalog.role_names,
      catalog.is_permissive,
      catalog.using_expression,
      catalog.with_check_expression
    FROM app_private.storage_object_policy_catalog() AS catalog
  ),
  actual AS (
    SELECT
      policy.policy_name,
      policy.command,
      policy.role_names,
      policy.is_permissive,
      policy.using_expression,
      policy.with_check_expression
    FROM app_private.storage_object_policy_live_catalog() AS policy
    WHERE policy.is_client_reachable
  ),
  missing AS (
    SELECT 'missing'::text AS drift_kind, expected.*
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM actual
      WHERE actual.policy_name = expected.policy_name
        AND actual.command = expected.command
        AND actual.role_names = expected.role_names
        AND actual.is_permissive = expected.is_permissive
        AND actual.using_expression IS NOT DISTINCT FROM expected.using_expression
        AND actual.with_check_expression IS NOT DISTINCT FROM expected.with_check_expression
    )
  ),
  unexpected AS (
    SELECT 'unexpected'::text AS drift_kind, actual.*
    FROM actual
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE expected.policy_name = actual.policy_name
        AND expected.command = actual.command
        AND expected.role_names = actual.role_names
        AND expected.is_permissive = actual.is_permissive
        AND expected.using_expression IS NOT DISTINCT FROM actual.using_expression
        AND expected.with_check_expression IS NOT DISTINCT FROM actual.with_check_expression
    )
  )
  SELECT * FROM missing
  UNION ALL
  SELECT * FROM unexpected;
$$;

REVOKE ALL ON FUNCTION app_private.storage_object_policy_contract_violations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.storage_object_policy_contract_violations()
  TO service_role;

DO $$
DECLARE
  violation_count integer;
BEGIN
  SELECT count(*)::integer
  INTO violation_count
  FROM app_private.storage_object_policy_contract_violations();

  IF violation_count > 0 THEN
    RAISE EXCEPTION 'storage objects policy reconciliation found % exact contract violation(s)', violation_count;
  END IF;
END;
$$;
