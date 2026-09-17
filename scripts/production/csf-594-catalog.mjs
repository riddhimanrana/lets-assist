import { ReleaseCheckError } from "./app-release-checks.mjs";

const previousRelation = "ca19166ee6970f30c58bf560dc1e311d";
const reviewedRelation = "706bcfcc5dc9d366a9bfcdc66386f13e";

export function csf594Catalog(previous) {
  if (previous.split(previousRelation).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed retired-class activity catalog predecessor changed.",
    );
  const reviewed = previous.replace(previousRelation, reviewedRelation);
  return `SELECT CASE WHEN (${reviewed.trim().replace(/;$/u, "")}) = 1
    AND md5(pg_get_functiondef(
      'plugin_data.csf_guard_retired_cohort_operational_write()'::regprocedure
    )) = '61b3229cfbf62af18b217ac5e3255e64'
    AND NOT has_function_privilege(
      'anon', 'plugin_data.csf_guard_retired_cohort_operational_write()', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated', 'plugin_data.csf_guard_retired_cohort_operational_write()', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role', 'plugin_data.csf_guard_retired_cohort_operational_write()', 'EXECUTE'
    )
    AND (
      SELECT count(*) FROM pg_catalog.pg_trigger AS trigger_record
      WHERE (trigger_record.tgrelid, trigger_record.tgname) IN (
        ('plugin_data.csf_opportunities'::regclass, 'csf_opportunities_retired_cohort_write_guard'),
        ('plugin_data.csf_cohort_terms'::regclass, 'csf_cohort_terms_retired_cohort_write_guard')
      )
        AND trigger_record.tgfoid =
          'plugin_data.csf_guard_retired_cohort_operational_write()'::regprocedure
        AND trigger_record.tgtype = 23
        AND trigger_record.tgenabled <> 'D'
    ) = 2
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
