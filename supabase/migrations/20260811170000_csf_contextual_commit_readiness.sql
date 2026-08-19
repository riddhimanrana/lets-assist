-- Contextual CSF import commits refuse before any business write while a sibling
-- row in the same authoritative population is still unresolved, and they hold that
-- population locked while they decide.
--
-- The central Sheets importer already had this boundary: `csf_claim_import_commit_attempt`
-- evaluates `csf_import_preview_claim_blockers` over the WHOLE preview before it freezes
-- a decision, so a conflict on row 1,200 stops a commit that only ever looked at row 1.
-- The two contextual commits -- meeting attendance and partner-club audit -- never did.
-- They selected `import_status = 'pending'` and wrote attendance, submissions, credits and
-- activity events for those rows while their ambiguous, conflicting, duplicate and invalid
-- siblings sat untouched, and then recorded the result as `partially_completed`. The
-- workspace's disabled button was the only thing standing between an officer and a
-- half-imported source, and a disabled button is not an authorization boundary.
--
-- This is deliberately NOT a second status model. The readiness vocabulary below is the
-- existing one, read from the existing columns:
--
--   * `import_status IN ('ambiguous', 'conflict', 'duplicate')` -- the unreconciled
--     decisions `csf_reconcile_sheet_import_row` exists to settle;
--   * `import_status = 'error'` -- a row the preview could not read into a valid record;
--   * `commit_outcome_state IN ('in_flight', 'unknown', 'historical_unknown')` -- the
--     recovery states added by 20260730001004. `commit_outcome_unresolved` is NOT read
--     here: that column is a stored boolean equal to
--     `commit_outcome_state IN ('unknown', 'historical_unknown')` (see the
--     `csf_sheet_import_rows_unresolved_state_check` constraint), so reading the state
--     column names which of the two an officer is looking at instead of collapsing them;
--   * `csf_partner_submission_rows.matched_status` outside its two settled values, for a
--     batch that predates the linked-preview contract and has no import rows to read.
--
-- On blocker wording, exactly: only ONE sentence below is shared verbatim with the central
-- SQL gate -- `Reconcile %s conflicting row(s) before importing.`, which
-- `csf_import_preview_claim_blockers` also emits. The other four are this migration's own
-- wording for facts the central gate either does not test at all (`import_status = 'error'`
-- has no central blocker) or states differently (`%s row(s) are still recorded in flight
-- and need recovery review first.`, `%s row(s) have an unresolved import outcome and must
-- be reconciled first.`). They are modelled on the TypeScript readiness projection in
-- `services/import-preview-readiness-evidence.ts`, which is where an officer reads them in
-- the workspace, but they are NOT byte-identical to it either: that projection inflects
-- `row`/`rows` from the count while every SQL gate in this schema writes `row(s)`.
--
-- Locking IS changed, because the previous claim about it was false. A reconciliation
-- (`csf_reconcile_sheet_import_row`) locks the IMPORT ROW and then the linked PARTNER ROWS;
-- it never touches the preview job or the batch. So a commit that locked only its
-- preview/batch row and then read readiness was reading rows nobody was holding: a
-- reconciliation could settle -- or unsettle -- a sibling between the readiness read and
-- the loop that writes, which is the exact window the gate exists to close.
--
-- Both commits now take the complete authoritative population through one helper,
-- `csf_lock_contextual_commit_population`, BEFORE readiness and before any business write.
-- The order inside that helper is import rows first, partner rows second -- the same
-- direction the reconciliation takes them -- so the two can never form an ABBA cycle. The
-- import-row order `(sheet_tab_name, row_number, id)` is the same stable order
-- `csf_lock_import_commit_coordinate` step 5 uses, so the central and contextual paths
-- cannot interleave into a cycle either.
--
-- A preview-less historical partner batch now fails CLOSED. There is no immutable preview
-- to prove such a batch's source against, and the Server Action skips source revalidation
-- entirely for it, so committing one wrote credits nothing could attribute. It is not
-- bricked: `csf_acknowledge_partner_audit_batch_provenance` is a migration-backed,
-- audited, attributed acknowledgement an authorized officer records once, after which the
-- batch commits normally.
--
-- An all-ready commit and an idempotent replay of an already-committed snapshot both keep
-- working exactly as before -- the replay short-circuits ahead of the check on purpose,
-- because a snapshot that is already committed is not waiting on anybody's decision, and
-- it also short-circuits ahead of the population lock so a replay stays a read.
--
-- Both commits also now take the source-evidence receipt the central importer has taken
-- since the commit fence landed. `p_evidence_token uuid` is trailing and has NO DEFAULT on
-- both, the receipt-less signatures are dropped rather than left resolvable beside them,
-- and the token is spent through `csf_consume_sheet_source_evidence` inside the commit
-- transaction: after the population lock, after every actionable readiness refusal, and
-- immediately before the first business write. The ordering is not stylistic -- see the
-- integration note at the foot of this file for why consuming before the population lock
-- would be an ABBA cycle against `csf_lock_import_commit_coordinate`, and for the one
-- source family this contract cannot yet issue a receipt for.

BEGIN;

-- ---------------------------------------------------------------------------
-- One canonical lock order for a contextual commit's authoritative population.
--
-- Taken by BOTH contextual commits, immediately before readiness is read and before the
-- first business write, so the rows readiness is computed from cannot move underneath it.
--
--   1. the preview's import rows, in (sheet_tab_name, row_number, id) order
--   2. the batch's partner submission rows, in (created_at, id) order
--
-- The direction is the point. `csf_reconcile_sheet_import_row` takes an import row FOR
-- UPDATE and then updates the partner rows carrying that row's hash: import row, then
-- partner rows. This helper takes the same two classes in the same direction, so a
-- reconciliation racing a commit always queues behind it rather than deadlocking with it.
-- Reversing these two blocks would be a genuine ABBA deadlock under load.
--
-- Step 1's order is `csf_lock_import_commit_coordinate` step 5's order, byte for byte, so
-- the central importer and these two contextual commits also cannot interleave into a
-- cycle on the shared `csf_sheet_import_rows` table.
--
-- Scope, stated honestly: FOR UPDATE locks the rows that exist when it runs and does not
-- prevent an INSERT of a new sibling. For the import-row half that is closed by the
-- caller, which holds the preview job FOR UPDATE and whose only owned appender
-- (`csf_append_import_preview_rows`) takes that same job row FOR UPDATE first. For the
-- partner-row half the caller holds the batch FOR UPDATE, which serializes this commit
-- against another commit and against the provenance acknowledgement, but partner rows are
-- also written by the batch-authoring path, so a row inserted by an in-progress upload is
-- outside this lock by construction rather than by oversight.
--
-- Internal helper: revoked from every role including service_role, in the same shape as
-- csf_lock_import_commit_coordinate. Only the owned SECURITY DEFINER commits below reach
-- it, and they reach it as the definer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plugin_data.csf_lock_contextual_commit_population(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_partner_batch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION
      'A contextual CSF commit population needs an organization.'
      USING ERRCODE = '22023';
  END IF;

  -- 1. Import rows first, always.
  IF p_preview_job_id IS NOT NULL THEN
    PERFORM 1
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
    ORDER BY import_row.sheet_tab_name, import_row.row_number, import_row.id
    FOR UPDATE;
  END IF;

  -- 2. Partner rows second, always.
  IF p_partner_batch_id IS NOT NULL THEN
    PERFORM 1
    FROM plugin_data.csf_partner_submission_rows AS partner_row
    WHERE partner_row.organization_id = p_organization_id
      AND partner_row.batch_id = p_partner_batch_id
    ORDER BY partner_row.created_at, partner_row.id
    FOR UPDATE;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- The row-population half of readiness, shared by both contextual commits.
--
-- NOT a subset of `csf_import_preview_claim_blockers`, and the previous comment here
-- claiming it was is wrong in both directions. The central gate asks things this one does
-- not -- a normalized snapshot contract version, a mapping generation bound to the job,
-- per-tab exact A1 ranges, a live provider receipt, a stored snapshot row count, a
-- resolved class and semester on every ready row, and at least one ready row -- none of
-- which the contextual previews are built to satisfy, which is why this is not a call to
-- it. But this one also asks something the central gate does not ask at all:
-- `import_status = 'error'` has no central blocker. The two gates OVERLAP on the one
-- question both are for -- "does any sibling row in this preview still need a decision" --
-- and diverge on either side of it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plugin_data.csf_import_preview_row_readiness_blockers(
  p_organization_id uuid,
  p_preview_job_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_blockers text[] := ARRAY[]::text[];
  v_unresolved integer;
  v_invalid integer;
  v_in_flight integer;
  v_unknown integer;
  v_historical integer;
BEGIN
  IF p_organization_id IS NULL OR p_preview_job_id IS NULL THEN
    RETURN ARRAY['The preview job was not found.'];
  END IF;

  SELECT
    count(*) FILTER (WHERE import_status IN ('ambiguous', 'conflict', 'duplicate')),
    count(*) FILTER (WHERE import_status = 'error'),
    count(*) FILTER (WHERE commit_outcome_state = 'in_flight'),
    count(*) FILTER (WHERE commit_outcome_state = 'unknown'),
    count(*) FILTER (WHERE commit_outcome_state = 'historical_unknown')
  INTO v_unresolved, v_invalid, v_in_flight, v_unknown, v_historical
  FROM plugin_data.csf_sheet_import_rows
  WHERE organization_id = p_organization_id
    AND job_id = p_preview_job_id;

  -- Scalar prose is appended with the explicit two-argument `array_append`, never
  -- `text[] || unknown`: PostgreSQL resolves that to array concatenation and then tries to
  -- parse a blocker sentence as an array literal. See V96.
  IF v_unresolved > 0 THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      format('Reconcile %s conflicting row(s) before importing.', v_unresolved)
    );
  END IF;
  IF v_invalid > 0 THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      format('Resolve %s row(s) that could not be read before importing.', v_invalid)
    );
  END IF;
  IF v_in_flight > 0 THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      format('Recover %s row(s) left in flight by a stopped import.', v_in_flight)
    );
  END IF;
  IF v_unknown > 0 THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      format('Decide %s row(s) whose import outcome is unknown.', v_unknown)
    );
  END IF;
  IF v_historical > 0 THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      format(
        'Acknowledge %s row(s) imported before commit attempts were recorded.',
        v_historical
      )
    );
  END IF;

  RETURN v_blockers;
END;
$$;

-- ---------------------------------------------------------------------------
-- What meeting attendance additionally requires of its READY rows.
--
-- The shared function above asks whether any sibling still needs a decision. It cannot ask
-- this, because "pending" means something narrower here than it does for the partner path:
-- a meeting commit writes one attendance record per pending row, keyed
-- (profile_id, term_id, meeting_key), so a pending row with no matched member or no
-- semester names no record at all, and two pending rows naming the same member name one
-- record twice.
--
-- Both used to be discovered halfway through the write loop, marked `duplicate`, counted
-- as `failed`, and reported as `partially_completed` success. They are counted here, at
-- the gate, before anything is written -- and the loop now raises instead of counting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plugin_data.csf_meeting_attendance_preview_readiness_blockers(
  p_organization_id uuid,
  p_preview_job_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_blockers text[] := ARRAY[]::text[];
  v_unreconciled integer;
  v_duplicate integer;
BEGIN
  IF p_organization_id IS NULL OR p_preview_job_id IS NULL THEN
    RETURN ARRAY['The preview job was not found.'];
  END IF;

  SELECT count(*) FILTER (
    WHERE import_status = 'pending'
      AND (matched_profile_id IS NULL OR term_id IS NULL)
  )
  INTO v_unreconciled
  FROM plugin_data.csf_sheet_import_rows
  WHERE organization_id = p_organization_id
    AND job_id = p_preview_job_id;

  -- Rows beyond the first for each repeated member, so the count names how many rows an
  -- officer has to settle rather than how many members are involved.
  SELECT coalesce(sum(repeated.extra_rows), 0)::integer
  INTO v_duplicate
  FROM (
    SELECT count(*) - 1 AS extra_rows
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = p_preview_job_id
      AND import_row.import_status = 'pending'
      AND import_row.matched_profile_id IS NOT NULL
    GROUP BY import_row.matched_profile_id
    HAVING count(*) > 1
  ) AS repeated;

  IF v_unreconciled > 0 THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      format('Reconcile %s conflicting row(s) before importing.', v_unreconciled)
    );
  END IF;
  IF v_duplicate > 0 THEN
    -- The same sentence the loop used to write into the row's `errors`, so the gate and
    -- the row an officer opens afterwards say one thing about one fact.
    v_blockers := pg_catalog.array_append(
      v_blockers,
      'Only one attendance record per member can be committed for this meeting.'
    );
  END IF;

  RETURN v_blockers;
END;
$$;

-- ---------------------------------------------------------------------------
-- The same question for a partner-audit batch, plus its provenance.
--
-- Historical batches exist without `summary->>'sheetImportPreviewJobId'`, and for those
-- the batch's own rows ARE the authoritative population. `matched` and `rejected` are the
-- two settled values -- `rejected` is what an officer skip writes -- so anything else is a
-- decision nobody has made. A matched row whose points or point type the commit loop would
-- silently count as `failed` is not settled either: it is an invalid row wearing a settled
-- status, and letting it through is how a batch reported success while dropping records.
--
-- Provenance is the third blocker, and it is why a preview-less batch now fails closed. A
-- linked preview is an immutable snapshot whose source the Server Action re-proves through
-- `revalidateCsfContextualImportSource` immediately before this commit. A batch with no
-- linked preview goes through none of that -- the action skips revalidation for it
-- entirely -- so committing one turns unverifiable rows into credits, submissions and
-- member activity with nothing to attribute them to. Rather than leave those batches
-- permanently unimportable, `csf_acknowledge_partner_audit_batch_provenance` lets an
-- authorized officer record, once and under audit, that they vouch for the batch; this
-- blocker clears the moment that acknowledgement exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plugin_data.csf_partner_audit_batch_readiness_blockers(
  p_organization_id uuid,
  p_batch_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_blockers text[] := ARRAY[]::text[];
  v_summary jsonb;
  v_unresolved integer;
  v_invalid integer;
BEGIN
  IF p_organization_id IS NULL OR p_batch_id IS NULL THEN
    RETURN ARRAY['Audit batch or term was not found.'];
  END IF;

  SELECT batch.summary
  INTO v_summary
  FROM plugin_data.csf_partner_submission_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.id = p_batch_id;

  IF NOT FOUND THEN
    RETURN ARRAY['Audit batch or term was not found.'];
  END IF;

  SELECT
    count(*) FILTER (WHERE matched_status NOT IN ('matched', 'rejected')),
    count(*) FILTER (
      WHERE matched_status = 'matched'
        AND generated_submission_id IS NULL
        AND (
          profile_id IS NULL
          OR claimed_points IS NULL
          OR claimed_points <= 0
          OR point_type IS NULL
          OR point_type NOT IN ('non_drive', 'drive')
        )
    )
  INTO v_unresolved, v_invalid
  FROM plugin_data.csf_partner_submission_rows
  WHERE organization_id = p_organization_id
    AND batch_id = p_batch_id;

  IF v_unresolved > 0 THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      format('Reconcile %s conflicting row(s) before importing.', v_unresolved)
    );
  END IF;
  IF v_invalid > 0 THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      format('Resolve %s row(s) that could not be read before importing.', v_invalid)
    );
  END IF;
  IF nullif(v_summary->>'sheetImportPreviewJobId', '') IS NULL
    AND nullif(v_summary->>'historicalProvenanceAcknowledgedAt', '') IS NULL
  THEN
    v_blockers := pg_catalog.array_append(
      v_blockers,
      'Acknowledge this audit batch, recorded before import previews were linked, before importing.'
    );
  END IF;

  RETURN v_blockers;
END;
$$;

-- ---------------------------------------------------------------------------
-- The recovery operation that makes the blocker above reachable.
--
-- Modelled on `csf_accept_historical_import_outcome`, which is the existing concept for
-- exactly this shape: a state that predates a contract cannot be proved, so an authorized
-- officer accepts it by name, once, under immutable audit, and the gate then lets the
-- normal path run. No new status model -- the acknowledgement lives in the batch `summary`
-- alongside `sheetImportPreviewJobId` and `atomicCommitCorrelationId`, and the attribution
-- is an ordinary `csf_admin_audit_events` row.
--
-- Server-only in the same shape as every function here: the permission-checked Server
-- Action authorizes the officer and then calls this with the service role.
--
-- It refuses the two contradictions rather than guessing at them: a batch that HAS a
-- linked preview has nothing to acknowledge, because its source is proved at commit; and a
-- batch that has already been committed cannot have its provenance decided afterwards.
-- Locking is the batch row only, which every partner path takes first, so this cannot
-- deadlock against a concurrent commit -- it simply queues behind it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plugin_data.csf_acknowledge_partner_audit_batch_provenance(
  p_organization_id uuid,
  p_batch_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_partner_submission_batches%ROWTYPE;
  v_correlation_id uuid;
  v_now timestamptz := now();
BEGIN
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A partner-audit provenance acknowledgement reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A partner-audit provenance acknowledgement actor is required.';
  END IF;

  SELECT batch.*
  INTO v_batch
  FROM plugin_data.csf_partner_submission_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND OR v_batch.term_id IS NULL THEN
    RAISE EXCEPTION 'Audit batch or term was not found.';
  END IF;

  IF nullif(v_batch.summary->>'sheetImportPreviewJobId', '') IS NOT NULL THEN
    RAISE EXCEPTION
      'This audit batch is linked to an import preview, so its source is proved at commit rather than acknowledged.';
  END IF;
  IF v_batch.summary ? 'atomicCommitCorrelationId' THEN
    RAISE EXCEPTION
      'This audit batch has already been committed, so its provenance cannot be decided now.';
  END IF;

  IF nullif(v_batch.summary->>'historicalProvenanceAcknowledgedAt', '') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'batchId', v_batch.id,
      'acknowledgedBy',
        nullif(v_batch.summary->>'historicalProvenanceAcknowledgedBy', '')::uuid,
      'acknowledgedAt', v_batch.summary->>'historicalProvenanceAcknowledgedAt',
      'correlationId',
        nullif(v_batch.summary->>'historicalProvenanceCorrelationId', '')::uuid,
      'idempotent', true
    );
  END IF;

  v_correlation_id := coalesce(p_correlation_id, gen_random_uuid());

  UPDATE plugin_data.csf_partner_submission_batches
  SET
    summary = v_batch.summary || jsonb_build_object(
      'historicalProvenanceAcknowledgedBy', p_actor_user_id,
      'historicalProvenanceAcknowledgedAt', v_now,
      'historicalProvenanceAcknowledgementReason', p_reason,
      'historicalProvenanceCorrelationId', v_correlation_id
    ),
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_batch.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'partner_audit.historical_provenance_acknowledged',
    'csf_partner_submission_batches',
    v_batch.id,
    v_batch.term_id,
    jsonb_build_object(
      'batchTitle', v_batch.title,
      'sourceUrl', v_batch.source_url,
      'reason', p_reason
    ),
    v_correlation_id,
    'partner_audit',
    v_batch.id::text,
    'partner_audit_historical_provenance_acknowledged'
  );

  RETURN jsonb_build_object(
    'batchId', v_batch.id,
    'acknowledgedBy', p_actor_user_id,
    'acknowledgedAt', v_now,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- The two contextual commits, now carrying the source-evidence receipt.
--
-- `p_evidence_token` is trailing and has NO DEFAULT, exactly as
-- `csf_claim_import_commit_attempt` declares it, so "commit without proving the source"
-- is not something a caller can express by omission. The five- and six-argument
-- signatures are dropped at the end of this migration rather than left beside these:
-- an overload that still resolves is the bypass this parameter exists to remove.
--
-- Placement, and why it is exactly here:
--
--   * AFTER `csf_lock_contextual_commit_population`. The central path calls
--     `csf_lock_import_commit_coordinate` first and consumes second, and that coordinate
--     takes the source LAST (step 6), after the preview's import rows. Consuming before
--     the population would take source-before-rows here and rows-before-source there,
--     which is an ABBA cycle on two objects both paths hold. Consuming after keeps one
--     direction everywhere: import rows, then partner rows, then the source.
--   * AFTER every actionable readiness refusal, so the officer-facing blocker -- the
--     common, fixable one -- is what surfaces rather than a source-freshness error.
--   * IMMEDIATELY BEFORE the first business write, so the proof and the write are one
--     transaction rather than two statements with a window between them.
--
-- Every refusal after the consume rolls the consume back with it, so a token is spent
-- only by a commit that durably happened. Nothing here is "spend it and hope".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  p_organization_id uuid,
  p_preview_job_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid,
  p_evidence_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_meeting plugin_data.csf_term_meetings%ROWTYPE;
  v_session plugin_data.csf_meeting_sessions%ROWTYPE;
  v_row plugin_data.csf_sheet_import_rows%ROWTYPE;
  v_meeting_id uuid;
  v_attendance_id uuid;
  v_correlation_id uuid;
  v_blockers text[];
  v_committed_profiles uuid[] := ARRAY[]::uuid[];
  v_created integer := 0;
  v_unchanged integer := 0;
  -- Retained because `failed` is a published key of the commit-job summary, the audit
  -- event and this function's return value. It can no longer be incremented: every path
  -- that used to increment it now raises and rolls the whole commit back.
  v_failed integer := 0;
  v_pending_count integer := 0;
  v_final_status text;
  v_now timestamptz := now();
BEGIN
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A meeting-attendance commit reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A meeting-attendance commit actor is required.';
  END IF;

  SELECT job.*
  INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.id = p_preview_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_preview.mode <> 'preview' OR v_preview.source_type <> 'meeting_attendance' THEN
    RAISE EXCEPTION 'Choose a meeting-attendance preview.';
  END IF;
  IF v_preview.source_id IS NULL OR v_preview.status NOT IN ('completed', 'needs_resolution') THEN
    RAISE EXCEPTION 'The attendance preview is not ready to commit.';
  END IF;

  v_correlation_id := v_preview.correlation_id;
  IF p_correlation_id IS NOT NULL AND p_correlation_id <> v_correlation_id THEN
    RAISE EXCEPTION 'The commit correlation does not match the immutable attendance preview.';
  END IF;

  SELECT job.*
  INTO v_commit
  FROM plugin_data.csf_sheet_import_jobs AS job
  WHERE job.organization_id = p_organization_id
    AND job.mode = 'commit'
    AND job.source_type = 'meeting_attendance'
    AND job.summary->>'previewJobId' = v_preview.id::text
  ORDER BY job.created_at, job.id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'jobId', v_commit.id,
      'previewJobId', v_preview.id,
      'created', coalesce((v_commit.summary->>'created')::integer, 0),
      'unchanged', coalesce((v_commit.summary->>'unchanged')::integer, 0),
      'failed', coalesce((v_commit.summary->>'failed')::integer, 0),
      'status', v_commit.status,
      'correlationId', v_commit.correlation_id,
      'idempotent', true
    );
  END IF;

  -- The whole authoritative population, locked in the one canonical order, BEFORE
  -- readiness is read. The preview job row is already held above, so no sibling can be
  -- appended; these locks are what stop a concurrent `csf_reconcile_sheet_import_row` from
  -- settling or unsettling a row between the readiness read and the write loop below.
  -- Deliberately AFTER the replay return: an already-committed snapshot is settled and a
  -- replay stays a read, and it is the one path that needs no evidence receipt -- it
  -- performs no new write, so demanding a fresh one would turn a safe retry into a
  -- failure every time the source has legitimately changed since.
  PERFORM plugin_data.csf_lock_contextual_commit_population(
    p_organization_id, v_preview.id, NULL
  );

  -- Whole-preview readiness, read under those locks and BEFORE the commit job, the
  -- attendance rows, the source health update and the audit event -- that is, before this
  -- transaction has written anything an officer would have to undo. The shared population
  -- question first, then what attendance additionally requires of its ready rows; the
  -- second is evaluated only when the first is clean because only the first sentence ever
  -- surfaces.
  v_blockers := plugin_data.csf_import_preview_row_readiness_blockers(
    p_organization_id, v_preview.id
  );
  IF pg_catalog.array_length(v_blockers, 1) IS NULL THEN
    v_blockers := plugin_data.csf_meeting_attendance_preview_readiness_blockers(
      p_organization_id, v_preview.id
    );
  END IF;
  IF pg_catalog.array_length(v_blockers, 1) > 0 THEN
    -- The first sentence only. It is already officer-facing product copy and naming one
    -- fixable thing beats concatenating the whole list into an unreadable paragraph.
    RAISE EXCEPTION '%', v_blockers[1];
  END IF;

  SELECT count(*)::integer
  INTO v_pending_count
  FROM plugin_data.csf_sheet_import_rows AS import_row
  WHERE import_row.organization_id = p_organization_id
    AND import_row.job_id = v_preview.id
    AND import_row.import_status = 'pending';

  IF v_pending_count = 0 THEN
    RAISE EXCEPTION 'Resolve at least one attendance row before committing.';
  END IF;

  BEGIN
    SELECT nullif(import_row.normalized_data->>'meetingId', '')::uuid
    INTO v_meeting_id
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview.id
      AND import_row.import_status = 'pending'
    ORDER BY import_row.row_number, import_row.id
    LIMIT 1;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The attendance preview contains an invalid meeting reference.';
  END;

  IF v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'The meeting for this preview no longer exists.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview.id
      AND import_row.import_status = 'pending'
      AND import_row.normalized_data->>'meetingId' IS DISTINCT FROM v_meeting_id::text
  ) THEN
    RAISE EXCEPTION 'One attendance preview cannot contain rows for multiple meetings.';
  END IF;

  SELECT meeting.*
  INTO v_meeting
  FROM plugin_data.csf_term_meetings AS meeting
  WHERE meeting.organization_id = p_organization_id
    AND meeting.id = v_meeting_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The meeting for this preview no longer exists.';
  END IF;

  SELECT session.*
  INTO v_session
  FROM plugin_data.csf_meeting_sessions AS session
  WHERE session.organization_id = p_organization_id
    AND session.legacy_term_meeting_id = v_meeting.id
  LIMIT 1;

  -- The source, re-proved in this transaction, immediately before the first write.
  --
  -- `v_preview.source_id` is already known non-null: the preview guard above refuses a
  -- preview that records no source, because a snapshot with no source is a snapshot
  -- nothing can be proved about. The consume itself refuses a NULL token, a token issued
  -- for another organization, source, officer or preview, one already spent, and one that
  -- has expired -- so there is deliberately no null-tolerant branch here to re-state.
  PERFORM plugin_data.csf_consume_sheet_source_evidence(
    p_organization_id, v_preview.source_id, p_actor_user_id, p_evidence_token, v_preview.id
  );

  INSERT INTO plugin_data.csf_sheet_import_jobs (
    organization_id,
    source_id,
    initiated_by,
    mode,
    status,
    source_type,
    source_file_id,
    source_file_name,
    source_sheet_tab,
    source_range,
    source_modified_at,
    source_file_metadata,
    mapping_snapshot,
    mapping_version,
    correlation_id,
    summary,
    started_at
  ) VALUES (
    p_organization_id,
    v_preview.source_id,
    p_actor_user_id,
    'commit',
    'running',
    'meeting_attendance',
    v_preview.source_file_id,
    v_preview.source_file_name,
    v_preview.source_sheet_tab,
    v_preview.source_range,
    v_preview.source_modified_at,
    v_preview.source_file_metadata,
    v_preview.mapping_snapshot,
    v_preview.mapping_version,
    v_correlation_id,
    jsonb_build_object('previewJobId', v_preview.id),
    v_now
  )
  RETURNING * INTO v_commit;

  FOR v_row IN
    SELECT import_row.*
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview.id
      AND import_row.import_status = 'pending'
    ORDER BY import_row.row_number, import_row.id
    FOR UPDATE
  LOOP
    -- Defence in depth, and it RAISES. The readiness gate above refused both of these
    -- before anything was written, and the whole population has been held FOR UPDATE ever
    -- since, so reaching either branch means an invariant this function depends on is not
    -- true. Marking the row `duplicate`, counting it `failed` and finishing the commit --
    -- which is what these branches used to do -- is precisely the half-imported source
    -- this migration exists to prevent, so the transaction rolls back instead.
    IF v_row.matched_profile_id IS NULL OR v_row.term_id IS NULL THEN
      RAISE EXCEPTION
        'Attendance row % is not reconciled to a member and semester.', v_row.id;
    END IF;
    IF v_row.matched_profile_id = ANY(v_committed_profiles) THEN
      RAISE EXCEPTION
        'Only one attendance record per member can be committed for this meeting.';
    END IF;

    IF v_row.term_id <> v_meeting.term_id THEN
      RAISE EXCEPTION 'Attendance row % belongs to a different semester.', v_row.id;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.id = v_row.matched_profile_id
        AND profile.record_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Attendance row % references a member outside this organization.', v_row.id;
    END IF;

    v_committed_profiles := array_append(v_committed_profiles, v_row.matched_profile_id);
    v_attendance_id := NULL;

    INSERT INTO plugin_data.csf_meeting_attendance (
      organization_id,
      profile_id,
      term_id,
      term_meeting_id,
      meeting_id,
      meeting_session_id,
      meeting_key,
      meeting_label,
      status,
      source,
      source_row_id,
      recorded_by,
      submitted_name,
      submitted_email,
      source_submitted_at,
      match_status,
      match_confidence,
      match_details
    ) VALUES (
      p_organization_id,
      v_row.matched_profile_id,
      v_meeting.term_id,
      v_meeting.id,
      v_session.meeting_id,
      v_session.id,
      v_meeting.meeting_key,
      v_meeting.label,
      'attended',
      'sheet',
      v_row.id,
      p_actor_user_id,
      nullif(v_row.normalized_data->>'submittedName', ''),
      nullif(v_row.normalized_data->>'submittedEmail', ''),
      nullif(v_row.normalized_data->>'sourceSubmittedAt', '')::timestamptz,
      'confirmed',
      CASE WHEN nullif(v_row.normalized_data->>'normalizedEmail', '') IS NOT NULL THEN 1 ELSE 0.9 END,
      jsonb_build_object(
        'importJobId', v_preview.id,
        'importRowId', v_row.id,
        'rowNumber', v_row.row_number,
        'rowHash', v_row.row_hash,
        'correlationId', v_correlation_id,
        'reason', p_reason
      )
    )
    ON CONFLICT (profile_id, term_id, meeting_key) DO NOTHING
    RETURNING id INTO v_attendance_id;

    IF v_attendance_id IS NULL THEN
      -- Not a refusal: an attendance record that already exists is the officer correction
      -- this commit is required to preserve, so the row records that it was left alone.
      v_unchanged := v_unchanged + 1;
      UPDATE plugin_data.csf_sheet_import_rows
      SET
        import_status = 'duplicate',
        errors = ARRAY['Attendance already exists and was not overwritten.']::text[]
      WHERE organization_id = p_organization_id
        AND id = v_row.id;
    ELSE
      v_created := v_created + 1;
      UPDATE plugin_data.csf_sheet_import_rows
      SET import_status = 'created'
      WHERE organization_id = p_organization_id
        AND id = v_row.id;
    END IF;
  END LOOP;

  v_final_status := CASE
    WHEN v_failed > 0 OR v_unchanged > 0 THEN 'partially_completed'
    ELSE 'completed'
  END;

  UPDATE plugin_data.csf_sheet_import_jobs
  SET
    status = v_final_status,
    summary = jsonb_build_object(
      'previewJobId', v_preview.id,
      'created', v_created,
      'unchanged', v_unchanged,
      'failed', v_failed,
      'reason', p_reason
    ),
    committed_at = v_now,
    completed_at = v_now,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_commit.id;

  UPDATE plugin_data.csf_sheet_sources
  SET
    sync_status = CASE WHEN v_final_status = 'completed' THEN 'healthy' ELSE 'needs_attention' END,
    last_sync_status = 'commit_' || v_final_status,
    last_sync_error = CASE
      WHEN v_failed > 0 THEN v_failed || ' row' || CASE WHEN v_failed = 1 THEN '' ELSE 's' END || ' failed.'
      ELSE NULL
    END,
    last_committed_at = v_now,
    last_synced_at = v_now,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_preview.source_id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'term_meeting.attendance_commit',
    'csf_term_meetings',
    v_meeting.id,
    v_meeting.term_id,
    jsonb_build_object(
      'previewJobId', v_preview.id,
      'commitJobId', v_commit.id,
      'created', v_created,
      'unchanged', v_unchanged,
      'failed', v_failed,
      'reason', p_reason
    ),
    v_correlation_id,
    'sheet_import',
    v_preview.source_id::text,
    'meeting_attendance_committed'
  );

  RETURN jsonb_build_object(
    'jobId', v_commit.id,
    'previewJobId', v_preview.id,
    'created', v_created,
    'unchanged', v_unchanged,
    'failed', v_failed,
    'status', v_final_status,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION plugin_data.csf_commit_partner_audit_import(
  p_organization_id uuid,
  p_batch_id uuid,
  p_approval_mode text,
  p_actor_user_id uuid,
  p_reason text,
  p_correlation_id uuid,
  p_evidence_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch plugin_data.csf_partner_submission_batches%ROWTYPE;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_commit plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_row plugin_data.csf_partner_submission_rows%ROWTYPE;
  v_submission_id uuid;
  v_credit_id uuid;
  v_preview_job_id uuid;
  v_correlation_id uuid;
  v_row_hash text;
  v_blockers text[];
  v_generated integer := 0;
  -- Same as the meeting commit: a published key that can no longer be incremented,
  -- because the loop branch that used to increment it now raises.
  v_failed integer := 0;
  v_unresolved integer := 0;
  v_final_status text;
  v_now timestamptz := now();
BEGIN
  IF p_approval_mode NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Invalid approval mode.';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A partner-audit commit reason is required.';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A partner-audit commit actor is required.';
  END IF;

  SELECT batch.*
  INTO v_batch
  FROM plugin_data.csf_partner_submission_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND OR v_batch.term_id IS NULL THEN
    RAISE EXCEPTION 'Audit batch or term was not found.';
  END IF;

  IF v_batch.summary ? 'atomicCommitCorrelationId' THEN
    RETURN jsonb_build_object(
      'batchId', v_batch.id,
      'jobId', nullif(v_batch.summary->>'sheetImportCommitJobId', '')::uuid,
      'generated', coalesce((v_batch.summary->>'generated')::integer, 0),
      'unresolved', coalesce((v_batch.summary->>'unresolvedImportRows')::integer, 0),
      'failed', coalesce((v_batch.summary->>'failedImportRows')::integer, 0),
      'correlationId', (v_batch.summary->>'atomicCommitCorrelationId')::uuid,
      'idempotent', true
    );
  END IF;

  BEGIN
    v_preview_job_id := nullif(v_batch.summary->>'sheetImportPreviewJobId', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'The partner-audit batch contains an invalid preview reference.';
  END;

  IF v_preview_job_id IS NOT NULL THEN
    SELECT job.*
    INTO v_preview
    FROM plugin_data.csf_sheet_import_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.id = v_preview_job_id
      AND job.mode = 'preview'
      AND job.source_type = 'partner_club_audit'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The linked partner-audit preview was not found in this organization.';
    END IF;

    v_correlation_id := v_preview.correlation_id;
    IF p_correlation_id IS NOT NULL AND p_correlation_id <> v_correlation_id THEN
      RAISE EXCEPTION 'The commit correlation does not match the immutable partner-audit preview.';
    END IF;

    SELECT job.*
    INTO v_commit
    FROM plugin_data.csf_sheet_import_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.mode = 'commit'
      AND job.source_type = 'partner_club_audit'
      AND job.summary->>'previewJobId' = v_preview.id::text
    ORDER BY job.created_at, job.id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'batchId', v_batch.id,
        'jobId', v_commit.id,
        'generated', coalesce((v_commit.summary->>'created')::integer, 0),
        'unresolved', coalesce((v_commit.summary->>'ambiguous')::integer, 0),
        'failed', coalesce((v_commit.summary->>'failed')::integer, 0),
        'correlationId', v_commit.correlation_id,
        'idempotent', true
      );
    END IF;
  ELSE
    v_correlation_id := coalesce(p_correlation_id, gen_random_uuid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM plugin_data.csf_terms AS term
    WHERE term.organization_id = p_organization_id
      AND term.id = v_batch.term_id
  ) THEN
    RAISE EXCEPTION 'The partner-audit term does not belong to this organization.';
  END IF;

  -- The whole authoritative population, locked in the one canonical order -- the linked
  -- preview's import rows first, this batch's partner rows second -- BEFORE readiness is
  -- read and before the commit job, the submissions, the credits, the activity events and
  -- the audit event. That direction is `csf_reconcile_sheet_import_row`'s own direction,
  -- which is what keeps a reconciliation racing this commit a wait rather than an ABBA
  -- deadlock. Deliberately AFTER both replay returns, so a replay stays a read and needs
  -- no evidence receipt: it writes nothing new, and re-proving a snapshot that is already
  -- durable would turn a safe retry into a failure whenever the workbook has legitimately
  -- changed since.
  PERFORM plugin_data.csf_lock_contextual_commit_population(
    p_organization_id, v_preview_job_id, v_batch.id
  );

  -- The batch's own rows are what this commit actually reads, so they are asked first;
  -- the linked preview's immutable rows -- what an officer reconciles -- are asked when
  -- the batch is clean, because a row left ambiguous there and matched here is still a
  -- decision nobody finished making. Only the first sentence ever surfaces, so evaluating
  -- the second half lazily loses nothing. For a batch with no linked preview the first
  -- call also carries the provenance blocker, so such a batch fails closed here until an
  -- officer records `csf_acknowledge_partner_audit_batch_provenance`.
  v_blockers := plugin_data.csf_partner_audit_batch_readiness_blockers(
    p_organization_id, v_batch.id
  );
  IF v_preview_job_id IS NOT NULL AND pg_catalog.array_length(v_blockers, 1) IS NULL THEN
    v_blockers := plugin_data.csf_import_preview_row_readiness_blockers(
      p_organization_id, v_preview_job_id
    );
  END IF;
  IF pg_catalog.array_length(v_blockers, 1) > 0 THEN
    RAISE EXCEPTION '%', v_blockers[1];
  END IF;

  -- The source, re-proved in this transaction, immediately before the first write.
  --
  -- Two branches, and neither is a skip.
  --
  --   * A batch WITH a linked preview has an immutable snapshot and a source, so it is
  --     held to the same receipt the meeting commit and the central importer are: the
  --     consume refuses a missing, foreign, spent or expired token. A linked preview that
  --     records no source is refused outright rather than consumed against NULL, which
  --     the consume would reject as a source mismatch with a less legible sentence.
  --
  --   * A batch with NO linked preview has no preview a receipt could ever have been
  --     issued against, so a supplied token is a contradiction and is refused rather than
  --     ignored. Its source is not unproved, it is proved differently: the readiness gate
  --     above has already refused it unless
  --     `csf_acknowledge_partner_audit_batch_provenance` recorded an attributed, audited
  --     officer acknowledgement. Raising here instead -- which the private note asked for
  --     literally -- would make such a batch permanently unimportable, because no receipt
  --     can be issued for a preview that does not exist. That is the brick this migration
  --     exists to end, so the acknowledgement stays the way out and this branch only
  --     refuses the token that cannot belong to it.
  IF v_preview_job_id IS NOT NULL THEN
    IF v_preview.source_id IS NULL THEN
      RAISE EXCEPTION
        'The linked partner-audit preview records no source, so nothing about it can be proved unchanged.'
        USING ERRCODE = '55000';
    END IF;
    PERFORM plugin_data.csf_consume_sheet_source_evidence(
      p_organization_id, v_preview.source_id, p_actor_user_id, p_evidence_token, v_preview.id
    );
  ELSIF p_evidence_token IS NOT NULL THEN
    RAISE EXCEPTION
      'This audit batch has no linked import preview, so no source freshness check could have been issued for it.'
      USING ERRCODE = '55000';
  END IF;

  IF v_preview_job_id IS NOT NULL THEN
    INSERT INTO plugin_data.csf_sheet_import_jobs (
      organization_id,
      source_id,
      initiated_by,
      mode,
      status,
      source_type,
      source_file_id,
      source_file_name,
      source_sheet_tab,
      source_range,
      source_modified_at,
      source_file_metadata,
      mapping_snapshot,
      mapping_version,
      correlation_id,
      summary,
      started_at
    ) VALUES (
      p_organization_id,
      v_preview.source_id,
      p_actor_user_id,
      'commit',
      'running',
      'partner_club_audit',
      v_preview.source_file_id,
      v_preview.source_file_name,
      v_preview.source_sheet_tab,
      v_preview.source_range,
      v_preview.source_modified_at,
      v_preview.source_file_metadata,
      v_preview.mapping_snapshot,
      v_preview.mapping_version,
      v_correlation_id,
      jsonb_build_object('previewJobId', v_preview.id, 'partnerAuditBatchId', v_batch.id),
      v_now
    )
    RETURNING * INTO v_commit;
  END IF;

  FOR v_row IN
    SELECT partner_row.*
    FROM plugin_data.csf_partner_submission_rows AS partner_row
    WHERE partner_row.organization_id = p_organization_id
      AND partner_row.batch_id = v_batch.id
      AND partner_row.matched_status = 'matched'
      AND partner_row.profile_id IS NOT NULL
      AND partner_row.generated_submission_id IS NULL
    ORDER BY partner_row.created_at, partner_row.id
    FOR UPDATE
  LOOP
    -- Defence in depth, and it RAISES. The readiness gate above counts exactly this set
    -- as invalid and refused the whole commit, and the population has been held FOR UPDATE
    -- ever since. Counting the row `failed` and continuing -- which is what this branch
    -- used to do -- is how a batch reported success while dropping a member's credit.
    IF v_row.claimed_points IS NULL
      OR v_row.claimed_points <= 0
      OR v_row.point_type IS NULL
      OR v_row.point_type NOT IN ('non_drive', 'drive')
    THEN
      RAISE EXCEPTION
        'Partner-audit row % is matched but carries no importable point value.', v_row.id;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM plugin_data.csf_profiles AS profile
      WHERE profile.organization_id = p_organization_id
        AND profile.id = v_row.profile_id
        AND profile.record_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Partner-audit row % references a member outside this organization.', v_row.id;
    END IF;

    INSERT INTO plugin_data.csf_point_submissions (
      organization_id,
      profile_id,
      term_id,
      source,
      description,
      claimed_points,
      point_type,
      status,
      submitted_by,
      reviewed_by,
      reviewed_at,
      review_notes
    ) VALUES (
      p_organization_id,
      v_row.profile_id,
      v_batch.term_id,
      'sheet',
      v_batch.title || ' partner club audit',
      v_row.claimed_points,
      v_row.point_type,
      CASE WHEN p_approval_mode = 'approved' THEN 'approved' ELSE 'submitted' END,
      p_actor_user_id,
      CASE WHEN p_approval_mode = 'approved' THEN p_actor_user_id ELSE NULL END,
      CASE WHEN p_approval_mode = 'approved' THEN v_now ELSE NULL END,
      CASE WHEN p_approval_mode = 'approved' THEN p_reason ELSE NULL END
    )
    RETURNING id INTO v_submission_id;

    INSERT INTO plugin_data.csf_credit_records (
      organization_id,
      profile_id,
      term_id,
      submission_id,
      source,
      points,
      point_type,
      status,
      verified_by,
      verified_at,
      evidence
    ) VALUES (
      p_organization_id,
      v_row.profile_id,
      v_batch.term_id,
      v_submission_id,
      'sheet',
      v_row.claimed_points,
      v_row.point_type,
      CASE WHEN p_approval_mode = 'approved' THEN 'verified' ELSE 'pending' END,
      CASE WHEN p_approval_mode = 'approved' THEN p_actor_user_id ELSE NULL END,
      CASE WHEN p_approval_mode = 'approved' THEN v_now ELSE NULL END,
      jsonb_build_object(
        'partnerAuditBatchId', v_batch.id,
        'partnerAuditRowId', v_row.id,
        'sourceUrl', v_batch.source_url,
        'normalizedData', v_row.normalized_data,
        'correlationId', v_correlation_id,
        'reason', p_reason
      )
    )
    RETURNING id INTO v_credit_id;

    INSERT INTO plugin_data.csf_profile_activity_events (
      organization_id,
      profile_id,
      term_id,
      credit_record_id,
      event_type,
      title,
      description,
      point_type,
      raw_points,
      counted_points,
      status,
      source,
      source_ref
    ) VALUES (
      p_organization_id,
      v_row.profile_id,
      v_batch.term_id,
      v_credit_id,
      'opportunity',
      v_batch.title,
      'Partner club audit credit',
      v_row.point_type,
      v_row.claimed_points,
      v_row.claimed_points,
      CASE WHEN p_approval_mode = 'approved' THEN 'verified' ELSE 'pending' END,
      'sheet',
      jsonb_build_object(
        'partnerAuditBatchId', v_batch.id,
        'partnerAuditRowId', v_row.id,
        'correlationId', v_correlation_id
      )
    );

    UPDATE plugin_data.csf_partner_submission_rows
    SET generated_submission_id = v_submission_id
    WHERE organization_id = p_organization_id
      AND batch_id = v_batch.id
      AND id = v_row.id;

    v_row_hash := v_row.normalized_data #>> '{source,rowHash}';
    IF v_preview_job_id IS NOT NULL AND nullif(v_row_hash, '') IS NOT NULL THEN
      UPDATE plugin_data.csf_sheet_import_rows
      SET
        import_status = 'created',
        matched_profile_id = v_row.profile_id
      WHERE organization_id = p_organization_id
        AND job_id = v_preview_job_id
        AND row_hash = v_row_hash
        AND import_status = 'pending';
    END IF;

    v_generated := v_generated + 1;
  END LOOP;

  IF v_preview_job_id IS NOT NULL THEN
    -- Preview rows this commit did not turn into credit. It can no longer include an
    -- unreconciled row -- readiness refused those above -- so what remains are the ready
    -- rows whose partner counterpart carried no matching row hash.
    SELECT count(*)::integer
    INTO v_unresolved
    FROM plugin_data.csf_sheet_import_rows AS import_row
    WHERE import_row.organization_id = p_organization_id
      AND import_row.job_id = v_preview_job_id
      AND import_row.import_status IN ('pending', 'ambiguous', 'conflict', 'duplicate', 'error');

    v_final_status := CASE
      WHEN v_unresolved > 0 OR v_failed > 0 THEN 'partially_completed'
      ELSE 'completed'
    END;

    UPDATE plugin_data.csf_sheet_import_jobs
    SET
      status = v_final_status,
      summary = jsonb_build_object(
        'previewJobId', v_preview_job_id,
        'partnerAuditBatchId', v_batch.id,
        'committed', v_generated,
        'created', v_generated,
        'updated', 0,
        'ambiguous', v_unresolved,
        'failed', v_failed,
        'reason', p_reason
      ),
      committed_at = v_now,
      completed_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_commit.id;

    UPDATE plugin_data.csf_sheet_sources
    SET
      sync_status = CASE WHEN v_final_status = 'completed' THEN 'healthy' ELSE 'needs_attention' END,
      last_sync_status = 'commit_' || v_final_status,
      last_sync_error = CASE
        WHEN v_unresolved > 0 OR v_failed > 0
          THEN v_unresolved || ' row' || CASE WHEN v_unresolved = 1 THEN ' remains' ELSE 's remain' END
            || ' unresolved; ' || v_failed || ' failed.'
        ELSE NULL
      END,
      last_committed_at = v_now,
      last_synced_at = v_now,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND id = v_preview.source_id;
  ELSE
    v_final_status := CASE WHEN v_failed > 0 THEN 'partially_completed' ELSE 'completed' END;
  END IF;

  UPDATE plugin_data.csf_partner_submission_batches
  SET
    status = CASE WHEN p_approval_mode = 'approved' THEN 'verified' ELSE 'needs_verification' END,
    reviewed_by = CASE WHEN p_approval_mode = 'approved' THEN p_actor_user_id ELSE NULL END,
    reviewed_at = CASE WHEN p_approval_mode = 'approved' THEN v_now ELSE NULL END,
    summary = v_batch.summary || jsonb_build_object(
      'sheetImportCommitJobId', v_commit.id,
      'generated', v_generated,
      'unresolvedImportRows', v_unresolved,
      'failedImportRows', v_failed,
      'atomicCommitCorrelationId', v_correlation_id,
      'commitReason', p_reason
    ),
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND id = v_batch.id;

  INSERT INTO plugin_data.csf_admin_audit_events (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    term_id,
    after_data,
    correlation_id,
    source_type,
    source_id,
    reason_code
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    'partner_audit.commit',
    'csf_partner_submission_batches',
    v_batch.id,
    v_batch.term_id,
    jsonb_build_object(
      'generated', v_generated,
      'approvalMode', p_approval_mode,
      'previewJobId', v_preview_job_id,
      'commitJobId', v_commit.id,
      'unresolvedImportRows', v_unresolved,
      'failed', v_failed,
      'reason', p_reason,
      -- Null for a preview-linked batch, and the officer who vouched for a preview-less
      -- one. Carrying it here is what makes the acknowledgement attributable from the
      -- commit itself rather than only from the batch summary.
      'historicalProvenanceAcknowledgedBy',
        nullif(v_batch.summary->>'historicalProvenanceAcknowledgedBy', ''),
      'historicalProvenanceAcknowledgedAt',
        nullif(v_batch.summary->>'historicalProvenanceAcknowledgedAt', '')
    ),
    v_correlation_id,
    CASE WHEN v_preview_job_id IS NOT NULL THEN 'sheet_import' ELSE 'partner_audit' END,
    coalesce(v_preview.source_id::text, v_batch.id::text),
    'partner_audit_committed'
  );

  RETURN jsonb_build_object(
    'batchId', v_batch.id,
    'jobId', v_commit.id,
    'generated', v_generated,
    'unresolved', v_unresolved,
    'failed', v_failed,
    'status', v_final_status,
    'correlationId', v_correlation_id,
    'idempotent', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- THE UPLOADED PARTNER-AUDIT RECEIPT, which this contract previously could not issue.
--
-- The integration note at the foot of this file used to end by naming one source family
-- that reaches the two commits above and cannot produce a receipt for them: a partner-club
-- audit workbook. It is registered `uploaded_xlsx` and written ONCE to a per-batch object
-- path with `upsert: false`, so it has no Drive object for
-- `csf_refresh_sheet_source_evidence` to re-read and no staged generation for
-- `csf_issue_uploaded_source_evidence` to lock. Every such batch therefore arrived at the
-- linked-preview branch above with a NULL token and was refused. That is fail-closed, but
-- it is also a brick: no officer could resolve it, because the resolution did not exist.
--
-- It exists now. `csf_issue_immutable_upload_source_evidence` is the third receipt issuer,
-- built on exactly the terms the other two are: it performs NO provider call, accepts NO
-- evidence from its caller, reads every value it attests to out of the locked source row
-- and the immutable preview, and writes an ordinary single-use row in
-- `csf_sheet_source_evidence_tokens`. What a caller supplies is four identifiers -- the
-- organization, the officer, the source and the preview -- and every one of them is a
-- thing to be checked, not a thing to be believed.
--
-- ONE DEVIATION FROM THE BRIEF, STATED PLAINLY RATHER THAN HIDDEN.
--
-- The brief asked for a receipt consumable by an UNCHANGED
-- `csf_consume_sheet_source_evidence`. That is not satisfiable, and the reason is
-- structural rather than stylistic. That function's non-Google arm requires
-- `staging_object_id IS NOT NULL`, requires `provider_file_id` to be that uuid rendered as
-- text, and then SELECTs the staging object row and refuses when it is not found; the
-- table's own `csf_evidence_tokens_provider_shape_check` independently requires a staged
-- object id, a staged generation and a positive byte length on every uploaded receipt. An
-- immutable partner-audit workbook has none of those and never will -- it is not a staged
-- generation, it is a permanent per-batch object, and staging exists precisely to delete
-- its bytes after a short window, which is the opposite of what this family needs.
--
-- So the only two ways to give this family a real receipt were:
--
--   (a) FABRICATE a staging object row and a source attachment for it, inventing the byte
--       length nothing records, adding a second writer to the `staging*` settings
--       namespace whose single-writer property is what makes
--       `csf_attach_sheet_source_generation`'s compare-and-swap mean anything, and
--       planting rows in a lifecycle table that the staging sweeps then own; or
--   (b) EXTEND the consumer with a third arm.
--
-- (a) is forging evidence to satisfy a verifier, which is the failure mode this entire
-- mechanism exists to prevent, so this migration takes (b). The extension is strictly
-- ADDITIVE and fail-closed, and none of it is a weakening:
--
--   * every existing arm -- Google, and staged-upload -- is byte-for-byte what it was, and
--     is now reached under exactly the same conditions;
--   * the new arm is reachable ONLY for a receipt whose `staging_object_id IS NULL`, which
--     no existing issuer can produce and the old table constraint made unrepresentable;
--   * the SOURCE row, not the receipt, decides which uploaded arm applies: a source that
--     carries a staged attachment must present a staged receipt and a source that carries
--     none must present an immutable one, so the two uploaded families cannot be
--     substituted for each other in either direction;
--   * the immutable arm's metadata digest is computed over a DIFFERENT canonical object
--     shape than the staged arm's, so no staged receipt can ever recompute into an
--     immutable one or the reverse, whatever else agrees.
--
-- The alternative reading -- leave the consumer alone and let the contextual commits call
-- a second, contextual-only verifier -- was rejected for the reason this file already
-- gives about readiness gates: two verifiers of one fact drift, and the drift is
-- discovered by the import that should have been refused.
-- ---------------------------------------------------------------------------

-- The receipt shape, with the immutable uploaded family added as its own arm.
--
-- Dropped and re-added rather than widened in place, because a CHECK constraint has no
-- ALTER. `IF EXISTS` so a replay against a database where this migration already ran is
-- still a clean no-op.
--
-- Arm three is deliberately narrower than arm two in every direction that matters: it is
-- `uploaded_xlsx` only (a CSV is never written through the immutable per-batch path), it
-- forbids the staged coordinates outright rather than merely not requiring them, and it
-- still demands a canonical lowercase sha256 content digest. "An uploaded receipt carrying
-- half a staged identity" remains unrepresentable.
ALTER TABLE plugin_data.csf_sheet_source_evidence_tokens
  DROP CONSTRAINT IF EXISTS csf_evidence_tokens_provider_shape_check;

ALTER TABLE plugin_data.csf_sheet_source_evidence_tokens
  ADD CONSTRAINT csf_evidence_tokens_provider_shape_check CHECK (
    (provider = 'google_sheets'
      AND provider_version IS NOT NULL
      AND provider_version ~ '^[1-9][0-9]{0,18}$'
      AND staging_object_id IS NULL
      AND staging_generation IS NULL
      AND content_digest IS NULL
      AND byte_length IS NULL)
    OR (provider IN ('uploaded_xlsx', 'uploaded_csv')
      AND provider_version IS NULL
      AND staging_object_id IS NOT NULL
      AND staging_generation IS NOT NULL AND staging_generation >= 1
      AND content_digest ~ '^[0-9a-f]{64}$'
      AND byte_length IS NOT NULL AND byte_length > 0)
    -- The immutable uploaded workbook: one permanent object, one digest, and none of the
    -- staged lifecycle's coordinates.
    OR (provider = 'uploaded_xlsx'
      AND provider_version IS NULL
      AND staging_object_id IS NULL
      AND staging_generation IS NULL
      AND byte_length IS NULL
      AND content_digest ~ '^[0-9a-f]{64}$')
  );

-- ---------------------------------------------------------------------------
-- The immutable uploaded workbook's receipt.
--
-- Same shape, lifetime, single-use rule, actor binding and preview binding as the other
-- two issuers. What differs is where the evidence comes from: there is no provider to call
-- and no staged generation to lock, so every attested value is read from the source row
-- this function holds FOR UPDATE and from the immutable preview that was reviewed.
--
-- LOCK ORDER, and why it is this one. The source row is taken FOR UPDATE and nothing else
-- is -- exactly `csf_issue_uploaded_source_evidence`'s own order, minus the staging object
-- it has and this family does not. The preview is read WITHOUT a lock, also as that issuer
-- does: a sealed preview is immutable, and taking it here would introduce a
-- source-then-job order against `csf_open_import_preview`, which takes the source under
-- the job's own construction, and against the contextual commits above, which take the
-- preview job first and reach the source only through the consume. Holding one row is what
-- keeps this issuer outside every cycle in this schema.
--
-- RETRY SAFETY. Calling this twice is safe and is not idempotent, on purpose and in the
-- same way both other issuers are not: each call bumps `evidence_generation` and rewrites
-- `evidenceRevision`/`evidenceDigest`, so the newest receipt is the only spendable one and
-- every earlier unspent receipt fails the consume's generation compare-and-set. A retry
-- therefore always narrows what can be spent; it never widens it.
--
-- WHAT IS REFUSED, and it is refused rather than repaired: a source that is not exactly
-- `uploaded_xlsx`; a source carrying a staged attachment, which belongs to the other
-- issuer; a Google or otherwise mutable provider; a source with no recorded object path or
-- a padded one; a source whose two records of the workbook digest (`contentHash` and
-- `fileHash`) are absent, non-canonical, or disagree; a preview from another organization,
-- another source, or a commit run; a preview that froze a different object path or a
-- different digest than the source records; and a preview that froze a modification time,
-- which an immutable object does not have and a mutable provider's preview does.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plugin_data.csf_issue_immutable_upload_source_evidence(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source_id uuid,
  p_preview_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The same two minutes the other two receipts get.
  c_token_ttl_seconds constant integer := 120;
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  -- The one MIME this family's typed provider owns, derived here and nowhere else, and
  -- the same value `csf_evidence_tokens_provider_mime_check` and the consume both require.
  c_xlsx_mime constant text :=
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_preview plugin_data.csf_sheet_import_jobs%ROWTYPE;
  v_object_path text;
  v_content_hash text;
  v_file_hash text;
  v_frozen_file_id text;
  v_frozen_id text;
  v_frozen_revision text;
  v_frozen_mime text;
  v_digest text;
  v_token plugin_data.csf_sheet_source_evidence_tokens%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_organization_id IS NULL
    OR p_actor_user_id IS NULL
    OR p_source_id IS NULL
    OR p_preview_job_id IS NULL
  THEN
    RAISE EXCEPTION
      'Issuing CSF uploaded-workbook evidence requires an organization, an officer, a source, and the preview.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;

  -- The acting officer's CSF import authority, revalidated server-side from the source's
  -- OWN recorded kind rather than from anything the caller said about it. Deliberately
  -- before every shape check below, so an unauthorized caller learns nothing about the
  -- source it named.
  PERFORM plugin_data.csf_assert_import_actor(
    p_organization_id, p_actor_user_id, v_source.source_type
  );

  -- Exactly `uploaded_xlsx`. `uploaded_csv` is refused as well as `google_sheets`: the
  -- immutable per-batch upload path writes a workbook and only a workbook, and a CSV
  -- receipt and an XLSX receipt authorize different parsers over the same bytes.
  IF v_source.provider IS DISTINCT FROM 'uploaded_xlsx' THEN
    RAISE EXCEPTION
      'This CSF source is not an immutable uploaded workbook, so its evidence comes from a live provider read.'
      USING ERRCODE = '23514';
  END IF;

  -- A source that points at a staged generation is the OTHER uploaded family, and it has
  -- its own issuer that locks that generation and attests to it. Refusing here is what
  -- keeps one source from being able to produce two kinds of receipt.
  IF v_source.settings ? 'stagingObjectId' THEN
    RAISE EXCEPTION
      'This CSF source points at a staged workbook generation, so its evidence is issued from that generation.'
      USING ERRCODE = '23514';
  END IF;

  -- The immutable object path, read exactly from the typed column. Padding is detected,
  -- never repaired: this value is the receipt's `provider_file_id` and is compared byte
  -- for byte at consumption, so trimming it here would invent the agreement.
  v_object_path := nullif(v_source.uploaded_file_path, '');
  IF v_object_path IS NULL OR plugin_data.csf_has_edge_padding(v_object_path) THEN
    RAISE EXCEPTION
      'This CSF source records no uploaded workbook to prove, so this import cannot be committed.'
      USING ERRCODE = '55000';
  END IF;

  -- The registered digest, and the second copy of it the same registration writes. Both
  -- are read on the terms every other coordinate in this schema is read on -- JSON type
  -- checked before `->>` is trusted, no `btrim`, no `lower` -- and BOTH are required to be
  -- canonical and equal. Two records of one fact that disagree are not evidence about any
  -- bytes, and repairing either into the other is the agreement this check exists to find.
  v_content_hash := CASE
    WHEN jsonb_typeof(v_source.settings -> 'contentHash') = 'string'
      THEN nullif(v_source.settings->>'contentHash', '')
    ELSE NULL
  END;
  v_file_hash := CASE
    WHEN jsonb_typeof(v_source.settings -> 'fileHash') = 'string'
      THEN nullif(v_source.settings->>'fileHash', '')
    ELSE NULL
  END;
  IF v_content_hash IS NULL
    OR v_file_hash IS NULL
    OR v_content_hash !~ c_sha256_shape
    OR v_file_hash !~ c_sha256_shape
    OR v_content_hash IS DISTINCT FROM v_file_hash
  THEN
    RAISE EXCEPTION
      'This CSF source''s recorded workbook digest is not a usable sha256 digest of the uploaded bytes.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_preview
  FROM plugin_data.csf_sheet_import_jobs AS preview
  WHERE preview.organization_id = p_organization_id
    AND preview.id = p_preview_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF preview job was not found for this organization.'
      USING ERRCODE = '23503';
  END IF;
  IF v_preview.mode <> 'preview' THEN
    RAISE EXCEPTION 'CSF source evidence is issued against a preview run, not a commit run.'
      USING ERRCODE = '23514';
  END IF;
  IF v_preview.source_id IS DISTINCT FROM p_source_id THEN
    RAISE EXCEPTION 'That CSF preview was taken from a different source.'
      USING ERRCODE = '23514';
  END IF;

  -- The preview's own frozen identity. For this family it is the object path in
  -- `source_file_id` and the sha256 in `source_content_hash` -- the same pair
  -- `assertCsfImmutableUploadFingerprint` compares in the Server Action, re-derived here
  -- from rows this function holds rather than from anything that process passed in.
  v_frozen_file_id := nullif(v_preview.source_file_id, '');
  IF v_frozen_file_id IS NOT NULL
    AND plugin_data.csf_has_edge_padding(v_frozen_file_id)
  THEN
    v_frozen_file_id := NULL;
  END IF;
  IF v_frozen_file_id IS NULL
    OR nullif(v_preview.source_content_hash, '') IS NULL
    OR v_preview.source_content_hash !~ c_sha256_shape
  THEN
    RAISE EXCEPTION
      'This CSF preview did not record the workbook evidence a commit must be checked against; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frozen_file_id IS DISTINCT FROM v_object_path THEN
    RAISE EXCEPTION
      'A different workbook is attached to this CSF source than the one this preview read; preview it again.'
      USING ERRCODE = '23514';
  END IF;
  IF v_preview.source_content_hash IS DISTINCT FROM v_content_hash THEN
    RAISE EXCEPTION
      'The workbook attached to this CSF source is not the bytes this preview read; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- A modification time is a MUTABLE provider's coordinate. An object written once with
  -- `upsert: false` has none, and the preview construction for this family records none,
  -- so a preview that froze one was not taken from an immutable upload and must not be
  -- given an immutable receipt.
  IF v_preview.source_modified_at IS NOT NULL THEN
    RAISE EXCEPTION
      'This CSF preview recorded a source modification time, so it was not taken from an immutable uploaded workbook; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- Frozen provider metadata, if the preview carries any, must agree rather than be
  -- ignored. This family freezes `{}`, so these are silent for it -- but a preview that
  -- froze a Drive id, a head revision or a MIME belongs to another family, and a receipt
  -- that quietly disregarded them would be attesting past evidence it can see.
  v_frozen_id := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'id') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'id', '')
    ELSE NULL
  END;
  v_frozen_revision := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'headRevisionId') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'headRevisionId', '')
    ELSE NULL
  END;
  v_frozen_mime := CASE
    WHEN jsonb_typeof(v_preview.source_file_metadata -> 'mimeType') = 'string'
      THEN nullif(v_preview.source_file_metadata->>'mimeType', '')
    ELSE NULL
  END;
  IF (v_frozen_id IS NOT NULL AND v_frozen_id IS DISTINCT FROM v_object_path)
    OR (v_frozen_revision IS NOT NULL AND v_frozen_revision IS DISTINCT FROM v_content_hash)
    OR (v_frozen_mime IS NOT NULL AND v_frozen_mime IS DISTINCT FROM c_xlsx_mime)
    OR v_preview.source_file_metadata ? 'version'
  THEN
    RAISE EXCEPTION
      'This CSF preview froze provider evidence that does not describe this uploaded workbook; preview it again.'
      USING ERRCODE = '23514';
  END IF;

  -- The digest covers every coordinate the consumption re-checks, and its KEYS are its
  -- own. `immutableObjectPath` appears in no other receipt shape, so a staged receipt
  -- cannot recompute into this one and this one cannot recompute into a staged receipt,
  -- whatever the two happen to agree about.
  v_digest := encode(
    sha256(convert_to(
      plugin_data.csf_canonical_json(jsonb_build_object(
        'provider', v_source.provider,
        'immutableObjectPath', v_object_path,
        'contentHash', v_content_hash,
        'mimeType', c_xlsx_mime
      )),
      'UTF8'
    )),
    'hex'
  );

  UPDATE plugin_data.csf_sheet_sources
  SET evidence_generation = v_source.evidence_generation + 1,
      evidence_refreshed_at = v_now,
      drive_access_state = 'accessible',
      drive_access_checked_at = v_now,
      settings = v_source.settings || jsonb_build_object(
        'evidenceRevision', v_content_hash,
        'evidenceDigest', v_digest
      ),
      updated_at = v_now
  WHERE id = p_source_id;

  INSERT INTO plugin_data.csf_sheet_source_evidence_tokens (
    organization_id, source_id, actor_user_id, preview_job_id, provider,
    evidence_generation, metadata_digest,
    -- No `provider_version`, no staging identity: this receipt attests to one permanent
    -- object and the digest of its bytes, which is the whole of what this family has.
    provider_file_id, mime_type, modified_time, content_digest,
    access_checked_at, expires_at
  ) VALUES (
    p_organization_id, p_source_id, p_actor_user_id, p_preview_job_id, 'uploaded_xlsx',
    v_source.evidence_generation + 1, v_digest,
    v_object_path, c_xlsx_mime,
    -- `modified_time` is NOT NULL in this table and is provenance only for this family:
    -- it is not part of the digest and is not compared at consumption, because an
    -- immutable object has no modification time to compare. The preview's own creation is
    -- the one instant in this receipt's story that is both authoritative and immutable.
    v_preview.created_at,
    v_content_hash,
    v_now, v_now + make_interval(secs => c_token_ttl_seconds)
  ) RETURNING * INTO v_token;

  RETURN jsonb_build_object(
    'evidenceToken', v_token.nonce,
    'evidenceGeneration', v_token.evidence_generation,
    'metadataDigest', v_digest,
    'provider', 'uploaded_xlsx',
    'previewJobId', p_preview_job_id,
    'expiresAt', v_token.expires_at
  );
END;
$$;

-- Consume one. Internal: reached only by the central claim
-- (`csf_claim_import_commit_attempt`) and by the two contextual commits in this
-- migration, in each case inside the same transaction that performs the write, so
-- a token cannot be spent without a commit or a commit performed without spending
-- one.
--
-- REPLACED HERE, ADDITIVELY, to add a third arm: the immutable uploaded workbook.
-- Its receipt carries no staged generation, because that family has none -- see the
-- section above for why fabricating one was the alternative and why it was refused.
-- Both existing arms are byte-for-byte what 20260730001004 defined and are reached
-- under exactly the same conditions; the new arm is reachable only for a receipt
-- whose `staging_object_id IS NULL`, which no issuer before this migration could
-- produce and the previous table constraint made unrepresentable.
CREATE OR REPLACE FUNCTION plugin_data.csf_consume_sheet_source_evidence(
  p_organization_id uuid,
  p_source_id uuid,
  p_actor_user_id uuid,
  p_evidence_token uuid,
  p_preview_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The same canonical grammars the issuers wrote these values under. Restated
  -- here rather than imported, because the whole point of this function is to be
  -- an INDEPENDENT reader of what was stored -- a verifier that trusts the
  -- writer's own constants proves only that the writer agreed with itself.
  c_sheets_mime constant text := 'application/vnd.google-apps.spreadsheet';
  c_sha256_shape constant text := '^[0-9a-f]{64}$';
  c_version_shape constant text := '^[1-9][0-9]*$';
  c_version_max constant text := '9223372036854775807';
  c_uuid_shape constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_xlsx_mime constant text :=
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  -- One shared, complete, locale-independent implementation. See
  -- `plugin_data.csf_has_edge_padding`.
  v_token plugin_data.csf_sheet_source_evidence_tokens%ROWTYPE;
  v_source plugin_data.csf_sheet_sources%ROWTYPE;
  v_staging plugin_data.csf_sheet_import_staging_objects%ROWTYPE;
  -- The digest recomputed from the receipt's own coordinates, so a receipt whose
  -- stored digest does not describe the receipt is refused.
  v_recomputed_digest text;
  v_settings_revision text;
  -- Which uploaded family the SOURCE belongs to, read from the source row rather
  -- than inferred from the receipt being checked.
  v_source_staged boolean;
BEGIN
  -- There is deliberately no null-tolerant branch and no default for this
  -- parameter. "No receipt" is the case this whole mechanism exists to refuse,
  -- for every provider family: an uploaded source that cannot produce a receipt
  -- has an unprovable attachment, which is not a reason to commit it anyway.
  IF p_evidence_token IS NULL THEN
    RAISE EXCEPTION
      'This CSF import must re-verify its source immediately before committing.'
      USING ERRCODE = '55000';
  END IF;
  IF p_preview_job_id IS NULL THEN
    RAISE EXCEPTION 'Consuming CSF source evidence requires the preview it was issued for.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_token
  FROM plugin_data.csf_sheet_source_evidence_tokens AS token
  WHERE token.nonce = p_evidence_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This CSF source freshness check is not recognized.' USING ERRCODE = '55000';
  END IF;

  IF v_token.organization_id IS DISTINCT FROM p_organization_id
    OR v_token.source_id IS DISTINCT FROM p_source_id
    OR v_token.actor_user_id IS DISTINCT FROM p_actor_user_id
  THEN
    RAISE EXCEPTION
      'This CSF source freshness check was issued for a different officer, source, or organization.'
      USING ERRCODE = '42501';
  END IF;
  -- The preview binding, checked rather than recorded.
  --
  -- This function already took a preview job id before this wave; it wrote it
  -- into `consumed_by_job_id` and never compared it to anything. An officer with
  -- two reviewed previews of one source could therefore refresh against either
  -- and spend the receipt on the other.
  IF v_token.preview_job_id IS DISTINCT FROM p_preview_job_id THEN
    RAISE EXCEPTION
      'This CSF source freshness check was issued for a different preview; check this preview and import again.'
      USING ERRCODE = '42501';
  END IF;
  -- Single use, durably. A replayed token is refused rather than silently
  -- accepted a second time.
  IF v_token.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This CSF source freshness check has already been used.' USING ERRCODE = '55000';
  END IF;
  IF v_token.expires_at <= now() THEN
    RAISE EXCEPTION
      'This CSF source freshness check has expired; re-read the source and import again.'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_source
  FROM plugin_data.csf_sheet_sources AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CSF sheet source was not found for this organization.' USING ERRCODE = '23503';
  END IF;

  -- The provider family the receipt attests to must still be the source's own.
  -- A Google receipt proves a live Drive read; an uploaded receipt proves a
  -- locked staged generation. Neither is evidence about the other, and a source
  -- that changed kind between issue and use has invalidated both.
  IF v_token.provider IS DISTINCT FROM v_source.provider THEN
    RAISE EXCEPTION
      'This CSF source freshness check was issued for a different kind of source; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- WHICH uploaded family applies is the SOURCE's fact, not the receipt's.
  --
  -- `uploaded_xlsx` now names two structurally different things: a staged generation
  -- whose bytes live in the staging lifecycle, and an immutable per-batch object that
  -- never entered it. A receipt proves one or the other and never both, so the source
  -- decides which shape it will accept and a receipt of the wrong shape is refused
  -- before any of its coordinates are read. Without this, an immutable receipt and a
  -- staged receipt for one source would each satisfy the arm they were built for.
  -- `coalesce` is load-bearing rather than decorative. `jsonb_typeof` of a MISSING key is
  -- SQL NULL, so the bare comparison yields NULL for the common case -- a source with no
  -- attachment at all -- and `NULL IS DISTINCT FROM false` is true, which would have
  -- refused every immutable receipt ever issued. Absent is `false` here, explicitly.
  v_source_staged := coalesce(
    jsonb_typeof(v_source.settings -> 'stagingObjectId') = 'string', false
  );
  IF v_token.provider <> 'google_sheets'
    AND v_source_staged IS DISTINCT FROM (v_token.staging_object_id IS NOT NULL)
  THEN
    RAISE EXCEPTION
      'This CSF source freshness check was issued for a different kind of source; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The receipt's own provider/MIME pairing, re-derived here rather than
  -- trusted. `csf_evidence_tokens_provider_mime_check` already makes a crossed
  -- row unrepresentable, but the constraint is enforced at INSERT by the
  -- issuer's intent; this is the reader refusing to spend a receipt whose MIME
  -- does not belong to its provider, so a future issuer regression, a manual
  -- write, or a constraint someone drops does not become a committed import.
  IF v_token.mime_type IS DISTINCT FROM (
    CASE v_token.provider
      WHEN 'google_sheets' THEN 'application/vnd.google-apps.spreadsheet'
      WHEN 'uploaded_csv' THEN 'text/csv'
      WHEN 'uploaded_xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ELSE NULL
    END
  ) THEN
    RAISE EXCEPTION
      'This CSF source freshness check does not describe the kind of file it was issued for; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The receipt's own coordinates, revalidated against the canonical grammars
  -- they were written under.
  --
  -- This function used to take the token row as given, on the reasoning that the
  -- issuer had already validated it and the table's CHECK constraints hold the
  -- shape. Neither is a proof at consumption time: a constraint someone drops, a
  -- manual write, or a future issuer regression all produce a row this function
  -- would have spent. A padded provider id, a non-canonical digest or an
  -- overflowing version is malformed evidence here as much as it is there.
  IF nullif(v_token.provider_file_id, '') IS NULL
    OR plugin_data.csf_has_edge_padding(v_token.provider_file_id)
    OR v_token.modified_time IS NULL
  THEN
    RAISE EXCEPTION
      'This CSF source freshness check does not identify the file it was issued for; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;
  IF v_token.provider = 'google_sheets' THEN
    -- Canonical bounded positive decimal int64 TEXT, compared as digits under
    -- the C collation so no database locale decides the bound.
    IF nullif(v_token.provider_version, '') IS NULL
      OR v_token.provider_version !~ c_version_shape
      OR length(v_token.provider_version) > length(c_version_max)
      OR (length(v_token.provider_version) = length(c_version_max)
        AND v_token.provider_version COLLATE "C" > c_version_max COLLATE "C")
    THEN
      RAISE EXCEPTION
        'This CSF source freshness check does not carry a usable provider version; preview it again before importing.'
        USING ERRCODE = '23514';
    END IF;
    -- The receipt is rebound to the LIVE source row, not only to the settings
    -- digest below: identity, kind and modification time must all still be the
    -- ones the receipt attested to.
    IF v_token.provider_file_id
      IS DISTINCT FROM nullif(coalesce(v_source.drive_file_id, v_source.spreadsheet_id), '')
      OR v_source.drive_mime_type IS DISTINCT FROM c_sheets_mime
      OR v_source.drive_modified_at IS DISTINCT FROM v_token.modified_time
    THEN
      RAISE EXCEPTION
        'This CSF source changed after it was checked; preview it again before importing.'
        USING ERRCODE = '40001';
    END IF;
  ELSIF v_token.staging_object_id IS NOT NULL THEN
    IF v_token.content_digest IS NULL
      OR v_token.content_digest !~ c_sha256_shape
      OR v_token.provider_file_id !~ c_uuid_shape
      OR v_token.provider_file_id IS DISTINCT FROM v_token.staging_object_id::text
    THEN
      RAISE EXCEPTION
        'This CSF source freshness check does not carry a usable workbook digest; preview it again before importing.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    -- The immutable uploaded workbook. Its identity is the permanent object path the
    -- receipt already carries in `provider_file_id` -- validated non-empty and unpadded
    -- above, in the check every provider shares -- and its freshness evidence is the
    -- sha256 of the exact bytes. The staged coordinates are refused rather than merely
    -- unused: a receipt carrying half a staged identity is malformed evidence, and the
    -- provider is pinned to `uploaded_xlsx` because the immutable per-batch path writes
    -- a workbook and never a CSV.
    IF v_token.provider IS DISTINCT FROM 'uploaded_xlsx'
      OR v_token.content_digest IS NULL
      OR v_token.content_digest !~ c_sha256_shape
      OR v_token.staging_generation IS NOT NULL
      OR v_token.byte_length IS NOT NULL
      OR v_token.provider_version IS NOT NULL
    THEN
      RAISE EXCEPTION
        'This CSF source freshness check does not carry a usable workbook digest; preview it again before importing.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_token.metadata_digest IS NULL OR v_token.metadata_digest !~ c_sha256_shape THEN
    RAISE EXCEPTION
      'This CSF source freshness check does not carry a usable evidence digest; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The digest, RECOMPUTED from the receipt's own coordinates.
  --
  -- Comparing the stored digest against the source's settings proves the two
  -- copies agree; it does not prove either describes the receipt. Rebuilding it
  -- from the token's own columns does, so a row whose digest was written
  -- separately from its coordinates cannot be spent. `trashed` is `false` by
  -- construction: the Google issuer refuses to issue at all unless the provider
  -- reported exactly SQL false, so there is no other value a receipt can encode.
  v_recomputed_digest := encode(
    sha256(convert_to(
      plugin_data.csf_canonical_json(
        CASE
          WHEN v_token.provider = 'google_sheets' THEN jsonb_build_object(
            'fileId', v_token.provider_file_id,
            'mimeType', v_token.mime_type,
            'modifiedTime', to_char(
              v_token.modified_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ),
            'version', v_token.provider_version,
            'trashed', false
          )
          WHEN v_token.staging_object_id IS NOT NULL THEN jsonb_build_object(
            'provider', v_token.provider,
            'stagingObjectId', v_token.staging_object_id::text,
            'stagingGeneration', v_token.staging_generation,
            'contentHash', v_token.content_digest,
            'byteLength', v_token.byte_length,
            'mimeType', v_token.mime_type
          )
          -- The immutable arm's KEYS are its own. `immutableObjectPath` appears in no
          -- other receipt shape, so a staged receipt cannot recompute into this digest
          -- and this one cannot recompute into a staged digest, whatever else agrees.
          ELSE jsonb_build_object(
            'provider', v_token.provider,
            'immutableObjectPath', v_token.provider_file_id,
            'contentHash', v_token.content_digest,
            'mimeType', v_token.mime_type
          )
        END
      ),
      'UTF8'
    )),
    'hex'
  );
  IF v_recomputed_digest IS DISTINCT FROM v_token.metadata_digest THEN
    RAISE EXCEPTION
      'This CSF source freshness check does not describe the evidence it was issued for; preview it again before importing.'
      USING ERRCODE = '23514';
  END IF;

  -- The receipt-written revision, revalidated as canonical rather than merely
  -- present. For a Google source this is the exact provider version string; for
  -- an uploaded one it is the sha256 content digest. Both are compared for
  -- EQUALITY only, and neither is btrimmed or lowercased into agreement.
  v_settings_revision := CASE
    WHEN jsonb_typeof(v_source.settings -> 'evidenceRevision') = 'string'
      THEN nullif(v_source.settings ->> 'evidenceRevision', '')
    ELSE NULL
  END;
  IF v_settings_revision IS NULL
    OR plugin_data.csf_has_edge_padding(v_settings_revision)
    OR v_settings_revision IS DISTINCT FROM (CASE
      WHEN v_token.provider = 'google_sheets' THEN v_token.provider_version
      ELSE v_token.content_digest
    END)
  THEN
    RAISE EXCEPTION
      'This CSF source changed after it was checked; preview it again before importing.'
      USING ERRCODE = '40001';
  END IF;

  -- Stale by generation, or stale by digest. A competing refresh that landed
  -- between this token's issue and its use replaced both, so the reviewed
  -- snapshot is no longer what the provider holds.
  --
  -- The stored digest is read exactly: its JSON type is checked before `->>` is
  -- trusted, and it is not btrimmed into agreement with the receipt's own.
  IF v_token.evidence_generation IS DISTINCT FROM v_source.evidence_generation
    OR v_token.metadata_digest IS DISTINCT FROM (CASE
      WHEN jsonb_typeof(v_source.settings -> 'evidenceDigest') = 'string'
        THEN nullif(v_source.settings ->> 'evidenceDigest', '')
      ELSE NULL
    END)
  THEN
    RAISE EXCEPTION
      'This CSF source changed after it was checked; preview it again before importing.'
      USING ERRCODE = '40001';
  END IF;

  -- The uploaded identity, verified a second time against the two rows it was
  -- derived from. The generation CAS above already refuses a receipt issued
  -- before a competing refresh, but a replacement upload is a change to the
  -- *attachment*, and this is what notices it.
  IF v_token.provider IN ('uploaded_xlsx', 'uploaded_csv')
    AND v_token.staging_object_id IS NOT NULL
  THEN
    -- Re-read on exactly the terms the issuer wrote them: JSON type checked, not
    -- btrimmed, not lowercased, and cast only behind a shape that makes the cast
    -- total so a malformed settings value is this bounded refusal rather than a
    -- 22P02 quoting the offending text back at the caller. A padded, uppercase
    -- or wrong-type value therefore resolves to NULL, which `IS DISTINCT FROM`
    -- the receipt's coordinate and refuses -- rather than being repaired into
    -- agreement with a receipt that never attested to it.
    IF (CASE
        WHEN jsonb_typeof(v_source.settings -> 'stagingObjectId') = 'string'
          AND v_source.settings->>'stagingObjectId'
            ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (v_source.settings->>'stagingObjectId')::uuid
        ELSE NULL
      END) IS DISTINCT FROM v_token.staging_object_id
      OR (CASE
        WHEN jsonb_typeof(v_source.settings -> 'stagingGeneration') = 'number'
          AND v_source.settings->>'stagingGeneration' ~ '^[1-9][0-9]{0,8}$'
          THEN (v_source.settings->>'stagingGeneration')::integer
        ELSE NULL
      END) IS DISTINCT FROM v_token.staging_generation
      OR (CASE
        WHEN jsonb_typeof(v_source.settings -> 'stagingContentHash') = 'string'
          THEN nullif(v_source.settings->>'stagingContentHash', '')
        ELSE NULL
      END) IS DISTINCT FROM v_token.content_digest
      OR (CASE
        WHEN jsonb_typeof(v_source.settings -> 'stagingByteLength') = 'number'
          AND v_source.settings->>'stagingByteLength' ~ '^[0-9]{1,18}$'
          THEN (v_source.settings->>'stagingByteLength')::bigint
        ELSE NULL
      END) IS DISTINCT FROM v_token.byte_length
    THEN
      RAISE EXCEPTION
        'A different workbook is attached to this CSF source than the one this import checked; preview it again.'
        USING ERRCODE = '40001';
    END IF;

    SELECT * INTO v_staging
    FROM plugin_data.csf_sheet_import_staging_objects AS staging
    WHERE staging.organization_id = p_organization_id
      AND staging.id = v_token.staging_object_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'The staged workbook this CSF import checked no longer exists; upload it again and preview.'
        USING ERRCODE = '23503';
    END IF;
    IF v_staging.source_id IS DISTINCT FROM p_source_id
      -- The same three-state immutable-evidence allowlist the issuer uses, and
      -- for the same reason: this comparison verifies typed coordinates that a
      -- tombstone still carries -- object id, generation, digest, byte length --
      -- and never reads a storage path. Requiring `ready` here reinstated the
      -- preview -> upload-again loop one step later than the issuer did: the
      -- receipt was granted and then refused at the moment it was consumed.
      -- `uploading` stays refused, because a half-written object has no frozen
      -- evidence to compare against.
      OR v_staging.status NOT IN ('ready', 'retire_pending', 'tombstoned')
      OR v_staging.generation IS DISTINCT FROM v_token.staging_generation
      OR v_staging.content_hash IS DISTINCT FROM v_token.content_digest
      OR v_staging.byte_length IS DISTINCT FROM v_token.byte_length
    THEN
      RAISE EXCEPTION
        'The staged workbook this CSF import checked is no longer the bytes it proved; upload it again and preview.'
        USING ERRCODE = '40001';
    END IF;
  ELSIF v_token.provider = 'uploaded_xlsx' THEN
    -- The immutable identity, verified a second time against the one row it was derived
    -- from. The generation compare-and-set above already refuses a receipt issued before
    -- a competing refresh; this is what notices the source being re-pointed at a
    -- different uploaded workbook, or either of its two records of the digest being
    -- changed underneath a live receipt.
    --
    -- Read exactly, on the issuer's own terms: JSON type checked before `->>` is
    -- trusted, never btrimmed, never lowercased, so a padded, uppercase or wrong-type
    -- value resolves to NULL and refuses rather than being repaired into agreement.
    -- There is no staging object to re-read, because this family has none -- the object
    -- it names is permanent and this function never hands anybody a path to it.
    IF nullif(v_source.uploaded_file_path, '') IS DISTINCT FROM v_token.provider_file_id
      OR (CASE
        WHEN jsonb_typeof(v_source.settings -> 'contentHash') = 'string'
          THEN nullif(v_source.settings->>'contentHash', '')
        ELSE NULL
      END) IS DISTINCT FROM v_token.content_digest
      OR (CASE
        WHEN jsonb_typeof(v_source.settings -> 'fileHash') = 'string'
          THEN nullif(v_source.settings->>'fileHash', '')
        ELSE NULL
      END) IS DISTINCT FROM v_token.content_digest
      OR v_token.mime_type IS DISTINCT FROM c_xlsx_mime
    THEN
      RAISE EXCEPTION
        'A different workbook is attached to this CSF source than the one this import checked; preview it again.'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Consumption records the exact preview binding. `consumed_by_job_id` equals
  -- `preview_job_id` by table constraint, so this cannot drift into recording
  -- some other job even if a future caller passes one.
  UPDATE plugin_data.csf_sheet_source_evidence_tokens
  SET consumed_at = now(), consumed_by_job_id = v_token.preview_job_id
  WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'consumed', true,
    'provider', v_token.provider,
    'previewJobId', v_token.preview_job_id,
    'evidenceGeneration', v_token.evidence_generation,
    'metadataDigest', v_token.metadata_digest
  );
END;
$$;

REVOKE ALL ON FUNCTION plugin_data.csf_lock_contextual_commit_population(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION plugin_data.csf_import_preview_row_readiness_blockers(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_meeting_attendance_preview_readiness_blockers(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_partner_audit_batch_readiness_blockers(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_acknowledge_partner_audit_batch_provenance(
  uuid, uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plugin_data.csf_issue_immutable_upload_source_evidence(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
-- The consume keeps the shape 20260730001004 gave it: internal, reached by the owned
-- SECURITY DEFINER commits as the definer and by no role at all.
REVOKE ALL ON FUNCTION plugin_data.csf_consume_sheet_source_evidence(
  uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The receipt-less signatures, removed rather than left beside the new ones.
--
-- A trailing parameter creates a NEW function; it does not replace the old one. Leaving
-- the five- and six-argument forms in place would mean `plugin.rpc(...)` with the old
-- argument set still resolves, still commits, and still proves nothing about the source
-- -- which is precisely the bypass `p_evidence_token` exists to close. REVOKE first so
-- that a replay against a database where something else already dropped them is still a
-- clean no-op, then DROP.
--
-- This is a forward migration over an append-only ledger: 20260716053000 keeps its own
-- history, and this is the change that supersedes it.
--
-- The REVOKE is resolved through `to_regprocedure`, which answers NULL instead of raising
-- for a signature that is not there. A bare `REVOKE ... ON FUNCTION` errors on a missing
-- function, which would make this migration's own replay order the thing that decides
-- whether it applies.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'plugin_data.csf_commit_meeting_attendance_import(uuid,uuid,uuid,text,uuid)',
    'plugin_data.csf_commit_partner_audit_import(uuid,uuid,text,uuid,text,uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
        v_signature
      );
      EXECUTE format('DROP FUNCTION %s', v_signature);
    END IF;
  END LOOP;
END;
$$;

-- csf_lock_contextual_commit_population is deliberately absent from this list. It is an
-- internal helper in the same shape as csf_lock_import_commit_coordinate: only the owned
-- SECURITY DEFINER commits above may take the population, and they reach it as the
-- function owner rather than through a role grant.
GRANT EXECUTE ON FUNCTION plugin_data.csf_import_preview_row_readiness_blockers(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_meeting_attendance_preview_readiness_blockers(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_partner_audit_batch_readiness_blockers(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_acknowledge_partner_audit_batch_provenance(
  uuid, uuid, uuid, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid, uuid
) TO service_role;
-- The issuer is reached by the permission-checked Server Action with the service role,
-- exactly as csf_issue_uploaded_source_evidence is. It is NOT granted to anon or
-- authenticated: it writes the source's evidence generation.
GRANT EXECUTE ON FUNCTION plugin_data.csf_issue_immutable_upload_source_evidence(
  uuid, uuid, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION plugin_data.csf_lock_contextual_commit_population(uuid, uuid, uuid) IS
  'The single canonical lock order for a contextual CSF commit''s authoritative population: the preview''s import rows in (sheet_tab_name, row_number, id) order first, the batch''s partner submission rows in (created_at, id) order second. Import rows before partner rows is csf_reconcile_sheet_import_row''s own direction, so a reconciliation racing a contextual commit waits instead of deadlocking; the import-row order is csf_lock_import_commit_coordinate step 5''s order, so the central importer cannot form a cycle with these two either. Taken after the callers'' replay short-circuits and before readiness and every business write. FOR UPDATE holds the rows that exist when it runs: appends to the preview are excluded by the caller''s preview-job lock, which csf_append_import_preview_rows also takes first, while partner rows written by the batch-authoring path are outside it.';
COMMENT ON FUNCTION plugin_data.csf_import_preview_row_readiness_blockers(uuid, uuid) IS
  'The row-population half of CSF import readiness for one preview, in the existing readiness vocabulary: unreconciled ambiguous/conflict/duplicate rows, rows the preview could not read into a valid record, and the in-flight/unknown/historical-unknown recovery states read from commit_outcome_state rather than from the derived commit_outcome_unresolved boolean, so unknown and historical-unknown stay distinguishable. It is NOT a subset of csf_import_preview_claim_blockers and is not a call to it: that gate additionally requires a normalized-snapshot contract version, a bound mapping generation, per-tab exact A1 ranges, a live provider receipt, a stored snapshot row count, a resolved class and semester on every ready row and at least one ready row, none of which the contextual meeting and partner-club previews are built to carry -- but this one also tests import_status = ''error'', for which the central gate has no blocker at all. The two overlap on the one question both exist for and diverge on either side of it, and share exactly one sentence verbatim: Reconcile %s conflicting row(s) before importing. Evaluated by both contextual commits after csf_lock_contextual_commit_population and before any business write.';
COMMENT ON FUNCTION plugin_data.csf_meeting_attendance_preview_readiness_blockers(uuid, uuid) IS
  'What meeting attendance additionally requires of the READY rows of one preview, which the shared population gate cannot ask: a pending row with no matched member or no semester names no attendance record, and two pending rows naming the same member name one record twice under the (profile_id, term_id, meeting_key) key. Both were previously discovered inside the write loop, marked duplicate, counted as failed and reported as partially_completed success; they are counted here before anything is written, and the loop now raises. The duplicate sentence is the same one the loop used to write into the row''s errors so the gate and the row agree.';
COMMENT ON FUNCTION plugin_data.csf_partner_audit_batch_readiness_blockers(uuid, uuid) IS
  'The same readiness question for a partner-audit batch, read from csf_partner_submission_rows for batches that carry no linked preview. matched and rejected are the two settled values -- rejected is what an officer skip writes -- so any other matched_status is an undecided row, and a matched row with no profile, no positive point value or an unsupported point type is an invalid row wearing a settled status: the commit loop used to count exactly those as failed and drop them while reporting success. It also carries the provenance blocker: a batch with no sheetImportPreviewJobId has no immutable preview to prove its source against and the Server Action skips source revalidation for it entirely, so it fails closed until csf_acknowledge_partner_audit_batch_provenance records an attributed, audited officer acknowledgement in the batch summary.';
COMMENT ON FUNCTION plugin_data.csf_acknowledge_partner_audit_batch_provenance(
  uuid, uuid, uuid, text, uuid
) IS
  'The reachable recovery path for a preview-less historical partner-audit batch, modelled on csf_accept_historical_import_outcome: an authorized officer records once, under immutable audit and with a required reason, that they vouch for a batch whose source predates the linked-preview contract, after which csf_partner_audit_batch_readiness_blockers stops refusing it and the batch commits through the ordinary path. Refuses a batch that has a linked preview -- its source is proved at commit rather than acknowledged -- and a batch that has already been committed. Replaying an existing acknowledgement is idempotent. Locks the batch row only, which every partner path takes first, so it cannot deadlock with a concurrent commit.';
COMMENT ON FUNCTION plugin_data.csf_commit_meeting_attendance_import(
  uuid, uuid, uuid, text, uuid, uuid
) IS
  'Atomically commits one reconciled meeting-attendance preview, preserving existing officer corrections and writing source/job/audit state together. Takes the whole preview population through csf_lock_contextual_commit_population and only then reads readiness, so a concurrent csf_reconcile_sheet_import_row cannot move a sibling between the check and the write. Refuses the whole commit -- before the commit job, the attendance rows, the source health update and the audit event -- while any sibling row in the same preview is unreconciled, unreadable, in flight or carries an unresolved commit outcome, and additionally while any ready row lacks a matched member or semester or repeats a member already named by another ready row. The write loop raises rather than marking such a row duplicate and finishing, so failed can no longer be anything but 0. p_evidence_token is trailing and has NO DEFAULT, exactly as csf_claim_import_commit_attempt declares it, and is spent through csf_consume_sheet_source_evidence(organization, the preview''s source, actor, token, the preview) after the population lock and every actionable readiness refusal and immediately before the first business write -- after the lock because the central coordinate takes the source last, so consuming first would be source-before-rows here against rows-before-source there. A missing, foreign, already-spent or expired receipt refuses the commit, and every refusal after the consume rolls it back, so a token is spent only by a commit that durably happened. Replay of an already-committed snapshot still short-circuits ahead of the population lock, the readiness check and the consume, so it stays idempotent and needs no fresh receipt. The receipt-less five-argument signature is dropped in the same migration, so no overload can be resolved without one.';
COMMENT ON FUNCTION plugin_data.csf_commit_partner_audit_import(
  uuid, uuid, text, uuid, text, uuid, uuid
) IS
  'Atomically turns reconciled partner-audit rows into submissions, credits, activity history, import state, batch state, and immutable audit history. Takes the whole population through csf_lock_contextual_commit_population -- linked-preview import rows first, batch partner rows second, the same direction csf_reconcile_sheet_import_row takes them -- and only then reads readiness. Refuses the whole commit before any of those writes while the batch, or its linked immutable preview when one exists, still holds an undecided or invalid row, rather than silently skipping those rows and recording partially_completed, and refuses a batch with no linked preview until csf_acknowledge_partner_audit_batch_provenance records an attributed officer acknowledgement, because nothing revalidates such a batch''s source. The write loop raises rather than counting an invalid matched row as failed, so failed can no longer be anything but 0. p_evidence_token is trailing and has NO DEFAULT: a batch WITH a linked preview spends it through csf_consume_sheet_source_evidence(organization, the preview''s source, actor, token, the preview) after the population lock and the readiness gate and immediately before the first business write, and a linked preview that records no source is refused rather than consumed against NULL; a batch with NO linked preview refuses a supplied token outright, because no receipt can be issued against a preview that does not exist, and is released only by the audited, attributed provenance acknowledgement rather than by a receipt. Every refusal after the consume rolls it back. Replay of an already-committed batch still short-circuits ahead of the population lock, the readiness check and the consume, so it stays idempotent and needs no fresh receipt. The receipt-less six-argument signature is dropped in the same migration, so no overload can be resolved without one.';

COMMENT ON FUNCTION plugin_data.csf_issue_immutable_upload_source_evidence(
  uuid, uuid, uuid, uuid
) IS
  'Issues the single-use commit-time receipt for the IMMUTABLE uploaded workbook family: an uploaded_xlsx CSF source whose bytes were written once to a permanent per-batch object path with upsert:false, so it has neither a Drive object for csf_refresh_sheet_source_evidence to re-read nor a staged generation for csf_issue_uploaded_source_evidence to lock. Performs no provider call and accepts no evidence from its caller: the object path and the sha256 content digest are read from the source row this function holds FOR UPDATE, and the caller supplies only four identifiers, every one of which is checked. Revalidates the acting officer''s CSF import authority through csf_assert_import_actor from the source''s OWN recorded source_type before any shape check, so an unauthorized caller learns nothing about the source it named. Requires the provider to be exactly uploaded_xlsx -- uploaded_csv and google_sheets are both refused -- and refuses a source that points at a staged generation, which belongs to the other uploaded issuer, so one source can never produce two kinds of receipt. Every coordinate is read exactly: JSON type checked before ->> is trusted, never btrimmed, never lowercased, padding detected through csf_has_edge_padding rather than repaired. Both of the source''s records of the workbook digest -- settings.contentHash and settings.fileHash -- must exist, be canonical lowercase sha256 and be equal, and the preview''s frozen source_file_id and source_content_hash must equal the source''s object path and digest byte for byte; a preview that froze a modification time, a provider version, or a Drive id, head revision or MIME that disagrees is refused rather than disregarded, because an immutable object has none of those. The metadata digest is canonicalized over immutableObjectPath/contentHash/mimeType, keys that appear in no other receipt shape, so no staged receipt can recompute into an immutable one or the reverse. Locks the source row and nothing else -- the sealed preview is read without a lock, exactly as csf_issue_uploaded_source_evidence reads it -- so this issuer sits outside every lock cycle in this schema. Bound to organization, source, actor, preview job and provider; expires after two minutes; consumed exactly once by csf_consume_sheet_source_evidence. Retrying is safe and deliberately not idempotent: each call bumps evidence_generation and rewrites evidenceRevision/evidenceDigest, so every earlier unspent receipt fails the consume''s compare-and-set and only the newest one can be spent.';
COMMENT ON FUNCTION plugin_data.csf_consume_sheet_source_evidence(
  uuid, uuid, uuid, uuid, uuid
) IS
  'Spends one single-use CSF source-evidence receipt inside the transaction that performs the write, and refuses a missing, foreign, mis-previewed, already-spent or expired one. Replaced by this migration ADDITIVELY: the google_sheets and staged-upload arms are byte-for-byte what 20260730001004 defined and are reached under exactly the same conditions, and a third arm accepts the immutable uploaded workbook -- an uploaded_xlsx source with a permanent per-batch object and no staged generation -- which csf_issue_immutable_upload_source_evidence issues. Which uploaded arm applies is decided by the SOURCE row rather than by the receipt: a source carrying a staged attachment must present a staged receipt and a source carrying none must present an immutable one, so the two uploaded families cannot be substituted for each other in either direction. The immutable arm refuses a receipt carrying any staged coordinate, a provider version, a non-canonical digest, or a provider other than uploaded_xlsx; it re-derives the metadata digest over immutableObjectPath/contentHash/mimeType, keys no other receipt shape uses, so no staged receipt can recompute into it; and it re-verifies the object path and BOTH of the source''s records of the digest against the receipt, so re-pointing the source at a different uploaded workbook invalidates a live receipt. It reads no staging object, because this family has none, and it hands nobody a storage path. Every other invariant is unchanged: the actor/source/organization/preview bindings, the durable single-use rule, the two-minute expiry, the provider/MIME pairing re-derived rather than trusted, the digest recomputed from the receipt''s own coordinates, the evidenceRevision/evidenceDigest equality and the evidence_generation compare-and-set.';

-- ---------------------------------------------------------------------------
-- INTEGRATION NOTE: the contextual source-evidence receipt IS taken here.
--
-- `CSF_CONTEXTUAL_EVIDENCE_ROOT_CONTRACT` in
-- `lib/plugins/private/plugins/dvhs-csf/server/actions/support-contextual-import-evidence.ts`
-- asked for a trailing `p_evidence_token uuid` with NO DEFAULT on both commits above,
-- consumed through
-- `plugin_data.csf_consume_sheet_source_evidence(p_organization_id, <preview source_id>,
-- p_actor_user_id, p_evidence_token, <preview job id>)` inside the commit transaction and
-- before the first write, with an idempotent replay exempted. That is what the two
-- functions above now do, and the receipt-less signatures are dropped rather than left
-- callable beside them, so the two halves land together as one change.
--
-- Three decisions this migration made that the private note could not:
--
--   1. PLACEMENT AGAINST THE LOCK ORDER. `csf_claim_import_commit_attempt` calls
--      `csf_lock_import_commit_coordinate` FIRST and consumes SECOND, and that coordinate
--      takes the preview's import rows at step 5 and the SOURCE at step 6. The contextual
--      consume therefore sits AFTER `csf_lock_contextual_commit_population`, never before
--      it: the other way round would take source-before-rows here and rows-before-source
--      there, which is an ABBA cycle on two objects both paths hold.
--
--   2. READINESS FIRST. The consume sits after every actionable readiness refusal, so the
--      common, fixable, officer-facing blocker is what surfaces rather than a
--      source-freshness error. Nothing is written before either, and every raise after
--      the consume rolls the consume back with it, so a refusal never spends a token.
--
--   3. THE PREVIEW-LESS BRANCH. The private note said a partner batch with no linked
--      preview "must RAISE, not skip the consume". Taken literally that reinstates the
--      permanently unimportable historical batch this migration exists to end: such a
--      batch has no preview, so no receipt can ever be issued for it, so no officer could
--      ever resolve it. What landed instead refuses a SUPPLIED token for such a batch --
--      there is no preview it could have been issued against -- and otherwise requires
--      the audited, attributed `csf_acknowledge_partner_audit_batch_provenance`, which is
--      a refusal with a way out rather than a silent skip.
--
-- WHAT REMAINED, AND WHAT CLOSED IT. This note previously ended by naming one source
-- family that reaches the two commits above and could not produce a receipt for them: a
-- partner-club audit workbook uploaded through `commitCsfPartnerAuditPreviewAction`,
-- registered `uploaded_xlsx` with no `stagingObjectId`, which
-- `csf_refresh_sheet_source_evidence` refuses for not being Google and
-- `csf_issue_uploaded_source_evidence` refuses for having no staged object. Such a batch
-- reached the linked-preview branch above with a NULL token and was refused -- fail-closed,
-- but with no way out, because the way out did not exist.
--
-- It exists now, and it is the FIRST of the two follow-ups this note named: an issuer for
-- the immutable-upload family, `csf_issue_immutable_upload_source_evidence`, whose receipt
-- `csf_consume_sheet_source_evidence` accepts. The second -- an in-transaction SQL
-- re-implementation of `assertCsfImmutableUploadFingerprint` -- was deliberately NOT taken:
-- a second verifier of one fact drifts from the first, and the drift is discovered by the
-- import that should have been refused.
--
-- The one thing this note said would have to be decided explicitly HAS been decided
-- explicitly, and against its own preference. The consume is a shared central verifier and
-- it did change, because it had to: its non-Google arm requires `staging_object_id IS NOT
-- NULL` and then reads the staging object row, and the token table independently required
-- a staged object id, a staged generation and a positive byte length on every uploaded
-- receipt. An immutable per-batch workbook has none of those and never will. The only way
-- to leave the consume untouched was to fabricate a staging object row, a byte length
-- nothing records, and a source attachment written by something other than
-- `csf_attach_sheet_source_generation` -- that is, to forge evidence in order to satisfy a
-- verifier, which is the failure this whole mechanism exists to prevent. The change taken
-- instead is strictly additive and fail-closed, both existing arms are byte-for-byte
-- unchanged, and the SOURCE row -- not the receipt -- decides which uploaded arm applies,
-- so the two uploaded families cannot be substituted for each other in either direction.
-- The section above states the whole of it.
--
-- `revalidateCsfContextualImportSource` therefore now returns `kind: evidence_token` for
-- every contextual source family it can reach, and `csfContextualEvidenceTokenFor` no
-- longer has a family to refuse. The client-side fingerprint comparison is kept as a
-- pre-flight, because a refusal an officer reads before the commit transaction opens is
-- better product than the same refusal read out of a rolled-back one -- but it is defence
-- in depth over the database receipt, never a substitute for it.
-- ---------------------------------------------------------------------------

COMMIT;
