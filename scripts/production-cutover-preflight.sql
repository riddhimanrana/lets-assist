-- Production 236 -> repository target 277 cutover preflight.
--
-- Read-only by construction: every check is SELECT or SHOW inside an explicit
-- READ ONLY transaction. Run this only with the reviewed Production read-only
-- URL, capture the complete output, and do not treat a Development or local
-- result as Production evidence.
--
--   psql -X "$PRODUCTION_READONLY_URL" \
--     -f scripts/production-cutover-preflight.sql
--
-- The only supported ledgers are:
--   pre-cutover   236 rows headed by 20260811001500
--   post-cutover  277 rows headed by 20260813010000 with the exact 41-row tail
--
-- Any partial, divergent, later, or wrong-tail ledger exits non-zero before
-- shape-specific relations are parsed. Relation inventories then fail with a
-- named blocker instead of sending a query against an object that is absent.
-- This makes the same file safe before and after cutover and useful on a
-- Production-baseline rehearsal clone.

\set ON_ERROR_STOP on
\timing off
\pset pager off
\if :{?accept_state_transitions}
\else
  \set accept_state_transitions 0
\endif

BEGIN TRANSACTION READ ONLY;

\echo '=============================================================='
\echo 'R0  Enforced read-only transaction'
\echo '=============================================================='
SELECT current_setting('transaction_read_only') = 'on' AS read_only_transaction
\gset
\if :read_only_transaction
  \echo 'PASS R0'
\else
  \echo 'FAIL R0: this session is not read-only.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'L0  Exact migration ledger'
\echo '    PASS: exactly 236/baseline or exactly 277/target'
\echo '=============================================================='
SELECT count(*) AS applied_migrations,
       min(version::text) AS first_version,
       max(version::text) AS head_version,
       count(*) FILTER (
         WHERE version::text > '20260811001500'
       ) AS target_migrations_applied
FROM supabase_migrations.schema_migrations;

WITH expected_baseline(version) AS (
  SELECT unnest(ARRAY[
    -- BEGIN EXACT PRODUCTION BASELINE VERSIONS
    '20260325181408','20260325193000','20260325200500','20260325221500',
    '20260325233000','20260325235500','20260326000000','20260326120000',
    '20260404010400','20260404030000','20260407162000','20260408022044',
    '20260411090000','20260411120000','20260411173000','20260411200000',
    '20260411213000','20260411223000','20260411230000','20260411235500',
    '20260412000001','20260412000002','20260412000003','20260412000004',
    '20260412000005','20260412000006','20260412000007','20260412001000',
    '20260412034647','20260412053000','20260412103000','20260412220000',
    '20260412230000','20260412230500','20260412231000','20260413000000',
    '20260413231741','20260414000000','20260415000000','20260416000000',
    '20260513000000','20260520000000','20260520002000','20260602000000',
    '20260602001000','20260602002000','20260602003000','20260603035734',
    '20260621193526','20260621210000','20260701040027','20260701041238',
    '20260701042331','20260701044135','20260701045444','20260701050435',
    '20260701050524','20260701051022','20260701052148','20260701052824',
    '20260701054111','20260701055524','20260701055714','20260701180752',
    '20260701193000','20260701202252','20260701202940','20260702015355',
    '20260702034458','20260702173448','20260703002340','20260703055743',
    '20260707213119','20260710041519','20260710043317','20260710044736',
    '20260710050346','20260710052353','20260712005625','20260712005626',
    '20260712010009','20260712010012','20260712010014','20260712010016',
    '20260712010018','20260712010020','20260712010023','20260712010025',
    '20260712010027','20260712010029','20260712010030','20260712010032',
    '20260712010034','20260712010036','20260712010038','20260712010040',
    '20260712010042','20260712010044','20260712010046','20260712010048',
    '20260712010050','20260712010051','20260712010053','20260712010055',
    '20260712010057','20260712010059','20260712010101','20260712010103',
    '20260712010105','20260712010106','20260712010108','20260712010110',
    '20260712010112','20260712010114','20260712010116','20260712010118',
    '20260712010120','20260712010121','20260712010124','20260712010126',
    '20260712010652','20260712010654','20260712011038','20260712011155',
    '20260712011156','20260712011157','20260712011512','20260712012500',
    '20260712013000','20260712013100','20260712013200','20260712013300',
    '20260712013400','20260712013500','20260712013600','20260712013601',
    '20260712013700','20260712013900','20260712014139','20260712014200',
    '20260712014203','20260712014223','20260712014300','20260712014400',
    '20260712014700','20260712014800','20260712015854','20260712020512',
    '20260712021055','20260712021110','20260712022509','20260712024700',
    '20260712030000','20260712032000','20260714235236','20260715001830',
    '20260715003820','20260715005340','20260715005407','20260715010232',
    '20260715010505','20260715013000','20260715013410','20260716032057',
    '20260716044050','20260716044620','20260716050923','20260716051441',
    '20260716051834','20260716053000','20260716201712','20260716213000',
    '20260716223000','20260716223500','20260716224500','20260716225000',
    '20260716225500','20260716230000','20260716230500','20260716231000',
    '20260716231500','20260716232000','20260716232500','20260716233000',
    '20260717032312','20260721071359','20260721071854','20260721095945',
    '20260723020219','20260723025954','20260730001001','20260730001002',
    '20260730001003','20260730001004','20260801222404','20260801223711',
    '20260801223804','20260801230447','20260801230913','20260801232231',
    '20260801233200','20260801233343','20260801234028','20260801234509',
    '20260801235515','20260801235714','20260802002941','20260802003517',
    '20260802004041','20260802010000','20260802010500','20260802195500',
    '20260803010000','20260803010500','20260806220000','20260806231500',
    '20260807090000','20260807223600','20260809211732','20260809212049',
    '20260809212324','20260809212833','20260809230155','20260810000028',
    '20260810002428','20260810004500','20260810013000','20260810014500',
    '20260810015500','20260810021019','20260810220100','20260810220200',
    '20260810220300','20260810220400','20260810220500','20260811001500'
    -- END EXACT PRODUCTION BASELINE VERSIONS
  ]::text[])
),
actual_baseline(version) AS (
  SELECT version::text
  FROM supabase_migrations.schema_migrations
  WHERE version::text <= '20260811001500'
)
SELECT NOT EXISTS (
  (
    SELECT version FROM expected_baseline
    EXCEPT
    SELECT version FROM actual_baseline
  )
  UNION ALL
  (
    SELECT version FROM actual_baseline
    EXCEPT
    SELECT version FROM expected_baseline
  )
) AS baseline_versions_exact
\gset

SELECT
  count(*) = 236
    AND min(version::text) = '20260325181408'
    AND max(version::text) = '20260811001500'
    AND :'baseline_versions_exact'::boolean
    AND count(*) FILTER (
      WHERE version::text > '20260811001500'
    ) = 0 AS baseline_ledger,
  count(*) = 277
    AND min(version::text) = '20260325181408'
    AND max(version::text) = '20260813010000'
    AND :'baseline_versions_exact'::boolean
    AND (
      SELECT array_agg(pending.version ORDER BY pending.version)
      FROM (
        SELECT version::text AS version
        FROM supabase_migrations.schema_migrations
        WHERE version::text > '20260811001500'
      ) AS pending
    ) = ARRAY[
      '20260811063522','20260811073000','20260811074518',
      '20260811081506','20260811085048','20260811100000',
      '20260811110000','20260811120000','20260811132454',
      '20260811160000','20260811161000','20260811170000',
      '20260811180000','20260811233646','20260812010529',
      '20260812030000','20260812065621','20260812071500',
      '20260812072357','20260812073000','20260812100000',
      '20260812100100','20260812100200','20260812100300',
      '20260812100400','20260812100500','20260812100600',
      '20260812100700','20260812100800','20260812100900',
      '20260812101000','20260812101100','20260812104754',
      '20260812114638','20260812115556','20260812132725',
      '20260812152300','20260812161500','20260812203000',
      '20260812203500','20260813010000'
    ]::text[] AS target_ledger
FROM supabase_migrations.schema_migrations
\gset

\if :baseline_ledger
  \set cutover_shape pre
  \echo 'PASS L0: exact Production baseline; 41 migrations pending.'
\elif :target_ledger
  \set cutover_shape post
  \echo 'PASS L0: exact repository target; zero migrations pending.'
\else
  \echo 'FAIL L0: unsupported or partial ledger. Stop; do not improvise.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'L1  Baseline relation inventory'
\echo '    PASS: every relation required by shared checks exists'
\echo '=============================================================='
SELECT required.relation_name AS missing_relation
FROM (
  VALUES
    ('public.certificates'),
    ('public.notifications'),
    ('public.organizations'),
    ('public.project_cancellation_jobs'),
    ('cron.job'),
    ('storage.objects')
) AS required(relation_name)
WHERE to_regclass(required.relation_name) IS NULL
ORDER BY required.relation_name;

SELECT bool_and(to_regclass(required.relation_name) IS NOT NULL)
  AS baseline_shape_ready
FROM (
  VALUES
    ('public.certificates'),
    ('public.notifications'),
    ('public.organizations'),
    ('public.project_cancellation_jobs'),
    ('cron.job'),
    ('storage.objects')
) AS required(relation_name)
\gset

\if :baseline_shape_ready
  \echo 'PASS L1: baseline relations are present.'
\else
  \echo 'FAIL L1: required relation missing. The list above is authoritative.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'S0  CSF relation inventory'
\echo '    PASS: all required CSF relations present'
\echo '    Missing/partial CSF fails before any CSF table is queried'
\echo '=============================================================='
SELECT required.relation_name AS missing_relation
FROM (
  VALUES
    ('plugin_data.csf_admin_audit_events'),
    ('plugin_data.csf_announcements'),
    ('plugin_data.csf_announcement_replies'),
    ('plugin_data.csf_communication_campaigns'),
    ('plugin_data.csf_communication_dispatch_attempts'),
    ('plugin_data.csf_onboarding_links')
) AS required(relation_name)
WHERE to_regclass(required.relation_name) IS NULL
ORDER BY required.relation_name;

SELECT
  count(*) FILTER (
    WHERE to_regclass(required.relation_name) IS NOT NULL
  ) = 6 AS csf_shape_ready,
  count(*) FILTER (
    WHERE to_regclass(required.relation_name) IS NOT NULL
  ) = 0 AS csf_shape_absent
FROM (
  VALUES
    ('plugin_data.csf_admin_audit_events'),
    ('plugin_data.csf_announcements'),
    ('plugin_data.csf_announcement_replies'),
    ('plugin_data.csf_communication_campaigns'),
    ('plugin_data.csf_communication_dispatch_attempts'),
    ('plugin_data.csf_onboarding_links')
) AS required(relation_name)
\gset

\if :csf_shape_ready
  \echo 'PASS S0: required CSF relations are present.'
\elif :csf_shape_absent
  \echo 'FAIL S0: no CSF relations are installed on this database.'
  \echo 'The pending CSF migrations reference these relations; stop and reconcile'
  \echo 'the reviewed plugin-install/schema sequence before attempting cutover.'
  SELECT 1 / 0 AS preflight_check_failed;
\else
  \echo 'FAIL S0: the CSF relation set is partial. Stop and reconcile drift.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'S1  plugin_data RLS and browser isolation — PASS: []'
\echo '    Browser roles must have no schema/object/default access'
\echo '=============================================================='
WITH client(role_name) AS (
  VALUES ('anon'::text), ('authenticated'::text)
),
violations(issue, object_name, role_name) AS (
  SELECT
    'table_without_rls'::text,
    pg_catalog.format('%I.%I', namespace.nspname, relation.relname),
    NULL::text
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'plugin_data'
    AND relation.relkind IN ('r', 'p')
    AND NOT relation.relrowsecurity
  UNION ALL
  SELECT
    'browser_schema_usage',
    namespace.nspname,
    client.role_name
  FROM pg_catalog.pg_namespace AS namespace
  CROSS JOIN client
  WHERE namespace.nspname = 'plugin_data'
    AND has_schema_privilege(client.role_name, namespace.oid, 'USAGE')
  UNION ALL
  SELECT
    'service_role_schema_usage_missing',
    namespace.nspname,
    'service_role'
  FROM pg_catalog.pg_namespace AS namespace
  WHERE namespace.nspname = 'plugin_data'
    AND NOT has_schema_privilege('service_role', namespace.oid, 'USAGE')
  UNION ALL
  SELECT
    'browser_table_privilege',
    pg_catalog.format('%I.%I', namespace.nspname, relation.relname),
    client.role_name
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN client
  WHERE namespace.nspname = 'plugin_data'
    AND relation.relkind IN ('r', 'p', 'v', 'm')
    AND has_table_privilege(
      client.role_name,
      relation.oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  UNION ALL
  SELECT
    'browser_sequence_privilege',
    pg_catalog.format('%I.%I', namespace.nspname, sequence_record.relname),
    client.role_name
  FROM pg_catalog.pg_class AS sequence_record
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = sequence_record.relnamespace
  CROSS JOIN client
  WHERE namespace.nspname = 'plugin_data'
    AND sequence_record.relkind = 'S'
    AND (
      has_sequence_privilege(client.role_name, sequence_record.oid, 'USAGE')
      OR has_sequence_privilege(client.role_name, sequence_record.oid, 'SELECT')
      OR has_sequence_privilege(client.role_name, sequence_record.oid, 'UPDATE')
    )
  UNION ALL
  SELECT
    'browser_function_execute',
    function_record.oid::regprocedure::text,
    client.role_name
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function_record.pronamespace
  CROSS JOIN client
  WHERE namespace.nspname = 'plugin_data'
    AND has_function_privilege(
      client.role_name,
      function_record.oid,
      'EXECUTE'
    )
  UNION ALL
  SELECT
    'policy_targets_public',
    pg_catalog.format('%I.%I', namespace.nspname, relation.relname),
    'public'
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'plugin_data'
    AND 0::oid = ANY(policy.polroles)
  UNION ALL
  SELECT
    'client_default_privilege',
    pg_catalog.format(
      '%I:%s',
      namespace.nspname,
      default_acl.defaclobjtype
    ),
    CASE
      WHEN exploded_acl.grantee = 0 THEN 'public'
      ELSE grantee.rolname::text
    END
  FROM pg_catalog.pg_default_acl AS default_acl
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = default_acl.defaclnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl)
    AS exploded_acl
  LEFT JOIN pg_catalog.pg_roles AS grantee
    ON grantee.oid = exploded_acl.grantee
  WHERE namespace.nspname = 'plugin_data'
    AND (
      exploded_acl.grantee = 0
      OR grantee.rolname IN ('anon', 'authenticated')
    )
)
SELECT
  count(*) = 0 AS plugin_data_isolation_pass,
  coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'issue', issue,
        'object', object_name,
        'role', role_name
      )
      ORDER BY issue, object_name, role_name
    ),
    '[]'::jsonb
  )::text AS plugin_data_isolation_violations
FROM violations
\gset
\echo :plugin_data_isolation_violations
\if :plugin_data_isolation_pass
  \echo 'PASS S1'
\else
  \echo 'FAIL S1: plugin_data is reachable by a browser role or lacks RLS.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'S2  DVHS CSF control-plane and setup consistency'
\echo '    PASS: catalog valid; any existing install is coherent'
\echo '    Provider booleans are handoff evidence, never secret output'
\echo '=============================================================='
WITH chapter AS (
  SELECT organization.id
  FROM public.organizations AS organization
  WHERE pg_catalog.lower(pg_catalog.btrim(organization.username)) = 'dvhighcsf'
),
state AS (
  SELECT
    (SELECT count(*) FROM chapter) AS chapter_count,
    EXISTS (
      SELECT 1
      FROM public.plugins AS plugin
      WHERE plugin.key = 'dvhs-csf'
        AND plugin.name = 'DVHS CSF'
        AND plugin.visibility = 'private'
        AND plugin.is_active
        AND plugin.private_codebase
    ) AS catalog_ready,
    EXISTS (
      SELECT 1
      FROM chapter
      JOIN public.organization_plugin_entitlements AS entitlement
        ON entitlement.organization_id = chapter.id
       AND entitlement.plugin_key = 'dvhs-csf'
      WHERE entitlement.status = 'active'
        AND (
          entitlement.starts_at IS NULL
          OR entitlement.starts_at <= pg_catalog.now()
        )
        AND (
          entitlement.ends_at IS NULL
          OR entitlement.ends_at > pg_catalog.now()
        )
    ) AS entitlement_ready,
    EXISTS (
      SELECT 1
      FROM chapter
      JOIN public.organization_plugin_installs AS install
        ON install.organization_id = chapter.id
       AND install.plugin_key = 'dvhs-csf'
      WHERE install.enabled
    ) AS install_ready,
    EXISTS (
      SELECT 1
      FROM chapter
      JOIN public.organization_plugin_data_boundaries AS boundary
        ON boundary.organization_id = chapter.id
       AND boundary.plugin_key = 'dvhs-csf'
    ) AS data_boundary_ready,
    (
      SELECT count(*)
      FROM chapter
      JOIN plugin_data.csf_roles AS role_record
        ON role_record.organization_id = chapter.id
      WHERE role_record.archived_at IS NULL
    ) AS active_role_count,
    (
      SELECT count(*)
      FROM chapter
      JOIN plugin_data.csf_cohorts AS cohort
        ON cohort.organization_id = chapter.id
      WHERE cohort.status = 'active'
    ) AS active_cohort_count,
    (
      SELECT count(*)
      FROM chapter
      JOIN plugin_data.csf_terms AS term
        ON term.organization_id = chapter.id
    ) AS term_count,
    (
      SELECT count(*)
      FROM chapter
      JOIN plugin_data.csf_terms AS term
        ON term.organization_id = chapter.id
      WHERE term.is_current
    ) AS current_term_count,
    EXISTS (
      SELECT 1
      FROM chapter
      JOIN public.organization_plugin_installs AS install
        ON install.organization_id = chapter.id
       AND install.plugin_key = 'dvhs-csf'
      WHERE nullif(
        pg_catalog.btrim(
          install.configuration #>> ARRAY[
            'communications',
            'broadcastTopics',
            'term_members',
            'topicKey'
          ]
        ),
        ''
      ) ~ '^[a-z0-9]([a-z0-9_.-]{0,62}[a-z0-9])?$'
        AND nullif(
          pg_catalog.btrim(
            install.configuration #>> ARRAY[
              'communications',
              'broadcastTopics',
              'term_members',
              'resendTopicId'
            ]
          ),
          ''
        ) ~ '^[A-Za-z0-9_-]{1,128}$'
    ) AS communications_configuration_ready,
    NOT EXISTS (
      SELECT 1
      FROM chapter
      JOIN public.organization_plugin_installs AS install
        ON install.organization_id = chapter.id
       AND install.plugin_key = 'dvhs-csf'
      WHERE (
        nullif(
          pg_catalog.btrim(
            install.configuration #>> ARRAY[
              'communications',
              'broadcastTopics',
              'term_members',
              'topicKey'
            ]
          ),
          ''
        ) IS NULL
      ) <> (
        nullif(
          pg_catalog.btrim(
            install.configuration #>> ARRAY[
              'communications',
              'broadcastTopics',
              'term_members',
              'resendTopicId'
            ]
          ),
          ''
        ) IS NULL
      )
    ) AS communications_configuration_consistent
)
SELECT
  chapter_count,
  catalog_ready,
  entitlement_ready,
  install_ready,
  data_boundary_ready,
  active_role_count,
  active_cohort_count,
  term_count,
  current_term_count,
  communications_configuration_ready,
  (
    catalog_ready
    AND chapter_count <= 1
    AND current_term_count <= 1
    AND communications_configuration_consistent
    AND (
      NOT install_ready
      OR (
        entitlement_ready
        AND data_boundary_ready
        AND active_role_count > 0
      )
    )
  ) AS csf_control_plane_pass
FROM state
\gset
\echo 'chapter_count=' :chapter_count
\echo 'catalog_ready=' :catalog_ready
\echo 'entitlement_ready=' :entitlement_ready
\echo 'install_ready=' :install_ready
\echo 'data_boundary_ready=' :data_boundary_ready
\echo 'active_role_count=' :active_role_count
\echo 'active_cohort_count=' :active_cohort_count
\echo 'term_count=' :term_count
\echo 'current_term_count=' :current_term_count
\echo 'communications_configuration_ready=' :communications_configuration_ready
\if :csf_control_plane_pass
  \echo 'PASS S2'
\else
  \echo 'FAIL S2: CSF catalog or an existing DVHS install is inconsistent.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D1  Duplicate verified certificates per signup — PASS: 0 rows'
\echo '    Blocks 20260811081506 certificates_verified_signup_unique'
\echo '=============================================================='
SELECT signup_id, count(*) AS certificate_count,
       array_agg(id ORDER BY id) AS certificate_ids
FROM public.certificates
WHERE type = 'verified' AND signup_id IS NOT NULL
GROUP BY signup_id
HAVING count(*) > 1;

SELECT NOT EXISTS (
  SELECT 1
  FROM public.certificates
  WHERE type = 'verified' AND signup_id IS NOT NULL
  GROUP BY signup_id
  HAVING count(*) > 1
) AS d1_pass
\gset
\if :d1_pass
  \echo 'PASS D1'
\else
  \echo 'FAIL D1: resolve duplicate verified certificates explicitly.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D2  Open CSF communications missing environment — PASS: 0 rows'
\echo '    Blocks 20260811073000 webhook-environment isolation'
\echo '=============================================================='
SELECT campaign.organization_id, campaign.id AS campaign_id,
       campaign.status,
       count(attempt.id) FILTER (
         WHERE attempt.state IN ('queued', 'processing')
       ) AS open_attempts
FROM plugin_data.csf_communication_campaigns AS campaign
LEFT JOIN plugin_data.csf_communication_dispatch_attempts AS attempt
  ON attempt.campaign_id = campaign.id
 AND attempt.organization_id = campaign.organization_id
WHERE (attempt.state IN ('queued', 'processing') OR campaign.status = 'draft')
  AND (
    nullif(btrim(coalesce(campaign.metadata->>'csf_environment', '')), '') IS NULL
    OR campaign.metadata->>'csf_environment' !~ '^[a-z0-9_]{1,64}$'
  )
GROUP BY campaign.organization_id, campaign.id, campaign.status
ORDER BY campaign.organization_id, campaign.id;

SELECT NOT EXISTS (
  SELECT 1
  FROM plugin_data.csf_communication_campaigns AS campaign
  LEFT JOIN plugin_data.csf_communication_dispatch_attempts AS attempt
    ON attempt.campaign_id = campaign.id
   AND attempt.organization_id = campaign.organization_id
  WHERE (attempt.state IN ('queued', 'processing') OR campaign.status = 'draft')
    AND (
      nullif(btrim(coalesce(campaign.metadata->>'csf_environment', '')), '') IS NULL
      OR campaign.metadata->>'csf_environment' !~ '^[a-z0-9_]{1,64}$'
    )
) AS d2_pass
\gset
\if :d2_pass
  \echo 'PASS D2'
\else
  \echo 'FAIL D2: bind every draft/open campaign to its backend environment.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D3  Duplicate active reusable class links — PASS: 0 rows'
\echo '    Blocks 20260811161000 one-active-link index'
\echo '=============================================================='
SELECT organization_id, cohort_id, term_id, count(*) AS active_links,
       array_agg(id ORDER BY id) AS link_ids
FROM plugin_data.csf_onboarding_links
WHERE invitation_scope = 'cohort'
  AND is_active
  AND cohort_id IS NOT NULL
  AND term_id IS NOT NULL
GROUP BY organization_id, cohort_id, term_id
HAVING count(*) > 1;

SELECT NOT EXISTS (
  SELECT 1
  FROM plugin_data.csf_onboarding_links
  WHERE invitation_scope = 'cohort'
    AND is_active
    AND cohort_id IS NOT NULL
    AND term_id IS NOT NULL
  GROUP BY organization_id, cohort_id, term_id
  HAVING count(*) > 1
) AS d3_pass
\gset
\if :d3_pass
  \echo 'PASS D3'
\else
  \echo 'FAIL D3: deactivate extras through Members -> Account connections.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D4  Existing organization uses reserved route slug — PASS: 0 rows'
\echo '    Blocks 20260812100000 validated CHECK'
\echo '=============================================================='
SELECT id AS organization_id
FROM public.organizations
WHERE lower(
  regexp_replace(
    normalize(username, nfkc),
    '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+'
      || '|'
      || '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '',
    'g'
  )
) = ANY (ARRAY['create', 'join'])
ORDER BY id;

SELECT NOT EXISTS (
  SELECT 1
  FROM public.organizations
  WHERE lower(
    regexp_replace(
      normalize(username, nfkc),
      '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+'
        || '|'
        || '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
      '',
      'g'
    )
  ) = ANY (ARRAY['create', 'join'])
) AS d4_pass
\gset
\if :d4_pass
  \echo 'PASS D4'
\else
  \echo 'FAIL D4: adjudicate unreachable reserved-slug organizations.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D5  Cancellation-job baseline values outside target checks'
\echo '    PASS: 0 rows'
\echo '=============================================================='
SELECT id, status, attempts, "cursor"
FROM public.project_cancellation_jobs
WHERE status IS NULL
   OR status NOT IN ('pending', 'processing', 'completed', 'failed', 'needs_review')
   OR attempts IS NULL
   OR attempts < 0
ORDER BY id;

SELECT NOT EXISTS (
  SELECT 1
  FROM public.project_cancellation_jobs
  WHERE status IS NULL
     OR status NOT IN ('pending', 'processing', 'completed', 'failed', 'needs_review')
     OR attempts IS NULL
     OR attempts < 0
) AS d5_pass
\gset
\if :d5_pass
  \echo 'PASS D5'
\else
  \echo 'FAIL D5: unsupported cancellation state would fail target constraints.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\if :baseline_ledger
  \echo ''
  \echo '=============================================================='
  \echo 'D6  Rows deliberately transitioned by pending cancellation migrations'
  \echo '    PASS: zero, or rerun with -v accept_state_transitions=1'
  \echo '    only after counts are reviewed and maintenance has stopped workers'
  \echo '=============================================================='
  SELECT status, count(*) AS jobs,
         count(*) FILTER (WHERE "cursor" > 0) AS advanced_cursor_jobs,
         count(*) FILTER (WHERE status = 'completed') AS completed_to_review,
         count(*) FILTER (WHERE attempts > 5) AS attempts_to_clamp
  FROM public.project_cancellation_jobs
  WHERE status IN ('pending', 'processing', 'completed') OR attempts > 5
  GROUP BY status
  ORDER BY status;

  SELECT (
    NOT EXISTS (
      SELECT 1
      FROM public.project_cancellation_jobs
      WHERE status IN ('pending', 'processing', 'completed') OR attempts > 5
    )
    OR :'accept_state_transitions' = '1'
  ) AS d6_pass
  \gset
  \if :d6_pass
    \echo 'PASS D6: transition inventory is empty or explicitly accepted.'
  \else
    \echo 'FAIL D6: capture and adjudicate transition counts, then rerun explicitly.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif
\endif

\echo ''
\echo '=============================================================='
\echo 'D7  Cross-organization CSF post replies — PASS: 0 rows'
\echo '    Blocks 20260812152300 tenant FK validation'
\echo '=============================================================='
SELECT reply.id AS reply_id, reply.organization_id,
       reply.announcement_id,
       announcement.organization_id AS announcement_organization_id
FROM plugin_data.csf_announcement_replies AS reply
LEFT JOIN plugin_data.csf_announcements AS announcement
  ON announcement.id = reply.announcement_id
WHERE announcement.id IS NULL
   OR announcement.organization_id IS DISTINCT FROM reply.organization_id
ORDER BY reply.id;

SELECT NOT EXISTS (
  SELECT 1
  FROM plugin_data.csf_announcement_replies AS reply
  LEFT JOIN plugin_data.csf_announcements AS announcement
    ON announcement.id = reply.announcement_id
  WHERE announcement.id IS NULL
     OR announcement.organization_id IS DISTINCT FROM reply.organization_id
) AS d7_pass
\gset
\if :d7_pass
  \echo 'PASS D7'
\else
  \echo 'FAIL D7: target tenant FK validation would fail.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D8  Duplicate/unkeyed CSF post-reply request receipts'
\echo '    PASS: 0 rows; blocks 20260812152300 unique index'
\echo '=============================================================='
SELECT organization_id, correlation_id, count(*) AS receipts
FROM plugin_data.csf_admin_audit_events
WHERE source_type = 'post_reply_mutation_request'
  AND action IN ('post_reply_added', 'post_reply_deleted')
GROUP BY organization_id, correlation_id
HAVING correlation_id IS NULL OR count(*) > 1;

SELECT NOT EXISTS (
  SELECT 1
  FROM plugin_data.csf_admin_audit_events
  WHERE source_type = 'post_reply_mutation_request'
    AND action IN ('post_reply_added', 'post_reply_deleted')
  GROUP BY organization_id, correlation_id
  HAVING correlation_id IS NULL OR count(*) > 1
) AS d8_pass
\gset
\if :d8_pass
  \echo 'PASS D8'
\else
  \echo 'FAIL D8: target replay-receipt uniqueness would fail.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D9  External dependencies on pg_graphql objects — PASS: 0 rows'
\echo '    Blocks 20260811132454 DROP EXTENSION ... RESTRICT'
\echo '=============================================================='
WITH extension_record AS (
  SELECT oid
  FROM pg_catalog.pg_extension
  WHERE extname = 'pg_graphql'
),
extension_members AS (
  SELECT dependency.classid, dependency.objid
  FROM pg_catalog.pg_depend AS dependency
  JOIN extension_record
    ON extension_record.oid = dependency.refobjid
  WHERE dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    AND dependency.deptype = 'e'
),
extension_roots AS (
  SELECT 'pg_catalog.pg_extension'::regclass AS classid, oid AS objid
  FROM extension_record
  UNION ALL
  SELECT classid, objid
  FROM extension_members
),
blockers AS (
  SELECT dependency.*
  FROM pg_catalog.pg_depend AS dependency
  JOIN extension_roots AS referenced_object
    ON referenced_object.classid = dependency.refclassid
   AND referenced_object.objid = dependency.refobjid
  WHERE dependency.deptype = 'n'
    AND NOT EXISTS (
    SELECT 1
    FROM extension_members AS dependent_member
    WHERE dependent_member.classid = dependency.classid
      AND dependent_member.objid = dependency.objid
  )
)
SELECT
  pg_catalog.pg_describe_object(
    blocker.classid,
    blocker.objid,
    blocker.objsubid
  ) AS dependent_object,
  pg_catalog.pg_describe_object(
    blocker.refclassid,
    blocker.refobjid,
    blocker.refobjsubid
  ) AS extension_object
FROM blockers AS blocker
ORDER BY dependent_object, extension_object;

WITH extension_record AS (
  SELECT oid
  FROM pg_catalog.pg_extension
  WHERE extname = 'pg_graphql'
),
extension_members AS (
  SELECT dependency.classid, dependency.objid
  FROM pg_catalog.pg_depend AS dependency
  JOIN extension_record
    ON extension_record.oid = dependency.refobjid
  WHERE dependency.refclassid = 'pg_catalog.pg_extension'::regclass
    AND dependency.deptype = 'e'
),
extension_roots AS (
  SELECT 'pg_catalog.pg_extension'::regclass AS classid, oid AS objid
  FROM extension_record
  UNION ALL
  SELECT classid, objid
  FROM extension_members
)
SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_depend AS dependency
  JOIN extension_roots AS referenced_object
    ON referenced_object.classid = dependency.refclassid
   AND referenced_object.objid = dependency.refobjid
  WHERE dependency.deptype = 'n'
    AND NOT EXISTS (
    SELECT 1
    FROM extension_members AS dependent_member
    WHERE dependent_member.classid = dependency.classid
      AND dependent_member.objid = dependency.objid
  )
) AS d9_pass
\gset
\if :d9_pass
  \echo 'PASS D9'
\else
  \echo 'FAIL D9: DROP EXTENSION ... RESTRICT would fail.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\if :baseline_ledger
  \echo ''
  \echo '=============================================================='
  \echo 'D10 Reviewed public client grants still effective'
  \echo '    PASS: 0 missing grants on relations present at this shape'
  \echo '    Guards 20260812100900 before it revokes and rebuilds ACLs'
  \echo '=============================================================='
  WITH catalog(relation_name, role_name, privilege, columns) AS (
  VALUES
    ('account_data_export_audit_logs','authenticated','DELETE',NULL::text[]),
    ('account_data_export_audit_logs','authenticated','INSERT',NULL::text[]),
    ('account_data_export_audit_logs','authenticated','SELECT',NULL::text[]),
    ('account_data_export_audit_logs','authenticated','UPDATE',NULL::text[]),
    ('account_data_export_jobs','authenticated','DELETE',NULL::text[]),
    ('account_data_export_jobs','authenticated','INSERT',NULL::text[]),
    ('account_data_export_jobs','authenticated','SELECT',NULL::text[]),
    ('account_data_export_jobs','authenticated','UPDATE',NULL::text[]),
    ('anonymous_signups','authenticated','DELETE',NULL::text[]),
    ('anonymous_signups','authenticated','INSERT',NULL::text[]),
    ('anonymous_signups','authenticated','SELECT',NULL::text[]),
    ('anonymous_signups','authenticated','UPDATE',NULL::text[]),
    ('certificate_verification_read_model','anon','SELECT',NULL::text[]),
    ('certificate_verification_read_model','authenticated','SELECT',NULL::text[]),
    ('certificates','authenticated','DELETE',NULL::text[]),
    ('certificates','authenticated','INSERT',NULL::text[]),
    ('certificates','authenticated','SELECT',NULL::text[]),
    ('certificates','authenticated','UPDATE',NULL::text[]),
    ('content_flags','authenticated','INSERT',NULL::text[]),
    ('content_flags','authenticated','SELECT',NULL::text[]),
    ('content_flags','authenticated','UPDATE',NULL::text[]),
    ('content_reports','authenticated','DELETE',NULL::text[]),
    ('content_reports','authenticated','INSERT',NULL::text[]),
    ('content_reports','authenticated','SELECT',NULL::text[]),
    ('content_reports','authenticated','UPDATE',NULL::text[]),
    ('feedback','authenticated','DELETE',NULL::text[]),
    ('feedback','authenticated','INSERT',NULL::text[]),
    ('feedback','authenticated','SELECT',NULL::text[]),
    ('feedback','authenticated','UPDATE',NULL::text[]),
    ('notification_settings','authenticated','DELETE',NULL::text[]),
    ('notification_settings','authenticated','INSERT',NULL::text[]),
    ('notification_settings','authenticated','SELECT',NULL::text[]),
    ('notification_settings','authenticated','UPDATE',NULL::text[]),
    ('notifications','authenticated','INSERT',NULL::text[]),
    ('notifications','authenticated','SELECT',NULL::text[]),
    ('notifications','authenticated','UPDATE',NULL::text[]),
    ('organization_calendar_events','authenticated','DELETE',NULL::text[]),
    ('organization_calendar_events','authenticated','INSERT',NULL::text[]),
    ('organization_calendar_events','authenticated','SELECT',NULL::text[]),
    ('organization_calendar_events','authenticated','UPDATE',NULL::text[]),
    ('organization_contact_import_jobs','authenticated','DELETE',NULL::text[]),
    ('organization_contact_import_jobs','authenticated','INSERT',NULL::text[]),
    ('organization_contact_import_jobs','authenticated','SELECT',NULL::text[]),
    ('organization_contact_import_jobs','authenticated','UPDATE',NULL::text[]),
    ('organization_contact_import_rows','authenticated','DELETE',NULL::text[]),
    ('organization_contact_import_rows','authenticated','INSERT',NULL::text[]),
    ('organization_contact_import_rows','authenticated','SELECT',NULL::text[]),
    ('organization_contact_import_rows','authenticated','UPDATE',NULL::text[]),
    ('organization_invitation_acceptance_read_model','anon','SELECT',NULL::text[]),
    ('organization_invitation_acceptance_read_model','authenticated','SELECT',NULL::text[]),
    ('organization_invitations','anon','SELECT',NULL::text[]),
    ('organization_invitations','authenticated','INSERT',NULL::text[]),
    ('organization_invitations','authenticated','SELECT',NULL::text[]),
    ('organization_invitations','authenticated','UPDATE',NULL::text[]),
    ('organization_members','anon','SELECT',NULL::text[]),
    ('organization_members','authenticated','SELECT',NULL::text[]),
    ('organization_members','authenticated','UPDATE',NULL::text[]),
    ('organization_plugin_access','authenticated','SELECT',NULL::text[]),
    ('organization_plugin_entitlements','authenticated','SELECT',NULL::text[]),
    ('organization_plugin_feature_flags','authenticated','SELECT',NULL::text[]),
    ('organization_plugin_installs','authenticated','SELECT',NULL::text[]),
    ('organization_plugin_routes','authenticated','DELETE',NULL::text[]),
    ('organization_plugin_routes','authenticated','INSERT',NULL::text[]),
    ('organization_plugin_routes','authenticated','SELECT',NULL::text[]),
    ('organization_plugin_routes','authenticated','UPDATE',NULL::text[]),
    ('organization_public_member_read_model','anon','SELECT',NULL::text[]),
    ('organization_public_member_read_model','authenticated','SELECT',NULL::text[]),
    ('organization_public_read_model','anon','SELECT',NULL::text[]),
    ('organization_public_read_model','authenticated','SELECT',NULL::text[]),
    ('organizations','anon','SELECT',ARRAY[
      'allowed_email_domains','created_at','description','id','logo_url','name',
      'show_members_publicly','type','username','verified','website'
    ]::text[]),
    ('organizations','authenticated','DELETE',NULL::text[]),
    ('organizations','authenticated','INSERT',ARRAY[
      'allowed_email_domains','auto_join_domain','created_at','created_by',
      'description','id','join_code','logo_url','name',
      'setup_checklist_dismissed_at','show_members_publicly','staff_join_token',
      'staff_join_token_created_at','staff_join_token_expires_at','type',
      'username','verified','website'
    ]::text[]),
    ('organizations','authenticated','SELECT',ARRAY[
      'allowed_email_domains','created_at','description','id','logo_url','name',
      'setup_checklist_dismissed_at','show_members_publicly','type','username',
      'verified','website'
    ]::text[]),
    ('organizations','authenticated','UPDATE',ARRAY[
      'allowed_email_domains','auto_join_domain','created_at','created_by',
      'description','id','join_code','logo_url','name',
      'setup_checklist_dismissed_at','show_members_publicly','staff_join_token',
      'staff_join_token_created_at','staff_join_token_expires_at','type',
      'username','verified','website'
    ]::text[]),
    ('plugin_audit_logs','authenticated','SELECT',NULL::text[]),
    ('plugin_runtime_contracts','authenticated','SELECT',NULL::text[]),
    ('plugin_versions','authenticated','SELECT',NULL::text[]),
    ('plugins','authenticated','SELECT',NULL::text[]),
    ('profiles','authenticated','DELETE',NULL::text[]),
    ('profiles','authenticated','INSERT',NULL::text[]),
    ('profiles','authenticated','SELECT',NULL::text[]),
    ('profiles','authenticated','UPDATE',NULL::text[]),
    ('project_discovery_read_model','anon','SELECT',NULL::text[]),
    ('project_discovery_read_model','authenticated','SELECT',NULL::text[]),
    ('project_drafts','authenticated','DELETE',NULL::text[]),
    ('project_drafts','authenticated','INSERT',NULL::text[]),
    ('project_drafts','authenticated','SELECT',NULL::text[]),
    ('project_drafts','authenticated','UPDATE',NULL::text[]),
    ('project_feedback','authenticated','INSERT',NULL::text[]),
    ('project_feedback','authenticated','SELECT',NULL::text[]),
    ('project_feedback','authenticated','UPDATE',NULL::text[]),
    ('project_paper_roster_entries','authenticated','SELECT',NULL::text[]),
    ('project_paper_scan_batches','authenticated','SELECT',NULL::text[]),
    ('project_paper_scan_images','authenticated','SELECT',NULL::text[]),
    ('project_paper_scan_rows','authenticated','SELECT',NULL::text[]),
    ('project_signups','authenticated','SELECT',NULL::text[]),
    ('project_signups','authenticated','UPDATE',NULL::text[]),
    ('projects','anon','SELECT',NULL::text[]),
    ('projects','authenticated','DELETE',NULL::text[]),
    ('projects','authenticated','INSERT',NULL::text[]),
    ('projects','authenticated','SELECT',NULL::text[]),
    ('projects','authenticated','UPDATE',NULL::text[]),
    ('projects_with_creator','anon','SELECT',NULL::text[]),
    ('projects_with_creator','authenticated','SELECT',NULL::text[]),
    ('public_profile_read_model','anon','SELECT',NULL::text[]),
    ('public_profile_read_model','authenticated','SELECT',NULL::text[]),
    ('system_banners','authenticated','SELECT',NULL::text[]),
    ('trusted_member','authenticated','DELETE',NULL::text[]),
    ('trusted_member','authenticated','INSERT',NULL::text[]),
    ('trusted_member','authenticated','SELECT',NULL::text[]),
    ('trusted_member','authenticated','UPDATE',NULL::text[]),
    ('user_calendar_connections','authenticated','DELETE',NULL::text[]),
    ('user_calendar_connections','authenticated','INSERT',NULL::text[]),
    ('user_calendar_connections','authenticated','SELECT',NULL::text[]),
    ('user_calendar_connections','authenticated','UPDATE',NULL::text[]),
    ('user_certificate_read_model','anon','SELECT',NULL::text[]),
    ('user_certificate_read_model','authenticated','SELECT',NULL::text[]),
    ('user_emails','authenticated','DELETE',NULL::text[]),
    ('user_emails','authenticated','SELECT',NULL::text[]),
    ('user_plugin_display_preferences','authenticated','DELETE',NULL::text[]),
    ('user_plugin_display_preferences','authenticated','INSERT',NULL::text[]),
    ('user_plugin_display_preferences','authenticated','SELECT',NULL::text[]),
    ('user_plugin_display_preferences','authenticated','UPDATE',NULL::text[])
),
expected AS (
  SELECT relation_name, role_name, privilege, NULL::text AS column_name
  FROM catalog
  WHERE columns IS NULL
  UNION ALL
  SELECT catalog.relation_name, catalog.role_name, catalog.privilege,
         expected_column.column_name
  FROM catalog
  CROSS JOIN LATERAL unnest(catalog.columns)
    AS expected_column(column_name)
  WHERE catalog.columns IS NOT NULL
),
present_relations AS (
  SELECT relation.oid, relation.relname::text AS relation_name
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p', 'v', 'm')
),
missing_effective AS (
  SELECT expected.*
  FROM expected
  JOIN present_relations AS relation
    ON relation.relation_name = expected.relation_name
  LEFT JOIN pg_catalog.pg_roles AS role_entry
    ON role_entry.rolname = expected.role_name
  WHERE role_entry.oid IS NULL
     OR NOT CASE
       WHEN expected.column_name IS NULL THEN
         has_table_privilege(role_entry.oid, relation.oid, expected.privilege)
       ELSE
         has_column_privilege(
           role_entry.oid,
           relation.oid,
           expected.column_name,
           expected.privilege
         )
     END
),
missing_relation AS (
  SELECT expected.*
  FROM expected
  WHERE to_regclass('public.' || expected.relation_name) IS NULL
    AND NOT (
      :'cutover_shape' = 'pre'
      AND expected.relation_name IN (
        'project_feedback',
        'project_paper_roster_entries',
        'project_paper_scan_batches',
        'project_paper_scan_images',
        'project_paper_scan_rows'
      )
    )
),
missing AS (
  SELECT * FROM missing_effective
  UNION ALL
  SELECT * FROM missing_relation
)
SELECT
  count(*) = 0 AS d10_pass,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'relation', relation_name,
        'role', role_name,
        'privilege', privilege,
        'column', column_name
      )
      ORDER BY relation_name, role_name, privilege, column_name
    ),
    '[]'::jsonb
  ) AS d10_missing_grants
  FROM missing
  \gset
  \echo :d10_missing_grants
  \if :d10_pass
    \echo 'PASS D10'
  \else
    \echo 'FAIL D10: reviewed grants are missing before ACL convergence.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif
\endif

\if :target_ledger
  \echo ''
  \echo '=============================================================='
  \echo 'T1  Target-only relation inventory — PASS: all present'
  \echo '=============================================================='
  SELECT required.relation_name AS missing_relation
  FROM (
    VALUES
      ('public.hours_publication_receipts'),
      ('public.hours_publication_email_outbox'),
      ('public.project_cancellation_deliveries'),
      ('public.project_feedback_requests'),
      ('public.reporter_references'),
      ('public.api_rate_limit_receipts'),
      ('private.plugin_data_deletion_requests'),
      ('app_private.storage_object_policy_contract')
  ) AS required(relation_name)
  WHERE to_regclass(required.relation_name) IS NULL
  ORDER BY required.relation_name;

  SELECT bool_and(to_regclass(required.relation_name) IS NOT NULL)
    AS target_shape_ready
  FROM (
    VALUES
      ('public.hours_publication_receipts'),
      ('public.hours_publication_email_outbox'),
      ('public.project_cancellation_deliveries'),
      ('public.project_feedback_requests'),
      ('public.reporter_references'),
      ('public.api_rate_limit_receipts'),
      ('private.plugin_data_deletion_requests'),
      ('app_private.storage_object_policy_contract')
  ) AS required(relation_name)
  \gset
  \if :target_shape_ready
    \echo 'PASS T1'
  \else
    \echo 'FAIL T1: target ledger and target schema disagree.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  \echo ''
  \echo '=============================================================='
  \echo 'T2  Target constraints, indexes, detachment, and definer ACLs'
  \echo '    PASS: 0 missing/invalid'
  \echo '=============================================================='
  SELECT expected.kind, expected.relation_name, expected.object_name
  FROM (
    VALUES
      ('constraint', 'public.organizations',
        'organizations_username_not_reserved_check'),
      ('constraint', 'public.project_cancellation_jobs',
        'project_cancellation_jobs_snapshot_identifiers_match'),
      ('constraint', 'public.project_cancellation_jobs',
        'project_cancellation_jobs_status_check'),
      ('constraint', 'public.project_cancellation_jobs',
        'project_cancellation_jobs_attempts_bound'),
      ('constraint', 'public.project_cancellation_jobs',
        'project_cancellation_jobs_lease_shape'),
      ('constraint', 'public.project_cancellation_deliveries',
        'project_cancellation_deliveries_snapshot_identifiers_match'),
      ('constraint', 'plugin_data.csf_announcement_replies',
        'csf_announcement_replies_announcement_organization_fkey'),
      ('index', 'public.certificates',
        'certificates_verified_signup_unique'),
      ('index', 'plugin_data.csf_onboarding_links',
        'csf_onboarding_links_active_cohort_uidx'),
      ('index', 'plugin_data.csf_admin_audit_events',
        'csf_admin_audit_events_post_reply_request_idx'),
      ('index', 'public.content_reports',
        'content_reports_request_occurrence_uidx'),
      ('constraint', 'public.content_reports',
        'content_reports_request_fingerprint_format_check'),
      ('constraint', 'public.content_reports',
        'content_reports_request_identity_complete_check'),
      ('constraint', 'public.reporter_references',
        'reporter_references_reporter_id_key'),
      ('fk_delete_set_null', 'public.content_reports',
        'content_reports_reporter_id_fkey'),
      ('fk_delete_set_null', 'public.reporter_references',
        'reporter_references_reporter_id_fkey'),
      ('fk_delete_restrict', 'public.content_reports',
        'content_reports_reporter_reference_fkey'),
      ('server_only_function', 'public',
        'submit_content_report(text,uuid,text,uuid,text,text,integer,text[],integer[],integer)'),
      ('server_only_function', 'public',
        'consume_content_report_attempt(text[],integer[],integer)'),
      ('server_only_function', 'public',
        'detach_content_report_reporter(uuid)'),
      ('index', 'public.api_rate_limit_receipts',
        'api_rate_limit_receipts_expiry_idx')
  ) AS expected(kind, relation_name, object_name)
  WHERE (
    expected.kind = 'constraint'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.conname = expected.object_name
        AND constraint_record.conrelid = to_regclass(expected.relation_name)
        AND constraint_record.convalidated
    )
  ) OR (
    expected.kind = 'index'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS index_record
      JOIN pg_catalog.pg_index AS index_state
        ON index_state.indexrelid = index_record.oid
      WHERE index_record.relname = expected.object_name
        AND index_state.indrelid = to_regclass(expected.relation_name)
        AND index_state.indisvalid
        AND index_state.indisready
    )
  ) OR (
    expected.kind IN ('fk_delete_set_null', 'fk_delete_restrict')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.conname = expected.object_name
        AND constraint_record.conrelid = to_regclass(expected.relation_name)
        AND constraint_record.contype = 'f'
        AND constraint_record.convalidated
        AND constraint_record.confdeltype = CASE expected.kind
          WHEN 'fk_delete_set_null' THEN 'n'::"char"
          ELSE 'r'::"char"
        END
    )
  ) OR (
    expected.kind = 'server_only_function'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS function_record
      WHERE function_record.oid = to_regprocedure(
          expected.relation_name || '.' || expected.object_name
        )
        AND function_record.prosecdef
        AND function_record.proconfig @> ARRAY['search_path=""']
        AND has_function_privilege('service_role', function_record.oid, 'EXECUTE')
    )
  )
  ORDER BY expected.kind, expected.object_name;

  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('constraint', 'public.organizations',
          'organizations_username_not_reserved_check'),
        ('constraint', 'public.project_cancellation_jobs',
          'project_cancellation_jobs_snapshot_identifiers_match'),
        ('constraint', 'public.project_cancellation_jobs',
          'project_cancellation_jobs_status_check'),
        ('constraint', 'public.project_cancellation_jobs',
          'project_cancellation_jobs_attempts_bound'),
        ('constraint', 'public.project_cancellation_jobs',
          'project_cancellation_jobs_lease_shape'),
        ('constraint', 'public.project_cancellation_deliveries',
          'project_cancellation_deliveries_snapshot_identifiers_match'),
        ('constraint', 'plugin_data.csf_announcement_replies',
          'csf_announcement_replies_announcement_organization_fkey'),
        ('index', 'public.certificates',
          'certificates_verified_signup_unique'),
        ('index', 'plugin_data.csf_onboarding_links',
          'csf_onboarding_links_active_cohort_uidx'),
        ('index', 'plugin_data.csf_admin_audit_events',
          'csf_admin_audit_events_post_reply_request_idx'),
        ('index', 'public.content_reports',
          'content_reports_request_occurrence_uidx'),
        ('constraint', 'public.content_reports',
          'content_reports_request_fingerprint_format_check'),
        ('constraint', 'public.content_reports',
          'content_reports_request_identity_complete_check'),
        ('constraint', 'public.reporter_references',
          'reporter_references_reporter_id_key'),
        ('fk_delete_set_null', 'public.content_reports',
          'content_reports_reporter_id_fkey'),
        ('fk_delete_set_null', 'public.reporter_references',
          'reporter_references_reporter_id_fkey'),
        ('fk_delete_restrict', 'public.content_reports',
          'content_reports_reporter_reference_fkey'),
        ('server_only_function', 'public',
          'submit_content_report(text,uuid,text,uuid,text,text,integer,text[],integer[],integer)'),
        ('server_only_function', 'public',
          'consume_content_report_attempt(text[],integer[],integer)'),
        ('server_only_function', 'public',
          'detach_content_report_reporter(uuid)'),
        ('index', 'public.api_rate_limit_receipts',
          'api_rate_limit_receipts_expiry_idx')
    ) AS expected(kind, relation_name, object_name)
    WHERE (
      expected.kind = 'constraint'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_record
        WHERE constraint_record.conname = expected.object_name
          AND constraint_record.conrelid = to_regclass(expected.relation_name)
          AND constraint_record.convalidated
      )
    ) OR (
      expected.kind = 'index'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS index_record
        JOIN pg_catalog.pg_index AS index_state
          ON index_state.indexrelid = index_record.oid
        WHERE index_record.relname = expected.object_name
          AND index_state.indrelid = to_regclass(expected.relation_name)
          AND index_state.indisvalid
          AND index_state.indisready
      )
    ) OR (
      expected.kind IN ('fk_delete_set_null', 'fk_delete_restrict')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_record
        WHERE constraint_record.conname = expected.object_name
          AND constraint_record.conrelid = to_regclass(expected.relation_name)
          AND constraint_record.contype = 'f'
          AND constraint_record.convalidated
          AND constraint_record.confdeltype = CASE expected.kind
            WHEN 'fk_delete_set_null' THEN 'n'::"char"
            ELSE 'r'::"char"
          END
      )
    ) OR (
      expected.kind = 'server_only_function'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS function_record
        WHERE function_record.oid = to_regprocedure(
            expected.relation_name || '.' || expected.object_name
          )
          AND function_record.prosecdef
          AND function_record.proconfig @> ARRAY['search_path=""']
          AND has_function_privilege('service_role', function_record.oid, 'EXECUTE')
      )
    )
  ) AS t2_pass
  \gset
  \if :t2_pass
    \echo 'PASS T2'
  \else
    \echo 'FAIL T2: target ledger claims objects that are missing or invalid.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  \echo ''
  \echo '=============================================================='
  \echo 'T3  Target pg_graphql posture — PASS: extension absent'
  \echo '=============================================================='
  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension
    WHERE extname = 'pg_graphql'
  ) AS target_pg_graphql_absent
  \gset
  \if :target_pg_graphql_absent
    \echo 'PASS T3'
  \else
    \echo 'FAIL T3: target ledger says pg_graphql was removed, but it remains.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  \echo ''
  \echo '=============================================================='
  \echo 'T5  Public read-model and function ACL posture'
  \echo '    PASS: security-invoker read models and exact client RPC ACL'
  \echo '=============================================================='
  SELECT namespace.nspname AS schema_name,
         relation.relname AS read_model,
         relation.reloptions
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind = 'v'
    AND relation.relname LIKE '%\_read\_model'
    AND NOT coalesce(
      relation.reloptions,
      ARRAY[]::text[]
    ) @> ARRAY['security_invoker=true']
  ORDER BY relation.relname;

  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind = 'v'
      AND relation.relname LIKE '%\_read\_model'
      AND NOT coalesce(
        relation.reloptions,
        ARRAY[]::text[]
      ) @> ARRAY['security_invoker=true']
  ) AS target_read_models_pass
  \gset
  \if :target_read_models_pass
    \echo 'PASS T5a: every public read model is security_invoker.'
  \else
    \echo 'FAIL T5a: a public read model can bypass caller RLS.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  WITH expected(signature, role_name) AS (
    VALUES
      ('public.can_insert_project(uuid)', 'authenticated'),
      ('public.can_insert_project(uuid,text,uuid)', 'authenticated'),
      ('public.can_keep_or_set_public_visibility(uuid,uuid)', 'authenticated'),
      ('public.cancel_project_transactional(uuid,text)', 'authenticated'),
      ('public.get_public_attendees(uuid)', 'anon'),
      ('public.get_public_attendees(uuid)', 'authenticated'),
      ('public.is_project_organizer(uuid,uuid)', 'authenticated'),
      ('public.is_super_admin()', 'authenticated'),
      ('public.is_trusted_member(uuid)', 'authenticated'),
      ('public.reject_project_signup(uuid)', 'authenticated'),
      ('public.unreject_project_signup_with_capacity(uuid)', 'authenticated')
  ),
  client(role_name) AS (
    VALUES ('anon'::text), ('authenticated'::text)
  ),
  actual AS (
    SELECT
      pg_catalog.format(
        'public.%I(%s)',
        function_record.proname,
        pg_catalog.replace(
          pg_catalog.oidvectortypes(function_record.proargtypes),
          ', ',
          ','
        )
      ) AS signature,
      client.role_name
    FROM pg_catalog.pg_proc AS function_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function_record.pronamespace
    CROSS JOIN client
    WHERE namespace.nspname = 'public'
      AND has_function_privilege(client.role_name, function_record.oid, 'EXECUTE')
  ),
  acl_drift AS (
    SELECT 'unexpected'::text AS drift_kind,
           actual.signature,
           actual.role_name
    FROM actual
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE expected.signature = actual.signature
        AND expected.role_name = actual.role_name
    )
    UNION ALL
    SELECT 'missing'::text,
           expected.signature,
           expected.role_name
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM actual
      WHERE actual.signature = expected.signature
        AND actual.role_name = expected.role_name
    )
  ),
  security_definer_client_exec AS (
    SELECT
      'security_definer_client_execute'::text AS drift_kind,
      pg_catalog.format(
        'public.%I(%s)',
        function_record.proname,
        pg_catalog.replace(
          pg_catalog.oidvectortypes(function_record.proargtypes),
          ', ',
          ','
        )
      ) AS signature,
      client.role_name
    FROM pg_catalog.pg_proc AS function_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function_record.pronamespace
    CROSS JOIN client
    WHERE namespace.nspname = 'public'
      AND function_record.prosecdef
      AND has_function_privilege(
        client.role_name,
        function_record.oid,
        'EXECUTE'
      )
  ),
  violations AS (
    SELECT * FROM acl_drift
    UNION ALL
    SELECT * FROM security_definer_client_exec
  )
  SELECT
    count(*) = 0 AS target_function_acl_pass,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'issue', drift_kind,
          'function', signature,
          'role', role_name
        )
        ORDER BY drift_kind, signature, role_name
      ),
      '[]'::jsonb
    )::text AS target_function_acl_violations
  FROM violations
  \gset
  \echo :target_function_acl_violations
  \if :target_function_acl_pass
    \echo 'PASS T5b: public client function ACL exactly matches its catalog.'
  \else
    \echo 'FAIL T5b: public client function ACL or SECURITY DEFINER posture drifted.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  \echo ''
  \echo '=============================================================='
  \echo 'T6  Exact target relation ACL'
  \echo '    PASS: direct and effective DML exactly match the catalog'
  \echo '=============================================================='
  WITH expected AS (
    SELECT relation_name, role_name, privilege, NULL::text AS column_name
    FROM app_private.client_relation_grant_catalog()
    WHERE columns IS NULL
    UNION ALL
    SELECT catalog.relation_name,
           catalog.role_name,
           catalog.privilege,
           expected_column.column_name
    FROM app_private.client_relation_grant_catalog() AS catalog
    CROSS JOIN LATERAL unnest(catalog.columns)
      AS expected_column(column_name)
    WHERE catalog.columns IS NOT NULL
  ),
  client_roles AS (
    SELECT role_entry.oid, role_entry.rolname::text AS role_name
    FROM pg_catalog.pg_roles AS role_entry
    WHERE role_entry.rolname IN ('anon', 'authenticated')
  ),
  relations AS (
    SELECT relation.oid,
           relation.relname::text AS relation_name,
           relation.relacl
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
  ),
  dml_privileges(privilege) AS (
    VALUES
      ('SELECT'::text),
      ('INSERT'::text),
      ('UPDATE'::text),
      ('DELETE'::text)
  ),
  direct_actual AS (
    SELECT
      relations.relation_name,
      grantee.rolname::text AS role_name,
      acl.privilege_type AS privilege,
      NULL::text AS column_name
    FROM relations
    CROSS JOIN LATERAL pg_catalog.aclexplode(relations.relacl) AS acl
    JOIN pg_catalog.pg_roles AS grantee
      ON grantee.oid = acl.grantee
    WHERE grantee.rolname IN ('anon', 'authenticated')
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    UNION ALL
    SELECT
      relations.relation_name,
      grantee.rolname::text,
      acl.privilege_type,
      attribute.attname::text
    FROM relations
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relations.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    JOIN pg_catalog.pg_roles AS grantee
      ON grantee.oid = acl.grantee
    WHERE grantee.rolname IN ('anon', 'authenticated')
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
  ),
  effective_actual AS (
    SELECT
      relations.relation_name,
      client_roles.role_name,
      dml_privileges.privilege,
      NULL::text AS column_name
    FROM relations
    CROSS JOIN client_roles
    CROSS JOIN dml_privileges
    WHERE has_table_privilege(
      client_roles.oid,
      relations.oid,
      dml_privileges.privilege
    )
    UNION ALL
    SELECT
      relations.relation_name,
      client_roles.role_name,
      dml_privileges.privilege,
      attribute.attname::text
    FROM relations
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relations.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN client_roles
    CROSS JOIN dml_privileges
    WHERE dml_privileges.privilege IN ('SELECT', 'INSERT', 'UPDATE')
      AND NOT has_table_privilege(
        client_roles.oid,
        relations.oid,
        dml_privileges.privilege
      )
      AND has_column_privilege(
        client_roles.oid,
        relations.oid,
        attribute.attnum,
        dml_privileges.privilege
      )
  ),
  contract_drift AS (
    SELECT 'direct_missing'::text AS issue, expected.*
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM direct_actual
      WHERE direct_actual.relation_name = expected.relation_name
        AND direct_actual.role_name = expected.role_name
        AND direct_actual.privilege = expected.privilege
        AND direct_actual.column_name IS NOT DISTINCT FROM expected.column_name
    )
    UNION ALL
    SELECT 'direct_unexpected'::text, direct_actual.*
    FROM direct_actual
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE expected.relation_name = direct_actual.relation_name
        AND expected.role_name = direct_actual.role_name
        AND expected.privilege = direct_actual.privilege
        AND expected.column_name IS NOT DISTINCT FROM direct_actual.column_name
    )
    UNION ALL
    SELECT 'effective_missing'::text, expected.*
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM effective_actual
      WHERE effective_actual.relation_name = expected.relation_name
        AND effective_actual.role_name = expected.role_name
        AND effective_actual.privilege = expected.privilege
        AND effective_actual.column_name IS NOT DISTINCT FROM expected.column_name
    )
    UNION ALL
    SELECT 'effective_unexpected'::text, effective_actual.*
    FROM effective_actual
    WHERE NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE expected.relation_name = effective_actual.relation_name
        AND expected.role_name = effective_actual.role_name
        AND expected.privilege = effective_actual.privilege
        AND expected.column_name IS NOT DISTINCT FROM effective_actual.column_name
    )
  ),
  dangerous_table_privileges(privilege) AS (
    VALUES
      ('TRUNCATE'::text),
      ('REFERENCES'::text),
      ('TRIGGER'::text),
      ('MAINTAIN'::text)
  ),
  dangerous AS (
    SELECT
      'dangerous'::text AS issue,
      relations.relation_name,
      client_roles.role_name,
      dangerous_table_privileges.privilege,
      NULL::text AS column_name
    FROM relations
    CROSS JOIN client_roles
    CROSS JOIN dangerous_table_privileges
    WHERE has_table_privilege(
      client_roles.oid,
      relations.oid,
      dangerous_table_privileges.privilege
    )
    UNION ALL
    SELECT
      'dangerous'::text,
      relations.relation_name,
      client_roles.role_name,
      'REFERENCES'::text,
      attribute.attname::text
    FROM relations
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relations.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN client_roles
    WHERE NOT has_table_privilege(
      client_roles.oid,
      relations.oid,
      'REFERENCES'
    )
      AND has_column_privilege(
        client_roles.oid,
        relations.oid,
        attribute.attnum,
        'REFERENCES'
      )
  ),
  public_acl AS (
    SELECT
      'public_acl_residue'::text AS issue,
      relations.relation_name,
      'public'::text AS role_name,
      acl.privilege_type AS privilege,
      NULL::text AS column_name
    FROM relations
    CROSS JOIN LATERAL pg_catalog.aclexplode(relations.relacl) AS acl
    WHERE acl.grantee = 0
    UNION ALL
    SELECT
      'public_acl_residue'::text,
      relations.relation_name,
      'public'::text,
      acl.privilege_type,
      attribute.attname::text
    FROM relations
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relations.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE acl.grantee = 0
  ),
  violations AS (
    SELECT * FROM contract_drift
    UNION ALL
    SELECT * FROM dangerous
    UNION ALL
    SELECT * FROM public_acl
  )
  SELECT
    count(*) = 0 AS target_relation_acl_pass,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'issue', issue,
          'relation', relation_name,
          'role', role_name,
          'privilege', privilege,
          'column', column_name
        )
        ORDER BY issue, relation_name, role_name, privilege, column_name
      ),
      '[]'::jsonb
    )::text AS target_relation_acl_violations
  FROM violations
  \gset
  \echo :target_relation_acl_violations
  \if :target_relation_acl_pass
    \echo 'PASS T6: target relation ACL exactly matches the reviewed catalog.'
  \else
    \echo 'FAIL T6: target relation ACL has missing, extra, PUBLIC, or dangerous grants.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  \echo ''
  \echo '=============================================================='
  \echo 'T7  Exact target storage posture'
  \echo '    PASS: buckets, storage.objects RLS, and policies are exact'
  \echo '=============================================================='
  WITH expected_buckets AS (
    SELECT bucket_id,
           is_public,
           file_size_limit,
           allowed_mime_types,
           posture
    FROM app_private.storage_bucket_posture_catalog()
  ),
  actual_buckets AS (
    SELECT bucket.id AS bucket_id,
           bucket.public AS is_public,
           bucket.file_size_limit,
           bucket.allowed_mime_types
    FROM storage.buckets AS bucket
  ),
  bucket_drift AS (
    SELECT
      'bucket_missing'::text AS issue,
      expected_buckets.bucket_id AS object_name,
      expected_buckets.posture AS detail
    FROM expected_buckets
    LEFT JOIN actual_buckets USING (bucket_id)
    WHERE actual_buckets.bucket_id IS NULL
    UNION ALL
    SELECT
      'bucket_unexpected'::text,
      actual_buckets.bucket_id,
      NULL::text
    FROM actual_buckets
    LEFT JOIN expected_buckets USING (bucket_id)
    WHERE expected_buckets.bucket_id IS NULL
    UNION ALL
    SELECT
      'bucket_property_drift'::text,
      expected_buckets.bucket_id,
      pg_catalog.jsonb_build_object(
        'expected_public', expected_buckets.is_public,
        'actual_public', actual_buckets.is_public,
        'expected_file_size_limit', expected_buckets.file_size_limit,
        'actual_file_size_limit', actual_buckets.file_size_limit,
        'expected_allowed_mime_types', expected_buckets.allowed_mime_types,
        'actual_allowed_mime_types', actual_buckets.allowed_mime_types,
        'posture', expected_buckets.posture
      )::text
    FROM expected_buckets
    JOIN actual_buckets USING (bucket_id)
    WHERE expected_buckets.is_public IS DISTINCT FROM actual_buckets.is_public
       OR expected_buckets.file_size_limit
          IS DISTINCT FROM actual_buckets.file_size_limit
       OR coalesce(
            expected_buckets.allowed_mime_types,
            ARRAY[]::text[]
          ) IS DISTINCT FROM coalesce(
            actual_buckets.allowed_mime_types,
            ARRAY[]::text[]
          )
  ),
  storage_objects_rls AS (
    SELECT
      'storage_objects_rls_disabled'::text AS issue,
      'storage.objects'::text AS object_name,
      NULL::text AS detail
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage'
      AND relation.relname = 'objects'
      AND relation.relkind IN ('r', 'p')
      AND NOT relation.relrowsecurity
  ),
  policy_drift AS (
    SELECT
      'policy_' || violation.drift_kind AS issue,
      violation.policy_name AS object_name,
      pg_catalog.jsonb_build_object(
        'command', violation.command,
        'roles', violation.role_names,
        'permissive', violation.is_permissive,
        'using', violation.using_expression,
        'check', violation.with_check_expression
      )::text AS detail
    FROM app_private.storage_object_policy_contract_violations() AS violation
  ),
  bucket_catalog AS (
    SELECT bucket_id, posture
    FROM app_private.storage_bucket_posture_catalog()
  ),
  policy_catalog AS (
    SELECT *
    FROM app_private.storage_object_policy_catalog()
  ),
  posture_gaps AS (
    SELECT
      'policy_bucket_missing_from_posture_catalog'::text AS issue,
      policy_catalog.policy_name AS object_name,
      policy_catalog.bucket_id AS detail
    FROM policy_catalog
    LEFT JOIN bucket_catalog USING (bucket_id)
    WHERE bucket_catalog.bucket_id IS NULL
    UNION ALL
    SELECT
      'server_only_bucket_has_client_policy'::text,
      policy_catalog.policy_name,
      policy_catalog.bucket_id
    FROM policy_catalog
    JOIN bucket_catalog USING (bucket_id)
    WHERE bucket_catalog.posture = 'server-only'
    UNION ALL
    SELECT
      'policy_roles_are_not_exactly_authenticated'::text,
      policy_catalog.policy_name,
      policy_catalog.bucket_id
    FROM policy_catalog
    WHERE policy_catalog.role_names <> ARRAY['authenticated']::text[]
    UNION ALL
    SELECT
      'reviewed_policy_is_restrictive'::text,
      policy_catalog.policy_name,
      policy_catalog.bucket_id
    FROM policy_catalog
    WHERE NOT policy_catalog.is_permissive
    UNION ALL
    SELECT
      'private_client_bucket_has_no_reviewed_policy'::text,
      bucket_catalog.bucket_id,
      bucket_catalog.posture
    FROM bucket_catalog
    WHERE bucket_catalog.posture = 'private-client'
      AND NOT EXISTS (
        SELECT 1
        FROM policy_catalog
        WHERE policy_catalog.bucket_id = bucket_catalog.bucket_id
      )
  ),
  violations AS (
    SELECT * FROM bucket_drift
    UNION ALL
    SELECT * FROM storage_objects_rls
    UNION ALL
    SELECT * FROM policy_drift
    UNION ALL
    SELECT * FROM posture_gaps
  )
  SELECT
    count(*) = 0 AS target_storage_contract_pass,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'issue', issue,
          'object', object_name,
          'detail', detail
        )
        ORDER BY issue, object_name, detail
      ),
      '[]'::jsonb
    )::text AS target_storage_contract_violations
  FROM violations
  \gset
  \echo :target_storage_contract_violations
  \if :target_storage_contract_pass
    \echo 'PASS T7: target storage posture exactly matches its contracts.'
  \else
    \echo 'FAIL T7: target bucket, RLS, policy, or posture contract drifted.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif
\endif

\echo ''
\echo '=============================================================='
\echo 'E1  Invalid indexes — PASS: 0 rows'
\echo '=============================================================='
SELECT namespace.nspname AS schema_name,
       table_record.relname AS table_name,
       index_record.relname AS index_name,
       index_state.indisready,
       index_state.indisvalid
FROM pg_catalog.pg_index AS index_state
JOIN pg_catalog.pg_class AS table_record
  ON table_record.oid = index_state.indrelid
JOIN pg_catalog.pg_class AS index_record
  ON index_record.oid = index_state.indexrelid
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = table_record.relnamespace
WHERE NOT index_state.indisvalid OR NOT index_state.indisready
ORDER BY namespace.nspname, table_record.relname, index_record.relname;

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_index
  WHERE NOT indisvalid OR NOT indisready
) AS e1_pass
\gset
\if :e1_pass
  \echo 'PASS E1'
\else
  \echo 'FAIL E1: reconcile invalid indexes before dry-run or release.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'E2  Collation version — mismatch requires planned remediation'
\echo '=============================================================='
SELECT datname, datcollate, datcollversion,
       pg_database_collation_actual_version(oid) AS actual_version,
       datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid) AS mismatch
FROM pg_database WHERE datname = current_database();

SELECT NOT (
  datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid)
) AS e2_pass
FROM pg_database
WHERE datname = current_database()
\gset
\if :e2_pass
  \echo 'PASS E2'
\else
  \echo 'FAIL E2: repair the database collation version before cutover.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'E3  Session limits and identity — evidence snapshot'
\echo '=============================================================='
SELECT current_database() AS database_name,
       current_user AS database_role,
       :'cutover_shape' AS cutover_shape;
SHOW statement_timeout;
SHOW idle_in_transaction_session_timeout;
SHOW lock_timeout;

\echo ''
\echo '=============================================================='
\echo 'E4  Table sizes that shape the maintenance window — snapshot'
\echo '=============================================================='
SELECT schemaname, relname, n_live_tup,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE relname IN (
  'certificates',
  'csf_admin_audit_events',
  'csf_announcement_replies',
  'csf_communication_campaigns',
  'csf_onboarding_links',
  'notifications',
  'organizations',
  'project_cancellation_jobs',
  'project_signups',
  'projects'
)
ORDER BY pg_total_relation_size(relid) DESC, schemaname, relname;

\echo ''
\echo '=============================================================='
\echo 'E5  Scheduled jobs — evidence snapshot before maintenance'
\echo '=============================================================='
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;

\echo ''
\echo '=============================================================='
\echo 'E6  Connection and lock pressure — take again at T-0'
\echo '=============================================================='
SELECT state, count(*) AS n FROM pg_stat_activity GROUP BY state ORDER BY n DESC;
SELECT count(*) AS ungranted_locks FROM pg_locks WHERE NOT granted;

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_locks
  WHERE NOT granted
) AS e6_pass
\gset
\if :e6_pass
  \echo 'PASS E6'
\else
  \echo 'FAIL E6: ungranted locks are present; wait or reconcile before cutover.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'E7  Storage object counts per bucket — evidence snapshot'
\echo '=============================================================='
SELECT bucket_id, count(*) AS objects,
       pg_size_pretty(sum((metadata->>'size')::bigint)) AS bytes
FROM storage.objects
GROUP BY bucket_id ORDER BY bucket_id;

ROLLBACK;

\echo ''
\echo 'PASS: all blocking checks are clean; evidence snapshots were captured.'
\echo 'This is evidence for the named database only. Capture the entire output.'
