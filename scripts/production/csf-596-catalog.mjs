import { ReleaseCheckError } from "./app-release-checks.mjs";

const changedDefinitions = [
  ["e11c607e2605d2d7094470cae9d15104", "114572ff40882109974318bd4aca877b"],
  ["3b006244758b8eaee4535a5ea7d297a1", "4bab1cba993d8504681ff8eb869b6a05"],
  ["1737ebf7d2e061b504c2721e4e113dde", "e12c9d3b8e4efdcc4c189493ed6dc5ed"],
];

export function csf596Catalog(previous) {
  let reviewed = previous;
  for (const [before, after] of changedDefinitions) {
    if (reviewed.split(before).length !== 2)
      throw new ReleaseCheckError(
        "The reviewed retired-class post or actor catalog predecessor changed.",
      );
    reviewed = reviewed.replace(before, after);
  }
  return `SELECT CASE WHEN (${reviewed.trim().replace(/;$/u, "")}) = 1
    AND md5(pg_get_functiondef(
      'plugin_data.csf_guard_retired_class_post()'::regprocedure
    )) = 'f5b74163ac45204dc9249017e4aadd9e'
    AND NOT has_function_privilege(
      'anon', 'plugin_data.csf_guard_retired_class_post()', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated', 'plugin_data.csf_guard_retired_class_post()', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role', 'plugin_data.csf_guard_retired_class_post()', 'EXECUTE'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgrelid = 'plugin_data.csf_announcements'::regclass
        AND trigger_record.tgname = 'csf_guard_retired_class_post'
        AND trigger_record.tgfoid =
          'plugin_data.csf_guard_retired_class_post()'::regprocedure
        AND trigger_record.tgtype = 23
        AND trigger_record.tgenabled <> 'D'
    )
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
