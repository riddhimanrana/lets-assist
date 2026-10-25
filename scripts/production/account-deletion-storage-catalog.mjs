// Storage owns this relation, so the platform schema inventory cannot pin its
// triggers. Require the exact account-removal fences when accepting this schema.
export function accountDeletionStorageCatalog(catalog) {
  return `SELECT CASE WHEN (${catalog.replace(/;\s*$/u, "")}) = 1
AND NOT EXISTS (
  SELECT 1 FROM (VALUES
    ('account_deletion_write_fence', 'app_private.guard_account_deletion_write()',
      'CREATE TRIGGER account_deletion_write_fence BEFORE INSERT OR DELETE OR UPDATE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION app_private.guard_account_deletion_write()'),
    ('account_deletion_storage_reference_fence', 'app_private.account_deletion_storage_fence()',
      'CREATE TRIGGER account_deletion_storage_reference_fence BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION app_private.account_deletion_storage_fence()')
  ) AS expected(name, function_signature, definition)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=pg_catalog.to_regclass('storage.objects')
      AND t.tgname=expected.name
      AND t.tgfoid=pg_catalog.to_regprocedure(expected.function_signature)
      AND t.tgenabled='O' AND NOT t.tgisinternal
      AND pg_catalog.pg_get_triggerdef(t.oid)=expected.definition
  )
) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
