import { ReleaseCheckError } from "./app-release-checks.mjs";

const changedDefinitions = [
  ["61b3229cfbf62af18b217ac5e3255e64", "d58de4f9bc9dc995dd44e10841ae1c76"],
  ["f5b74163ac45204dc9249017e4aadd9e", "77a0bba4132095cb3d2adecf33a30e00"],
  ["e7258ed743fa52f1470ca1b7c5e71d55", "9dde0343c06362744e1e9b19de8190a0"],
];

export function csf597Catalog(previous) {
  let reviewed = previous;
  for (const [before, after] of changedDefinitions) {
    if (reviewed.split(before).length !== 2)
      throw new ReleaseCheckError(
        "The reviewed retired-class terminal guard predecessor changed.",
      );
    reviewed = reviewed.replace(before, after);
  }
  return `SELECT CASE WHEN (${reviewed.trim().replace(/;$/u, "")}) = 1
    AND md5(pg_get_functiondef(
      'plugin_data.csf_guard_retired_shared_term_update()'::regprocedure
    )) = '8b8658e8831e2a6acea19b544d049e02'
    AND NOT has_function_privilege(
      'anon', 'plugin_data.csf_guard_retired_shared_term_update()', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated', 'plugin_data.csf_guard_retired_shared_term_update()', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role', 'plugin_data.csf_guard_retired_shared_term_update()', 'EXECUTE'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgrelid = 'plugin_data.csf_terms'::regclass
        AND trigger_record.tgname = 'csf_guard_retired_shared_term_update'
        AND trigger_record.tgfoid =
          'plugin_data.csf_guard_retired_shared_term_update()'::regprocedure
        AND trigger_record.tgtype = 19
        AND trigger_record.tgenabled <> 'D'
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
