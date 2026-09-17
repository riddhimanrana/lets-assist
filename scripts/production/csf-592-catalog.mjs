export function csf592Catalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_class_join_codes AS code
      JOIN plugin_data.csf_retention_retired_cohorts AS retired
        ON retired.organization_id = code.organization_id
       AND retired.cohort_id = code.cohort_id
      WHERE code.status = 'active'
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
