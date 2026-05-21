-- Store project signup form schemas in the projects table.
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS signup_form_schema jsonb;

COMMENT ON COLUMN public.projects.signup_form_schema IS
  'Signup form schema used by project details and signup flows.';

NOTIFY pgrst, 'reload schema';
