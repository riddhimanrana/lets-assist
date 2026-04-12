-- Store extra imported profile data on import rows and user profiles

ALTER TABLE public.organization_contact_import_rows
	ADD COLUMN IF NOT EXISTS profile_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.profiles
	ADD COLUMN IF NOT EXISTS profile_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
