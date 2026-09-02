-- Production 414 -> repository target 432 cutover preflight.
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
--   pre-cutover   414 rows headed by 20260829092823
--   post-cutover  432 rows headed by 20260901230000 with the exact 18-row tail
--
-- Any partial, divergent, later, or wrong-tail ledger exits non-zero before
-- shape-specific relations are parsed. Relation inventories then fail with a
-- named blocker instead of sending a query against an object that is absent.
-- This makes the same file safe before and after cutover and useful on a
-- Production-baseline rehearsal clone.
--
-- The target count, head, and tail below are computed from this branch's
-- supabase/migrations directory alone.
-- This pin includes the complete class-centric consolidation tail and must be
-- recomputed from the exact merged tree before any later cutover relies on it.

\set ON_ERROR_STOP on
\timing off
\pset pager off

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
\echo '    PASS: exactly 414/baseline or exactly 432/target'
\echo '=============================================================='
SELECT count(*) AS applied_migrations,
       min(version::text) AS first_version,
       max(version::text) AS head_version,
       count(*) FILTER (
         WHERE version::text > '20260829092823'
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
    '20260810220300','20260810220400','20260810220500','20260811001500',
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
    '20260812152300','20260812161500','20260812185500',
    '20260812193329','20260812193400','20260812203000',
    '20260812203500','20260812220000','20260813010000',
    '20260813012206','20260813013000','20260813013100',
    '20260813013200','20260813013300','20260813020000',
    '20260813085442','20260813091801','20260814001123',
    '20260814051720','20260815100500','20260815110000',
    '20260815120000','20260815130000','20260816083000',
    '20260816185321','20260816190000','20260816190454',
    '20260816230000','20260816233000','20260817010000',
    '20260817020000','20260817021000','20260817022000',
    '20260817030000','20260817040000','20260817050000',
    '20260817100000','20260817110500','20260817114700',
    '20260817120000','20260817121000','20260817130000',
    '20260817131000','20260817132000','20260817133000',
    '20260818040246','20260818064000','20260818074500',
    '20260818092855','20260818115000','20260818134000',
    '20260818150000','20260818160000','20260818170000',
    '20260818180000','20260818223637','20260818232541',
    '20260819002500','20260819020000','20260819030000','20260819050728',
    '20260820090000','20260820100000','20260820110000','20260820120000',
    '20260820130000','20260821005258','20260821024024','20260821041738',
    '20260821044815','20260821052000','20260821232923','20260821233000',
    '20260822000923','20260822032423','20260822044742','20260822060000',
    '20260822070000','20260822075815','20260822084356','20260822134710',
    '20260822151500','20260822154500','20260822224500','20260822231000',
    '20260822233000','20260822234500','20260823040000','20260823100349',
    '20260823102458','20260823200804','20260823210000','20260823211000',
    '20260823214000','20260823220000','20260823221000','20260823222000',
    '20260824001000','20260824002008','20260824003000','20260824040000',
    '20260824050000','20260824065333','20260824084735','20260824092128',
    '20260824123000','20260824123001','20260825023556','20260825041422',
    '20260825045100','20260825053600','20260825063639','20260825153000',
    '20260825160000','20260825170000','20260826021508','20260826032500',
    '20260826033554','20260826055241','20260826061500','20260826074500',
    '20260826081841','20260827010310','20260827015240','20260827020000',
    '20260827044256','20260827055807','20260827063258','20260827065000',
    '20260827073223','20260827082349','20260827233941','20260828070641',
    '20260828143000','20260828151000','20260828170000','20260828173500',
    '20260828183000','20260829010000','20260829020011','20260829025224',
    '20260829092823'
    -- END EXACT PRODUCTION BASELINE VERSIONS
  ]::text[])
),
actual_baseline(version) AS (
  SELECT version::text
  FROM supabase_migrations.schema_migrations
  WHERE version::text <= '20260829092823'
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
  count(*) = 414
    AND min(version::text) = '20260325181408'
    AND max(version::text) = '20260829092823'
    AND :'baseline_versions_exact'::boolean
    AND count(*) FILTER (
      WHERE version::text > '20260829092823'
    ) = 0 AS baseline_ledger,
  count(*) = 432
    AND min(version::text) = '20260325181408'
    AND max(version::text) = '20260901230000'
    AND :'baseline_versions_exact'::boolean
    AND (
      SELECT array_agg(pending.version ORDER BY pending.version)
      FROM (
        SELECT version::text AS version
        FROM supabase_migrations.schema_migrations
        WHERE version::text > '20260829092823'
      ) AS pending
    ) = ARRAY[
      -- BEGIN EXACT PRODUCTION TARGET TAIL
      '20260830100000','20260830110000','20260830120000','20260830130000',
      '20260830140000','20260831000000','20260831010000','20260831122035',
      '20260831234952','20260901023000','20260901035129','20260901043613',
      '20260901052000','20260901060000','20260901070000','20260901103347',
      '20260901120000','20260901230000'
      -- END EXACT PRODUCTION TARGET TAIL
    ]::text[] AS target_ledger
FROM supabase_migrations.schema_migrations
\gset

\if :baseline_ledger
  \set cutover_shape pre
  \echo 'PASS L0: exact Production baseline; 18 migrations pending.'
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
\echo '    PASS: every pre-existing relation and function used by the tail exists'
\echo '    Missing/partial CSF fails before any dependent object is queried'
\echo '=============================================================='
WITH required_relations(relation_name) AS (
  VALUES
    -- BEGIN 414 CSF BASELINE RELATIONS
    ('auth.users'),
    ('public.organization_members'),
    ('public.organizations'),
    ('public.profiles'),
    ('plugin_data.csf_admin_audit_events'),
    ('plugin_data.csf_announcement_link_previews'),
    ('plugin_data.csf_announcement_replies'),
    ('plugin_data.csf_announcements'),
    ('plugin_data.csf_application_correction_requests'),
    ('plugin_data.csf_class_join_codes'),
    ('plugin_data.csf_cohorts'),
    ('plugin_data.csf_communication_campaigns'),
    ('plugin_data.csf_communication_dispatch_attempts'),
    ('plugin_data.csf_credit_records'),
    ('plugin_data.csf_dues_records'),
    ('plugin_data.csf_meeting_attendance'),
    ('plugin_data.csf_meeting_sessions'),
    ('plugin_data.csf_meetings'),
    ('plugin_data.csf_opportunities'),
    ('plugin_data.csf_opportunity_signups'),
    ('plugin_data.csf_point_appeals'),
    ('plugin_data.csf_point_submissions'),
    ('plugin_data.csf_profile_accounts'),
    ('plugin_data.csf_profile_activity_events'),
    ('plugin_data.csf_profile_cohort_memberships'),
    ('plugin_data.csf_profile_link_requests'),
    ('plugin_data.csf_profile_merge_reviews'),
    ('plugin_data.csf_profile_restrictions'),
    ('plugin_data.csf_profiles'),
    ('plugin_data.csf_roles'),
    ('plugin_data.csf_sheet_import_commit_attempts'),
    ('plugin_data.csf_sheet_import_jobs'),
    ('plugin_data.csf_sheet_import_rows'),
    ('plugin_data.csf_sheet_sources'),
    ('plugin_data.csf_staff_positions'),
    ('plugin_data.csf_term_applications'),
    ('plugin_data.csf_term_deadlines'),
    ('plugin_data.csf_term_meetings'),
    ('plugin_data.csf_term_memberships'),
    ('plugin_data.csf_term_point_rules'),
    ('plugin_data.csf_term_policies'),
    ('plugin_data.csf_terms')
    -- END 414 CSF BASELINE RELATIONS
),
required_functions(signature, baseline_only) AS (
  VALUES
    -- BEGIN 414 CSF BASELINE FUNCTIONS
    ('extensions.digest(bytea,text)', false),
    ('plugin_data.csf_actor_has_permission(uuid,uuid,text)', false),
    ('plugin_data.csf_assert_import_actor(uuid,uuid,text)', false),
    ('plugin_data.csf_assert_import_actor_for_row(uuid,uuid,uuid)', false),
    ('plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid)', false),
    ('plugin_data.csf_chapter_today()', false),
    ('plugin_data.csf_commit_import_row_for_attempt(uuid,uuid,uuid)', false),
    ('plugin_data.csf_confirm_profile_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)', true),
    ('plugin_data.csf_current_school_year(uuid)', false),
    ('plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)', false),
    ('plugin_data.csf_import_preview_readiness(uuid,uuid)', false),
    ('plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)', false),
    ('plugin_data.csf_lock_active_import_profiles(uuid,uuid[])', false),
    ('plugin_data.csf_lock_identity_mutation(uuid)', false),
    ('plugin_data.csf_normalize_identity_part(text)', false),
    ('plugin_data.csf_reconcile_sheet_import_row(uuid,uuid,uuid,text,text,uuid,uuid)', false),
    ('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)', false)
    -- END 414 CSF BASELINE FUNCTIONS
)
SELECT 'relation'::text AS object_kind,
       required.relation_name AS missing_object
FROM required_relations AS required
WHERE to_regclass(required.relation_name) IS NULL
UNION ALL
SELECT 'function', required.signature
FROM required_functions AS required
WHERE (NOT required.baseline_only OR :'baseline_ledger'::boolean)
  AND to_regprocedure(required.signature) IS NULL
ORDER BY object_kind, missing_object;

WITH required_relations(relation_name) AS (
  VALUES
    -- BEGIN 414 CSF BASELINE RELATIONS
    ('auth.users'),
    ('public.organization_members'),
    ('public.organizations'),
    ('public.profiles'),
    ('plugin_data.csf_admin_audit_events'),
    ('plugin_data.csf_announcement_link_previews'),
    ('plugin_data.csf_announcements'),
    ('plugin_data.csf_announcement_replies'),
    ('plugin_data.csf_application_correction_requests'),
    ('plugin_data.csf_class_join_codes'),
    ('plugin_data.csf_cohorts'),
    ('plugin_data.csf_communication_campaigns'),
    ('plugin_data.csf_communication_dispatch_attempts'),
    ('plugin_data.csf_credit_records'),
    ('plugin_data.csf_dues_records'),
    ('plugin_data.csf_meeting_attendance'),
    ('plugin_data.csf_meeting_sessions'),
    ('plugin_data.csf_meetings'),
    ('plugin_data.csf_opportunities'),
    ('plugin_data.csf_opportunity_signups'),
    ('plugin_data.csf_point_appeals'),
    ('plugin_data.csf_point_submissions'),
    ('plugin_data.csf_profile_accounts'),
    ('plugin_data.csf_profile_activity_events'),
    ('plugin_data.csf_profile_cohort_memberships'),
    ('plugin_data.csf_profile_link_requests'),
    ('plugin_data.csf_profile_merge_reviews'),
    ('plugin_data.csf_profile_restrictions'),
    ('plugin_data.csf_profiles'),
    ('plugin_data.csf_roles'),
    ('plugin_data.csf_sheet_import_commit_attempts'),
    ('plugin_data.csf_sheet_import_jobs'),
    ('plugin_data.csf_sheet_import_rows'),
    ('plugin_data.csf_sheet_sources'),
    ('plugin_data.csf_staff_positions'),
    ('plugin_data.csf_term_applications'),
    ('plugin_data.csf_term_deadlines'),
    ('plugin_data.csf_term_meetings'),
    ('plugin_data.csf_term_memberships'),
    ('plugin_data.csf_term_point_rules'),
    ('plugin_data.csf_term_policies'),
    ('plugin_data.csf_terms')
    -- END 414 CSF BASELINE RELATIONS
),
required_functions(signature, baseline_only) AS (
  VALUES
    -- BEGIN 414 CSF BASELINE FUNCTIONS
    ('extensions.digest(bytea,text)', false),
    ('plugin_data.csf_actor_has_permission(uuid,uuid,text)', false),
    ('plugin_data.csf_assert_import_actor(uuid,uuid,text)', false),
    ('plugin_data.csf_assert_import_actor_for_row(uuid,uuid,uuid)', false),
    ('plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid)', false),
    ('plugin_data.csf_chapter_today()', false),
    ('plugin_data.csf_commit_import_row_for_attempt(uuid,uuid,uuid)', false),
    ('plugin_data.csf_confirm_profile_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)', true),
    ('plugin_data.csf_current_school_year(uuid)', false),
    ('plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)', false),
    ('plugin_data.csf_import_preview_readiness(uuid,uuid)', false),
    ('plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)', false),
    ('plugin_data.csf_lock_active_import_profiles(uuid,uuid[])', false),
    ('plugin_data.csf_lock_identity_mutation(uuid)', false),
    ('plugin_data.csf_normalize_identity_part(text)', false),
    ('plugin_data.csf_reconcile_sheet_import_row(uuid,uuid,uuid,text,text,uuid,uuid)', false),
    ('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)', false)
    -- END 414 CSF BASELINE FUNCTIONS
)
SELECT
  NOT EXISTS (
    SELECT 1
    FROM required_relations AS required
    WHERE to_regclass(required.relation_name) IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM required_functions AS required
    WHERE (NOT required.baseline_only OR :'baseline_ledger'::boolean)
      AND to_regprocedure(required.signature) IS NULL
  ) AS csf_shape_ready,
  NOT EXISTS (
    SELECT 1
    FROM required_relations AS required
    WHERE required.relation_name LIKE 'plugin_data.%'
      AND to_regclass(required.relation_name) IS NOT NULL
  ) AS csf_shape_absent
\gset

WITH required_columns(relation_name, column_names) AS (
  VALUES
    -- BEGIN 414 CSF BASELINE COLUMN SHAPES
    ('auth.users', ARRAY['id']::text[]),
    ('public.organization_members',
      ARRAY['organization_id','user_id','status','role']::text[]),
    ('public.organizations', ARRAY['id']::text[]),
    ('public.profiles', ARRAY['id','full_name','username','avatar_url']::text[]),
    ('plugin_data.csf_admin_audit_events',
      ARRAY['id','organization_id','actor_user_id','action','target_type',
        'target_id','after_data','correlation_id','source_type','source_id',
        'reason_code','term_id','created_at']::text[]),
    ('plugin_data.csf_announcement_link_previews',
      ARRAY['organization_id','announcement_id','url','title','description',
        'site_name','image_url']::text[]),
    ('plugin_data.csf_announcement_replies',
      ARRAY['id','organization_id','announcement_id','created_by','created_at']::text[]),
    ('plugin_data.csf_announcements',
      ARRAY['id','organization_id','created_by']::text[]),
    ('plugin_data.csf_application_correction_requests',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_class_join_codes',
      ARRAY['id','organization_id','cohort_id','code','status']::text[]),
    ('plugin_data.csf_cohorts',
      ARRAY['id','organization_id','label','graduation_year','status',
        'created_at','updated_at']::text[]),
    ('plugin_data.csf_communication_campaigns',
      ARRAY['id','organization_id','status','metadata']::text[]),
    ('plugin_data.csf_communication_dispatch_attempts',
      ARRAY['id','organization_id','campaign_id','state','available_at']::text[]),
    ('plugin_data.csf_credit_records', ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_dues_records', ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_meeting_attendance',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_meeting_sessions',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_meetings', ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_opportunities',
      ARRAY['id','organization_id','term_id','created_by_user_id']::text[]),
    ('plugin_data.csf_opportunity_signups',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_point_appeals',
      ARRAY['id','organization_id','status','created_at']::text[]),
    ('plugin_data.csf_point_submissions',
      ARRAY['id','organization_id','status','submitted_at']::text[]),
    ('plugin_data.csf_profile_accounts',
      ARRAY['id','organization_id','profile_id','user_id','status','is_primary',
        'linked_at']::text[]),
    ('plugin_data.csf_profile_activity_events',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_profile_cohort_memberships',
      ARRAY['id','organization_id','profile_id','cohort_id','status',
        'updated_at']::text[]),
    ('plugin_data.csf_profile_link_requests',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_profile_merge_reviews',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_profile_restrictions',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_profiles',
      ARRAY['id','organization_id','first_name','last_name',
        'normalized_first_name','normalized_last_name',
        'normalized_school_email','normalized_personal_email','record_status',
        'source_summary']::text[]),
    ('plugin_data.csf_roles', ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_sheet_import_commit_attempts',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_sheet_import_jobs',
      ARRAY['id','organization_id','mode','source_type','source_file_id']::text[]),
    ('plugin_data.csf_sheet_import_rows',
      ARRAY['id','organization_id','job_id','cohort_id','normalized_data',
        'import_status','matched_profile_id','resolution_status',
        'correlation_id']::text[]),
    ('plugin_data.csf_sheet_sources',
      ARRAY['id','organization_id','cohort_id','provider','spreadsheet_id',
        'sync_owner_user_id','source_type','settings','sync_mode']::text[]),
    ('plugin_data.csf_staff_positions',
      ARRAY['id','organization_id','user_id','status','display_title',
        'school_year','starts_at','ends_at','created_at']::text[]),
    ('plugin_data.csf_term_applications',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_term_deadlines',
      ARRAY['id','organization_id','term_id','title','due_at','status',
        'audience']::text[]),
    ('plugin_data.csf_term_meetings',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_term_memberships',
      ARRAY['id','organization_id','profile_id','term_id','cohort_id','status']::text[]),
    ('plugin_data.csf_term_point_rules',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_term_policies',
      ARRAY['id','organization_id']::text[]),
    ('plugin_data.csf_terms',
      ARRAY['id','organization_id','is_current','updated_at']::text[])
    -- END 414 CSF BASELINE COLUMN SHAPES
),
required_function_shapes(
  signature, baseline_only, return_type, returns_set
) AS (
  VALUES
    ('extensions.digest(bytea,text)', false, 'bytea', false),
    ('plugin_data.csf_actor_has_permission(uuid,uuid,text)',
      false, 'boolean', false),
    ('plugin_data.csf_assert_import_actor(uuid,uuid,text)',
      false, 'jsonb', false),
    ('plugin_data.csf_assert_import_actor_for_row(uuid,uuid,uuid)',
      false, 'jsonb', false),
    ('plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid)',
      false, 'jsonb', false),
    ('plugin_data.csf_chapter_today()', false, 'date', false),
    ('plugin_data.csf_commit_import_row_for_attempt(uuid,uuid,uuid)',
      false, 'jsonb', false),
    ('plugin_data.csf_confirm_profile_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)',
      true, 'jsonb', false),
    ('plugin_data.csf_current_school_year(uuid)', false, 'text', false),
    ('plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
      false, 'jsonb', false),
    ('plugin_data.csf_import_preview_readiness(uuid,uuid)',
      false, 'jsonb', false),
    ('plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)',
      false, 'jsonb', false),
    ('plugin_data.csf_lock_active_import_profiles(uuid,uuid[])',
      false, 'void', false),
    ('plugin_data.csf_lock_identity_mutation(uuid)', false, 'void', false),
    ('plugin_data.csf_normalize_identity_part(text)', false, 'text', false),
    ('plugin_data.csf_reconcile_sheet_import_row(uuid,uuid,uuid,text,text,uuid,uuid)',
      false, 'jsonb', false),
    ('plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)',
      false, 'jsonb', false)
),
missing_columns AS (
  SELECT required.relation_name || '.' || column_name AS column_name
  FROM required_columns AS required
  CROSS JOIN LATERAL unnest(required.column_names) AS column_name
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_record
    WHERE attribute_record.attrelid = to_regclass(required.relation_name)
      AND attribute_record.attname = column_name
      AND attribute_record.attnum > 0
      AND NOT attribute_record.attisdropped
  )
),
invalid_function_shapes AS (
  SELECT required.signature
  FROM required_function_shapes AS required
  LEFT JOIN pg_catalog.pg_proc AS function_record
    ON function_record.oid = to_regprocedure(required.signature)
  WHERE (NOT required.baseline_only OR :'baseline_ledger'::boolean)
    AND (
      function_record.oid IS NULL
      OR function_record.prorettype::regtype::text
        IS DISTINCT FROM required.return_type
      OR function_record.proretset IS DISTINCT FROM required.returns_set
    )
),
shape_issues(issue_name) AS (
  SELECT 'column:' || missing_columns.column_name
  FROM missing_columns
  UNION ALL
  SELECT 'function:' || invalid_function_shapes.signature
  FROM invalid_function_shapes
)
SELECT count(*) = 0 AS csf_column_shape_ready,
  coalesce(
    jsonb_agg(issue_name ORDER BY issue_name),
    '[]'::jsonb
  )::text AS csf_missing_columns
FROM shape_issues
\gset
\echo :csf_missing_columns

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

\if :csf_column_shape_ready
  \echo 'PASS S0: required CSF column shapes are present.'
\else
  \echo 'FAIL S0: a required CSF column is missing. Stop and reconcile drift.'
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
\echo '    Confirms current verified-certificate uniqueness'
\echo '=============================================================='
SELECT count(*) AS duplicate_signup_group_count
FROM (
  SELECT 1
  FROM public.certificates
  WHERE type = 'verified' AND signup_id IS NOT NULL
  GROUP BY signup_id
  HAVING count(*) > 1
) AS duplicate_groups;

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
\echo '    Confirms current webhook-environment isolation'
\echo '=============================================================='
SELECT count(*) AS incompatible_campaign_count
FROM (
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
  GROUP BY campaign.organization_id, campaign.id
) AS incompatible_campaigns;

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
\echo 'D3  Duplicate active class join codes — PASS: 0 rows'
\echo '    Confirms current one-active-code-per-class uniqueness'
\echo '=============================================================='
SELECT count(*) AS duplicate_class_group_count
FROM (
  SELECT 1
  FROM plugin_data.csf_class_join_codes
  WHERE status = 'active'
  GROUP BY organization_id, cohort_id
  HAVING count(*) > 1
) AS duplicate_groups;

SELECT NOT EXISTS (
  SELECT 1
  FROM plugin_data.csf_class_join_codes
  WHERE status = 'active'
  GROUP BY organization_id, cohort_id
  HAVING count(*) > 1
) AS d3_pass
\gset
\if :d3_pass
  \echo 'PASS D3'
\else
  \echo 'FAIL D3: rotate or revoke the extra codes from the class page.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D4  Existing organization uses reserved route slug — PASS: 0 rows'
\echo '    Confirms the current reserved-route constraint'
\echo '=============================================================='
SELECT count(*) AS reserved_slug_organization_count
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
  ) = ANY (ARRAY['create', 'join']);

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
\echo 'D5  Cancellation-job states and attempts remain valid'
\echo '    PASS: 0 rows'
\echo '=============================================================='
SELECT count(*) AS invalid_cancellation_job_count
FROM public.project_cancellation_jobs
WHERE status IS NULL
   OR status NOT IN ('pending', 'processing', 'completed', 'failed', 'needs_review')
   OR attempts IS NULL
   OR attempts < 0;

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
  \echo 'FAIL D5: cancellation-job state or attempt bounds have drifted.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D7  Cross-organization CSF post replies — PASS: 0 rows'
\echo '    Confirms the current announcement tenant FK'
\echo '=============================================================='
SELECT count(*) AS cross_tenant_reply_count
FROM plugin_data.csf_announcement_replies AS reply
LEFT JOIN plugin_data.csf_announcements AS announcement
  ON announcement.id = reply.announcement_id
WHERE announcement.id IS NULL
   OR announcement.organization_id IS DISTINCT FROM reply.organization_id;

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
  \echo 'FAIL D7: the current announcement tenant FK has drifted.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D8  Duplicate/unkeyed CSF post-reply request receipts'
\echo '    PASS: 0 rows; confirms current receipt uniqueness'
\echo '=============================================================='
SELECT count(*) AS invalid_receipt_group_count
FROM (
  SELECT 1
  FROM plugin_data.csf_admin_audit_events
  WHERE source_type = 'post_reply_mutation_request'
    AND action IN ('post_reply_added', 'post_reply_deleted')
  GROUP BY organization_id, correlation_id
  HAVING correlation_id IS NULL OR count(*) > 1
) AS invalid_groups;

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
  \echo 'FAIL D8: current replay-receipt uniqueness has drifted.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\echo ''
\echo '=============================================================='
\echo 'D9  External dependencies on pg_graphql objects — PASS: 0 rows'
\echo '    Confirms the removed extension has no dependency drift'
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
SELECT count(*) AS external_dependency_count
FROM blockers;

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
  \echo 'FAIL D9: pg_graphql dependency drift was detected.'
  SELECT 1 / 0 AS preflight_check_failed;
\endif

\if :baseline_ledger
  \echo ''
  \echo '=============================================================='
  \echo 'D10 Current reviewed public client grants remain effective'
  \echo '    PASS: 0 missing grants on relations present at this shape'
  \echo '    Confirms the reviewed public relation ACL catalog'
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
    \echo 'FAIL D10: current reviewed grants have drifted.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif
\endif

\if :baseline_ledger
  \echo ''
  \echo '=============================================================='
  \echo 'D11 Sheet sources match their graduating-class tenant'
  \echo '    PASS: 0 rows; guards the pending validated tenant FK'
  \echo '=============================================================='
  SELECT count(*) AS incompatible_source_count
  FROM plugin_data.csf_sheet_sources AS source
  LEFT JOIN plugin_data.csf_cohorts AS cohort
    ON cohort.id = source.cohort_id
  WHERE source.cohort_id IS NOT NULL
    AND (
      cohort.id IS NULL
      OR cohort.organization_id IS DISTINCT FROM source.organization_id
    );

  SELECT NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_sources AS source
    LEFT JOIN plugin_data.csf_cohorts AS cohort
      ON cohort.id = source.cohort_id
    WHERE source.cohort_id IS NOT NULL
      AND (
        cohort.id IS NULL
        OR cohort.organization_id IS DISTINCT FROM source.organization_id
      )
  ) AS d11_pass
  \gset
  \if :d11_pass
    \echo 'PASS D11'
  \else
    \echo 'FAIL D11: a sheet source references a graduating class from another tenant.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif
\endif

\if :baseline_ledger
  \echo ''
  \echo '=============================================================='
  \echo 'D12 Duplicate class-history profile-create request receipts'
  \echo '    PASS: 0 groups; guards the pending partial UNIQUE index'
  \echo '=============================================================='
  SELECT count(*) AS duplicate_request_group_count
  FROM (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.action = 'sheet_import.class_history_profile_create_request'
      AND audit.correlation_id IS NOT NULL
    GROUP BY audit.organization_id, audit.correlation_id
    HAVING count(*) > 1
  ) AS duplicate_groups;

  SELECT NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.action = 'sheet_import.class_history_profile_create_request'
      AND audit.correlation_id IS NOT NULL
    GROUP BY audit.organization_id, audit.correlation_id
    HAVING count(*) > 1
  ) AS d12_pass
  \gset
  \if :d12_pass
    \echo 'PASS D12'
  \else
    \echo 'FAIL D12: duplicate non-null request IDs would block the pending UNIQUE index.'
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
      ('private.project_series_end_receipts'),
      ('private.plugin_data_deletion_requests'),
      ('private.anonymous_feedback_email_preferences'),
      ('private.google_cap_event_receipts'),
      ('app_private.storage_object_policy_contract'),
      -- BEGIN 432 CSF TARGET RELATIONS
      ('plugin_data.csf_class_workbooks'),
      ('plugin_data.csf_class_workbook_refresh_jobs'),
      ('plugin_data.csf_import_approval_batches'),
      ('plugin_data.csf_import_commit_queue'),
      ('plugin_data.csf_import_approval_batch_items'),
      ('plugin_data.csf_import_row_batches'),
      ('plugin_data.csf_import_row_batch_outcomes')
      -- END 432 CSF TARGET RELATIONS
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
      ('private.project_series_end_receipts'),
      ('private.plugin_data_deletion_requests'),
      ('private.anonymous_feedback_email_preferences'),
      ('private.google_cap_event_receipts'),
      ('app_private.storage_object_policy_contract'),
      -- BEGIN 432 CSF TARGET RELATIONS
      ('plugin_data.csf_class_workbooks'),
      ('plugin_data.csf_class_workbook_refresh_jobs'),
      ('plugin_data.csf_import_approval_batches'),
      ('plugin_data.csf_import_commit_queue'),
      ('plugin_data.csf_import_approval_batch_items'),
      ('plugin_data.csf_import_row_batches'),
      ('plugin_data.csf_import_row_batch_outcomes')
      -- END 432 CSF TARGET RELATIONS
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
      ('index', 'plugin_data.csf_profile_link_requests',
        'csf_profile_link_requests_cohort_review_idx'),
      ('index', 'plugin_data.csf_admin_audit_events',
        'csf_admin_audit_events_post_reply_request_idx'),
      ('index', 'private.google_cap_event_receipts',
        'google_cap_event_receipts_processing_subject_uidx'),
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
      ('server_only_function', 'public',
        'set_anonymous_feedback_email_opt_out(uuid,boolean)'),
      ('owner_only_function', 'app_private',
        'apply_anonymous_feedback_email_preference()'),
      ('trigger', 'public.anonymous_signups',
        'apply_anonymous_feedback_email_preference'),
      ('index', 'public.anonymous_signups',
        'anonymous_signups_feedback_normalized_email_idx'),
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
  ) OR (
    expected.kind = 'owner_only_function'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS function_record
      WHERE function_record.oid = to_regprocedure(
          expected.relation_name || '.' || expected.object_name
        )
        AND function_record.prosecdef
        AND function_record.proconfig @> ARRAY['search_path=""']
        AND NOT has_function_privilege('anon', function_record.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', function_record.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', function_record.oid, 'EXECUTE')
    )
  ) OR (
    expected.kind = 'trigger'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgrelid = to_regclass(expected.relation_name)
        AND trigger_record.tgname = expected.object_name
        AND NOT trigger_record.tgisinternal
        AND trigger_record.tgenabled <> 'D'
        AND trigger_record.tgtype = 23
        AND (
          SELECT array_agg(attribute_record.attnum::smallint ORDER BY attribute_record.attnum)
          FROM pg_catalog.pg_attribute AS attribute_record
          WHERE attribute_record.attrelid = trigger_record.tgrelid
            AND attribute_record.attname IN ('email', 'email_opt_out_at')
            AND NOT attribute_record.attisdropped
        ) = (
          SELECT array_agg(trigger_column.attnum ORDER BY trigger_column.attnum)
          FROM unnest(trigger_record.tgattr::smallint[]) AS trigger_column(attnum)
        )
        AND trigger_record.tgfoid = to_regprocedure(
          'app_private.apply_anonymous_feedback_email_preference()'
        )
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
        ('index', 'plugin_data.csf_profile_link_requests',
          'csf_profile_link_requests_cohort_review_idx'),
        ('index', 'plugin_data.csf_admin_audit_events',
          'csf_admin_audit_events_post_reply_request_idx'),
        ('index', 'private.google_cap_event_receipts',
          'google_cap_event_receipts_processing_subject_uidx'),
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
        ('server_only_function', 'public',
          'set_anonymous_feedback_email_opt_out(uuid,boolean)'),
        ('owner_only_function', 'app_private',
          'apply_anonymous_feedback_email_preference()'),
        ('trigger', 'public.anonymous_signups',
          'apply_anonymous_feedback_email_preference'),
        ('index', 'public.anonymous_signups',
          'anonymous_signups_feedback_normalized_email_idx'),
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
    ) OR (
      expected.kind = 'owner_only_function'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS function_record
        WHERE function_record.oid = to_regprocedure(
            expected.relation_name || '.' || expected.object_name
          )
          AND function_record.prosecdef
          AND function_record.proconfig @> ARRAY['search_path=""']
          AND NOT has_function_privilege('anon', function_record.oid, 'EXECUTE')
          AND NOT has_function_privilege('authenticated', function_record.oid, 'EXECUTE')
          AND NOT has_function_privilege('service_role', function_record.oid, 'EXECUTE')
      )
    ) OR (
      expected.kind = 'trigger'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_record
        WHERE trigger_record.tgrelid = to_regclass(expected.relation_name)
          AND trigger_record.tgname = expected.object_name
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgenabled <> 'D'
          AND trigger_record.tgtype = 23
          AND (
            SELECT array_agg(attribute_record.attnum::smallint ORDER BY attribute_record.attnum)
            FROM pg_catalog.pg_attribute AS attribute_record
            WHERE attribute_record.attrelid = trigger_record.tgrelid
              AND attribute_record.attname IN ('email', 'email_opt_out_at')
              AND NOT attribute_record.attisdropped
          ) = (
            SELECT array_agg(trigger_column.attnum ORDER BY trigger_column.attnum)
            FROM unnest(trigger_record.tgattr::smallint[]) AS trigger_column(attnum)
          )
          AND trigger_record.tgfoid = to_regprocedure(
            'app_private.apply_anonymous_feedback_email_preference()'
          )
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
  \echo 'T2C 432 CSF release-tail contract'
  \echo '    PASS: []'
  \echo '=============================================================='
  WITH expected_tables(relation_name, service_privileges) AS (
    VALUES
      ('plugin_data.csf_class_workbooks',
        ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[]),
      ('plugin_data.csf_class_workbook_refresh_jobs',
        ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[]),
      ('plugin_data.csf_import_approval_batches',
        ARRAY['INSERT','SELECT','UPDATE']::text[]),
      ('plugin_data.csf_import_commit_queue',
        ARRAY['INSERT','SELECT','UPDATE']::text[]),
      ('plugin_data.csf_import_approval_batch_items',
        ARRAY['INSERT','SELECT','UPDATE']::text[]),
      ('plugin_data.csf_import_row_batches',
        ARRAY['INSERT','SELECT','UPDATE']::text[]),
      ('plugin_data.csf_import_row_batch_outcomes',
        ARRAY['INSERT','SELECT']::text[])
  ),
  table_state AS (
    SELECT expected.relation_name,
      expected.service_privileges,
      relation_record.oid,
      relation_record.relrowsecurity,
      ARRAY(
        SELECT privilege
        FROM unnest(ARRAY[
          'DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'
        ]::text[]) AS privilege
        WHERE relation_record.oid IS NOT NULL
          AND has_table_privilege(
            'service_role', relation_record.oid, privilege
          )
        ORDER BY privilege
      ) AS actual_service_privileges,
      EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'
        ]::text[]) AS privilege
        WHERE relation_record.oid IS NOT NULL
          AND (
            has_table_privilege('anon', relation_record.oid, privilege)
            OR has_table_privilege(
              'authenticated', relation_record.oid, privilege
            )
          )
      ) AS browser_privilege
    FROM expected_tables AS expected
    LEFT JOIN pg_catalog.pg_class AS relation_record
      ON relation_record.oid = to_regclass(expected.relation_name)
     AND relation_record.relkind IN ('r', 'p')
  ),
  table_issues AS (
    SELECT 'table'::text AS issue_kind, state.relation_name AS object_name
    FROM table_state AS state
    WHERE state.oid IS NULL
       OR NOT state.relrowsecurity
       OR state.actual_service_privileges IS DISTINCT FROM state.service_privileges
       OR state.browser_privilege
  ),
  column_issues AS (
    SELECT 'column'::text AS issue_kind,
      'plugin_data.csf_class_workbook_refresh_jobs.drive_file_id'::text
        AS object_name
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_record
      WHERE attribute_record.attrelid =
          to_regclass('plugin_data.csf_class_workbook_refresh_jobs')
        AND attribute_record.attname = 'drive_file_id'
        AND attribute_record.attnum > 0
        AND NOT attribute_record.attisdropped
        AND attribute_record.attnotnull
    )
  ),
  expected_constraints(
    label, relation_name, constraint_name, constraint_type, key_columns,
    referenced_relation, referenced_columns, delete_action,
    definition_fragment
  ) AS (
    VALUES
      ('class_workbooks_primary_key',
        'plugin_data.csf_class_workbooks', NULL::text, 'p',
        ARRAY['id']::text[], NULL::text, NULL::text[], NULL::text, NULL::text),
      ('workbook_refresh_jobs_primary_key',
        'plugin_data.csf_class_workbook_refresh_jobs', NULL, 'p',
        ARRAY['id']::text[], NULL, NULL::text[], NULL, NULL),
      ('import_approval_batches_primary_key',
        'plugin_data.csf_import_approval_batches', NULL, 'p',
        ARRAY['id']::text[], NULL, NULL::text[], NULL, NULL),
      ('import_commit_queue_primary_key',
        'plugin_data.csf_import_commit_queue', NULL, 'p',
        ARRAY['id']::text[], NULL, NULL::text[], NULL, NULL),
      ('import_approval_batch_items_primary_key',
        'plugin_data.csf_import_approval_batch_items', NULL, 'p',
        ARRAY['id']::text[], NULL, NULL::text[], NULL, NULL),
      ('import_row_batches_primary_key',
        'plugin_data.csf_import_row_batches', NULL, 'p',
        ARRAY['id']::text[], NULL, NULL::text[], NULL, NULL),
      ('import_row_batch_outcomes_primary_key',
        'plugin_data.csf_import_row_batch_outcomes', NULL, 'p',
        ARRAY['id']::text[], NULL, NULL::text[], NULL, NULL),
      ('workbook_tenant_class_unique',
        'plugin_data.csf_class_workbooks', NULL::text, 'u',
        ARRAY['organization_id','cohort_id']::text[],
        NULL::text, NULL::text[], NULL::text, NULL::text),
      ('csf_class_workbooks_id_organization_id_key',
        'plugin_data.csf_class_workbooks',
        'csf_class_workbooks_id_organization_id_key', 'u',
        ARRAY['id','organization_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('csf_class_workbooks_cohort_organization_fk',
        'plugin_data.csf_class_workbooks',
        'csf_class_workbooks_cohort_organization_fk', 'f',
        ARRAY['cohort_id','organization_id']::text[],
        'plugin_data.csf_cohorts', ARRAY['id','organization_id']::text[],
        'c', NULL),
      ('csf_sheet_sources_cohort_organization_fkey',
        'plugin_data.csf_sheet_sources',
        'csf_sheet_sources_cohort_organization_fkey', 'f',
        ARRAY['cohort_id','organization_id']::text[],
        'plugin_data.csf_cohorts', ARRAY['id','organization_id']::text[],
        'n', 'ON DELETE SET NULL (cohort_id)'),
      ('csf_class_workbook_refresh_jobs_source_version_key',
        'plugin_data.csf_class_workbook_refresh_jobs',
        'csf_class_workbook_refresh_jobs_source_version_key', 'u',
        ARRAY['workbook_id','drive_file_id','provider_version']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('csf_class_workbook_refresh_jobs_workbook_organization_fk',
        'plugin_data.csf_class_workbook_refresh_jobs',
        'csf_class_workbook_refresh_jobs_workbook_organization_fk', 'f',
        ARRAY['workbook_id','organization_id']::text[],
        'plugin_data.csf_class_workbooks', ARRAY['id','organization_id']::text[],
        'c', NULL),
      ('approval_batch_request_unique',
        'plugin_data.csf_import_approval_batches', NULL, 'u',
        ARRAY['organization_id','request_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('csf_import_approval_batches_id_organization_key',
        'plugin_data.csf_import_approval_batches',
        'csf_import_approval_batches_id_organization_key', 'u',
        ARRAY['id','organization_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('commit_queue_preview_unique',
        'plugin_data.csf_import_commit_queue', NULL, 'u',
        ARRAY['organization_id','preview_job_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('commit_queue_preview_tenant_fk',
        'plugin_data.csf_import_commit_queue', NULL, 'f',
        ARRAY['preview_job_id','organization_id']::text[],
        'plugin_data.csf_sheet_import_jobs', ARRAY['id','organization_id']::text[],
        'c', NULL),
      ('csf_import_commit_queue_id_organization_key',
        'plugin_data.csf_import_commit_queue',
        'csf_import_commit_queue_id_organization_key', 'u',
        ARRAY['id','organization_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('approval_item_batch_preview_unique',
        'plugin_data.csf_import_approval_batch_items', NULL, 'u',
        ARRAY['batch_id','preview_job_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('approval_item_preview_tenant_fk',
        'plugin_data.csf_import_approval_batch_items', NULL, 'f',
        ARRAY['preview_job_id','organization_id']::text[],
        'plugin_data.csf_sheet_import_jobs', ARRAY['id','organization_id']::text[],
        'c', NULL),
      ('csf_import_approval_items_batch_organization_fkey',
        'plugin_data.csf_import_approval_batch_items',
        'csf_import_approval_items_batch_organization_fkey', 'f',
        ARRAY['batch_id','organization_id']::text[],
        'plugin_data.csf_import_approval_batches',
        ARRAY['id','organization_id']::text[], 'c', NULL),
      ('csf_import_approval_items_queue_organization_fkey',
        'plugin_data.csf_import_approval_batch_items',
        'csf_import_approval_items_queue_organization_fkey', 'f',
        ARRAY['queue_id','organization_id']::text[],
        'plugin_data.csf_import_commit_queue',
        ARRAY['id','organization_id']::text[], 'n',
        'ON DELETE SET NULL (queue_id)'),
      ('row_batch_request_unique',
        'plugin_data.csf_import_row_batches', NULL, 'u',
        ARRAY['organization_id','request_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('row_batch_attempt_tenant_fk',
        'plugin_data.csf_import_row_batches', NULL, 'f',
        ARRAY['attempt_id','organization_id']::text[],
        'plugin_data.csf_sheet_import_commit_attempts',
        ARRAY['id','organization_id']::text[], 'c', NULL),
      ('csf_import_row_batches_id_organization_key',
        'plugin_data.csf_import_row_batches',
        'csf_import_row_batches_id_organization_key', 'u',
        ARRAY['id','organization_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('row_outcome_batch_row_unique',
        'plugin_data.csf_import_row_batch_outcomes', NULL, 'u',
        ARRAY['batch_id','import_row_id']::text[],
        NULL, NULL::text[], NULL, NULL),
      ('row_outcome_import_row_tenant_fk',
        'plugin_data.csf_import_row_batch_outcomes', NULL, 'f',
        ARRAY['import_row_id','organization_id']::text[],
        'plugin_data.csf_sheet_import_rows', ARRAY['id','organization_id']::text[],
        'c', NULL),
      ('csf_import_row_outcomes_batch_organization_fkey',
        'plugin_data.csf_import_row_batch_outcomes',
        'csf_import_row_outcomes_batch_organization_fkey', 'f',
        ARRAY['batch_id','organization_id']::text[],
        'plugin_data.csf_import_row_batches',
        ARRAY['id','organization_id']::text[], 'c', NULL)
  ),
  constraint_issues AS (
    SELECT 'constraint'::text AS issue_kind, expected.label AS object_name
    FROM expected_constraints AS expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.conrelid = to_regclass(expected.relation_name)
        AND constraint_record.contype = expected.constraint_type::"char"
        AND constraint_record.convalidated
        AND (
          expected.constraint_name IS NULL
          OR constraint_record.conname = expected.constraint_name
        )
        AND (
          SELECT array_agg(
            attribute_record.attname::text ORDER BY key_column.ordinality
          )
          FROM unnest(constraint_record.conkey)
            WITH ORDINALITY AS key_column(attnum, ordinality)
          JOIN pg_catalog.pg_attribute AS attribute_record
            ON attribute_record.attrelid = constraint_record.conrelid
           AND attribute_record.attnum = key_column.attnum
        ) = expected.key_columns
        AND (
          expected.referenced_relation IS NULL
          OR (
            constraint_record.confrelid =
              to_regclass(expected.referenced_relation)
            AND (
              SELECT array_agg(
                attribute_record.attname::text ORDER BY key_column.ordinality
              )
              FROM unnest(constraint_record.confkey)
                WITH ORDINALITY AS key_column(attnum, ordinality)
              JOIN pg_catalog.pg_attribute AS attribute_record
                ON attribute_record.attrelid = constraint_record.confrelid
               AND attribute_record.attnum = key_column.attnum
            ) = expected.referenced_columns
          )
        )
        AND (
          expected.delete_action IS NULL
          OR constraint_record.confdeltype = expected.delete_action::"char"
        )
        AND (
          expected.definition_fragment IS NULL
          OR pg_catalog.pg_get_constraintdef(constraint_record.oid)
            LIKE '%' || expected.definition_fragment || '%'
      )
    )
  ),
  expected_check_constraints(label, relation_name, definition_terms) AS (
    VALUES
      ('workbook_discovered_tabs_array', 'plugin_data.csf_class_workbooks',
        ARRAY['discovered_tabs','jsonb_typeof','array']::text[]),
      ('workbook_source_candidates_array', 'plugin_data.csf_class_workbooks',
        ARRAY['source_candidates','jsonb_typeof','array']::text[]),
      ('workbook_state_domain', 'plugin_data.csf_class_workbooks',
        ARRAY['state','linked','needs_reconnect','blocked','unlinked']::text[]),
      ('workbook_drive_link_shape', 'plugin_data.csf_class_workbooks',
        ARRAY['drive_file_id','state','blocked','unlinked']::text[]),
      ('workbook_provider_version_shape', 'plugin_data.csf_class_workbooks',
        ARRAY['provider_version','^[1-9][0-9]{0,18}$']::text[]),
      ('workbook_prepared_version_shape', 'plugin_data.csf_class_workbooks',
        ARRAY['last_prepared_version','^[1-9][0-9]{0,18}$']::text[]),
      ('refresh_provider_version_shape',
        'plugin_data.csf_class_workbook_refresh_jobs',
        ARRAY['provider_version','^[1-9][0-9]{0,18}$']::text[]),
      ('refresh_status_domain', 'plugin_data.csf_class_workbook_refresh_jobs',
        ARRAY['status','queued','running','completed','needs_reconnect',
          'blocked','failed']::text[]),
      ('refresh_attempt_count_nonnegative',
        'plugin_data.csf_class_workbook_refresh_jobs',
        ARRAY['attempt_count','>= 0']::text[]),
      ('refresh_result_counts_object',
        'plugin_data.csf_class_workbook_refresh_jobs',
        ARRAY['result_counts','jsonb_typeof','object']::text[]),
      ('approval_batch_status_domain',
        'plugin_data.csf_import_approval_batches',
        ARRAY['status','queued','running','completed',
          'partially_completed']::text[]),
      ('approval_requested_count_nonnegative',
        'plugin_data.csf_import_approval_batches',
        ARRAY['requested_count','>= 0']::text[]),
      ('approval_queued_count_nonnegative',
        'plugin_data.csf_import_approval_batches',
        ARRAY['queued_count','>= 0']::text[]),
      ('approval_blocked_count_nonnegative',
        'plugin_data.csf_import_approval_batches',
        ARRAY['blocked_count','>= 0']::text[]),
      ('approval_stale_count_nonnegative',
        'plugin_data.csf_import_approval_batches',
        ARRAY['stale_count','>= 0']::text[]),
      ('approval_completed_count_nonnegative',
        'plugin_data.csf_import_approval_batches',
        ARRAY['completed_count','>= 0']::text[]),
      ('commit_queue_status_domain', 'plugin_data.csf_import_commit_queue',
        ARRAY['status','queued','running','completed','blocked','failed']::text[]),
      ('commit_queue_attempt_count_nonnegative',
        'plugin_data.csf_import_commit_queue',
        ARRAY['attempt_count','>= 0']::text[]),
      ('commit_queue_result_counts_object',
        'plugin_data.csf_import_commit_queue',
        ARRAY['result_counts','jsonb_typeof','object']::text[]),
      ('approval_item_state_domain',
        'plugin_data.csf_import_approval_batch_items',
        ARRAY['state','queued','blocked','stale','completed']::text[]),
      ('row_batch_size_bound', 'plugin_data.csf_import_row_batches',
        ARRAY['cardinality(row_ids)','1','50']::text[]),
      ('row_batch_status_domain', 'plugin_data.csf_import_row_batches',
        ARRAY['status','running','completed']::text[]),
      ('row_batch_succeeded_count_nonnegative',
        'plugin_data.csf_import_row_batches',
        ARRAY['succeeded_count','>= 0']::text[]),
      ('row_batch_failed_count_nonnegative',
        'plugin_data.csf_import_row_batches',
        ARRAY['failed_count','>= 0']::text[]),
      ('row_outcome_domain', 'plugin_data.csf_import_row_batch_outcomes',
        ARRAY['outcome','created','updated','recovered','failed']::text[]),
      ('row_outcome_result_object',
        'plugin_data.csf_import_row_batch_outcomes',
        ARRAY['result','jsonb_typeof','object']::text[])
  ),
  check_constraint_issues AS (
    SELECT 'check_constraint'::text AS issue_kind,
      expected.label AS object_name
    FROM expected_check_constraints AS expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.conrelid = to_regclass(expected.relation_name)
        AND constraint_record.contype = 'c'
        AND constraint_record.convalidated
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(expected.definition_terms) AS term
          WHERE pg_catalog.strpos(
            pg_catalog.lower(
              pg_catalog.pg_get_constraintdef(constraint_record.oid)
            ),
            term
          ) = 0
        )
    )
  ),
  invalid_constraint_issues AS (
    SELECT 'unvalidated_constraint'::text AS issue_kind,
      constraint_record.conname::text AS object_name
    FROM expected_tables AS expected
    JOIN pg_catalog.pg_constraint AS constraint_record
      ON constraint_record.conrelid = to_regclass(expected.relation_name)
    WHERE NOT constraint_record.convalidated
  ),
  expected_indexes(relation_name, index_name, unique_index, definition_terms) AS (
    VALUES
      ('plugin_data.csf_class_workbook_refresh_jobs',
        'csf_class_workbook_refresh_jobs_claim_idx', false,
        ARRAY['created_at','id','status','queued']::text[]),
      ('plugin_data.csf_class_workbook_refresh_jobs',
        'csf_class_workbook_refresh_jobs_running_lease_idx', false,
        ARRAY['lease_expires_at','status','running']::text[]),
      ('plugin_data.csf_import_commit_queue',
        'csf_import_commit_queue_claim_idx', false,
        ARRAY['created_at','id','status','queued']::text[]),
      ('plugin_data.csf_import_commit_queue',
        'csf_import_commit_queue_running_lease_idx', false,
        ARRAY['lease_expires_at','status','running']::text[]),
      ('plugin_data.csf_point_submissions',
        'csf_point_submissions_unresolved_queue_idx', false,
        ARRAY['organization_id','submitted_at desc','id desc','needs_action']::text[]),
      ('plugin_data.csf_point_appeals',
        'csf_point_appeals_unresolved_queue_idx', false,
        ARRAY['organization_id','created_at desc','id desc','under_review']::text[]),
      ('plugin_data.csf_profiles', 'csf_profiles_name_prefix_idx', false,
        ARRAY['organization_id','normalized_last_name text_pattern_ops',
          'normalized_first_name text_pattern_ops','record_status']::text[]),
      ('plugin_data.csf_profiles', 'csf_profiles_school_email_prefix_idx', false,
        ARRAY['organization_id','normalized_school_email text_pattern_ops',
          'record_status']::text[]),
      ('plugin_data.csf_profiles', 'csf_profiles_personal_email_prefix_idx', false,
        ARRAY['organization_id','normalized_personal_email text_pattern_ops',
          'record_status']::text[]),
      ('plugin_data.csf_class_workbook_refresh_jobs',
        'csf_workbook_refresh_jobs_tenant_state_idx', false,
        ARRAY['organization_id','status','created_at','id']::text[]),
      ('plugin_data.csf_import_approval_batch_items',
        'csf_import_approval_items_tenant_batch_idx', false,
        ARRAY['organization_id','batch_id','state','id']::text[]),
      ('plugin_data.csf_import_approval_batch_items',
        'csf_import_approval_items_org_queue_idx', false,
        ARRAY['organization_id','queue_id','queue_id is not null']::text[]),
      ('plugin_data.csf_import_row_batch_outcomes',
        'csf_import_row_outcomes_tenant_batch_idx', false,
        ARRAY['organization_id','batch_id','created_at','id']::text[]),
      ('plugin_data.csf_admin_audit_events',
        'csf_class_history_profile_create_request_idx', true,
        ARRAY['organization_id','correlation_id',
          'sheet_import.class_history_profile_create_request']::text[])
  ),
  index_issues AS (
    SELECT 'index'::text AS issue_kind, expected.index_name AS object_name
    FROM expected_indexes AS expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS index_record
      JOIN pg_catalog.pg_index AS index_state
        ON index_state.indexrelid = index_record.oid
      WHERE index_record.relname = expected.index_name
        AND index_state.indrelid = to_regclass(expected.relation_name)
        AND index_state.indisvalid
        AND index_state.indisready
        AND index_state.indisunique = expected.unique_index
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(expected.definition_terms) AS term
          WHERE pg_catalog.strpos(
            pg_catalog.lower(
              pg_catalog.pg_get_indexdef(index_state.indexrelid)
            ),
            term
          ) = 0
        )
    )
  ),
  expected_triggers(relation_name, trigger_name, trigger_type, function_name) AS (
    VALUES
      ('plugin_data.csf_sheet_import_rows',
        'csf_sheet_import_rows_attempt_created_profile_resolution', 19,
        'plugin_data.csf_set_import_created_profile_resolution()'),
      ('plugin_data.csf_sheet_import_rows',
        'csf_sheet_import_rows_attempt_lineage', 23,
        'plugin_data.csf_enforce_import_row_attempt_lineage()'),
      ('plugin_data.csf_import_approval_batches',
        'csf_import_approval_batches_normalize_status', 19,
        'plugin_data.csf_normalize_import_approval_batch_status()'),
      ('plugin_data.csf_import_approval_batches',
        'csf_import_approval_batches_audit', 17,
        'plugin_data.csf_audit_import_approval_batch()')
  ),
  trigger_issues AS (
    SELECT 'trigger'::text AS issue_kind, expected.trigger_name AS object_name
    FROM expected_triggers AS expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgrelid = to_regclass(expected.relation_name)
        AND trigger_record.tgname = expected.trigger_name
        AND trigger_record.tgtype = expected.trigger_type
        AND trigger_record.tgfoid = to_regprocedure(expected.function_name)
        AND NOT trigger_record.tgisinternal
        AND trigger_record.tgenabled <> 'D'
    )
  ),
  expected_functions(
    signature, service_execute, security_definer, return_type, returns_set
  ) AS (
    VALUES
      ('plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_claim_class_workbook_check(uuid,uuid,uuid,integer)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_complete_class_workbook_check(uuid,uuid,uuid,uuid,text,text)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_fail_class_workbook_check(uuid,uuid,uuid,uuid,text,text)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_claim_class_workbook_refresh_job(integer)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_finish_class_workbook_refresh_job(uuid,uuid,text,jsonb,integer,integer,integer,text)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_queue_class_workbook_preparation(uuid,uuid,text,uuid,text,text,jsonb)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_claim_import_commit_queue(integer)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_import_row_batch_receipt(uuid,uuid)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_commit_import_row_batch(uuid,uuid,uuid,uuid[])',
        true, true, 'jsonb', false),
      ('plugin_data.csf_assert_dashboard_officer(uuid,uuid)',
        true, true, 'void', false),
      ('plugin_data.csf_officer_home_snapshot(uuid,uuid)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_member_profile_snapshot(uuid,uuid)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_search_profiles(uuid,uuid,text,uuid)',
        true, true, 'record', true),
      ('plugin_data.csf_post_reply_previews(uuid,uuid[],integer)',
        true, true, 'record', true),
      ('plugin_data.csf_import_preview_readiness_batch(uuid,uuid[])',
        true, true, 'record', true),
      ('plugin_data.csf_get_worker_alert_snapshot()',
        true, true, 'jsonb', false),
      ('plugin_data.csf_class_history_source_key_value(jsonb)',
        true, false, 'text', false),
      ('plugin_data.csf_class_history_has_stable_source_key(jsonb)',
        true, false, 'boolean', false),
      ('plugin_data.csf_class_history_source_key_requires_review(uuid,uuid)',
        true, true, 'boolean', false),
      ('plugin_data.csf_import_preview_readiness(uuid,uuid)',
        true, false, 'jsonb', false),
      ('plugin_data.csf_create_profile_for_class_history_import_row(uuid,uuid,uuid,uuid,text)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_member_home_context_snapshot(uuid,uuid,timestamptz,timestamptz,date)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_member_stream_enrichment(uuid,uuid[],uuid[],uuid[])',
        true, true, 'jsonb', false),
      ('plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)',
        true, true, 'jsonb', false),
      ('plugin_data.csf_class_history_source_key_target(uuid,uuid)',
        false, true, 'uuid', false),
      ('plugin_data.csf_import_class_history_row_v2_source_key_base(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
        false, true, 'jsonb', false),
      ('plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)',
        false, true, 'jsonb', false),
      ('plugin_data.csf_set_import_created_profile_resolution()',
        false, false, 'trigger', false),
      ('plugin_data.csf_enforce_import_row_attempt_lineage()',
        false, false, 'trigger', false),
      ('plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)',
        false, true, 'jsonb', false),
      ('plugin_data.csf_audit_import_approval_batch()',
        false, true, 'trigger', false),
      ('plugin_data.csf_normalize_import_approval_batch_status()',
        false, true, 'trigger', false),
      ('plugin_data.csf_block_import_commit_queue(uuid,text)',
        false, true, 'void', false),
      ('plugin_data.csf_commit_import_row_batch_unserialized(uuid,uuid,uuid,uuid[])',
        false, true, 'jsonb', false),
      ('plugin_data.csf_member_profile_snapshot_verified_projection(uuid,uuid)',
        false, true, 'jsonb', false),
      ('plugin_data.csf_member_home_context_snapshot_unscoped(uuid,uuid,timestamptz,timestamptz,date)',
        false, true, 'jsonb', false)
  ),
  function_state AS (
    SELECT expected.*,
      function_record.oid,
      function_record.prosecdef,
      function_record.proconfig,
      function_record.prorettype::regtype::text AS actual_return_type,
      function_record.proretset,
      has_function_privilege(
        'service_role', function_record.oid, 'EXECUTE'
      ) AS actual_service_execute,
      coalesce(has_function_privilege(
        'anon', function_record.oid, 'EXECUTE'
      ), false) OR coalesce(has_function_privilege(
        'authenticated', function_record.oid, 'EXECUTE'
      ), false) AS browser_execute,
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(coalesce(
          function_record.proacl,
          pg_catalog.acldefault('f', function_record.proowner)
        )) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      ) AS public_execute
    FROM expected_functions AS expected
    LEFT JOIN pg_catalog.pg_proc AS function_record
      ON function_record.oid = to_regprocedure(expected.signature)
  ),
  function_issues AS (
    SELECT 'function'::text AS issue_kind, state.signature AS object_name
    FROM function_state AS state
    WHERE state.oid IS NULL
       OR state.prosecdef IS DISTINCT FROM state.security_definer
       OR NOT coalesce(state.proconfig @> ARRAY['search_path=""'], false)
       OR state.actual_return_type IS DISTINCT FROM state.return_type
       OR state.proretset IS DISTINCT FROM state.returns_set
       OR state.actual_service_execute IS DISTINCT FROM state.service_execute
       OR state.browser_execute
       OR state.public_execute
  ),
  retired_functions(function_name) AS (
    VALUES
      ('csf_confirm_profile_name_match'),
      ('csf_join_class_by_code_pre_identity_guard'),
      ('csf_register_class_workbook')
  ),
  retired_function_issues AS (
    SELECT 'retired_function'::text AS issue_kind,
      'plugin_data.' || retired.function_name AS object_name
    FROM retired_functions AS retired
    WHERE EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS function_record
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function_record.pronamespace
      WHERE namespace.nspname = 'plugin_data'
        AND function_record.proname = retired.function_name
    )
  ),
  expected_function_fragments(signature, definition_fragment) AS (
    VALUES
      ('plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)',
        'perform plugin_data.csf_assert_import_actor('),
      ('plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)',
        'v_batch.actor_user_id is distinct from p_actor_user_id'),
      ('plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)',
        'v_existing_preview_ids is distinct from v_requested_preview_ids'),
      ('plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)',
        'where item.organization_id = v_item.organization_id'),
      ('plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)',
        'where batch_item.organization_id = v_item.organization_id'),
      ('plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)',
        'and batch.organization_id = v_item.organization_id')
  ),
  function_fragment_issues AS (
    SELECT 'function_definition'::text AS issue_kind,
      expected.signature AS object_name
    FROM expected_function_fragments AS expected
    LEFT JOIN pg_catalog.pg_proc AS function_record
      ON function_record.oid = to_regprocedure(expected.signature)
    WHERE function_record.oid IS NULL
       OR pg_catalog.strpos(
         pg_catalog.lower(
           pg_catalog.pg_get_functiondef(function_record.oid)
         ),
         expected.definition_fragment
       ) = 0
    GROUP BY expected.signature
  ),
  queue_definition AS (
    SELECT pg_catalog.lower(
      pg_catalog.pg_get_functiondef(function_record.oid)
    ) AS definition
    FROM pg_catalog.pg_proc AS function_record
    WHERE function_record.oid = to_regprocedure(
      'plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)'
    )
  ),
  function_order_issues AS (
    SELECT 'function_definition'::text AS issue_kind,
      'plugin_data.csf_queue_import_preview_batch authorization order'::text
        AS object_name
    WHERE NOT EXISTS (
      SELECT 1
      FROM queue_definition
      WHERE pg_catalog.strpos(
          definition,
          'perform plugin_data.csf_assert_import_actor('
        ) > 0
        AND pg_catalog.strpos(definition, 'select * into v_batch') > 0
        AND pg_catalog.strpos(
          definition,
          'perform plugin_data.csf_assert_import_actor('
        ) < pg_catalog.strpos(definition, 'select * into v_batch')
    )
  ),
  issues AS (
    SELECT * FROM table_issues
    UNION ALL SELECT * FROM column_issues
    UNION ALL SELECT * FROM constraint_issues
    UNION ALL SELECT * FROM check_constraint_issues
    UNION ALL SELECT * FROM invalid_constraint_issues
    UNION ALL SELECT * FROM index_issues
    UNION ALL SELECT * FROM trigger_issues
    UNION ALL SELECT * FROM function_issues
    UNION ALL SELECT * FROM retired_function_issues
    UNION ALL SELECT * FROM function_fragment_issues
    UNION ALL SELECT * FROM function_order_issues
  )
  SELECT coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'kind', issue_kind,
          'object', object_name
        ) ORDER BY issue_kind, object_name
      ),
      '[]'::jsonb
    )::text AS target_csf_release_tail_issues,
    count(*) = 0 AS target_csf_release_tail_pass
  FROM issues
  \gset
  \echo :target_csf_release_tail_issues
  \if :target_csf_release_tail_pass
    \echo 'PASS T2C'
  \else
    \echo 'FAIL T2C: the 432 CSF release-tail contract has drifted.'
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
  \echo 'T3B Retired onboarding-link surface — PASS: fully absent'
  \echo '    20260823211000 drops the table, its RPC families, and the'
  \echo '    link-request pointer column; 20260823210000 moves class codes'
  \echo '    to the six-character unambiguous alphabet'
  \echo '=============================================================='
  SELECT proc.proname || '(' || pg_get_function_identity_arguments(proc.oid) || ')'
    AS surviving_retired_function
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'plugin_data'
    AND (
      proc.proname LIKE '%onboarding_link%'
      OR proc.proname LIKE '%direct_invitation%'
      OR proc.proname LIKE 'csf_submit_profile_link_request%'
      OR proc.proname IN (
        'csf_profile_claim_candidate',
        'csf_confirm_profile_claim',
        'csf_confirm_profile_claim_identity_base',
        'csf_decline_profile_claim',
        'csf_decline_profile_claim_identity_base'
      )
    )
  ORDER BY proc.proname;

  SELECT to_regclass('plugin_data.csf_onboarding_links') IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_record
      WHERE attribute_record.attrelid =
          to_regclass('plugin_data.csf_profile_link_requests')
        AND attribute_record.attname = 'onboarding_link_id'
        AND NOT attribute_record.attisdropped
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS proc
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'plugin_data'
        AND (
          proc.proname LIKE '%onboarding_link%'
          OR proc.proname LIKE '%direct_invitation%'
          OR proc.proname LIKE 'csf_submit_profile_link_request%'
          OR proc.proname IN (
            'csf_profile_claim_candidate',
            'csf_confirm_profile_claim',
            'csf_confirm_profile_claim_identity_base',
            'csf_decline_profile_claim',
            'csf_decline_profile_claim_identity_base'
          )
        )
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid =
          to_regclass('plugin_data.csf_class_join_codes')
        AND constraint_row.contype = 'c'
        AND pg_get_constraintdef(constraint_row.oid)
          LIKE '%[A-HJ-NP-Z2-9]{6}%'
    ) AS target_onboarding_teardown_pass
  \gset
  \if :target_onboarding_teardown_pass
    \echo 'PASS T3B'
  \else
    \echo 'FAIL T3B: retired onboarding-link objects remain after cutover.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  \echo ''
  \echo '=============================================================='
  \echo 'T4  Google CAP RPC integrity and service-only execution'
  \echo '    PASS: exact fenced definitions, fixed search path, least privilege'
  \echo '=============================================================='
  WITH expected(signature, required_fragments, forbidden_fragment) AS (
    VALUES
      (
        'public.claim_google_cap_event(text,text,text,text,timestamptz,text)',
        ARRAY[
          'identity_row.provider_id = p_google_subject',
          'v_receipt.status = ''effect_started'''
        ]::text[],
        'identity_data'
      ),
      (
        'public.begin_google_cap_event_effect(uuid,uuid,text)',
        ARRAY[
          'v_receipt.claim_token <> p_claim_token',
          'v_receipt.lease_expires_at <= pg_catalog.clock_timestamp()',
          'identity_row.provider_id = p_google_subject',
          'v_receipt.resolved_user_id IS DISTINCT FROM v_user_id',
          'status = ''effect_started'''
        ]::text[],
        NULL::text
      ),
      (
        'public.finish_google_cap_event(uuid,uuid,boolean,text,integer,integer)',
        ARRAY[
          'receipt.status IN (''processing'', ''effect_started'')',
          'OR receipt.status = ''effect_started'''
        ]::text[],
        NULL::text
      )
  ),
  inspected AS (
    SELECT
      expected.signature,
      function_record.oid,
      function_record.prosecdef,
      function_record.proconfig,
      CASE
        WHEN function_record.oid IS NULL THEN NULL::text
        ELSE pg_catalog.pg_get_functiondef(function_record.oid)
      END AS definition,
      expected.required_fragments,
      expected.forbidden_fragment
    FROM expected
    LEFT JOIN pg_catalog.pg_proc AS function_record
      ON function_record.oid = to_regprocedure(expected.signature)
  ),
  function_violations AS (
    SELECT
      inspected.signature,
      CASE
        WHEN inspected.oid IS NULL THEN 'missing'
        WHEN NOT inspected.prosecdef THEN 'not_security_definer'
        WHEN NOT coalesce(
          inspected.proconfig,
          ARRAY[]::text[]
        ) @> ARRAY['search_path=""'] THEN 'mutable_search_path'
        WHEN NOT has_function_privilege(
          'service_role',
          inspected.oid,
          'EXECUTE'
        ) THEN 'service_role_execute_missing'
        WHEN has_function_privilege('anon', inspected.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', inspected.oid, 'EXECUTE')
          THEN 'browser_execute_present'
        WHEN EXISTS (
          SELECT 1
          FROM unnest(inspected.required_fragments) AS fragment(value)
          WHERE pg_catalog.strpos(inspected.definition, fragment.value) = 0
        ) THEN 'required_fence_missing'
        WHEN inspected.forbidden_fragment IS NOT NULL
          AND pg_catalog.strpos(
            inspected.definition,
            inspected.forbidden_fragment
          ) > 0 THEN 'forbidden_fallback_present'
        ELSE NULL::text
      END AS issue
    FROM inspected
  ),
  violations AS (
    SELECT signature, issue
    FROM function_violations
    UNION ALL
    SELECT
      'private.google_cap_event_receipts_processing_subject_uidx'::text,
      CASE
        WHEN to_regclass(
          'private.google_cap_event_receipts_processing_subject_uidx'
        ) IS NULL THEN 'missing'
        WHEN NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_index AS index_state
          WHERE index_state.indexrelid = to_regclass(
              'private.google_cap_event_receipts_processing_subject_uidx'
            )
            AND index_state.indrelid = to_regclass(
              'private.google_cap_event_receipts'
            )
            AND index_state.indisunique
            AND index_state.indisvalid
            AND index_state.indisready
            AND index_state.indnkeyatts = 1
            AND pg_catalog.pg_get_indexdef(
              index_state.indexrelid,
              1,
              true
            ) = 'subject_hash'
            AND pg_catalog.regexp_replace(
              pg_catalog.pg_get_expr(
                index_state.indpred,
                index_state.indrelid
              ),
              '[[:space:]()]',
              '',
              'g'
            ) = 'status=ANYARRAY[''processing''::text,''effect_started''::text]'
        ) THEN 'effect_fence_index_drift'
        ELSE NULL::text
      END
  )
  SELECT
    count(*) FILTER (WHERE issue IS NOT NULL) = 0
      AS target_google_cap_rpc_pass,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'function', signature,
          'issue', issue
        )
        ORDER BY signature
      ) FILTER (WHERE issue IS NOT NULL),
      '[]'::jsonb
    )::text AS target_google_cap_rpc_violations
  FROM violations
  \gset
  \echo :target_google_cap_rpc_violations
  \if :target_google_cap_rpc_pass
    \echo 'PASS T4: Google CAP RPC fence and ACL are exact.'
  \else
    \echo 'FAIL T4: Google CAP RPC definition, fence, or ACL drifted.'
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
      ('public.end_recurring_project_series_transactional(uuid)', 'authenticated'),
      ('public.end_recurring_project_series_transactional(uuid,jsonb)', 'authenticated'),
      ('public.get_csf_application_role_context(uuid,text)', 'authenticated'),
      ('public.get_plugin_application_access_context(uuid,text,text)', 'authenticated'),
      ('public.get_plugin_application_access_context_by_identifier(text,text,text)', 'authenticated'),
      ('public.get_plugin_application_route_target_by_identifier(text,text,text)', 'authenticated'),
      ('public.get_plugin_application_asset_route_target_by_identifier(text,text,text,text)', 'authenticated'),
      ('public.get_public_attendees(uuid)', 'anon'),
      ('public.get_public_attendees(uuid)', 'authenticated'),
      ('public.is_project_organizer(uuid,uuid)', 'authenticated'),
      ('public.is_super_admin()', 'authenticated'),
      ('public.is_trusted_member(uuid)', 'authenticated'),
      ('public.reject_project_signup(uuid)', 'authenticated'),
      ('public.transition_project_status_transactional(uuid,text)', 'authenticated'),
      ('public.unreject_project_signup_with_capacity(uuid)', 'authenticated')
  ),
  client(role_name) AS (
    VALUES ('anon'::text), ('authenticated'::text)
  ),
  reviewed_security_definer(signature, role_name) AS (
    SELECT expected.signature, expected.role_name
    FROM expected
    WHERE expected.signature IN (
      'public.get_csf_application_role_context(uuid,text)',
      'public.get_plugin_application_access_context(uuid,text,text)',
      'public.get_plugin_application_access_context_by_identifier(text,text,text)',
      'public.get_plugin_application_route_target_by_identifier(text,text,text)',
      'public.get_plugin_application_asset_route_target_by_identifier(text,text,text,text)'
    )
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
      AND NOT EXISTS (
        SELECT 1
        FROM reviewed_security_definer AS reviewed
        WHERE reviewed.signature = pg_catalog.format(
          'public.%I(%s)',
          function_record.proname,
          pg_catalog.replace(
            pg_catalog.oidvectortypes(function_record.proargtypes),
            ', ',
            ','
          )
        )
          AND reviewed.role_name = client.role_name
      )
  ),
  security_definer_posture_drift AS (
    SELECT
      'reviewed_security_definer_posture'::text AS drift_kind,
      reviewed.signature,
      reviewed.role_name
    FROM reviewed_security_definer AS reviewed
    WHERE pg_catalog.to_regprocedure(reviewed.signature) IS NULL
      OR NOT (
        SELECT function_record.prosecdef
        FROM pg_catalog.pg_proc AS function_record
        WHERE function_record.oid = pg_catalog.to_regprocedure(reviewed.signature)
      )
  ),
  violations AS (
    SELECT * FROM acl_drift
    UNION ALL
    SELECT * FROM security_definer_client_exec
    UNION ALL
    SELECT * FROM security_definer_posture_drift
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

  \echo ''
  \echo '=============================================================='
  \echo 'T8  Central import lineage and transport-settlement boundary'
  \echo '    PASS: identity-first begin; unknown-only five-argument settlement'
  \echo '=============================================================='
  WITH reviewed_boundary(signature) AS (
    VALUES
      ('plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid)'),
      ('plugin_data.csf_fail_import_row_for_attempt(uuid,uuid,uuid,text,text)')
  ),
  boundary_state AS (
    SELECT
      reviewed_boundary.signature,
      function_record.oid,
      function_record.prosecdef,
      function_record.proconfig,
      function_record.proacl,
      function_record.proowner
    FROM reviewed_boundary
    LEFT JOIN pg_catalog.pg_proc AS function_record
      ON function_record.oid = to_regprocedure(reviewed_boundary.signature)
  ),
  begin_boundary AS (
    SELECT
      wrapper.oid AS wrapper_oid,
      pg_catalog.pg_get_functiondef(wrapper.oid) AS wrapper_definition,
      base.oid AS base_oid,
      base.proacl AS base_proacl,
      base.proowner AS base_owner
    FROM pg_catalog.pg_proc AS wrapper
    LEFT JOIN pg_catalog.pg_proc AS base
      ON base.oid = to_regprocedure(
        'plugin_data.csf_begin_import_row_for_attempt_identity_base(uuid,uuid,uuid)'
      )
    WHERE wrapper.oid = to_regprocedure(
      'plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid)'
    )
  )
  SELECT
    count(*) = 2
      AND bool_and(oid IS NOT NULL)
      AND bool_and(prosecdef)
      AND bool_and(proconfig @> ARRAY['search_path=""'])
      AND bool_and(has_function_privilege('service_role', oid, 'EXECUTE'))
      AND bool_and(NOT has_function_privilege('anon', oid, 'EXECUTE'))
      AND bool_and(NOT has_function_privilege('authenticated', oid, 'EXECUTE'))
      AND bool_and(NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(proacl, pg_catalog.acldefault('f', proowner))
        ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      ))
      AND to_regprocedure(
        'plugin_data.csf_fail_import_row_for_attempt(uuid,uuid,uuid,text,text,boolean)'
      ) IS NULL
      AND to_regprocedure(
        'plugin_data.csf_begin_import_row_for_attempt_identity_base(uuid,uuid,uuid)'
      ) IS NOT NULL
      AND bool_and(begin_boundary.base_oid IS NOT NULL)
      AND bool_and(NOT has_function_privilege(
        'service_role',
        begin_boundary.base_oid,
        'EXECUTE'
      ))
      AND bool_and(NOT has_function_privilege(
        'anon',
        begin_boundary.base_oid,
        'EXECUTE'
      ))
      AND bool_and(NOT has_function_privilege(
        'authenticated',
        begin_boundary.base_oid,
        'EXECUTE'
      ))
      AND bool_and(NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(
            begin_boundary.base_proacl,
            pg_catalog.acldefault('f', begin_boundary.base_owner)
          )
        ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      ))
      AND bool_and(pg_catalog.strpos(
        begin_boundary.wrapper_definition,
        'PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);'
      ) > 0)
      AND bool_and(pg_catalog.strpos(
        begin_boundary.wrapper_definition,
        'PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);'
      ) < pg_catalog.strpos(
        begin_boundary.wrapper_definition,
        'PERFORM plugin_data.csf_assert_import_actor_for_job('
      ))
      AND bool_and(pg_catalog.strpos(
        begin_boundary.wrapper_definition,
        'PERFORM plugin_data.csf_assert_import_actor_for_job('
      ) < pg_catalog.strpos(
        begin_boundary.wrapper_definition,
        'PERFORM plugin_data.csf_lock_active_import_profiles('
      ))
      AND bool_and(pg_catalog.strpos(
        begin_boundary.wrapper_definition,
        'PERFORM plugin_data.csf_lock_active_import_profiles('
      ) < pg_catalog.strpos(
        begin_boundary.wrapper_definition,
        'RETURN plugin_data.csf_begin_import_row_for_attempt_identity_base('
      )) AS target_import_lineage_pass
  FROM boundary_state
  CROSS JOIN begin_boundary
  \gset
  \if :target_import_lineage_pass
    \echo 'PASS T8: central import lineage and settlement ACLs are exact.'
  \else
    \echo 'FAIL T8: central import lineage signature, lock boundary, or ACL drifted.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  \echo ''
  \echo '=============================================================='
  \echo 'T9  CSF post-mutation outcome resolver boundary'
  \echo '    PASS: service-only ACL; manage_posts recheck brackets the'
  \echo '    same-request advisory lock around a bounded receipt read'
  \echo '=============================================================='
  WITH resolver AS (
    SELECT
      function_record.oid,
      function_record.prosecdef,
      function_record.proconfig,
      function_record.proacl,
      function_record.proowner,
      CASE
        WHEN function_record.oid IS NULL THEN NULL::text
        ELSE pg_catalog.pg_get_functiondef(function_record.oid)
      END AS definition
    FROM (
      VALUES (
        'plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)'
      )
    ) AS expected(signature)
    LEFT JOIN pg_catalog.pg_proc AS function_record
      ON function_record.oid = to_regprocedure(expected.signature)
  ),
  resolver_boundary AS (
    SELECT
      resolver.*,
      pg_catalog.strpos(
        resolver.definition,
        'PERFORM pg_catalog.pg_advisory_xact_lock('
      ) AS lock_position,
      pg_catalog.strpos(
        resolver.definition,
        '''plugin_data.csf_post_mutation_request:'''
      ) AS lock_key_position,
      pg_catalog.strpos(
        resolver.definition,
        'plugin_data.csf_actor_has_permission('
      ) AS first_authorization_position,
      pg_catalog.strpos(
        resolver.definition,
        '''manage_posts'''
      ) AS first_permission_position,
      CASE
        WHEN resolver.definition IS NULL THEN ''
        ELSE pg_catalog.substr(
          resolver.definition,
          pg_catalog.strpos(
            resolver.definition,
            'PERFORM pg_catalog.pg_advisory_xact_lock('
          ) + 1
        )
      END AS after_lock_definition
    FROM resolver
  )
  SELECT
    bool_and(
      resolver_boundary.oid IS NOT NULL
      AND resolver_boundary.prosecdef
      AND coalesce(resolver_boundary.proconfig, ARRAY[]::text[])
        @> ARRAY['search_path=""']
      AND has_function_privilege(
        'service_role',
        resolver_boundary.oid,
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'anon',
        resolver_boundary.oid,
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        resolver_boundary.oid,
        'EXECUTE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(
            resolver_boundary.proacl,
            pg_catalog.acldefault('f', resolver_boundary.proowner)
          )
        ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
      AND resolver_boundary.lock_position > 0
      AND resolver_boundary.lock_key_position
        > resolver_boundary.lock_position
      AND resolver_boundary.first_authorization_position > 0
      AND resolver_boundary.first_authorization_position
        < resolver_boundary.lock_position
      AND resolver_boundary.first_permission_position > 0
      AND resolver_boundary.first_permission_position
        < resolver_boundary.lock_position
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        '|| p_organization_id::text || '':'' || p_request_id::text,'
      ) > 0
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        'plugin_data.csf_actor_has_permission('
      ) > 0
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        '''manage_posts'''
      ) > 0
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        'FROM plugin_data.csf_admin_audit_events'
      ) > pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        '''manage_posts'''
      )
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        'audit.organization_id = p_organization_id'
      ) > 0
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        'audit.correlation_id = p_request_id'
      ) > 0
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        'audit.source_type = ''post_mutation_request'''
      ) > 0
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        'audit.actor_user_id = p_actor_user_id'
      ) > 0
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        'audit.target_id IS NOT NULL'
      ) > 0
      AND pg_catalog.strpos(
        resolver_boundary.after_lock_definition,
        'LIMIT 1'
      ) > 0
    ) AS target_post_outcome_resolver_pass
  FROM resolver_boundary
  \gset
  \if :target_post_outcome_resolver_pass
    \echo 'PASS T9: outcome resolver ACL, lock bracket, and bounded read are exact.'
  \else
    \echo 'FAIL T9: outcome resolver ACL, lock order, or bounded read drifted.'
    SELECT 1 / 0 AS preflight_check_failed;
  \endif

  \echo ''
  \echo '=============================================================='
  \echo 'T10 Feedback candidate rotation boundary'
  \echo '=============================================================='
  SELECT
    to_regclass('public.project_feedback_candidate_read_model') IS NOT NULL
    AND to_regclass('public.projects_feedback_candidate_end_date_idx') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS candidate_view
      WHERE candidate_view.oid = 'public.project_feedback_candidate_read_model'::regclass
        AND candidate_view.reloptions @> ARRAY[
          'security_invoker=true',
          'security_barrier=true'
        ]
    )
    AND has_table_privilege(
      'service_role',
      'public.project_feedback_candidate_read_model',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'anon',
      'public.project_feedback_candidate_read_model',
      'SELECT'
    )
    AND NOT has_table_privilege(
      'authenticated',
      'public.project_feedback_candidate_read_model',
      'SELECT'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS helper
      WHERE helper.oid = 'private.project_feedback_candidate_end_date(text,jsonb)'::regprocedure
        AND pg_catalog.pg_get_userbyid(helper.proowner) = 'postgres'
        AND helper.provolatile = 'i'
        AND helper.proparallel = 's'
    )
    AND has_function_privilege(
      'service_role',
      'private.project_feedback_candidate_end_date(text,jsonb)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'private.project_feedback_candidate_end_date(text,jsonb)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'private.project_feedback_candidate_end_date(text,jsonb)',
      'EXECUTE'
    ) AS target_feedback_candidate_rotation_pass
  \gset
  \if :target_feedback_candidate_rotation_pass
    \echo 'PASS T10: indexed feedback candidate read model and ACLs are exact.'
  \else
    \echo 'FAIL T10: feedback candidate index, view, helper, or ACLs drifted.'
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
  'csf_class_join_codes',
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
