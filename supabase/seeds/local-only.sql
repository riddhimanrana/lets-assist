-- Data-only local reset seed.
-- Schema, RLS, functions, storage buckets, and plugin catalog structure belong
-- in migrations so `supabase db reset` proves the production migration chain.

INSERT INTO public.plugins (
  key,
  name,
  description,
  visibility,
  is_active,
  latest_version,
  private_codebase
)
VALUES (
  'dv-speech-debate',
  'DV Speech & Debate',
  'Temporarily disabled while the plugin_data backend is redesigned for server-only access.',
  'private',
  false,
  '2.0.0',
  true
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  visibility = EXCLUDED.visibility,
  is_active = EXCLUDED.is_active,
  latest_version = EXCLUDED.latest_version,
  private_codebase = EXCLUDED.private_codebase,
  updated_at = now();

INSERT INTO public.plugins (
  key,
  name,
  description,
  visibility,
  is_active,
  latest_version,
  private_codebase,
  metadata
)
VALUES (
  'dvhs-csf',
  'DVHS CSF',
  'Private CSF workflow system for cohort membership, applications, officer roles, points, posts, and sheets.',
  'private',
  true,
  '0.1.0',
  true,
  jsonb_build_object('privacyMode', 'strict-minor-safe', 'defaultOwnerEmails', jsonb_build_array('dvhighcsf@gmail.com'))
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  visibility = EXCLUDED.visibility,
  is_active = EXCLUDED.is_active,
  latest_version = EXCLUDED.latest_version,
  private_codebase = EXCLUDED.private_codebase,
  metadata = public.plugins.metadata || EXCLUDED.metadata,
  updated_at = now();
