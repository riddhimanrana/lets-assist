-- Application review: bounded roster pages, scope counts, and the frozen
-- review queue, read on the server.
--
-- The Applications workspace used to load every application in a semester,
-- with its courses, files, corrections and notes, and filter that set in the
-- browser. A 1,000-application campaign serialized all of it into every
-- response. These functions move the list semantics into the database so the
-- server can return one bounded page and a few counts instead:
--
--   csf_review_application_roster_scope   counts for one semester and class
--   csf_review_application_roster_page    one keyset page of list rows
--   csf_review_application_roster_queue   the ordered subjects a review queue
--                                         or a split freezes, as one document
--
-- The list semantics are the ones the browser applied before, unchanged:
--
--   * A subject is an application with a profile in the same organization.
--   * The list is ordered by normalized last name, normalized first name, then
--     application id. The names are compared under
--     `plugin_data.csf_review_name_order`, the ICU root collation declared
--     nondeterministic, which is the comparison the previous loader made with
--     `localeCompare`: punctuation sorts before letters, an accented letter
--     sorts beside its base letter, case is a last tiebreak, and two names
--     the locale comparison calls equal ARE equal. That last part is why the
--     built-in `und-x-icu` is not used. It is deterministic: when ICU finds
--     two last names equal it breaks the tie by their bytes, before the first
--     name is looked at. A stored last name can carry a character ICU ignores
--     (a zero-width space survives name normalization), so two applicants
--     named `miller` and `mi<U+200B>ller` would be ordered by that invisible
--     byte instead of by first name and then id, as the list always has.
--   * The roster index is the 1-based position in the semester/class scope in
--     that order. Search and filters narrow what is listed; they never
--     renumber it. It is a label, not a paging coordinate.
--   * Pending means the published decision is neither approved nor rejected.
--   * Search is a literal, case-insensitive substring of "first last". It is
--     not a pattern, so % and _ match only themselves. It runs on the display
--     names under their ordinary deterministic collation; the name-order
--     collation is used for ordering and cursor comparison only, never for
--     matching.
--   * A staged Sheet decision is attached to every row that has one. The Sheet
--     filter and the Sheet ordering apply only when the caller says the
--     semester is reviewed in the Sheet. The ordering puts rows that block
--     release first, then rows not yet done, then done rows, each keeping
--     roster order.
--
-- One collation and five functions: no table, index, policy or data change.
-- Every function is service-role only, owned by the migration role, with an
-- empty search path. The two helpers are internal and are not granted to any
-- client role.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The name order
--
-- ICU root locale, nondeterministic, so strings the locale comparison treats
-- as equal compare equal and the next sort key decides. Owned by the migration
-- role. A collation carries no privileges of its own, so there is nothing to
-- grant or revoke: it is reachable only by naming it, and every use below is
-- schema-qualified inside a SECURITY DEFINER function with an empty search
-- path. It is applied to ordering and to row comparison only. A nondeterministic
-- collation cannot be used for pattern or substring matching, and none of
-- the matching below uses it.
-- ---------------------------------------------------------------------------

CREATE COLLATION plugin_data.csf_review_name_order (
  provider = icu,
  locale = 'und',
  deterministic = false
);

COMMENT ON COLLATION plugin_data.csf_review_name_order IS
  'ICU root locale, nondeterministic. The order of the application review list: names the locale comparison treats as equal are equal, so the first name and then the application id break the tie. Used for ordering and keyset comparison only, never for matching.';

-- ---------------------------------------------------------------------------
-- A. The scope: every reviewable application in one semester and class
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_review_application_roster_rows(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid
)
RETURNS TABLE (
  application_id uuid,
  profile_id uuid,
  cohort_id uuid,
  first_name text,
  last_name text,
  sort_last text,
  sort_first text,
  assigned_to uuid,
  decision_status text,
  decision_pending boolean,
  source_submitted_at timestamptz,
  reported_totals jsonb,
  list_i_points numeric,
  list_i_ii_points numeric,
  grand_total_points numeric,
  roster_index integer,
  has_stage boolean,
  stage_status text,
  stage_reason text,
  stage_observed_color text,
  stage_is_done boolean,
  stage_blocks_release boolean,
  stage_block_reason text,
  stage_release_state text,
  stage_released_decision text,
  stage_observed_row_number integer,
  sheet_rank integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    application.id,
    profile.id,
    application.cohort_id,
    coalesce(profile.first_name, ''),
    coalesce(profile.last_name, ''),
    profile.normalized_last_name,
    profile.normalized_first_name,
    application.assigned_to,
    application.decision_status::text,
    coalesce(application.decision_status::text, '') NOT IN ('approved', 'rejected'),
    application.source_submitted_at,
    application.application_data -> 'normalizedImport' -> 'claimedTotals',
    application.list_i_points::numeric,
    application.list_i_ii_points::numeric,
    application.grand_total_points::numeric,
    pg_catalog.row_number() OVER (
      ORDER BY
        profile.normalized_last_name COLLATE plugin_data.csf_review_name_order,
        profile.normalized_first_name COLLATE plugin_data.csf_review_name_order,
        application.id
    )::integer,
    stage.application_id IS NOT NULL,
    CASE
      WHEN stage.application_id IS NULL THEN NULL
      ELSE coalesce(nullif(pg_catalog.btrim(stage.staged_decision), ''), 'unreviewed')
    END,
    nullif(pg_catalog.btrim(stage.staged_reason), ''),
    nullif(pg_catalog.btrim(stage.observed_color), ''),
    coalesce(stage.is_done, false),
    coalesce(stage.blocks_release, false),
    nullif(pg_catalog.btrim(stage.block_reason), ''),
    CASE
      WHEN stage.application_id IS NULL THEN NULL
      WHEN stage.release_state = 'released' THEN 'released'
      ELSE 'staged'
    END,
    nullif(pg_catalog.btrim(stage.released_decision), ''),
    stage.observed_row_number,
    -- Mirrors the list ordering officers already use for a Sheet semester: a
    -- row with no staged decision is not done, an individual officer approval
    -- is done, a row that blocks release needs an officer first.
    CASE
      WHEN stage.application_id IS NULL THEN 0
      WHEN nullif(pg_catalog.btrim(stage.block_reason), '') = 'officer_approved' THEN 1
      WHEN coalesce(stage.blocks_release, false) THEN -1
      WHEN coalesce(stage.is_done, false) THEN 1
      ELSE 0
    END
  FROM plugin_data.csf_term_applications AS application
  JOIN plugin_data.csf_profiles AS profile
    ON profile.id = application.profile_id
   AND profile.organization_id = application.organization_id
  LEFT JOIN plugin_data.csf_application_decision_stages AS stage
    ON stage.organization_id = application.organization_id
   AND stage.application_id = application.id
   AND stage.term_id = application.term_id
  WHERE application.organization_id = p_organization_id
    AND application.term_id = p_term_id
    AND (p_cohort_id IS NULL OR application.cohort_id = p_cohort_id);
$$;

-- ---------------------------------------------------------------------------
-- B. The listed rows: the scope under the pending filter, the search and the
--    Sheet filter, with the key the list is ordered by
--
-- `p_keep_application_id` keeps one subject whatever the filters say. A queue
-- entered from a row always contains that row, including when a decision or a
-- sync moved it out of the filter between the page load and the click.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_review_application_roster_matches(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_pending_only boolean,
  p_query text,
  p_sheet_review boolean,
  p_sheet_filter text,
  p_keep_application_id uuid
)
RETURNS TABLE (
  application_id uuid,
  profile_id uuid,
  cohort_id uuid,
  first_name text,
  last_name text,
  sort_last text,
  sort_first text,
  assigned_to uuid,
  decision_status text,
  decision_pending boolean,
  source_submitted_at timestamptz,
  reported_totals jsonb,
  list_i_points numeric,
  list_i_ii_points numeric,
  grand_total_points numeric,
  roster_index integer,
  has_stage boolean,
  stage_status text,
  stage_reason text,
  stage_observed_color text,
  stage_is_done boolean,
  stage_blocks_release boolean,
  stage_block_reason text,
  stage_release_state text,
  stage_released_decision text,
  stage_observed_row_number integer,
  sort_rank integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH request AS (
    SELECT
      pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_query, ''), E' \t\n\r\f\v')
      ) AS needle,
      coalesce(p_pending_only, false) AS pending_only,
      coalesce(p_sheet_review, false) AS sheet_review,
      coalesce(nullif(pg_catalog.btrim(p_sheet_filter), ''), 'all') AS sheet_filter
  )
  SELECT
    scope.application_id,
    scope.profile_id,
    scope.cohort_id,
    scope.first_name,
    scope.last_name,
    scope.sort_last,
    scope.sort_first,
    scope.assigned_to,
    scope.decision_status,
    scope.decision_pending,
    scope.source_submitted_at,
    scope.reported_totals,
    scope.list_i_points,
    scope.list_i_ii_points,
    scope.grand_total_points,
    scope.roster_index,
    scope.has_stage,
    scope.stage_status,
    scope.stage_reason,
    scope.stage_observed_color,
    scope.stage_is_done,
    scope.stage_blocks_release,
    scope.stage_block_reason,
    scope.stage_release_state,
    scope.stage_released_decision,
    scope.stage_observed_row_number,
    CASE WHEN request.sheet_review THEN scope.sheet_rank ELSE 0 END
  FROM plugin_data.csf_review_application_roster_rows(
    p_organization_id, p_term_id, p_cohort_id
  ) AS scope
  CROSS JOIN request
  WHERE scope.application_id = p_keep_application_id
     OR (
       (NOT request.pending_only OR scope.decision_pending)
       -- strpos is a literal substring test: no pattern characters to escape.
       AND (
         request.needle = ''
         OR pg_catalog.strpos(
           pg_catalog.lower(scope.first_name || ' ' || scope.last_name),
           request.needle
         ) > 0
       )
       AND (
         NOT request.sheet_review
         OR CASE
           WHEN request.sheet_filter = 'all' THEN true
           -- An unknown filter lists nothing rather than everything.
           WHEN request.sheet_filter NOT IN (
             'done', 'not_done', 'accepted', 'rejected',
             'rejected_with_explanation', 'on_hold', 'unreviewed', 'conflict'
           ) THEN false
           -- Never read out of the workbook: not done, and not any decision.
           WHEN NOT scope.has_stage
             THEN request.sheet_filter IN ('not_done', 'unreviewed')
           WHEN scope.stage_block_reason = 'officer_approved'
             THEN request.sheet_filter IN ('accepted', 'done')
           WHEN request.sheet_filter = 'conflict'
             THEN scope.stage_status = 'conflict'
               OR (
                 scope.stage_blocks_release
                 AND scope.stage_block_reason IS DISTINCT FROM 'awaiting_review'
               )
           WHEN request.sheet_filter = 'done' THEN scope.stage_is_done
           WHEN request.sheet_filter = 'not_done' THEN NOT scope.stage_is_done
           ELSE scope.stage_status = request.sheet_filter
         END
       )
     );
$$;

-- ---------------------------------------------------------------------------
-- C. Scope counts
--
-- Counts and per-reviewer totals for the semester and class. They take no
-- search or filter argument, so the "Pending (N)" and "All (N)" controls and
-- the reviewer totals cannot move when the officer narrows the list.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_review_application_roster_scope(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH scope AS MATERIALIZED (
    SELECT rows.assigned_to, rows.decision_pending
    FROM plugin_data.csf_review_application_roster_rows(
      p_organization_id, p_term_id, p_cohort_id
    ) AS rows
  ),
  reviewer AS (
    SELECT
      scope.assigned_to AS reviewer_user_id,
      pg_catalog.count(*) AS assigned_count,
      pg_catalog.count(*) FILTER (WHERE scope.decision_pending) AS pending_count
    FROM scope
    WHERE scope.assigned_to IS NOT NULL
    GROUP BY scope.assigned_to
  )
  SELECT pg_catalog.jsonb_build_object(
    'total', (SELECT pg_catalog.count(*) FROM scope),
    'pending', (SELECT pg_catalog.count(*) FROM scope WHERE scope.decision_pending),
    'reviewers', coalesce(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'reviewerUserId', reviewer.reviewer_user_id,
            'assigned', reviewer.assigned_count,
            'pending', reviewer.pending_count
          )
          ORDER BY reviewer.reviewer_user_id
        )
        FROM reviewer
      ),
      '[]'::jsonb
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- D. One keyset page
--
-- The list key is (sort_rank, normalized last name, normalized first name,
-- application id), and a cursor is the key of a boundary row. It is made of
-- the row's own sort values, never of a position, so a row removed, renamed or
-- inserted before the boundary cannot move the boundary: the next page starts
-- strictly after the same values and neither skips nor repeats a row that has
-- not itself changed. `after` reads forward from the cursor and `before` reads
-- back toward it; both return rows in list order. An unknown direction with a
-- cursor returns nothing rather than guessing a page. The limit defaults to 50
-- and is clamped to 1..100.
--
-- `matched_count` and `match_position` describe the whole filtered list as it
-- stands now, so the caller can say "51 to 100 of 1,000" and know whether a
-- previous or next page exists without reading one. They are labels; nothing
-- pages by them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_review_application_roster_page(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_pending_only boolean,
  p_query text,
  p_sheet_review boolean,
  p_sheet_filter text,
  p_cursor_rank integer,
  p_cursor_last text,
  p_cursor_first text,
  p_cursor_id uuid,
  p_direction text,
  p_limit integer
)
RETURNS TABLE (
  application_id uuid,
  profile_id uuid,
  cohort_id uuid,
  first_name text,
  last_name text,
  sort_last text,
  sort_first text,
  assigned_to uuid,
  decision_status text,
  decision_pending boolean,
  source_submitted_at timestamptz,
  reported_totals jsonb,
  list_i_points numeric,
  list_i_ii_points numeric,
  grand_total_points numeric,
  roster_index integer,
  has_stage boolean,
  stage_status text,
  stage_reason text,
  stage_observed_color text,
  stage_is_done boolean,
  stage_blocks_release boolean,
  stage_block_reason text,
  stage_release_state text,
  stage_released_decision text,
  stage_observed_row_number integer,
  sort_rank integer,
  note_count bigint,
  matched_count bigint,
  match_position bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH matched AS MATERIALIZED (
    SELECT
      listed.*,
      pg_catalog.count(*) OVER () AS matched_total,
      pg_catalog.row_number() OVER (
        ORDER BY
          listed.sort_rank,
          listed.sort_last COLLATE plugin_data.csf_review_name_order,
          listed.sort_first COLLATE plugin_data.csf_review_name_order,
          listed.application_id
      ) AS list_position
    FROM plugin_data.csf_review_application_roster_matches(
      p_organization_id, p_term_id, p_cohort_id,
      p_pending_only, p_query, p_sheet_review, p_sheet_filter, NULL
    ) AS listed
  ),
  page AS (
    SELECT matched.*
    FROM matched
    WHERE p_cursor_id IS NULL
       OR (
         p_direction = 'after'
         AND (
           matched.sort_rank,
           matched.sort_last COLLATE plugin_data.csf_review_name_order,
           matched.sort_first COLLATE plugin_data.csf_review_name_order,
           matched.application_id
         ) > (
           coalesce(p_cursor_rank, 0),
           coalesce(p_cursor_last, ''),
           coalesce(p_cursor_first, ''),
           p_cursor_id
         )
       )
       OR (
         p_direction = 'before'
         AND (
           matched.sort_rank,
           matched.sort_last COLLATE plugin_data.csf_review_name_order,
           matched.sort_first COLLATE plugin_data.csf_review_name_order,
           matched.application_id
         ) < (
           coalesce(p_cursor_rank, 0),
           coalesce(p_cursor_last, ''),
           coalesce(p_cursor_first, ''),
           p_cursor_id
         )
       )
    ORDER BY
      CASE
        WHEN p_cursor_id IS NOT NULL AND p_direction = 'before'
          THEN -matched.list_position
        ELSE matched.list_position
      END
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  SELECT
    page.application_id,
    page.profile_id,
    page.cohort_id,
    page.first_name,
    page.last_name,
    page.sort_last,
    page.sort_first,
    page.assigned_to,
    page.decision_status,
    page.decision_pending,
    page.source_submitted_at,
    page.reported_totals,
    page.list_i_points,
    page.list_i_ii_points,
    page.grand_total_points,
    page.roster_index,
    page.has_stage,
    page.stage_status,
    page.stage_reason,
    page.stage_observed_color,
    page.stage_is_done,
    page.stage_blocks_release,
    page.stage_block_reason,
    page.stage_release_state,
    page.stage_released_decision,
    page.stage_observed_row_number,
    page.sort_rank,
    -- Only the count crosses to the list. Note bodies are read with the one
    -- application an officer opens.
    (
      SELECT pg_catalog.count(*)
      FROM plugin_data.csf_review_notes AS note
      JOIN plugin_data.csf_review_periods AS period
        ON period.id = note.period_id
       AND period.organization_id = note.organization_id
      WHERE note.organization_id = p_organization_id
        AND period.term_id = p_term_id
        AND period.kind::text = 'membership_applications'
        AND note.subject_kind::text = 'application'
        AND note.subject_id = page.application_id
        AND note.redacted_at IS NULL
    ),
    page.matched_total,
    page.list_position
  FROM page
  ORDER BY page.list_position;
$$;

-- ---------------------------------------------------------------------------
-- E. The frozen queue
--
-- Every listed subject in list order: id, roster index and surname label only.
-- It is deliberately not page-limited, because a review queue walks the whole
-- filtered list and a split shares out all of it, whichever page the officer
-- was reading.
--
-- It returns ONE jsonb document, not a row set. A row set read through the
-- Data API is cut at the API's configured maximum row count with no error, so
-- the 1,001st authorized application would silently fall out of a queue that
-- claims to be complete. A scalar is not subject to that limit.
--
-- The document is still bounded. `p_max_subjects` is clamped to 1..5000. When
-- more subjects than that are eligible the function returns their count with
-- `complete = false` and NO subjects, so the caller refuses rather than
-- freezing part of a list. `count` always equals the number of subjects a
-- complete document carries, and the caller checks that.
--
-- `p_splittable_only` narrows to what a split may assign, pending and still
-- unassigned. `listed` is how many rows the filters list before that
-- narrowing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plugin_data.csf_review_application_roster_queue(
  p_organization_id uuid,
  p_term_id uuid,
  p_cohort_id uuid,
  p_pending_only boolean,
  p_query text,
  p_sheet_review boolean,
  p_sheet_filter text,
  p_keep_application_id uuid,
  p_splittable_only boolean,
  p_max_subjects integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH listed AS MATERIALIZED (
    SELECT
      matched.application_id,
      matched.roster_index,
      matched.last_name,
      matched.sort_rank,
      matched.sort_last,
      matched.sort_first,
      matched.decision_pending,
      matched.assigned_to
    FROM plugin_data.csf_review_application_roster_matches(
      p_organization_id, p_term_id, p_cohort_id,
      p_pending_only, p_query, p_sheet_review, p_sheet_filter,
      p_keep_application_id
    ) AS matched
  ),
  eligible AS MATERIALIZED (
    SELECT listed.*
    FROM listed
    WHERE NOT coalesce(p_splittable_only, false)
       OR (listed.decision_pending AND listed.assigned_to IS NULL)
  ),
  bound AS (
    SELECT
      least(greatest(coalesce(p_max_subjects, 5000), 1), 5000) AS max_subjects,
      (SELECT pg_catalog.count(*) FROM listed) AS listed_count,
      (SELECT pg_catalog.count(*) FROM eligible) AS eligible_count
  )
  SELECT pg_catalog.jsonb_build_object(
    'listed', bound.listed_count,
    'count', bound.eligible_count,
    'limit', bound.max_subjects,
    'complete', bound.eligible_count <= bound.max_subjects,
    'subjects',
    CASE
      WHEN bound.eligible_count <= bound.max_subjects THEN coalesce(
        (
          SELECT pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', eligible.application_id,
              'index', eligible.roster_index,
              'label', eligible.last_name
            )
            ORDER BY
              eligible.sort_rank,
              eligible.sort_last COLLATE plugin_data.csf_review_name_order,
              eligible.sort_first COLLATE plugin_data.csf_review_name_order,
              eligible.application_id
          )
          FROM eligible
        ),
        '[]'::jsonb
      )
      ELSE '[]'::jsonb
    END
  )
  FROM bound;
$$;

-- ---------------------------------------------------------------------------
-- F. Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION plugin_data.csf_review_application_roster_rows(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_review_application_roster_matches(
  uuid, uuid, uuid, boolean, text, boolean, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_review_application_roster_scope(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_application_roster_scope(uuid, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_review_application_roster_page(
  uuid, uuid, uuid, boolean, text, boolean, text, integer, text, text, uuid, text, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_application_roster_page(
  uuid, uuid, uuid, boolean, text, boolean, text, integer, text, text, uuid, text, integer
) TO service_role;

REVOKE ALL ON FUNCTION plugin_data.csf_review_application_roster_queue(
  uuid, uuid, uuid, boolean, text, boolean, text, uuid, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_review_application_roster_queue(
  uuid, uuid, uuid, boolean, text, boolean, text, uuid, boolean, integer
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_review_application_roster_rows(uuid, uuid, uuid) IS
  'Internal. Every reviewable application in one organization, semester and optional class, with its sort names, roster index, pending flag, staged Sheet decision and Sheet ordering rank. Not granted to any client role.';

COMMENT ON FUNCTION plugin_data.csf_review_application_roster_matches(
  uuid, uuid, uuid, boolean, text, boolean, text, uuid
) IS
  'Internal. The roster scope under the pending filter, a literal case-insensitive name search and, for a semester reviewed in the Sheet, the Sheet decision filter. One named application is kept whatever the filters say. Not granted to any client role.';

COMMENT ON FUNCTION plugin_data.csf_review_application_roster_scope(uuid, uuid, uuid) IS
  'Total, pending and per-reviewer assignment counts for one application review scope. Takes no search or filter, so the counts never move with the list.';

COMMENT ON FUNCTION plugin_data.csf_review_application_roster_page(
  uuid, uuid, uuid, boolean, text, boolean, text, integer, text, text, uuid, text, integer
) IS
  'One keyset page of application review list rows, at most 100 and 50 by default, ordered by (sort_rank, normalized last name, normalized first name, application id) with names compared under plugin_data.csf_review_name_order. The cursor is the boundary row''s own sort values, so rows changing before the boundary cannot shift it. Returns list fields, the staged Sheet decision and a note count only; no courses, files, corrections or note bodies.';

COMMENT ON FUNCTION plugin_data.csf_review_application_roster_queue(
  uuid, uuid, uuid, boolean, text, boolean, text, uuid, boolean, integer
) IS
  'The whole filtered review list as one jsonb document of ordered application ids, roster indexes and surname labels, for a frozen review queue or a queue split. A scalar, so the Data API row limit cannot truncate it. Bounded at 5000 subjects: beyond that it returns the count with complete = false and no subjects.';

COMMIT;
