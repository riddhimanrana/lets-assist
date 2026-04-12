-- Migration: Bump existing plugins to version 1.0.0 and seed plugin_versions rows

-- ============================================================
-- 1. Update existing plugin catalog entries to 1.0.0
-- ============================================================

UPDATE public.plugins
SET latest_version = '1.0.0'
WHERE latest_version IS NULL
   OR latest_version = '';

-- ============================================================
-- 2. Seed plugin_versions for existing plugins
-- ============================================================

INSERT INTO public.plugin_versions (plugin_key, version, status, changelog, published_at)
SELECT
  key,
  '1.0.0',
  'published',
  'Initial release',
  now()
FROM public.plugins
WHERE NOT EXISTS (
  SELECT 1 FROM public.plugin_versions pv
  WHERE pv.plugin_key = plugins.key AND pv.version = '1.0.0'
)
ON CONFLICT (plugin_key, version) DO NOTHING;
