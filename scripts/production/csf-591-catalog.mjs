import { ReleaseCheckError } from "./app-release-checks.mjs";

const previousDigest = "0abd6c8cfe331766e22001d8744d5541";
const reviewedDigest = "3b006244758b8eaee4535a5ea7d297a1";

export function csf591Catalog(previous) {
  if (previous.split(previousDigest).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed retired-class projection catalog predecessor changed.",
    );
  const reviewed = previous.replace(previousDigest, reviewedDigest);
  return `SELECT CASE WHEN (${reviewed.trim().replace(/;$/u, "")}) = 1
    AND md5(pg_get_functiondef(
      'plugin_data.csf_create_term_for_cohort(uuid,uuid,jsonb,uuid)'::regprocedure
    )) = '51a12d2ff4a3f2a44a297b136ed631fc'
    AND md5(pg_get_functiondef(
      'plugin_data.csf_rotate_class_join_code(uuid,uuid,uuid)'::regprocedure
    )) = '34cf3ce530ba6b9066b260d65f6d3f87'
    AND has_function_privilege(
      'service_role', 'plugin_data.csf_create_term_for_cohort(uuid,uuid,jsonb,uuid)', 'EXECUTE'
    )
    AND has_function_privilege(
      'service_role', 'plugin_data.csf_rotate_class_join_code(uuid,uuid,uuid)', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated', 'plugin_data.csf_create_term_for_cohort(uuid,uuid,jsonb,uuid)', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated', 'plugin_data.csf_rotate_class_join_code(uuid,uuid,uuid)', 'EXECUTE'
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
