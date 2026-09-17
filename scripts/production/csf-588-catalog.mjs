import { ReleaseCheckError } from "./app-release-checks.mjs";

const functions = [
  [
    "plugin_data.csf_class_publication_email_candidates(uuid,uuid,uuid,text,uuid,uuid,integer,integer)",
    "7f4cac966814d1fbd362c2db5b4ab436",
    true,
    true,
  ],
  [
    "plugin_data.csf_correct_attendance_source_timestamp(uuid,uuid,uuid,uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid,uuid)",
    "d2610d48950d289b4a8c5cfbebd0092b",
    true,
    true,
  ],
  [
    "plugin_data.csf_guard_attendance_response_window()",
    "6f98ed83157bc2b7c52076603b88f3ef",
    false,
    true,
  ],
  [
    "plugin_data.csf_guard_retired_cohort_status()",
    "3eff96fce8db247b0200700354c36883",
    false,
    true,
  ],
  [
    "plugin_data.csf_project_retired_cohort_status()",
    "0abd6c8cfe331766e22001d8744d5541",
    false,
    true,
  ],
  [
    "plugin_data.csf_publication_email_recipient_allowed(uuid,uuid)",
    "420a97da04211e530a3fe4bac9d10a46",
    false,
    true,
  ],
  [
    "plugin_data.csf_retention_commit(uuid,uuid,uuid,uuid,text,integer[],uuid[])",
    "e11c607e2605d2d7094470cae9d15104",
    true,
    true,
  ],
  [
    "plugin_data.csf_upsert_term_meeting_with_attendance_window(uuid,uuid,uuid,text,date[],timestamp with time zone,text,text,boolean,integer,text,uuid,uuid,jsonb)",
    "3e555109b43f9bee6d0b36dc2e0671fe",
    true,
    true,
  ],
  [
    "plugin_data.csf_validate_attendance_window(jsonb)",
    "3d1388e57a22e6d7fb8ae092044bd866",
    false,
    false,
  ],
  [
    "private.project_status_schedule_window(text,jsonb,text)",
    "7edc7ac2ff62c9f38e1f937c71505187",
    true,
    false,
  ],
  [
    "public.process_projects()",
    "5442e6c3f41fff243e325b224cfc3c43",
    true,
    false,
  ],
];

const relations = [
  [
    "csf_application_decision_sync_sources",
    "b2384cfcb76c445049edc1867e188f39",
    false,
  ],
  ["csf_cohorts", "a0a71e54fb1737590de9c21f55e5b18b", false],
  ["csf_meeting_attendance", "51a6e2bef00754005d3fb60e2d590b6d", false],
  ["csf_retention_preview_profiles", "54bc481178bfc159b347bdc3e7685700", true],
  ["csf_retention_retired_cohorts", "deb57109bd430d8db37837d41d665b4f", true],
  [
    "csf_sheet_semester_ledger_writes",
    "5a2e7874ae626e96f5cda454a55ea748",
    false,
  ],
  ["csf_term_meetings", "bad4ca06267c8b621670502ed4379931", false],
];

function values(rows) {
  return rows
    .map(
      (row) =>
        `(${row.map((value) => (typeof value === "boolean" ? value : `'${value}'`)).join(",")})`,
    )
    .join(",\n");
}

export function csf588Catalog(previous, relationSnapshotQuery) {
  const oldEmail = "57c41026b33ca412f0b73645d520b795";
  const oldLedger = "a3769fe20a17380a403737ac5511f7a1";
  if (
    previous.split(oldEmail).length !== 2 ||
    previous.split(oldLedger).length !== 3
  )
    throw new ReleaseCheckError(
      "The reviewed CSF 588 catalog predecessor changed.",
    );
  const predecessor = previous
    .replace(oldEmail, functions[5][1])
    .replaceAll(oldLedger, relations[5][1])
    .trim()
    .replace(/;$/u, "");
  const relationQuery = relationSnapshotQuery.replace(
    /FROM pg_class c WHERE c\.relpersistence = 'p' AND c\.oid IN \([\s\S]*?\)$/u,
    `FROM pg_class c WHERE c.relpersistence = 'p' AND c.oid IN (${relations.map(([name]) => `to_regclass('plugin_data.${name}')`).join(",")})`,
  );
  if (relationQuery === relationSnapshotQuery)
    throw new ReleaseCheckError(
      "The reviewed CSF relation snapshot contract changed.",
    );
  return `WITH expected_functions(signature,digest,service_execute,security_definer) AS (VALUES ${values(functions)}),
actual_functions AS (
  SELECT e.signature, e.digest, e.service_execute, e.security_definer, p.oid
  FROM expected_functions e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
),
relation_snapshot AS (${relationQuery}),
expected_relations(name,digest,runtime_denied) AS (VALUES ${values(relations)})
SELECT CASE WHEN (${predecessor})=1
  AND NOT EXISTS (
    SELECT 1 FROM actual_functions e LEFT JOIN pg_proc p ON p.oid=e.oid
    WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole
      OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM e.digest
      OR p.prosecdef IS DISTINCT FROM e.security_definer
      OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM e.service_execute
      OR has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE')
  )
  AND (SELECT count(*) FROM relation_snapshot)=${relations.length}
  AND NOT EXISTS (
    SELECT 1 FROM expected_relations e LEFT JOIN relation_snapshot a ON a.relname=e.name
    WHERE a.relname IS NULL OR a.digest IS DISTINCT FROM e.digest
      OR a.runtime_denied IS DISTINCT FROM e.runtime_denied
  )
  AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('Auto check-in signups','Auto check-out signups'))
  AND (SELECT count(*) FROM cron.job WHERE active AND schedule='* * * * *'
    AND (jobname='process-automatic-check-ins' AND regexp_replace(lower(command),'[[:space:];]','','g')='selectpublic.process_automatic_check_ins()'
      OR jobname='process-automatic-check-outs' AND regexp_replace(lower(command),'[[:space:];]','','g')='selectpublic.process_automatic_check_outs()'))=2
THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
