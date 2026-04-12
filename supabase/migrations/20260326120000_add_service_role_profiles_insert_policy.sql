-- Allow service_role to insert into profiles table (for bootstrap/admin operations)
CREATE POLICY "profiles_insert_service_role"
  ON "public"."profiles"
  FOR INSERT
  TO "service_role"
  WITH CHECK (true);
