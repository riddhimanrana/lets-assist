-- Preserve project and organization scope when an optional reference is removed.
-- Immutable decision receipts and live sync ownership block parent deletion.
-- No rows are deleted, no browser grants change, and no worker is enabled.

BEGIN;

ALTER TABLE public.project_paper_scan_rows
  DROP CONSTRAINT project_paper_scan_rows_match_signup_fkey,
  ADD CONSTRAINT project_paper_scan_rows_match_signup_fkey
    FOREIGN KEY (match_signup_id, project_id)
    REFERENCES public.project_signups (id, project_id)
    ON DELETE SET NULL (match_signup_id),
  DROP CONSTRAINT project_paper_scan_rows_committed_signup_fkey,
  ADD CONSTRAINT project_paper_scan_rows_committed_signup_fkey
    FOREIGN KEY (committed_signup_id, project_id)
    REFERENCES public.project_signups (id, project_id)
    ON DELETE SET NULL (committed_signup_id);

-- Staged decisions can detach optional source pointers without losing their
-- organization. Immutable parent receipts still refuse direct deletion.
ALTER TABLE plugin_data.csf_application_decision_stages
  DROP CONSTRAINT csf_application_decision_stages_source_organization_fkey,
  ADD CONSTRAINT csf_application_decision_stages_source_organization_fkey
    FOREIGN KEY (source_id, organization_id)
    REFERENCES plugin_data.csf_sheet_sources (id, organization_id)
    ON DELETE SET NULL (source_id),
  DROP CONSTRAINT csf_application_decision_stages_import_row_organization_fkey,
  ADD CONSTRAINT csf_application_decision_stages_import_row_organization_fkey
    FOREIGN KEY (import_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id)
    ON DELETE SET NULL (import_row_id),
  DROP CONSTRAINT csf_application_decision_stages_run_organization_fkey,
  ADD CONSTRAINT csf_application_decision_stages_run_organization_fkey
    FOREIGN KEY (last_sync_run_id, organization_id)
    REFERENCES plugin_data.csf_application_decision_sync_runs (id, organization_id)
    ON DELETE SET NULL (last_sync_run_id),
  DROP CONSTRAINT csf_application_decision_stages_release_organization_fkey,
  ADD CONSTRAINT csf_application_decision_stages_release_organization_fkey
    FOREIGN KEY (release_id, organization_id)
    REFERENCES plugin_data.csf_application_decision_releases (id, organization_id)
    ON DELETE SET NULL (release_id);

-- These rows are immutable evidence. A parent delete must fail without trying
-- to rewrite their provenance or invoking their immutability trigger as a side effect.
ALTER TABLE plugin_data.csf_application_decision_sync_rows
  DROP CONSTRAINT csf_application_decision_sync_rows_application_organization_fkey,
  ADD CONSTRAINT csf_application_decision_sync_rows_application_organization_fkey
    FOREIGN KEY (application_id, organization_id)
    REFERENCES plugin_data.csf_term_applications (id, organization_id)
    ON DELETE RESTRICT,
  DROP CONSTRAINT csf_application_decision_sync_rows_import_row_organization_fkey,
  ADD CONSTRAINT csf_application_decision_sync_rows_import_row_organization_fkey
    FOREIGN KEY (import_row_id, organization_id)
    REFERENCES plugin_data.csf_sheet_import_rows (id, organization_id)
    ON DELETE RESTRICT;

ALTER TABLE plugin_data.csf_class_join_codes
  DROP CONSTRAINT csf_class_join_codes_replaces_organization_fkey,
  ADD CONSTRAINT csf_class_join_codes_replaces_organization_fkey
    FOREIGN KEY (replaces_code_id, organization_id)
    REFERENCES plugin_data.csf_class_join_codes (id, organization_id)
    ON DELETE SET NULL (replaces_code_id);

-- A configured sheet sync requires its owner for OAuth and authorization.
-- Keep that requirement explicit until an authorized removal or transfer.
ALTER TABLE public.organization_sheet_syncs
  DROP CONSTRAINT organization_sheet_syncs_created_by_fkey,
  ADD CONSTRAINT organization_sheet_syncs_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles (id)
    ON DELETE RESTRICT;

COMMIT;
