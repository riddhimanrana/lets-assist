-- Create plugin_form_uploads storage bucket if it does not exist
INSERT INTO storage.buckets (id, name, public, "file_size_limit", "allowed_mime_types")
VALUES (
    'plugin_form_uploads',
    'plugin_form_uploads',
    false,
    10485760, -- 10MB limit
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for storage.objects
-- The folder structure is expected to be: {organization_id}/{plugin_key}/{user_id}/{filename}

DO $$
BEGIN
    -- Authenticated Users can upload files if the path identifies them as the uploader
    DROP POLICY IF EXISTS "Authenticated users can upload own plugin form files" ON storage.objects;
    CREATE POLICY "Authenticated users can upload own plugin form files"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'plugin_form_uploads'
        AND auth.uid() IS NOT NULL
        AND (string_to_array(name, '/'))[3] = auth.uid()::text
    );

    -- Authenticated Users can view files they uploaded themselves
    DROP POLICY IF EXISTS "Authenticated users can view own plugin form files" ON storage.objects;
    CREATE POLICY "Authenticated users can view own plugin form files"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'plugin_form_uploads'
        AND auth.uid() IS NOT NULL
        AND (string_to_array(name, '/'))[3] = auth.uid()::text
    );

    -- Organization Staff can view ALL files uploaded within their organization
    DROP POLICY IF EXISTS "Org staff can view their org plugin form files" ON storage.objects;
    CREATE POLICY "Org staff can view their org plugin form files"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'plugin_form_uploads'
        AND auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.organization_id::text = (string_to_array(name, '/'))[1]
              AND om.user_id = auth.uid()
              AND om.role IN ('admin', 'staff')
        )
    );

    -- Authenticated Users can delete files they uploaded themselves
    DROP POLICY IF EXISTS "Authenticated users can delete own plugin form files" ON storage.objects;
    CREATE POLICY "Authenticated users can delete own plugin form files"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'plugin_form_uploads'
        AND auth.uid() IS NOT NULL
        AND (string_to_array(name, '/'))[3] = auth.uid()::text
    );

END $$;
