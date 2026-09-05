import { createHash } from "node:crypto";
import { ReleaseCheckError } from "./app-release-checks.mjs";

// Function definitions from the exact hosted-accepted 446-migration catalog.
const acceptedDefinitions = [
  [
    "app_private.protect_csf_release_worker_receipt()",
    "13b93bbdb8bc561985863a0e5e5fa14f",
    false,
  ],
  [
    "app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)",
    "1e41a41793d76980edb8fd30f1e4b5ad",
    false,
  ],
  [
    "plugin_data.csf_confirm_class_code_account_name_match_v4(uuid,uuid,uuid,text,uuid,uuid,text,text,text)",
    "6d2494c3f65510af06f214241a83bb87",
    true,
  ],
  [
    "plugin_data.csf_find_account_name_candidate(uuid,uuid,text)",
    "40fa35c59381c8dbc07a7e001881122f",
    true,
  ],
  [
    "plugin_data.csf_record_connection_basis()",
    "2bb49e2e9b35ef542840c3a0f24ab454",
    false,
  ],
  [
    "plugin_data.csf_revalidate_class_code_connection_replay(uuid,uuid,uuid,uuid,jsonb)",
    "407562642ac0bbf5cff10501c549dd2e",
    false,
  ],
  [
    "plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb)",
    "3b3e734fe920f885aa3b2d08f3b313a5",
    false,
  ],
  [
    "public.read_csf_release_worker_controls(text)",
    "a3e5236a9ae2bc7d54ffcd600fab0798",
    true,
  ],
];

export function acceptedCatalogQuery(source, versions) {
  if (!versions.includes("20260904010000")) return source;
  if (
    versions.length !== 446 ||
    createHash("sha256").update(versions.join("\n")).digest("hex") !==
      "449fbef149b83293d6c4312ee987b050dc9026aef0a24e9b330a518baf48b7d4"
  )
    throw new ReleaseCheckError(
      "This claim catalog version needs explicit release review.",
    );
  const start = source.indexOf(
    "expected_function_fragments(signature, definition_fragment) AS (",
  );
  const end = source.indexOf("function_fragment_posture AS (", start);
  const signature =
    "'plugin_data.csf_revalidate_class_code_connection_replay(uuid,uuid,uuid,uuid,jsonb)'";
  const legacy =
    "'plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb)'";
  const fragments = source.slice(start, end);
  if (start < 0 || end < start || fragments.split(signature).length !== 3)
    throw new ReleaseCheckError(
      "The accepted catalog fragment contract changed.",
    );
  const adjusted =
    source.slice(0, start) +
    fragments.replaceAll(signature, legacy) +
    source.slice(end);
  const marker = "SELECT 1 / CASE\n";
  const gate = "WHEN (SELECT valid FROM table_posture)";
  if (
    adjusted.split(marker).length !== 2 ||
    adjusted.split(gate).length !== 2
  )
    throw new ReleaseCheckError(
      "The accepted catalog result contract changed.",
    );
  const values = acceptedDefinitions
    .map(
      ([signature, digest, service]) =>
        `('${signature}','${digest}',${service})`,
    )
    .join(",\n");
  const upgrade = `, accepted_upgrade_definitions(signature,digest,service_execute) AS (VALUES ${values}),
accepted_upgrade_posture AS (
  SELECT count(*) = 8 AND coalesce(bool_and(
    p.oid IS NOT NULL
    AND p.proowner = 'postgres'::regrole
    AND md5(pg_get_functiondef(p.oid)) = expected.digest
    AND has_function_privilege('service_role',p.oid,'EXECUTE') = expected.service_execute
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
      WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
      WHERE a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole))
  ),false) AND EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgname = 'csf_record_connection_basis_after_audit'
      AND t.tgrelid = to_regclass('plugin_data.csf_admin_audit_events')
      AND t.tgfoid = to_regprocedure('plugin_data.csf_record_connection_basis()')
      AND t.tgenabled = 'O'
      AND t.tgtype = 5
      AND NOT t.tgisinternal
      AND t.tgconstraint = 0
      AND t.tgqual IS NULL
      AND octet_length(t.tgargs) = 0
  ) AS valid
  FROM accepted_upgrade_definitions expected
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
)
`;
  return adjusted
    .replace(marker, upgrade + marker)
    .replace(
      gate,
      "WHEN (SELECT valid FROM accepted_upgrade_posture) AND (SELECT valid FROM table_posture)",
    );
}
