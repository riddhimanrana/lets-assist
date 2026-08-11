-- Temporarily disable the DV Speech & Debate plugin while plugin_data is moved
-- out of the public Data API and the plugin backend is redesigned.

BEGIN;

UPDATE public.plugins
SET
  is_active = false,
  description = 'Temporarily disabled while the plugin_data backend is redesigned for server-only access.',
  updated_at = now()
WHERE key = 'dv-speech-debate';

UPDATE public.organization_plugin_installs
SET
  enabled = false,
  updated_at = now()
WHERE plugin_key = 'dv-speech-debate';

UPDATE public.organization_plugin_data_boundaries
SET
  boundary_status = 'disabled',
  direct_client_access = 'blocked',
  notes = coalesce(notes || E'\n', '') || 'DV temporarily disabled during plugin_data server-only redesign.',
  updated_at = now()
WHERE plugin_key = 'dv-speech-debate';

COMMIT;
