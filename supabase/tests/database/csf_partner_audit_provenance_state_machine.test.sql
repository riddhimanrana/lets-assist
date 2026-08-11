-- The full state machine of a PREVIEW-LESS partner-audit batch, from the blocker it
-- starts life with to the commit that ends it, and the two doors that are shut afterwards.
--
-- csf_contextual_commit_readiness.test.sql proves this batch shape fails closed, in among
-- everything else that file proves about readiness. This file is only about the states an
-- acknowledged batch moves through, and about the two claims that file cannot make because
-- it has no fixture for them:
--
--   * the acknowledgement clears the PROVENANCE blocker and nothing else. Proved on a
--     second preview-less batch that also holds an unreconciled row, so "no blockers left"
--     and "the one blocker this was meant to clear is gone" cannot be the same assertion;
--   * none of it reaches another organization. A second chapter holds its own preview-less
--     batch throughout, and the acknowledgement, the commit and the blocker read are all
--     asked about it across the tenant boundary.
--
-- What is NOT here: source-evidence receipts, which csf_contextual_commit_evidence.test.sql
-- owns, beyond the one fact this state machine depends on -- a preview-less batch commits
-- with `p_evidence_token := NULL`, because no receipt could ever have been issued for a
-- preview that does not exist.
--
-- Every identity below is synthetic and lives only inside this rolled-back transaction.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- An exact plan. no_plan() cannot tell "every assertion passed" from "the file stopped
-- running half way", and a state machine that silently stops advancing is exactly the
-- failure this file exists to catch.
SELECT extensions.plan(35);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  (
    'c9000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'provenance-officer@local.test', now(), '{}', '{}',
    now(), now()
  ),
  (
    'c9000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'provenance-other-officer@local.test', now(), '{}', '{}',
    now(), now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'c9100000-0000-4000-8000-000000000001',
    'CSF Partner Audit Provenance',
    'csf-partner-audit-provenance',
    'school',
    '995201'
  ),
  (
    'c9100000-0000-4000-8000-000000000002',
    'CSF Partner Audit Provenance Neighbour',
    'csf-partner-audit-provenance-two',
    'school',
    '995202'
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES
  (
    'c9200000-0000-4000-8000-000000000001',
    'c9100000-0000-4000-8000-000000000001',
    'F32', 'Fall 2032', '2032-2033', 'fall'
  ),
  (
    'c9200000-0000-4000-8000-000000000002',
    'c9100000-0000-4000-8000-000000000002',
    'F32', 'Fall 2032', '2032-2033', 'fall'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  ('c9300000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001',
   'Vouched', 'Auditee', 'vouched', 'auditee'),
  ('c9300000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000001',
   'Mixed', 'Auditee', 'mixed', 'auditee'),
  ('c9300000-0000-4000-8000-000000000003', 'c9100000-0000-4000-8000-000000000002',
   'Neighbour', 'Auditee', 'neighbour', 'auditee');

INSERT INTO plugin_data.csf_partner_clubs (
  id, organization_id, name, approved_point_types
) VALUES
  (
    'c9800000-0000-4000-8000-000000000001',
    'c9100000-0000-4000-8000-000000000001',
    'Synthetic Provenance Club',
    ARRAY['non_drive']::text[]
  ),
  (
    'c9800000-0000-4000-8000-000000000002',
    'c9100000-0000-4000-8000-000000000002',
    'Synthetic Neighbour Club',
    ARRAY['non_drive']::text[]
  );

-- Three batches, none of them linked to an import preview, which is the whole population
-- this file is about. An empty `summary` is what a batch recorded before the linked-preview
-- contract existed actually looks like: no preview job, no acknowledgement, no commit
-- correlation.
INSERT INTO plugin_data.csf_partner_submission_batches (
  id, organization_id, partner_club_id, term_id, title, source, source_url, status,
  submitted_by, summary
) VALUES
  -- The batch that walks the whole machine.
  (
    'c9900000-0000-4000-8000-000000000001',
    'c9100000-0000-4000-8000-000000000001',
    'c9800000-0000-4000-8000-000000000001',
    'c9200000-0000-4000-8000-000000000001',
    'Synthetic preview-less audit', 'sheet', 'csf/fixture/provenance-preview-less.xlsx',
    'needs_verification', 'c9000000-0000-4000-8000-000000000001', '{}'
  ),
  -- Preview-less AND unreconciled. Acknowledging this one must move exactly one blocker.
  (
    'c9900000-0000-4000-8000-000000000002',
    'c9100000-0000-4000-8000-000000000001',
    'c9800000-0000-4000-8000-000000000001',
    'c9200000-0000-4000-8000-000000000001',
    'Synthetic unreconciled audit', 'sheet', 'csf/fixture/provenance-unreconciled.xlsx',
    'needs_verification', 'c9000000-0000-4000-8000-000000000001', '{}'
  ),
  -- Another chapter's batch, identical in shape. Nothing this file does may touch it.
  (
    'c9900000-0000-4000-8000-000000000003',
    'c9100000-0000-4000-8000-000000000002',
    'c9800000-0000-4000-8000-000000000002',
    'c9200000-0000-4000-8000-000000000002',
    'Synthetic neighbour audit', 'sheet', 'csf/fixture/provenance-neighbour.xlsx',
    'needs_verification', 'c9000000-0000-4000-8000-000000000002', '{}'
  );

INSERT INTO plugin_data.csf_partner_submission_rows (
  id, organization_id, batch_id, profile_id, matched_status, raw_data, normalized_data,
  claimed_points, point_type
) VALUES
  -- Settled, matched, and importable: everything except its provenance is decided.
  (
    'c9a00000-0000-4000-8000-000000000001',
    'c9100000-0000-4000-8000-000000000001',
    'c9900000-0000-4000-8000-000000000001',
    'c9300000-0000-4000-8000-000000000001',
    'matched', '{"Name":"Vouched Auditee"}',
    '{"source":{"rowHash":"provenance-vouched-hash"}}', 4, 'non_drive'
  ),
  (
    'c9a00000-0000-4000-8000-000000000002',
    'c9100000-0000-4000-8000-000000000001',
    'c9900000-0000-4000-8000-000000000002',
    'c9300000-0000-4000-8000-000000000002',
    'matched', '{"Name":"Mixed Auditee"}',
    '{"source":{"rowHash":"provenance-mixed-hash"}}', 2, 'non_drive'
  ),
  -- The sibling nobody has decided. `ambiguous` is neither `matched` nor `rejected`.
  (
    'c9a00000-0000-4000-8000-000000000003',
    'c9100000-0000-4000-8000-000000000001',
    'c9900000-0000-4000-8000-000000000002',
    NULL,
    'ambiguous', '{"Name":"Undecided Auditee"}',
    '{"source":{"rowHash":"provenance-undecided-hash"}}', 1, 'non_drive'
  ),
  (
    'c9a00000-0000-4000-8000-000000000004',
    'c9100000-0000-4000-8000-000000000002',
    'c9900000-0000-4000-8000-000000000003',
    'c9300000-0000-4000-8000-000000000003',
    'matched', '{"Name":"Neighbour Auditee"}',
    '{"source":{"rowHash":"provenance-neighbour-hash"}}', 3, 'non_drive'
  );

-- ---------------------------------------------------------------------------
-- A. The state a preview-less batch starts in: refused, and refused with the one
--    sentence that names the way out.
-- ---------------------------------------------------------------------------
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'c9100000-0000-4000-8000-000000000001',
    'c9900000-0000-4000-8000-000000000001'
  ),
  ARRAY['Acknowledge this audit batch, recorded before import previews were linked, before importing.']::text[],
  'a preview-less batch whose rows are otherwise settled reports exactly the provenance blocker'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000001',
      'approved',
      'c9000000-0000-4000-8000-000000000001',
      'Attempted to commit before anybody vouched for the source.',
      'c9d00000-0000-4000-8000-000000000004', NULL
    )
  $$,
  'P0001',
  'Acknowledge this audit batch, recorded before import previews were linked, before importing.',
  'the commit refuses the unacknowledged batch with the same sentence the gate states'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic preview-less audit partner club audit'),
  0,
  'the refused commit wrote no point submission'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000001'),
  0,
  'the refused commit wrote no audit event'
);
-- Two independent facts, stated in the order the gate states them. The second batch is
-- what makes section C able to say "only the provenance one moved".
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'c9100000-0000-4000-8000-000000000001',
    'c9900000-0000-4000-8000-000000000002'
  ),
  ARRAY[
    'Reconcile 1 conflicting row(s) before importing.',
    'Acknowledge this audit batch, recorded before import previews were linked, before importing.'
  ]::text[],
  'a preview-less batch holding an undecided row reports both blockers'
);

-- ---------------------------------------------------------------------------
-- B. The acknowledgement: attributed, reasoned, audited, and effective.
-- ---------------------------------------------------------------------------
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000001',
      'c9000000-0000-4000-8000-000000000001',
      'Advisor confirmed the 2032 workbook against the signed club roster.',
      'c9d00000-0000-4000-8000-000000000001'
    )
  $$,
  'an authorized officer can acknowledge a preview-less batch'
);
SELECT extensions.is(
  (SELECT summary->>'historicalProvenanceAcknowledgedBy'
   FROM plugin_data.csf_partner_submission_batches
   WHERE id = 'c9900000-0000-4000-8000-000000000001'),
  'c9000000-0000-4000-8000-000000000001',
  'the batch records WHO vouched for it'
);
-- The reason is the point of the acknowledgement, not decoration around it: it is the only
-- durable statement of what the officer checked before vouching.
SELECT extensions.is(
  (SELECT summary->>'historicalProvenanceAcknowledgementReason'
   FROM plugin_data.csf_partner_submission_batches
   WHERE id = 'c9900000-0000-4000-8000-000000000001'),
  'Advisor confirmed the 2032 workbook against the signed club roster.',
  'the batch records WHY, verbatim'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000001'
     AND target_type = 'csf_partner_submission_batches'
     AND action = 'partner_audit.historical_provenance_acknowledged'
     AND actor_user_id = 'c9000000-0000-4000-8000-000000000001'
     AND reason_code = 'partner_audit_historical_provenance_acknowledged'
     AND term_id = 'c9200000-0000-4000-8000-000000000001'),
  1,
  'the acknowledgement writes exactly one audit event, naming its officer and term'
);
SELECT extensions.is(
  (SELECT after_data->>'reason' FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000001'
     AND action = 'partner_audit.historical_provenance_acknowledged'),
  'Advisor confirmed the 2032 workbook against the signed club roster.',
  'the audit event carries the reason as well as the actor'
);
SELECT extensions.is(
  (SELECT correlation_id FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000001'
     AND action = 'partner_audit.historical_provenance_acknowledged'),
  'c9d00000-0000-4000-8000-000000000001'::uuid,
  'the audit event is correlated to the acknowledgement the caller identified'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'c9100000-0000-4000-8000-000000000001',
    'c9900000-0000-4000-8000-000000000001'
  ),
  ARRAY[]::text[],
  'the acknowledged batch reports no readiness blocker at all'
);

-- ---------------------------------------------------------------------------
-- C. The acknowledgement clears the provenance blocker and NOTHING else.
--
-- This is the claim an all-clean fixture cannot make. Vouching for a source says nothing
-- about whether an officer has finished deciding the rows, and a batch where the two were
-- confused would import an undecided member's row on the strength of a signature about the
-- workbook.
-- ---------------------------------------------------------------------------
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000002',
      'c9000000-0000-4000-8000-000000000001',
      'Vouched for the unreconciled workbook while its rows are still being decided.',
      'c9d00000-0000-4000-8000-000000000003'
    )
  $$,
  'the unreconciled batch can be acknowledged too -- provenance is a separate question'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'c9100000-0000-4000-8000-000000000001',
    'c9900000-0000-4000-8000-000000000002'
  ),
  ARRAY['Reconcile 1 conflicting row(s) before importing.']::text[],
  'exactly the provenance blocker cleared; the unreconciled row still blocks'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000002',
      'approved',
      'c9000000-0000-4000-8000-000000000001',
      'Attempted to commit an acknowledged but undecided batch.',
      NULL, NULL
    )
  $$,
  'P0001',
  'Reconcile 1 conflicting row(s) before importing.',
  'an acknowledged batch with an undecided row is still refused, on the remaining blocker'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic unreconciled audit partner club audit'),
  0,
  'the acknowledged-but-undecided batch wrote no point submission either'
);

-- ---------------------------------------------------------------------------
-- D. A second acknowledgement before the commit is idempotent, and idempotent means the
--    FIRST decision stands rather than the last one silently replacing it.
-- ---------------------------------------------------------------------------
SELECT extensions.ok(
  (
    plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000001',
      'c9000000-0000-4000-8000-000000000001',
      'A second, differently worded acknowledgement of the same batch.',
      'c9d00000-0000-4000-8000-000000000002'
    )->>'idempotent'
  )::boolean,
  'replaying the acknowledgement before the commit reports itself idempotent'
);
SELECT extensions.is(
  (SELECT summary->>'historicalProvenanceCorrelationId'
   FROM plugin_data.csf_partner_submission_batches
   WHERE id = 'c9900000-0000-4000-8000-000000000001'),
  'c9d00000-0000-4000-8000-000000000001',
  'the replay did not repoint the batch at the second correlation'
);
SELECT extensions.is(
  (SELECT summary->>'historicalProvenanceAcknowledgementReason'
   FROM plugin_data.csf_partner_submission_batches
   WHERE id = 'c9900000-0000-4000-8000-000000000001'),
  'Advisor confirmed the 2032 workbook against the signed club roster.',
  'and it did not overwrite the reason the first officer gave'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000001'
     AND action = 'partner_audit.historical_provenance_acknowledged'),
  1,
  'the replay wrote no second audit event'
);

-- ---------------------------------------------------------------------------
-- E. The ordinary commit path, with no evidence token, because no receipt could ever have
--    been issued for a preview that does not exist.
-- ---------------------------------------------------------------------------
SELECT extensions.lives_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000001',
      'approved',
      'c9000000-0000-4000-8000-000000000001',
      'Committed the acknowledged preview-less batch.',
      'c9d00000-0000-4000-8000-000000000004', NULL
    )
  $$,
  'the acknowledged preview-less batch commits through the ordinary path with a NULL token'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE description = 'Synthetic preview-less audit partner club audit'
     AND profile_id = 'c9300000-0000-4000-8000-000000000001'
     AND claimed_points = 4
     AND status = 'approved'),
  1,
  'it generated exactly the one credit-bearing submission its settled row described'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_credit_records
   WHERE evidence->>'partnerAuditBatchId' = 'c9900000-0000-4000-8000-000000000001'
     AND status = 'verified'),
  1,
  'and the matching verified credit record'
);
SELECT extensions.ok(
  (SELECT generated_submission_id IS NOT NULL
   FROM plugin_data.csf_partner_submission_rows
   WHERE id = 'c9a00000-0000-4000-8000-000000000001'),
  'the partner row now names the submission it produced, so a replay cannot double it'
);
-- Attribution survives the commit. Reading the batch summary is not enough: an auditor
-- reading the commit event has to be able to see who vouched without following a link.
SELECT extensions.is(
  (SELECT after_data->>'historicalProvenanceAcknowledgedBy'
   FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000001'
     AND action = 'partner_audit.commit'),
  'c9000000-0000-4000-8000-000000000001',
  'the commit audit event carries the acknowledging officer forward'
);
SELECT extensions.is(
  (SELECT source_type FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000001'
     AND action = 'partner_audit.commit'),
  'partner_audit',
  'and records the commit as a partner-audit one rather than a sheet import it never was'
);

-- ---------------------------------------------------------------------------
-- F. After the commit, the door is shut. Provenance is decided BEFORE credit is written or
--    it is not decided at all: an acknowledgement recorded afterwards would be a signature
--    on records that already exist.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000001',
      'c9000000-0000-4000-8000-000000000001',
      'Attempted to vouch for a batch that has already written its credit.',
      NULL
    )
  $$,
  'P0001',
  'This audit batch has already been committed, so its provenance cannot be decided now.',
  'acknowledging a committed batch raises rather than backdating a decision'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000001'
     AND action = 'partner_audit.historical_provenance_acknowledged'),
  1,
  'and the refused acknowledgement wrote nothing'
);

-- ---------------------------------------------------------------------------
-- G. A reason is required, and it is required before anything is looked up.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'c9100000-0000-4000-8000-000000000002',
      'c9900000-0000-4000-8000-000000000003',
      'c9000000-0000-4000-8000-000000000002',
      '   ',
      NULL
    )
  $$,
  'P0001',
  'A partner-audit provenance acknowledgement reason is required.',
  'a blank reason is refused -- an unexplained signature is not an acknowledgement'
);

-- ---------------------------------------------------------------------------
-- H. None of the above reached the other chapter.
--
-- The neighbour's batch is the same shape as the one just committed, and it is named
-- directly, across the tenant boundary, by both write paths.
-- ---------------------------------------------------------------------------
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_acknowledge_partner_audit_batch_provenance(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000003',
      'c9000000-0000-4000-8000-000000000001',
      'Attempted to vouch for another chapter''s batch.',
      NULL
    )
  $$,
  'P0001',
  'Audit batch or term was not found.',
  'one organization cannot acknowledge another organization''s batch'
);
SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_commit_partner_audit_import(
      'c9100000-0000-4000-8000-000000000001',
      'c9900000-0000-4000-8000-000000000003',
      'approved',
      'c9000000-0000-4000-8000-000000000001',
      'Attempted to commit another chapter''s batch.',
      NULL, NULL
    )
  $$,
  'P0001',
  'Audit batch or term was not found.',
  'nor commit it'
);
SELECT extensions.is(
  plugin_data.csf_partner_audit_batch_readiness_blockers(
    'c9100000-0000-4000-8000-000000000002',
    'c9900000-0000-4000-8000-000000000003'
  ),
  ARRAY['Acknowledge this audit batch, recorded before import previews were linked, before importing.']::text[],
  'the neighbour batch still stands exactly where it started'
);
SELECT extensions.ok(
  (SELECT summary->>'historicalProvenanceAcknowledgedAt' IS NULL
   FROM plugin_data.csf_partner_submission_batches
   WHERE id = 'c9900000-0000-4000-8000-000000000003'),
  'the neighbour batch was never acknowledged by any of this'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_admin_audit_events
   WHERE target_id = 'c9900000-0000-4000-8000-000000000003'),
  0,
  'and no audit event names it'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM plugin_data.csf_point_submissions
   WHERE organization_id = 'c9100000-0000-4000-8000-000000000002'),
  0,
  'and no credit was written into the other organization at all'
);

SELECT * FROM extensions.finish();
ROLLBACK;
