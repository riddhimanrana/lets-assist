-- Scope plugin form uploads to a real organization and an installed plugin.
--
-- The bucket's path grammar is {organization_id}/{plugin_key}/{user_id}/{file},
-- but the policies only ever checked segment 3 against auth.uid(). Segment 2,
-- the plugin key, was never checked by any policy, and segment 1 was checked
-- only in the staff read path. Any authenticated user could therefore write and
-- read under any organization's prefix and any plugin key, provided the third
-- segment was their own user id — a tenancy break, not merely untidy paths.
--
-- There is also no UPDATE policy, so a move is impossible through the browser
-- client. That is a deliberate gap rather than an accidental one: moves stay
-- server-side, and the accompanying pgTAP asserts the absence so it cannot be
-- reopened without a decision.
--
-- The predicate deliberately requires only that the plugin is installed and
-- enabled for the organization, never that the uploader is a member. DV Speech
-- and Debate uploads a membership application's files during the join flow,
-- before any membership row exists, so a membership predicate here would break
-- signup rather than harden it.

-- The predicate cannot read organization_plugin_installs directly. That table
-- carries row-level security, so inside a policy it is evaluated as the calling
-- user and a non-member sees no install row at all. Using it directly would
-- therefore smuggle in the membership requirement this migration is explicitly
-- avoiding, and would break the join-flow upload it is meant to preserve.
--
-- An existing private enabled-plugin predicate answers this question, but it was
-- deliberately hardened to postgres-only execution, so a policy running as
-- `authenticated` cannot call it. This is a separate, narrow entry point with
-- its own reviewed grant, taking the raw path segments rather than typed
-- arguments so a malformed key is a false result instead of a cast error.
--
-- `private` is not a PostgREST-exposed schema, so granting EXECUTE to
-- `authenticated` makes this reachable from row-level security without adding
-- anything to the browser-callable surface.
CREATE OR REPLACE FUNCTION private.storage_plugin_namespace_is_active(
  p_organization_segment text,
  p_plugin_key_segment text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_plugin_installs AS install
    WHERE install.organization_id::text = p_organization_segment
      AND install.plugin_key = p_plugin_key_segment
      AND install.enabled
  );
$$;

COMMENT ON FUNCTION private.storage_plugin_namespace_is_active(text, text) IS
  'Whether a storage path''s organization and plugin segments name an installed, enabled plugin. Used by plugin_form_uploads row-level security.';

REVOKE ALL ON FUNCTION private.storage_plugin_namespace_is_active(text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.storage_plugin_namespace_is_active(text, text)
  TO authenticated;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can upload own plugin form files" ON storage.objects;
  CREATE POLICY "Authenticated users can upload own plugin form files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'plugin_form_uploads'
    AND auth.uid() IS NOT NULL
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
    AND private.storage_plugin_namespace_is_active(
      (string_to_array(name, '/'))[1],
      (string_to_array(name, '/'))[2]
    )
  );

  DROP POLICY IF EXISTS "Authenticated users can view own plugin form files" ON storage.objects;
  CREATE POLICY "Authenticated users can view own plugin form files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'plugin_form_uploads'
    AND auth.uid() IS NOT NULL
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
    AND private.storage_plugin_namespace_is_active(
      (string_to_array(name, '/'))[1],
      (string_to_array(name, '/'))[2]
    )
  );

  DROP POLICY IF EXISTS "Authenticated users can delete own plugin form files" ON storage.objects;
  CREATE POLICY "Authenticated users can delete own plugin form files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'plugin_form_uploads'
    AND auth.uid() IS NOT NULL
    AND (string_to_array(name, '/'))[3] = auth.uid()::text
    AND private.storage_plugin_namespace_is_active(
      (string_to_array(name, '/'))[1],
      (string_to_array(name, '/'))[2]
    )
  );

  -- Staff reads already bound segment 1 to an active membership. Add the same
  -- plugin-key predicate so a staff member cannot read a namespace belonging to
  -- a plugin their organization does not run.
  DROP POLICY IF EXISTS "Org staff can view their org plugin form files" ON storage.objects;
  CREATE POLICY "Org staff can view their org plugin form files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'plugin_form_uploads'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS organization_member
      WHERE organization_member.organization_id::text = (string_to_array(name, '/'))[1]
        AND organization_member.user_id = auth.uid()
        AND organization_member.status = 'active'
        AND organization_member.role IN ('admin', 'staff')
    )
    AND private.storage_plugin_namespace_is_active(
      (string_to_array(name, '/'))[1],
      (string_to_array(name, '/'))[2]
    )
  );
END $$;

-- Refresh only the four expressions changed above. The live reader deparses
-- under its fixed empty search_path, exactly as the drift gate does.
WITH refreshed_policy(policy_name) AS (
  VALUES
    ('Authenticated users can upload own plugin form files'::text),
    ('Authenticated users can view own plugin form files'::text),
    ('Authenticated users can delete own plugin form files'::text),
    ('Org staff can view their org plugin form files'::text)
)
UPDATE app_private.storage_object_policy_contract AS contract
SET
  command = live.command,
  role_names = live.role_names,
  is_permissive = live.is_permissive,
  using_expression = live.using_expression,
  with_check_expression = live.with_check_expression
FROM refreshed_policy
JOIN app_private.storage_object_policy_live_catalog() AS live
  ON live.policy_name = refreshed_policy.policy_name
WHERE contract.policy_name = refreshed_policy.policy_name;

DO $$
DECLARE
  storage_violation_count integer;
BEGIN
  SELECT count(*)::integer
  INTO storage_violation_count
  FROM app_private.storage_object_policy_contract_violations();

  IF storage_violation_count > 0 THEN
    RAISE EXCEPTION
      'plugin form upload scoping left % exact contract violation(s)',
      storage_violation_count;
  END IF;
END;
$$;
