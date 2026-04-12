-- Fix ALL remaining Supabase advisor findings (security + performance)
-- This migration handles every outstanding lint error/warning/info.

BEGIN;

-- ============================================================================
-- SECTION 1: SECURITY ERRORS — Fix SECURITY DEFINER views
-- ============================================================================
-- These views enforce the VIEW CREATOR's permissions instead of the querying
-- user's permissions. Recreate them with security_invoker = true so that
-- the querying user's RLS policies apply.

DROP VIEW IF EXISTS public.waiver_definition_fields_accessible CASCADE;

CREATE VIEW public.waiver_definition_fields_accessible
WITH (security_invoker = true) AS
SELECT
  wdf.id,
  wdf.waiver_definition_id,
  wdf.field_key,
  wdf.field_type,
  wdf.label,
  wdf.required,
  wdf.source,
  wdf.pdf_field_name,
  wdf.page_index,
  wdf.rect,
  wdf.signer_role_key,
  wdf.meta,
  wdf.created_at,
  wdf.updated_at
FROM public.waiver_definition_fields wdf
JOIN public.waiver_definitions wd
  ON wd.id = wdf.waiver_definition_id
WHERE EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = wd.project_id
);

DROP VIEW IF EXISTS public.waiver_definition_signers_accessible CASCADE;

CREATE VIEW public.waiver_definition_signers_accessible
WITH (security_invoker = true) AS
SELECT
  wds.id,
  wds.waiver_definition_id,
  wds.role_key,
  wds.label,
  wds.required,
  wds.order_index,
  wds.rules,
  wds.created_at,
  wds.updated_at
FROM public.waiver_definition_signers wds
JOIN public.waiver_definitions wd
  ON wd.id = wds.waiver_definition_id
WHERE EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = wd.project_id
);


-- ============================================================================
-- SECTION 2: SECURITY WARNINGS — Fix mutable search_path on functions
-- ============================================================================

ALTER FUNCTION public.log_plugin_audit(uuid, text, text, uuid, text, jsonb, integer)
  SET search_path = '';

ALTER FUNCTION public.update_plugin_execution_metrics(uuid, text, integer, boolean, text)
  SET search_path = '';


-- ============================================================================
-- SECTION 3: PERFORMANCE — Fix multiple permissive SELECT policies
-- ============================================================================
-- For each table with reader (FOR SELECT) + writer (FOR ALL):
--   Drop the FOR ALL policy and re-create as FOR INSERT + FOR UPDATE + FOR DELETE.
-- This eliminates the duplicate SELECT evaluation.
--
-- Tables affected:
--          submission_answers, parent_student_links, memberships,
--          judge_assignments, student_profiles, parent_profiles, profile_links
--   Platform: organization_plugin_feature_flags, organization_plugin_installs

-- ---------- organization_plugin_feature_flags ----------
DROP POLICY IF EXISTS "Feature flags manageable by org admins" ON public.organization_plugin_feature_flags;

CREATE POLICY "Feature flags insert by org admins"
  ON public.organization_plugin_feature_flags FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_feature_flags.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = 'admin'
    )
  );

CREATE POLICY "Feature flags update by org admins"
  ON public.organization_plugin_feature_flags FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_feature_flags.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_feature_flags.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = 'admin'
    )
  );

CREATE POLICY "Feature flags delete by org admins"
  ON public.organization_plugin_feature_flags FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_feature_flags.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = 'admin'
    )
  );

-- ---------- organization_plugin_installs ----------
DROP POLICY IF EXISTS "Plugin installs manageable by org admins and staff" ON public.organization_plugin_installs;

CREATE POLICY "Plugin installs insert by org admins and staff"
  ON public.organization_plugin_installs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_installs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = ANY(ARRAY['admin','staff'])
    )
  );

CREATE POLICY "Plugin installs update by org admins and staff"
  ON public.organization_plugin_installs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_installs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = ANY(ARRAY['admin','staff'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_installs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = ANY(ARRAY['admin','staff'])
    )
  );

CREATE POLICY "Plugin installs delete by org admins and staff"
  ON public.organization_plugin_installs FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = organization_plugin_installs.organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role = ANY(ARRAY['admin','staff'])
    )
  );


-- ============================================================================
-- SECTION 4: PERFORMANCE — Fix RLS initplan on remaining SELECT policies
-- ============================================================================
-- Wrap auth.uid() with (select auth.uid()) so Postgres evaluates it once
-- per query instead of once per row.

DO $$
DECLARE
  rec record;
  v_using text;
  v_check text;
  target_policies text[] := ARRAY[
    -- Plugin platform
    'Audit logs readable by org admins',
    'Feature flags readable by org members',
    'Plugin installs readable by org members',
    -- Invitations
    'Org admins and staff can view invitations',
    'Org admins can create invitations',
    'Org admins can update invitations',
    -- Contact imports
    'Org admins can manage contact import jobs',
    'Org admins can manage contact import rows'
  ];
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = ANY(target_policies)
  LOOP
    v_using := rec.qual;
    v_check := rec.with_check;

    IF v_using IS NOT NULL THEN
      v_using := replace(v_using, 'auth.uid()', '(select auth.uid())');
      v_using := replace(v_using, '"auth"."uid"()', '(select auth.uid())');
    END IF;

    IF v_check IS NOT NULL THEN
      v_check := replace(v_check, 'auth.uid()', '(select auth.uid())');
      v_check := replace(v_check, '"auth"."uid"()', '(select auth.uid())');
    END IF;

    IF rec.qual IS DISTINCT FROM v_using
       OR rec.with_check IS DISTINCT FROM v_check THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I %s%s%s',
        rec.policyname,
        rec.schemaname,
        rec.tablename,
        CASE WHEN v_using IS NOT NULL THEN format('USING (%s)', v_using) ELSE '' END,
        CASE WHEN v_using IS NOT NULL AND v_check IS NOT NULL THEN ' ' ELSE '' END,
        CASE WHEN v_check IS NOT NULL THEN format('WITH CHECK (%s)', v_check) ELSE '' END
      );
    END IF;
  END LOOP;
END
$$;


-- ============================================================================
-- SECTION 5: PERFORMANCE — Add missing indexes on foreign key columns
-- ============================================================================












-- organization_contact_import_rows
CREATE INDEX IF NOT EXISTS idx_org_contact_import_rows_invitation_id
  ON public.organization_contact_import_rows (invitation_id);

-- organization_invitations
CREATE INDEX IF NOT EXISTS idx_org_invitations_accepted_by
  ON public.organization_invitations (accepted_by);
CREATE INDEX IF NOT EXISTS idx_org_invitations_invited_by
  ON public.organization_invitations (invited_by);

-- organization_plugin_entitlements
CREATE INDEX IF NOT EXISTS idx_org_plugin_entitlements_created_by
  ON public.organization_plugin_entitlements (created_by);

-- organization_plugin_feature_flags
CREATE INDEX IF NOT EXISTS idx_org_plugin_feature_flags_updated_by
  ON public.organization_plugin_feature_flags (updated_by);

-- organization_plugin_installs
CREATE INDEX IF NOT EXISTS idx_org_plugin_installs_installed_by
  ON public.organization_plugin_installs (installed_by);
CREATE INDEX IF NOT EXISTS idx_org_plugin_installs_updated_by
  ON public.organization_plugin_installs (updated_by);

-- plugins
CREATE INDEX IF NOT EXISTS idx_plugins_updated_by
  ON public.plugins (updated_by);

COMMIT;
