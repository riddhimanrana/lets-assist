-- Production review follow-up:
--   1. Give every paper-scan extraction an ownership token so a losing or
--      crashed request cannot clear, populate, or fail another request's rows.
--   2. Reassert the reviewed service-role-only ACL after three CSF function
--      replacements. Function replacement preserves old ACLs, but every
--      replacement must still declare the boundary explicitly.

ALTER TABLE public.project_paper_scan_batches
  ADD COLUMN extraction_claim_id uuid;

COMMENT ON COLUMN public.project_paper_scan_batches.extraction_claim_id IS
  'Per-request ownership token for an extracting batch. Every terminal extraction write compares this token so a concurrent or stale worker cannot mutate another worker''s batch.';

ALTER TABLE public.project_paper_scan_batches
  ADD CONSTRAINT project_paper_scan_batches_extraction_claim_shape
  CHECK (status = 'extracting' OR extraction_claim_id IS NULL) NOT VALID;

ALTER TABLE public.project_paper_scan_batches
  VALIDATE CONSTRAINT project_paper_scan_batches_extraction_claim_shape;

REVOKE ALL ON FUNCTION plugin_data.csf_append_import_preview_rows(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_append_import_preview_rows(
  uuid, uuid, uuid, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  uuid, uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_apply_import_annotation_interpretation(
  uuid, uuid, text, text, uuid
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_refresh_sheet_source_evidence(
  uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plugin_data.csf_refresh_sheet_source_evidence(
  uuid, uuid, uuid, uuid, bigint, text, text, timestamptz, text, boolean, text, text
) TO service_role;
