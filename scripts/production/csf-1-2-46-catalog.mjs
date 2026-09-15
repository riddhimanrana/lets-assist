export const csfOneTwoFortySixDefinitions = [
  [
    "plugin_data.csf_assert_activity_earning_award(uuid,uuid,uuid,uuid,numeric,jsonb,jsonb)",
    "2213eb3174097e1a28ec49552380ab64",
    false,
  ],
  [
    "plugin_data.csf_assert_point_submission_eligibility(uuid,uuid,uuid,uuid,uuid,text,numeric,text,boolean,boolean,boolean)",
    "19095ac7a03b26f8c91aaa8d23465a36",
    false,
  ],
  [
    "plugin_data.csf_assign_review_queue(uuid,uuid,uuid,uuid,uuid,jsonb,uuid)",
    "1dfad28f4a35c850b3a0d0fd8f43830d",
    true,
  ],
  [
    "plugin_data.csf_begin_point_submission_request_v2(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid,jsonb)",
    "9cbc9f2a9ebaaaff681c951b2f5bc7ce",
    true,
  ],
  [
    "plugin_data.csf_begin_point_submission_request(uuid,uuid,uuid,uuid,uuid,text,text,numeric,text,date,uuid,text,text,bigint,text,uuid)",
    "9d70d9823b4f5b01fe64b5a31e407061",
    true,
  ],
  [
    "plugin_data.csf_calculate_earning(jsonb,jsonb)",
    "1a061d62855e5253a51cacca4d7496be",
    false,
  ],
  [
    "plugin_data.csf_create_activity_locked_impl(uuid,uuid,uuid,jsonb,uuid,uuid)",
    "3f8f3ee48ee75366bb29d9585df8cc9c",
    false,
  ],
  [
    "plugin_data.csf_default_earning_selection(jsonb)",
    "4ba1910f009bed767283ef490562b048",
    false,
  ],
  [
    "plugin_data.csf_earning_points_value(jsonb,text)",
    "b25e80926f53c2b8eeb4f29ba1bac0fd",
    false,
  ],
  [
    "plugin_data.csf_effective_earning_rules(jsonb,numeric,text)",
    "6a7de403e22ed9afbc7343fa8bc0137b",
    false,
  ],
  [
    "plugin_data.csf_enforce_new_application_intake()",
    "32b6748383385c7e4d38885da5851f8e",
    false,
  ],
  [
    "plugin_data.csf_normalize_earning_rules(jsonb)",
    "d3000b760ab6f06065bee5f819b996b0",
    false,
  ],
  [
    "plugin_data.csf_normalize_signup_links(jsonb)",
    "ccb600235ee7da696c2c33d0b2016dc6",
    false,
  ],
  [
    "plugin_data.csf_resubmit_point_submission_request_v2(uuid,uuid,numeric,text,date,text,uuid,uuid,jsonb)",
    "503c8785a052b3ade3e7416736db6b19",
    true,
  ],
  [
    "plugin_data.csf_resubmit_point_submission_request(uuid,uuid,numeric,text,date,text,uuid,uuid)",
    "4cd5c5dff3c097f0c4c8f9a40daef356",
    true,
  ],
  [
    "plugin_data.csf_review_application_counts(uuid)",
    "a159c89899fe40a7d24ab3b5ed6292b1",
    true,
  ],
  [
    "plugin_data.csf_review_point_appeal(uuid,uuid,text,text,uuid,uuid)",
    "ae33ed2ba09b2ff20d99ca59b5553ec3",
    false,
  ],
  [
    "plugin_data.csf_review_point_submission_v2(uuid,uuid,text,numeric,text,uuid)",
    "cb8e5da70302cce2c27d526e4256762d",
    false,
  ],
  [
    "plugin_data.csf_set_application_intake(uuid,uuid,boolean,uuid)",
    "c34b102508d0740bf38b9726e9ea097a",
    true,
  ],
  [
    "plugin_data.csf_update_activity_locked_impl(uuid,uuid,uuid,uuid,jsonb,uuid,uuid)",
    "40ec03266f91f1ca8eb683db1a6dc008",
    false,
  ],
];

const relationFingerprints = [
  ["plugin_data.csf_opportunities", "9b1b4a82e52bf0b006bb4962fb64554d", false],
  [
    "plugin_data.csf_point_submissions",
    "9c89b53001230c25776267a5990e1175",
    false,
  ],
  [
    "plugin_data.csf_admin_audit_events",
    "d1dc57a4ba8b99f76f7f004ce6ba5bbf",
    false,
  ],
  ["plugin_data.csf_terms", "187a2d5a6edd2503074c1591fd5d757d", false],
  [
    "plugin_data.csf_term_applications",
    "9be38d4860e44a5696c75358d3707efc",
    false,
  ],
  [
    "plugin_data.csf_publication_notification_deliveries",
    "9615c8ab9d7f7ce4edc4c4bec52811e3",
    true,
  ],
];

export function csfOneTwoFortySixPosture(relationQuery) {
  const snapshots = relationFingerprints.map(([relation]) =>
    relationQuery
      .replaceAll("app_private.csf_release_worker_controls", relation)
      .replaceAll("app_private.csf_release_worker_receipts", relation),
  );
  const expected = relationFingerprints
    .map(
      ([relation, digest, runtimeDenied]) =>
        `('${relation.slice(relation.indexOf(".") + 1)}','${digest}',${runtimeDenied})`,
    )
    .join(",");
  return `AND NOT EXISTS (
    SELECT 1 FROM (VALUES ${expected}) expected(relname,digest,runtime_denied)
    FULL JOIN (${snapshots.join(" UNION ALL ")}) actual USING (relname)
    WHERE actual.relname IS NULL OR expected.relname IS NULL
      OR actual.digest IS DISTINCT FROM expected.digest
      OR actual.runtime_denied IS DISTINCT FROM expected.runtime_denied
  )`;
}
