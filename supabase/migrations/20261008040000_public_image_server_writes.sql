-- Public images pass server decoding and durable cleanup reservation before upload.
-- Restrictive policies also reject a future permissive policy that grants too much.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app_private.storage_object_policy_contract_violations()) THEN
    RAISE EXCEPTION 'Storage policy drift must be resolved before image write hardening.';
  END IF;
END $$;

DROP POLICY "Authenticated users can upload own avatars" ON storage.objects;
DROP POLICY "Authenticated users can update own avatars" ON storage.objects;
DROP POLICY "Authenticated users can delete own avatars" ON storage.objects;
DROP POLICY "Authenticated users can upload organization logos" ON storage.objects;
DROP POLICY "Authenticated users can update organization logos" ON storage.objects;
DROP POLICY "Authenticated users can delete organization logos" ON storage.objects;

CREATE POLICY "Server owns avatar inserts" ON storage.objects AS RESTRICTIVE
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id <> 'avatars');
CREATE POLICY "Server owns avatar updates" ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (bucket_id <> 'avatars') WITH CHECK (bucket_id <> 'avatars');
CREATE POLICY "Server owns avatar deletes" ON storage.objects AS RESTRICTIVE
  FOR DELETE TO anon, authenticated USING (bucket_id <> 'avatars');
CREATE POLICY "Server owns organization logo inserts" ON storage.objects AS RESTRICTIVE
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id <> 'organization-logos');
CREATE POLICY "Server owns organization logo updates" ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (bucket_id <> 'organization-logos') WITH CHECK (bucket_id <> 'organization-logos');
CREATE POLICY "Server owns organization logo deletes" ON storage.objects AS RESTRICTIVE
  FOR DELETE TO anon, authenticated USING (bucket_id <> 'organization-logos');

DELETE FROM app_private.storage_object_policy_contract WHERE policy_name IN (
  'Authenticated users can upload own avatars',
  'Authenticated users can update own avatars',
  'Authenticated users can delete own avatars',
  'Authenticated users can upload organization logos',
  'Authenticated users can update organization logos',
  'Authenticated users can delete organization logos'
);

INSERT INTO app_private.storage_object_policy_contract (
  policy_name, command, role_names, is_permissive, using_expression, with_check_expression, bucket_id
)
SELECT live.policy_name, live.command, live.role_names, live.is_permissive,
  live.using_expression, live.with_check_expression, reviewed.bucket_id
FROM (VALUES
  ('Server owns avatar inserts', 'avatars'),
  ('Server owns avatar updates', 'avatars'),
  ('Server owns avatar deletes', 'avatars'),
  ('Server owns organization logo inserts', 'organization-logos'),
  ('Server owns organization logo updates', 'organization-logos'),
  ('Server owns organization logo deletes', 'organization-logos')
) reviewed(policy_name, bucket_id)
JOIN app_private.storage_object_policy_live_catalog() live USING (policy_name);

DO $$ BEGIN
  IF (SELECT count(*) FROM app_private.storage_object_policy_contract
      WHERE policy_name LIKE 'Server owns %') <> 6
     OR EXISTS (SELECT 1 FROM app_private.storage_object_policy_contract_violations()) THEN
    RAISE EXCEPTION 'Public image Storage policy contract did not converge.';
  END IF;
END $$;
