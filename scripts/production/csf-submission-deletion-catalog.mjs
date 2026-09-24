// The shared Storage relation is provider-owned and outside the schema inventory.
// Pin the one CSF upload trigger separately so disabling it fails release checks.
export function csfSubmissionDeletionCatalog(catalog) {
  return `SELECT CASE WHEN (${catalog.replace(/;\s*$/u, "")}) = 1
AND EXISTS (
  SELECT 1 FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid='storage.objects'::regclass
    AND t.tgname='csf_fence_deleted_submission_storage_upload'
    AND t.tgfoid='plugin_data.csf_fence_deleted_submission_storage_upload()'::regprocedure
    AND t.tgenabled='O' AND NOT t.tgisinternal
    AND pg_catalog.pg_get_triggerdef(t.oid) =
      'CREATE TRIGGER csf_fence_deleted_submission_storage_upload BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION plugin_data.csf_fence_deleted_submission_storage_upload()'
) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
