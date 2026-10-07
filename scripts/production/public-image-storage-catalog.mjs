// Auth and Storage own these relations. Bind only the platform's hooks and
// reviewed Storage policies, without pinning unrelated provider schema.
export function publicImageStorageCatalog(catalog) {
  return `SELECT CASE WHEN (${catalog.replace(/;\s*$/u, "")}) = 1
AND NOT EXISTS (
  SELECT 1 FROM (VALUES
    ('auth.users', 'public_image_auth_reference', 'app_private.track_public_image_references()',
      'CREATE TRIGGER public_image_auth_reference AFTER INSERT OR DELETE OR UPDATE OF raw_user_meta_data ON auth.users FOR EACH ROW EXECUTE FUNCTION app_private.track_public_image_references()'),
    ('storage.objects', 'public_image_upload_fence', 'app_private.fence_retired_public_image_upload()',
      'CREATE TRIGGER public_image_upload_fence BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION app_private.fence_retired_public_image_upload()')
  ) AS expected(relation, name, function_signature, definition)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=pg_catalog.to_regclass(expected.relation)
      AND t.tgname=expected.name
      AND t.tgfoid=pg_catalog.to_regprocedure(expected.function_signature)
      AND t.tgenabled='O' AND NOT t.tgisinternal
      AND pg_catalog.pg_get_triggerdef(t.oid)=expected.definition
  )
)
AND EXISTS (SELECT 1 FROM pg_catalog.pg_class
  WHERE oid='storage.objects'::regclass AND relrowsecurity)
AND (SELECT count(*)=21 AND pg_catalog.md5(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c)
  ORDER BY policy_name COLLATE "C")::text)='20e8c7d6bee8e6de48c1cab4343e12fe'
  FROM app_private.storage_object_policy_contract c)
AND NOT EXISTS (SELECT 1 FROM app_private.storage_object_policy_contract_violations())
THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
