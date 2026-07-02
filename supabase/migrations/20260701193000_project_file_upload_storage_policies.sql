-- Allow project creators and organization staff to upload project assets.
-- The create-project flow uploads files directly to Storage, then links the
-- public URLs to the project record in a small server action.

BEGIN;

UPDATE storage.buckets
SET
  file_size_limit = 20971520,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg'
  ]::text[],
  updated_at = now()
WHERE id = 'project-documents';

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Project managers can upload project images" ON storage.objects;
    CREATE POLICY "Project managers can upload project images"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'project-images'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can update project images" ON storage.objects;
    CREATE POLICY "Project managers can update project images"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'project-images'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      )
      WITH CHECK (
        bucket_id = 'project-images'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can delete project images" ON storage.objects;
    CREATE POLICY "Project managers can delete project images"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'project-images'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can upload project documents" ON storage.objects;
    CREATE POLICY "Project managers can upload project documents"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'project-documents'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can update project documents" ON storage.objects;
    CREATE POLICY "Project managers can update project documents"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'project-documents'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      )
      WITH CHECK (
        bucket_id = 'project-documents'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can delete project documents" ON storage.objects;
    CREATE POLICY "Project managers can delete project documents"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'project-documents'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_([0-9a-fA-F-]{36})_')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can upload project waiver files" ON storage.objects;
    CREATE POLICY "Project managers can upload project waiver files"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'waiver-uploads'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_waivers/([0-9a-fA-F-]{36})/')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      );

    DROP POLICY IF EXISTS "Project managers can delete project waiver files" ON storage.objects;
    CREATE POLICY "Project managers can delete project waiver files"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'waiver-uploads'
        AND EXISTS (
          SELECT 1
          FROM public.projects p
          WHERE p.id = substring(name from '^project_waivers/([0-9a-fA-F-]{36})/')::uuid
            AND public.is_project_organizer(p.id, (SELECT auth.uid()))
        )
      );
  END IF;
END $$;

COMMIT;
