-- Avatar uploads and removals rely on storage.objects RLS policies.
-- The profile upload flow stores files using a filename prefixed with the user's UUID,
-- so we restrict write/delete access to objects in the avatars bucket whose names start
-- with the authenticated user's id.

DO $$
BEGIN
	-- Public read access for avatar images.
	DROP POLICY IF EXISTS "Public can read avatars" ON storage.objects;
	CREATE POLICY "Public can read avatars"
	ON storage.objects
	FOR SELECT
	USING (bucket_id = 'avatars');

	-- Authenticated users can upload their own avatar file.
	DROP POLICY IF EXISTS "Authenticated users can upload own avatars" ON storage.objects;
	CREATE POLICY "Authenticated users can upload own avatars"
	ON storage.objects
	FOR INSERT
	TO authenticated
	WITH CHECK (
		bucket_id = 'avatars'
		AND auth.uid() IS NOT NULL
		AND name LIKE auth.uid()::text || '%'
	);

	-- Authenticated users can update their own avatar file if needed.
	DROP POLICY IF EXISTS "Authenticated users can update own avatars" ON storage.objects;
	CREATE POLICY "Authenticated users can update own avatars"
	ON storage.objects
	FOR UPDATE
	TO authenticated
	USING (
		bucket_id = 'avatars'
		AND auth.uid() IS NOT NULL
		AND name LIKE auth.uid()::text || '%'
	)
	WITH CHECK (
		bucket_id = 'avatars'
		AND auth.uid() IS NOT NULL
		AND name LIKE auth.uid()::text || '%'
	);

	-- Authenticated users can delete their own avatar file.
	DROP POLICY IF EXISTS "Authenticated users can delete own avatars" ON storage.objects;
	CREATE POLICY "Authenticated users can delete own avatars"
	ON storage.objects
	FOR DELETE
	TO authenticated
	USING (
		bucket_id = 'avatars'
		AND auth.uid() IS NOT NULL
		AND name LIKE auth.uid()::text || '%'
	);
END $$;
