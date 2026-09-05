import { createHash } from "node:crypto";
import { ReleaseCheckError } from "./app-release-checks.mjs";

export const workerRelationSnapshotQuery = `SELECT c.relname, md5(jsonb_build_object(
  'owner', pg_get_userbyid(c.relowner), 'kind', c.relkind,
  'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
  'acl', c.relacl::text,
  'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname,
    format_type(a.atttypid,a.atttypmod), a.attnotnull,
    pg_get_expr(d.adbin,d.adrelid), a.attidentity, a.attgenerated, a.attacl::text)
    ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d
    ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT jsonb_agg(jsonb_build_array(k.conname,
    pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred)
    ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
  'indexes', (SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),
    i.indisvalid,i.indisready) ORDER BY pg_get_indexdef(i.indexrelid))
    FROM pg_index i WHERE i.indrelid=c.oid),
  'triggers', (SELECT jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),
    t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
    WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)
)::text) AS digest,
NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(name)
  WHERE has_table_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(roles.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) AS runtime_denied
FROM pg_class c WHERE c.relpersistence = 'p' AND c.oid IN (
  to_regclass('app_private.csf_release_worker_controls'),
  to_regclass('app_private.csf_release_worker_receipts'))`;

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

const importReviewDefinitions = [
  [
    "plugin_data.csf_reconcile_sheet_import_row_identity_base(uuid,uuid,uuid,text,text,uuid,uuid,jsonb)",
    "9d5b02f7b4cdb7c948aad0398ed29bdf",
    false,
  ],
  [
    "plugin_data.csf_commit_meeting_attendance_import_identity_base(uuid,uuid,uuid,text,uuid,uuid,boolean)",
    "641568ea97cc01fff75298d218a1404d",
    false,
  ],
];

export function acceptedCatalogQuery(source, versions) {
  const ledgerHash = createHash("sha256")
    .update(versions.join("\n"))
    .digest("hex");
  if (
    versions.length === 444 &&
    ledgerHash ===
      "34dbbd884882349f8083512cd2fe48b371c3f1242bc62897685267f2a5d0001b"
  )
    return source;
  const reprepareUpgrade =
    versions.length === 449 &&
    ledgerHash ===
      "e057e1ab6ba2fb32fa73005d9f6c5ff5ee18e86ecbd72c2e19b93f7c8f5e130d";
  const importReviewUpgrade =
    reprepareUpgrade ||
    (versions.length === 448 &&
      ledgerHash ===
        "88ed874e0f578d6b64bd8b7368f8e8c2fa8e11737fc2a20c1469f20379ded445");
  const workerUpgrade =
    versions.length === 446 &&
    ledgerHash ===
      "449fbef149b83293d6c4312ee987b050dc9026aef0a24e9b330a518baf48b7d4";
  if (!workerUpgrade && !importReviewUpgrade)
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
  if (adjusted.split(marker).length !== 2 || adjusted.split(gate).length !== 2)
    throw new ReleaseCheckError(
      "The accepted catalog result contract changed.",
    );
  const definitions = importReviewUpgrade
    ? [...acceptedDefinitions, ...importReviewDefinitions]
    : acceptedDefinitions;
  const values = definitions
    .map(
      ([signature, digest, service]) =>
        `('${signature}','${digest}',${service})`,
    )
    .join(",\n");
  const upgrade = `, accepted_worker_relations AS (${workerRelationSnapshotQuery}),
accepted_upgrade_definitions(signature,digest,service_execute) AS (VALUES ${values}),
accepted_upgrade_posture AS (
  SELECT count(*) = ${definitions.length} AND coalesce(bool_and(
    p.oid IS NOT NULL
    AND p.proowner = 'postgres'::regrole
    AND md5(pg_get_functiondef(p.oid)) = expected.digest
    AND has_function_privilege('service_role',p.oid,'EXECUTE') = expected.service_execute
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
      WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
      WHERE a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole)
        OR a.is_grantable OR a.grantor <> 'postgres'::regrole)
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
  ) AND EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    JOIN pg_constraint k ON k.conrelid=a.attrelid
      AND k.conname='csf_profile_accounts_connection_basis_check'
    WHERE a.attrelid=to_regclass('plugin_data.csf_profile_accounts')
      AND a.attname='connection_basis' AND NOT a.attisdropped
      AND a.atttypid='text'::regtype AND a.attnotnull
      AND a.attgenerated='' AND a.attidentity=''
      AND pg_get_expr(d.adbin,d.adrelid) = '''unknown''::text'
      AND k.convalidated AND k.contype='c'
      AND pg_get_constraintdef(k.oid) = $$CHECK ((connection_basis = ANY (ARRAY['unknown'::text, 'verified_email'::text, 'self_confirmed_account_name'::text, 'officer_decision'::text])))$$
  ) ${importReviewUpgrade ? importReviewPosture : ""} ${reprepareUpgrade ? repreparePosture : ""} AND (SELECT count(*)=2 AND bool_and(runtime_denied AND digest = CASE relname
    WHEN 'csf_release_worker_controls' THEN 'b186cfbfbb17fee4e0966cde6d3bec9e'
    WHEN 'csf_release_worker_receipts' THEN '94e9bc198f37156522b9aed76bf696a4'
    ELSE '' END) FROM accepted_worker_relations) AS valid
  FROM accepted_upgrade_definitions expected
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
)
`;
  return adjusted
    .replace(marker, () => upgrade + marker)
    .replace(
      gate,
      "WHEN (SELECT valid FROM accepted_upgrade_posture) AND (SELECT valid FROM table_posture)",
    );
}

const repreparePosture = `AND EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('plugin_data.csf_request_class_workbook_reprepare(uuid,uuid,uuid,uuid,text)')
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='jsonb'::regtype AND l.lanname='plpgsql'
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.pronargdefaults=0 AND p.proconfig=ARRAY['search_path=""']
    AND md5(p.prosrc)='978fc913e56af1893565d56706941f69'
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=1 AND bool_and(a.grantee='service_role'::regrole
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
      AND a.grantor='postgres'::regrole) FROM aclexplode(p.proacl) a)
) AND EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indexrelid=to_regclass('plugin_data.csf_workbook_reprepare_request_idx')
    AND i.indrelid=to_regclass('plugin_data.csf_admin_audit_events')
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
    AND pg_get_indexdef(i.indexrelid) = $$CREATE UNIQUE INDEX csf_workbook_reprepare_request_idx ON plugin_data.csf_admin_audit_events USING btree (organization_id, correlation_id) WHERE (action = 'sheets.class_workbook_reprepare_requested'::text)$$
)`;

const importReviewPosture = `AND EXISTS (
  SELECT 1 FROM pg_attribute a
  JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  JOIN pg_constraint k ON k.conrelid=a.attrelid
    AND k.conname='csf_import_rows_resolution_metadata_object'
  WHERE a.attrelid=to_regclass('plugin_data.csf_sheet_import_rows')
    AND a.attname='resolution_metadata' AND NOT a.attisdropped
    AND a.atttypid='jsonb'::regtype AND a.attnotnull
    AND a.attgenerated='' AND a.attidentity=''
    AND pg_get_expr(d.adbin,d.adrelid) = '''{}''::jsonb'
    AND k.convalidated AND k.contype='c'
    AND pg_get_constraintdef(k.oid) = $$CHECK ((jsonb_typeof(resolution_metadata) = 'object'::text))$$
) AND EXISTS (
  SELECT 1 FROM pg_index i
  WHERE i.indexrelid=to_regclass('plugin_data.csf_import_rows_committed_source_key_idx')
    AND i.indrelid=to_regclass('plugin_data.csf_sheet_import_rows')
    AND i.indisvalid AND i.indisready AND i.indislive
    AND pg_get_indexdef(i.indexrelid) = $$CREATE INDEX csf_import_rows_committed_source_key_idx ON plugin_data.csf_sheet_import_rows USING btree (organization_id, cohort_id, plugin_data.csf_class_history_source_key_value(normalized_data)) WHERE (import_status = ANY (ARRAY['created'::text, 'updated'::text]))$$
)`;
