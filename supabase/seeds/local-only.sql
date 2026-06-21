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
  'Seasonal membership, tournament, guardian judging, and operations workspace.',
  'private',
  true,
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
