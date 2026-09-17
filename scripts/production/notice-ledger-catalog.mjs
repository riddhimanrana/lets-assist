// Measured after a clean 576-migration replay on the owned catalog576b stack.
export const noticeLedgerDefinitions = [
  [
    "plugin_data.csf_accept_sheet_semester_ledger_mapping(uuid,uuid,uuid,text,uuid,jsonb,text)",
    "8603132caf3e9c466a51d15ccdf7703e",
    true,
  ],
  [
    "plugin_data.csf_authorize_publication_notification(uuid,uuid,uuid)",
    "8f8b113fd372dfe7b94ab2c26ca8708e",
    true,
  ],
  [
    "plugin_data.csf_campaign_platform_sender_identity()",
    "6b1c350226bd4c12bd59a56be628e9c3",
    false,
  ],
  [
    "plugin_data.csf_claim_sheet_semester_ledger_write(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)",
    "c36579ace2984906abb4fc59dc469d50",
    true,
  ],
  [
    "plugin_data.csf_finish_sheet_semester_ledger_write(uuid,uuid,uuid,text,text)",
    "660b298dd9cfedb6be3d7db106d0b7ef",
    true,
  ],
  [
    "plugin_data.csf_guard_sheet_semester_ledger_immutable()",
    "d0d9a05b0c292c7ff0552bd891dd9d62",
    false,
  ],
  [
    "plugin_data.csf_profile_merge_reference_plan(uuid,uuid)",
    "67a8c6fccc8d7e45d9eb0db1b6575d82",
    false,
  ],
  [
    "plugin_data.csf_profile_merge_reference_plan_semester_ledger_base(uuid,uuid)",
    "fbe94054597fcd6d5e7b891f62487d98",
    false,
  ],
  [
    "plugin_data.csf_retention_candidates(uuid,integer[])",
    "74fe4770d6f2c246b3940bec2f28efd1",
    false,
  ],
  [
    "plugin_data.csf_retention_candidates_semester_ledger_base(uuid,integer[])",
    "4f0e7833c08cd6911049d5e59bc037b0",
    false,
  ],
  [
    "plugin_data.csf_retention_delete_owned_records(uuid,uuid)",
    "503e3be3d5f0479ddd10ff616a2ef3b8",
    false,
  ],
  [
    "plugin_data.csf_retention_delete_owned_records_semester_ledger_base(uuid,uuid)",
    "d339f4e946d8ac04511f1fedd7eaa0bc",
    false,
  ],
  [
    "plugin_data.csf_sheet_semester_ledger_source_version(uuid,uuid,uuid,uuid)",
    "3779b22becfc17737c1a949392dba351",
    true,
  ],
];

const relations = [
  ["csf_communication_campaigns", "2dfb67ba511a005c8aa41331b883845d"],
  ["csf_sheet_semester_ledger_mappings", "6d44d27f039ccd271c868e7aa72f6635"],
  ["csf_sheet_semester_ledger_writes", "47ab6207ab62d8ab7970670627b47f59"],
];

export function noticeLedgerCatalog(previous, count, relationSnapshotQuery) {
  const lifecycle = count === 576;
  const definitions = noticeLedgerDefinitions.filter(([signature]) => {
    if (
      signature.includes("profile_merge_reference_plan") ||
      signature.includes("retention_")
    )
      return lifecycle;
    if (signature.includes("semester_ledger")) return count >= 575;
    return true;
  });
  const tables = relations.slice(0, count === 574 ? 1 : 3);
  const snapshot = relationSnapshotQuery.replace(
    /FROM pg_class c WHERE[\s\S]+$/u,
    `FROM pg_class c WHERE c.relpersistence='p' AND c.oid IN (${tables.map(([name]) => `to_regclass('plugin_data.${name}')`).join(",")})`,
  );
  const functionRows = definitions
    .map(
      ([signature, hash, service]) => `('${signature}','${hash}',${service})`,
    )
    .join(",");
  const tableRows = tables
    .map(([name, hash]) => `('${name}','${hash}')`)
    .join(",");
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")})=1
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES ${functionRows}) expected(signature,digest,service_execute)
      LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
      WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM expected.digest
        OR p.proowner <> 'postgres'::regrole OR NOT p.prosecdef
        OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM expected.service_execute
        OR has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE')
        OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole) OR a.is_grantable OR a.grantor <> 'postgres'::regrole)
    ) AND (
      SELECT count(*)=${tables.length} AND coalesce(bool_and(actual.digest=expected.digest),false)
      FROM (${snapshot}) actual JOIN (VALUES ${tableRows}) expected(name,digest) ON expected.name=actual.relname
    ) AND NOT EXISTS (
      SELECT 1 FROM (VALUES ${tableRows}) expected(name,digest)
      CROSS JOIN (VALUES ('anon'),('authenticated')) AS role(name)
      WHERE has_table_privilege(role.name,to_regclass('plugin_data.'||expected.name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(role.name,to_regclass('plugin_data.'||expected.name),'SELECT,INSERT,UPDATE,REFERENCES')
    ) ${
      count >= 575
        ? `AND NOT EXISTS (
      SELECT 1 FROM (VALUES ('csf_sheet_semester_ledger_mappings'),('csf_sheet_semester_ledger_writes')) expected(name)
      WHERE NOT has_table_privilege('service_role',to_regclass('plugin_data.'||expected.name),'SELECT')
        OR has_table_privilege('service_role',to_regclass('plugin_data.'||expected.name),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege('service_role',to_regclass('plugin_data.'||expected.name),'INSERT,UPDATE,REFERENCES')
    )`
        : ""
    } ${
      lifecycle
        ? `AND EXISTS (
      SELECT 1 FROM plugin_data.csf_retention_reference_policy
      WHERE parent_table='csf_profiles' AND child_table='csf_sheet_semester_ledger_writes'
        AND child_column='profile_id' AND policy='delete_with_owner'
    )`
        : ""
    }
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
