-- Cancelling a signup is a soft state transition. Signed evidence must not be
-- erased by ordinary parent-row deletion or project deletion cascades; only the
-- explicit retention cleanup may delete waiver_signatures first.
ALTER TABLE public.project_signups
  DROP CONSTRAINT project_signups_status_check,
  ADD CONSTRAINT project_signups_status_check
    CHECK (status IN ('approved', 'attended', 'rejected', 'pending', 'cancelled'));

ALTER TABLE public.waiver_signatures
  DROP CONSTRAINT waiver_signatures_project_id_fkey,
  DROP CONSTRAINT waiver_signatures_signup_project_fkey,
  ADD CONSTRAINT waiver_signatures_project_id_fkey
    FOREIGN KEY (project_id)
    REFERENCES public.projects(id)
    ON DELETE NO ACTION
    NOT VALID,
  ADD CONSTRAINT waiver_signatures_signup_project_fkey
    FOREIGN KEY (signup_id, project_id)
    REFERENCES public.project_signups(id, project_id)
    ON DELETE NO ACTION
    NOT VALID;

ALTER TABLE public.waiver_signatures
  VALIDATE CONSTRAINT waiver_signatures_project_id_fkey;

ALTER TABLE public.waiver_signatures
  VALIDATE CONSTRAINT waiver_signatures_signup_project_fkey;
