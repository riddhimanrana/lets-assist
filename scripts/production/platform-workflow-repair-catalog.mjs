// Storage owns this shared relation, and collations are outside the object
// inventory. Bind the platform's exact hooks and roster ordering separately.
export const platformWorkflowStorageTriggers = [
  [
    "project_asset_object_delete_guard",
    "app_private.guard_project_asset_object_delete()",
    "CREATE TRIGGER project_asset_object_delete_guard BEFORE DELETE ON storage.objects FOR EACH ROW WHEN ((old.bucket_id = ANY (ARRAY['project-images'::text, 'project-documents'::text]))) EXECUTE FUNCTION app_private.guard_project_asset_object_delete()",
  ],
  [
    "project_asset_object_insert_fence",
    "app_private.fence_project_asset_object_write()",
    "CREATE TRIGGER project_asset_object_insert_fence BEFORE INSERT ON storage.objects FOR EACH ROW WHEN ((new.bucket_id = ANY (ARRAY['project-images'::text, 'project-documents'::text]))) EXECUTE FUNCTION app_private.fence_project_asset_object_write()",
  ],
  [
    "project_asset_object_register",
    "app_private.register_project_asset_object()",
    "CREATE TRIGGER project_asset_object_register AFTER INSERT ON storage.objects FOR EACH ROW WHEN ((new.bucket_id = ANY (ARRAY['project-images'::text, 'project-documents'::text]))) EXECUTE FUNCTION app_private.register_project_asset_object()",
  ],
  [
    "project_asset_object_update_fence",
    "app_private.fence_project_asset_object_write()",
    "CREATE TRIGGER project_asset_object_update_fence BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((old.bucket_id = ANY (ARRAY['project-images'::text, 'project-documents'::text])) OR (new.bucket_id = ANY (ARRAY['project-images'::text, 'project-documents'::text])))) EXECUTE FUNCTION app_private.fence_project_asset_object_write()",
  ],
  [
    "waiver_source_object_immutable",
    "private.protect_referenced_waiver_source_object()",
    "CREATE TRIGGER waiver_source_object_immutable BEFORE DELETE OR UPDATE ON storage.objects FOR EACH ROW WHEN ((old.bucket_id = 'waiver-uploads'::text)) EXECUTE FUNCTION private.protect_referenced_waiver_source_object()",
  ],
];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;

function workflowCatalog(catalog, triggers) {
  const rows = triggers
    .map((row) => `(${row.map(literal).join(",")})`)
    .join(",\n");
  return `SELECT CASE WHEN (${catalog.replace(/;\s*$/u, "")}) = 1
AND EXISTS (
  SELECT 1 FROM pg_catalog.pg_collation c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace
  WHERE n.nspname='plugin_data' AND c.collname='csf_review_name_order'
    AND c.collowner='postgres'::regrole AND c.collprovider='i'
    AND NOT c.collisdeterministic
    AND coalesce(pg_catalog.to_jsonb(c)->>'colllocale',
      pg_catalog.to_jsonb(c)->>'colliculocale')='und'
)
${
  rows
    ? `AND NOT EXISTS (
  SELECT 1 FROM (VALUES ${rows}) expected(name, function_signature, definition)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=pg_catalog.to_regclass('storage.objects')
      AND t.tgname=expected.name
      AND t.tgfoid=pg_catalog.to_regprocedure(expected.function_signature)
      AND t.tgenabled='O' AND NOT t.tgisinternal
      AND pg_catalog.pg_get_triggerdef(t.oid)=expected.definition
  )
)`
    : ""
}
THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}

export function platformWorkflowCollationCatalog(catalog) {
  return workflowCatalog(catalog, []);
}

export function platformWorkflowAssetsCatalog(catalog) {
  return workflowCatalog(catalog, platformWorkflowStorageTriggers.slice(0, 4));
}

export function platformWorkflowRepairCatalog(catalog) {
  return workflowCatalog(catalog, platformWorkflowStorageTriggers);
}
