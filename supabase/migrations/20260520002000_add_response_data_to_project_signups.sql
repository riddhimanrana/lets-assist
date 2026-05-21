-- Store signup form responses on project signups.
ALTER TABLE public.project_signups
ADD COLUMN IF NOT EXISTS response_data jsonb;

COMMENT ON COLUMN public.project_signups.response_data IS
  'Submitted signup form response payload for project signups.';

NOTIFY pgrst, 'reload schema';
