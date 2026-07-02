-- Database hardening, RLS verification, and Waiver JSONB consolidation.
-- Re-grants SELECT access to consolidated view, denormalizes organization_id on tournament entries,
-- protects invitations from token scraping, and schedules background cron automation.

BEGIN;

-- ============================================================================
-- 1. CONSOLIDATE WAIVER DEFINITION CHILD TABLES INTO JSONB
-- ============================================================================

-- Add JSONB columns to public.waiver_definitions
ALTER TABLE public.waiver_definitions
  ADD COLUMN IF NOT EXISTS signers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.waiver_definitions.signers IS 'Signer roles array: [{role_key, label, required, order_index, rules}]';
COMMENT ON COLUMN public.waiver_definitions.fields IS 'Field overlays array: [{field_key, field_type, label, required, source, pdf_field_name, page_index, rect, signer_role_key, meta}]';

-- Drop dependent views
DROP VIEW IF EXISTS public.waiver_definition_signers_accessible CASCADE;
DROP VIEW IF EXISTS public.waiver_definition_fields_accessible CASCADE;

-- Drop child tables
DROP TABLE IF EXISTS public.waiver_definition_signers CASCADE;
DROP TABLE IF EXISTS public.waiver_definition_fields CASCADE;


-- ============================================================================
-- 2. HARDEN ORGANIZATION INVITATIONS SELECT POLICY (INTRUDER PREVENTION)
-- ============================================================================

-- Revoke loose select policy that leaked all invitations to any anon/authenticated client
DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.organization_invitations;

-- Create hardened policy requiring invitation token match via request headers
CREATE POLICY "Anyone can read invitation by token"
  ON public.organization_invitations
  FOR SELECT
  TO authenticated, anon
  USING (
    token = COALESCE(
      NULLIF(current_setting('request.headers', true)::jsonb->>'x-invitation-token', ''),
      '00000000-0000-0000-0000-000000000000'
    )::uuid
  );


-- ============================================================================
-- 3. HARDEN TOURNAMENT ENTRIES & DENORMALIZE ORGANIZATION_ID FOR RLS SPEEDUP
-- ============================================================================

-- Denormalize organization_id to dv_sd_tournament_entries
ALTER TABLE plugin_data.dv_sd_tournament_entries
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Populate organization_id from the linked tournament
UPDATE plugin_data.dv_sd_tournament_entries e
SET organization_id = t.organization_id
FROM plugin_data.dv_sd_tournaments t
WHERE e.tournament_id = t.id
  AND e.organization_id IS NULL;

-- Enforce NOT NULL for schema integrity
ALTER TABLE plugin_data.dv_sd_tournament_entries
  ALTER COLUMN organization_id SET NOT NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_dv_sd_entries_org ON plugin_data.dv_sd_tournament_entries(organization_id);

-- Drop old subquery-heavy RLS policies
DROP POLICY IF EXISTS dv_sd_entries_read ON plugin_data.dv_sd_tournament_entries;
DROP POLICY IF EXISTS dv_sd_entries_insert ON plugin_data.dv_sd_tournament_entries;
DROP POLICY IF EXISTS dv_sd_entries_update ON plugin_data.dv_sd_tournament_entries;
DROP POLICY IF EXISTS dv_sd_entries_delete ON plugin_data.dv_sd_tournament_entries;

-- Recreate RLS policies using denormalized organization_id (much faster, no subqueries!)
CREATE POLICY "dv_sd_entries_read" ON plugin_data.dv_sd_tournament_entries
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.is_org_staff_or_admin(organization_id)
  );

CREATE POLICY "dv_sd_entries_insert" ON plugin_data.dv_sd_tournament_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.is_org_member(organization_id)
  );

CREATE POLICY "dv_sd_entries_update" ON plugin_data.dv_sd_tournament_entries
  FOR UPDATE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id))
  WITH CHECK (private.is_org_staff_or_admin(organization_id));

CREATE POLICY "dv_sd_entries_delete" ON plugin_data.dv_sd_tournament_entries
  FOR DELETE TO authenticated
  USING (private.is_org_staff_or_admin(organization_id));


-- ============================================================================
-- 4. RE-GRANT PRIVILEGES ON RECREATED VIEW (RESOLVE PERMISSION DENIED)
-- ============================================================================

GRANT SELECT ON public.organization_plugin_access TO authenticated;
GRANT SELECT ON public.organization_plugin_access TO service_role;


-- ============================================================================
-- 5. CONSOLIDATE AUTOMATION ENTRYPOINTS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.checkin_signups()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    PERFORM public.process_automatic_check_ins();
END;
$$;

CREATE OR REPLACE FUNCTION public.checkout_signups()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    PERFORM public.process_automatic_check_outs();
END;
$$;


-- ============================================================================
-- 6. ENABLE PG_CRON AND REGISTER BACKGROUND TASKS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Safely clear old jobs if they exist to prevent duplicates
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'cron' AND table_name = 'job') THEN
        PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('process-automatic-check-ins', 'process-automatic-check-outs');
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Ignore in environments where cron schema is present but locked
END $$;

-- Register the cron jobs
SELECT cron.schedule('process-automatic-check-ins', '* * * * *', 'SELECT public.process_automatic_check_ins()');
SELECT cron.schedule('process-automatic-check-outs', '* * * * *', 'SELECT public.process_automatic_check_outs()');

COMMIT;
