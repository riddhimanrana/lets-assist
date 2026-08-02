-- Close the catalog-level architecture gaps exposed by the final CSF replay.
-- This migration changes no application authority: it preserves the calendar
-- predicates, makes the existing tenant relationships structural, and adds
-- leading tenant indexes for the continuation's server-only CSF ledgers.

BEGIN;

-- Keep the recovery-foundation calendar write policies semantically identical,
-- but evaluate the authenticated user once per statement. This is the standard
-- Supabase RLS shape and avoids a per-row auth.uid() init plan.
DROP POLICY IF EXISTS "Org admins/staff can create calendar events"
  ON public.organization_calendar_events;
CREATE POLICY "Org admins/staff can create calendar events"
  ON public.organization_calendar_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    source_kind = 'project_schedule'
    AND project_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = (SELECT auth.uid())
        AND om.organization_id = organization_calendar_events.organization_id
        AND om.status = 'active'
        AND om.role::text IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Org admins/staff can update calendar events"
  ON public.organization_calendar_events;
CREATE POLICY "Org admins/staff can update calendar events"
  ON public.organization_calendar_events
  FOR UPDATE
  TO authenticated
  USING (
    source_kind = 'project_schedule'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = (SELECT auth.uid())
        AND om.organization_id = organization_calendar_events.organization_id
        AND om.status = 'active'
        AND om.role::text IN ('admin', 'staff')
    )
  )
  WITH CHECK (
    source_kind = 'project_schedule'
    AND project_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = (SELECT auth.uid())
        AND om.organization_id = organization_calendar_events.organization_id
        AND om.status = 'active'
        AND om.role::text IN ('admin', 'staff')
    )
  );

DROP POLICY IF EXISTS "Org admins/staff can delete calendar events"
  ON public.organization_calendar_events;
CREATE POLICY "Org admins/staff can delete calendar events"
  ON public.organization_calendar_events
  FOR DELETE
  TO authenticated
  USING (
    source_kind = 'project_schedule'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = (SELECT auth.uid())
        AND om.organization_id = organization_calendar_events.organization_id
        AND om.status = 'active'
        AND om.role::text IN ('admin', 'staff')
    )
  );

-- These transaction-local ledgers name a closure, semester, and tenant. Bind
-- all three together so a malformed or cross-tenant authorization row cannot
-- satisfy the close/reopen lifecycle triggers.
ALTER TABLE plugin_data.csf_term_close_authorizations
  ADD CONSTRAINT csf_term_close_auth_closure_tenant_fkey
  FOREIGN KEY (closure_id, organization_id, term_id)
  REFERENCES plugin_data.csf_term_closures (id, organization_id, term_id)
  ON DELETE CASCADE;

ALTER TABLE plugin_data.csf_term_reopen_authorizations
  ADD CONSTRAINT csf_term_reopen_auth_closure_tenant_fkey
  FOREIGN KEY (closure_id, organization_id, term_id)
  REFERENCES plugin_data.csf_term_closures (id, organization_id, term_id)
  ON DELETE CASCADE;

CREATE INDEX csf_term_close_authorizations_org_idx
  ON plugin_data.csf_term_close_authorizations (
    organization_id, transaction_id, term_id
  );

CREATE INDEX csf_term_reopen_authorizations_org_idx
  ON plugin_data.csf_term_reopen_authorizations (
    organization_id, transaction_id, term_id
  );

CREATE INDEX csf_import_cleanup_recovery_org_idx
  ON plugin_data.csf_import_cleanup_recovery (
    organization_id, recover_after
  );

CREATE INDEX csf_sheet_import_staging_claims_org_idx
  ON plugin_data.csf_sheet_import_staging_claims (
    organization_id, staging_object_id, lease_expires_at
  );

CREATE INDEX csf_sheet_import_staging_objects_org_idx
  ON plugin_data.csf_sheet_import_staging_objects (
    organization_id, source_id, generation
  );

CREATE INDEX csf_sheet_source_evidence_tokens_org_idx
  ON plugin_data.csf_sheet_source_evidence_tokens (
    organization_id, source_id, expires_at
  );

CREATE INDEX csf_storage_deletion_queue_org_idx
  ON plugin_data.csf_storage_deletion_queue (
    organization_id, enqueued_at
  );

CREATE INDEX csf_personal_calendar_operations_org_idx
  ON plugin_data.csf_personal_calendar_operations (
    organization_id, user_id, started_at DESC
  );

CREATE INDEX user_google_oauth_connection_bindings_org_idx
  ON public.user_google_oauth_connection_bindings (
    organization_id, connection_id
  )
  WHERE organization_id IS NOT NULL;

COMMIT;
