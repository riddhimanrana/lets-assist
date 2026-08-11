CREATE OR REPLACE FUNCTION private.waiver_source_storage_object_is_referenced(
  p_object_path text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.waiver_signatures AS signatures
    WHERE signatures.waiver_pdf_storage_path = p_object_path
  ) OR EXISTS (
    SELECT 1
    FROM public.waiver_definitions AS definitions
    WHERE definitions.pdf_storage_path = p_object_path
  );
$$;

REVOKE ALL ON FUNCTION private.waiver_source_storage_object_is_referenced(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.waiver_source_storage_object_is_referenced(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION private.waiver_source_storage_object_is_referenced(text) IS
  'Storage-policy helper that prevents deletion of source PDFs referenced by waiver evidence.';

DROP POLICY IF EXISTS "Project managers can delete project waiver files"
  ON storage.objects;
CREATE POLICY "Project managers can delete project waiver files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'waiver-uploads'
    AND NOT private.waiver_source_storage_object_is_referenced(name)
    AND EXISTS (
      SELECT 1
      FROM public.projects AS projects
      WHERE projects.id = substring(name from '^project_waivers/([0-9a-fA-F-]{36})/')::uuid
        AND public.is_project_organizer(projects.id, (SELECT auth.uid()))
    )
  );
