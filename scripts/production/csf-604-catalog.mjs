// This append pins the three advisor indexes added for populated CSF import
// foreign keys. The automatic-approval relation is already part of the
// accepted relation snapshot, so its fingerprint moves with the new index.
export function csf604Catalog(previous) {
  const predecessor = previous
    .trim()
    .replace(/;$/u, "")
    .replace(
      "4f49d866eabadf1ead30d6ebe714af41",
      "1d99ee16770ea80d937ea969577a77be",
    );

  return `SELECT CASE WHEN (${predecessor}) = 1
    AND (
      SELECT count(*) = 3 AND bool_and(
        index_record.indisvalid
        AND index_record.indisready
        AND index_record.indislive
        AND NOT index_record.indisunique
        AND pg_catalog.pg_get_indexdef(index_record.indexrelid)
          = expected.definition
      )
      FROM (VALUES
        (
          'plugin_data.csf_sheet_import_rows_resolved_by_fk_idx',
          'CREATE INDEX csf_sheet_import_rows_resolved_by_fk_idx ON plugin_data.csf_sheet_import_rows USING btree (resolved_by)'
        ),
        (
          'plugin_data.csf_import_row_batch_outcomes_import_row_org_fk_idx',
          'CREATE INDEX csf_import_row_batch_outcomes_import_row_org_fk_idx ON plugin_data.csf_import_row_batch_outcomes USING btree (import_row_id, organization_id)'
        ),
        (
          'plugin_data.csf_auto_import_approval_rows_import_row_org_fk_idx',
          'CREATE INDEX csf_auto_import_approval_rows_import_row_org_fk_idx ON plugin_data.csf_automatic_import_approval_rows USING btree (organization_id, import_row_id)'
        )
      ) AS expected(index_name, definition)
      LEFT JOIN pg_catalog.pg_index AS index_record
        ON index_record.indexrelid = pg_catalog.to_regclass(expected.index_name)
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
