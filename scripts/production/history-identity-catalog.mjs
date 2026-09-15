import { ReleaseCheckError } from "./app-release-checks.mjs";

// Exact reviewed ledgers. Publication-only additions need their own entry.
export const historyIdentityLedgers = new Map([
  [533, "95ef7711f7b0d6ef664da7e69858b6cf602da6779b19af02298afc2abcca7ae7"],
]);

export const historyIdentityDefinitions = [
  [
    "plugin_data.csf_enforce_import_row_attempt_lineage()",
    "f3c8d3a07affb3ef969f8b6d9e776c36",
    false,
    false,
    "v",
  ],
  [
    "plugin_data.csf_import_class_history_row_identity_base(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)",
    "349ad801226a4871d809de70922223a3",
    false,
    true,
    "v",
  ],
  [
    "plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)",
    "df9ef9f72403ea7fbbf8fabbad14c380",
    false,
    true,
    "v",
  ],
  [
    "plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)",
    "abda3e08cd11a412fbb919906c95fe74",
    true,
    true,
    "s",
  ],
  [
    "plugin_data.csf_profiles_share_class_source_key(uuid,uuid,uuid)",
    "4a26162d8f7a4f61023a1af2454eea26",
    true,
    true,
    "s",
  ],
  [
    "plugin_data.csf_class_connection_request_id(uuid,uuid,uuid)",
    "41070a5aa4172891fb6f5358b313b679",
    false,
    true,
    "v",
  ],
  [
    "plugin_data.csf_join_class_by_code_identity_base(uuid,text,uuid,text,text,text,text,uuid,uuid)",
    "1d733dd2e7a24eb3345b989dd7c149b1",
    false,
    true,
    "v",
  ],
  [
    "plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid)",
    "524766459ce161c31250d01b691ca7c9",
    true,
    true,
    "s",
  ],
  [
    "plugin_data.csf_revalidate_class_code_connection_replay_legacy(uuid,uuid,uuid,uuid,jsonb)",
    "8635714a7cc9f06d1a5c644578c7cfb3",
    false,
    true,
    "v",
  ],
  [
    "plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)",
    "f55544457947c753af0a8f527d7d25d6",
    true,
    true,
    "v",
  ],
  [
    "plugin_data.csf_staff_connect_requested_profile_account(uuid,uuid,uuid,text,text,uuid,uuid)",
    "fa39f50bf3794a4c891d9ea4c972c996",
    true,
    true,
    "v",
  ],
];

function replaceReviewed(query, before, after) {
  if (query.split(before).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed history catalog contract changed.",
    );
  return query.replace(before, after);
}

export function historyIdentityCatalog(query) {
  // Keep all earlier postures and replace only the four changed fingerprints.
  for (const [before, after] of [
    ["2c3ed2e24bee1d590dfedd62c27bb75c", "1d733dd2e7a24eb3345b989dd7c149b1"],
    ["3b3e734fe920f885aa3b2d08f3b313a5", "8635714a7cc9f06d1a5c644578c7cfb3"],
    ["eb16a9bc6344a60717de2a90ff91fa2b", "5f47bdc9f3dd79de9262c81e6714d42c"],
    ["9b1b4a82e52bf0b006bb4962fb64554d", "ca19166ee6970f30c58bf560dc1e311d"],
  ])
    query = replaceReviewed(query, before, after);
  const values = historyIdentityDefinitions
    .map(
      ([signature, digest, service, definer, volatility]) =>
        `('${signature}','${digest}',${service},${definer},'${volatility}')`,
    )
    .join(",\n");
  const posture = `, reviewed_history_identity_definitions(signature,digest,service_execute,security_definer,volatility) AS (
  VALUES ${values}
), reviewed_history_identity_posture AS (
  SELECT count(*)=${historyIdentityDefinitions.length} AND coalesce(bool_and(
    p.oid IS NOT NULL AND p.proowner='postgres'::regrole
    AND md5(pg_get_functiondef(p.oid))=expected.digest
    AND p.prosecdef=expected.security_definer AND p.provolatile::text=expected.volatility
    AND p.prokind='f' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.proconfig=ARRAY['search_path=""']
    AND has_function_privilege('service_role',p.oid,'EXECUTE')=expected.service_execute
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND (SELECT count(*)=CASE WHEN expected.service_execute THEN 2 ELSE 1 END
      AND bool_and(a.grantee IN ('postgres'::regrole,'service_role'::regrole)
        AND a.grantor='postgres'::regrole AND a.privilege_type='EXECUTE'
        AND NOT a.is_grantable)
      FROM aclexplode(p.proacl) a)
    AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
      WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE')
  ),false)
  AND EXISTS (
    SELECT 1 FROM pg_constraint k
    WHERE k.conrelid='plugin_data.csf_opportunities'::regclass
      AND k.conname='csf_opportunities_point_cap_check'
      AND k.contype='c' AND k.convalidated
      AND md5(pg_get_constraintdef(k.oid))='b3cb543817380b31299030dc23f802b0'
  ) AS valid
  FROM reviewed_history_identity_definitions expected
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
)
`;
  query = replaceReviewed(
    query,
    "SELECT 1 / CASE\n",
    posture + "SELECT 1 / CASE\n",
  );
  return replaceReviewed(
    query,
    "WHEN (SELECT valid FROM accepted_upgrade_posture)",
    "WHEN (SELECT valid FROM reviewed_history_identity_posture) AND (SELECT valid FROM accepted_upgrade_posture)",
  );
}
