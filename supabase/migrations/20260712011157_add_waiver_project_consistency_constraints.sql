-- The unique indexes were built concurrently in prerequisite migrations. Attaching
-- them as constraints is a metadata-only operation and avoids a long write lock.
ALTER TABLE public.project_signups
  ADD CONSTRAINT project_signups_id_project_id_key
  UNIQUE USING INDEX project_signups_id_project_id_key;

ALTER TABLE public.waiver_definitions
  ADD CONSTRAINT waiver_definitions_id_project_id_key
  UNIQUE USING INDEX waiver_definitions_id_project_id_key;

-- Replace single-column references with tenant-consistent composite references.
-- NOT VALID keeps the blocking lock short; validation scans without blocking
-- normal reads and writes.
ALTER TABLE public.waiver_signatures
  DROP CONSTRAINT waiver_signatures_signup_id_fkey,
  DROP CONSTRAINT waiver_signatures_waiver_definition_id_fkey,
  ADD CONSTRAINT waiver_signatures_signup_project_fkey
    FOREIGN KEY (signup_id, project_id)
    REFERENCES public.project_signups (id, project_id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT waiver_signatures_definition_project_fkey
    FOREIGN KEY (waiver_definition_id, project_id)
    REFERENCES public.waiver_definitions (id, project_id)
    ON DELETE SET NULL (waiver_definition_id)
    NOT VALID;

ALTER TABLE public.waiver_signatures
  VALIDATE CONSTRAINT waiver_signatures_signup_project_fkey;

ALTER TABLE public.waiver_signatures
  VALIDATE CONSTRAINT waiver_signatures_definition_project_fkey;
