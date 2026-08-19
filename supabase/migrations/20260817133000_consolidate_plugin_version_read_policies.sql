BEGIN;

-- Keep the public release catalog readable without evaluating two permissive
-- SELECT policies for every authenticated request. Anonymous callers may read
-- published releases; authenticated callers may additionally read every
-- release when they are trusted members.
DROP POLICY IF EXISTS "plugin_versions_published_read" ON public.plugin_versions;
DROP POLICY IF EXISTS "plugin_versions_trusted_read" ON public.plugin_versions;
DROP POLICY IF EXISTS "plugin_versions_anon_published_read" ON public.plugin_versions;
DROP POLICY IF EXISTS "plugin_versions_authenticated_read" ON public.plugin_versions;

CREATE POLICY "plugin_versions_anon_published_read"
  ON public.plugin_versions
  FOR SELECT
  TO anon
  USING (status = 'published');

CREATE POLICY "plugin_versions_authenticated_read"
  ON public.plugin_versions
  FOR SELECT
  TO authenticated
  USING (
    status = 'published'
    OR public.is_trusted_member((SELECT auth.uid()))
  );

COMMIT;
