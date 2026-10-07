// Preserve the applicable blocking data checks from the historical preflight.
// Return booleans only; never log rows or provider configuration.
export const maintenanceDataChecks = [
  {
    name: "control_plane",
    query: String.raw`SELECT csf_control_plane_pass AS valid FROM (WITH chapter AS (
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
FROM state) AS control_plane`,
  },
  {
    name: "d1_pass",
    query: String.raw`SELECT NOT EXISTS (
  SELECT 1
  FROM public.certificates
  WHERE type = 'verified' AND signup_id IS NOT NULL
  GROUP BY signup_id
  HAVING count(*) > 1
) AS valid`,
  },
  {
    name: "d2_pass",
    query: String.raw`SELECT NOT EXISTS (
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
) AS valid`,
  },
  {
    name: "d3_pass",
    query: String.raw`SELECT NOT EXISTS (
  SELECT 1
  FROM plugin_data.csf_class_join_codes
  WHERE status = 'active'
  GROUP BY organization_id, cohort_id
  HAVING count(*) > 1
) AS valid`,
  },
  {
    name: "d4_pass",
    query: String.raw`SELECT NOT EXISTS (
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
) AS valid`,
  },
  {
    name: "d5_pass",
    query: String.raw`SELECT NOT EXISTS (
  SELECT 1
  FROM public.project_cancellation_jobs
  WHERE status IS NULL
     OR status NOT IN ('pending', 'processing', 'completed', 'failed', 'needs_review')
     OR attempts IS NULL
     OR attempts < 0
) AS valid`,
  },
  {
    name: "d7_pass",
    query: String.raw`SELECT NOT EXISTS (
  SELECT 1
  FROM plugin_data.csf_announcement_replies AS reply
  LEFT JOIN plugin_data.csf_announcements AS announcement
    ON announcement.id = reply.announcement_id
  WHERE announcement.id IS NULL
     OR announcement.organization_id IS DISTINCT FROM reply.organization_id
) AS valid`,
  },
  {
    name: "d8_pass",
    query: String.raw`SELECT NOT EXISTS (
  SELECT 1
  FROM plugin_data.csf_admin_audit_events
  WHERE source_type = 'post_reply_mutation_request'
    AND action IN ('post_reply_added', 'post_reply_deleted')
  GROUP BY organization_id, correlation_id
  HAVING correlation_id IS NULL OR count(*) > 1
) AS valid`,
  },
  {
    name: "d9_pass",
    query: String.raw`WITH extension_record AS (
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
) AS valid`,
  },
  {
    name: "e1_pass",
    query: String.raw`SELECT NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_index
  WHERE NOT indisvalid OR NOT indisready
) AS valid`,
  },
  {
    name: "e2_pass",
    query: String.raw`SELECT NOT (
  datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid)
) AS valid
FROM pg_database
WHERE datname = current_database()`,
  },
  {
    name: "e6_pass",
    query: String.raw`SELECT NOT EXISTS (
  SELECT 1
  FROM pg_locks
  WHERE NOT granted
) AS valid`,
  },
];
