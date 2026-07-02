UPDATE public.projects
SET require_login = false
WHERE verification_method = 'signup-only'
  AND require_login IS TRUE;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_signup_only_no_login_required
  CHECK (verification_method <> 'signup-only' OR require_login IS FALSE)
  NOT VALID;

ALTER TABLE public.projects
  VALIDATE CONSTRAINT projects_signup_only_no_login_required;

CREATE INDEX IF NOT EXISTS idx_organization_sheet_syncs_auto_due
  ON public.organization_sheet_syncs (auto_sync, last_synced_at)
  WHERE auto_sync IS TRUE;
