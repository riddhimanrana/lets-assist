BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(17);

-- A successful, production-shaped merge. Every value is synthetic, but the
-- fixture spans the current ownership projections and deliberate history
-- retained by a real member record.
INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
) VALUES
  ('fc000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'merge-officer@local.test', now(), '{}', '{}', now(), now()),
  ('fc000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'merge-member@local.test', now(), '{}', '{}', now(), now()),
  ('fc000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'merge-history@local.test', now(), '{}', '{}', now(), now());

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'fc100000-0000-4000-8000-000000000001',
  'CSF Production Shape Merge', 'csf-production-shape-merge', 'school', '983321'
);
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('fc100000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'member', 'active');

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester, is_current
) VALUES (
  'fc200000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'FALL-2041', 'Fall 2041', '2041-2042', 'fall', true
);
INSERT INTO plugin_data.csf_cohorts (id, organization_id, graduation_year, label)
VALUES (
  'fc300000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001', 2042, 'Class of 2042'
);

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, school_email,
  normalized_first_name, normalized_last_name, normalized_school_email,
  record_status, merged_into_profile_id, merged_at, merged_by, merge_reason
) VALUES
  ('fc400000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'Quinn', 'Harbor', 'quinn.harbor@local.test', 'quinn', 'harbor', 'quinn.harbor@local.test', 'active', NULL, NULL, NULL, NULL),
  ('fc400000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'Quinn', 'Harbor', 'quinn.harbor@local.test', 'quinn', 'harbor', 'quinn.harbor@local.test', 'active', NULL, NULL, NULL, NULL),
  ('fc400000-0000-4000-8000-000000000003', 'fc100000-0000-4000-8000-000000000001', 'Prior', 'Duplicate', NULL, 'prior', 'duplicate', NULL, 'merged', 'fc400000-0000-4000-8000-000000000001', now() - interval '1 day', 'fc000000-0000-4000-8000-000000000001', 'Earlier duplicate merged into the now-duplicate source.');

INSERT INTO plugin_data.csf_profile_cohort_memberships (
  id, organization_id, profile_id, cohort_id, status, created_at, updated_at
) VALUES
  ('fc500000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001', 'active', now() - interval '2 years', now() - interval '2 years'),
  ('fc500000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000002', 'fc300000-0000-4000-8000-000000000001', 'archived', now() - interval '1 year', now() - interval '1 year');

INSERT INTO plugin_data.csf_profile_accounts (
  id, organization_id, profile_id, user_id, status, is_primary, linked_by, revoked_at
) VALUES
  ('fc600000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000002', 'verified', true, 'fc000000-0000-4000-8000-000000000001', NULL),
  ('fc600000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000003', 'revoked', false, 'fc000000-0000-4000-8000-000000000001', now() - interval '1 year'),
  ('fc600000-0000-4000-8000-000000000003', 'fc100000-0000-4000-8000-000000000001', 'fc400000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000002', 'pending', false, 'fc000000-0000-4000-8000-000000000001', NULL);

INSERT INTO plugin_data.csf_term_applications (
  id, organization_id, profile_id, cohort_id, term_id, source, status,
  submission_status, eligibility_status, decision_status, submitted_at, reviewed_at
) VALUES (
  'fc700000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'manual', 'accepted', 'decided', 'eligible', 'approved', now(), now()
);
INSERT INTO plugin_data.csf_application_correction_requests (
  id, organization_id, application_id, profile_id, check_type,
  requested_by, message, proposed_data, status
) VALUES (
  'fc710000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc700000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'required_information', 'fc000000-0000-4000-8000-000000000002',
  'Please correct the synthetic application record.', '{"field":"value"}',
  'submitted'
);

INSERT INTO plugin_data.csf_term_memberships (
  id, organization_id, profile_id, term_id, cohort_id, application_id, status
) VALUES (
  'fc720000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  'fc700000-0000-4000-8000-000000000001', 'active'
);

INSERT INTO plugin_data.csf_opportunities (
  id, organization_id, term_id, title, body, evidence_policy, status
) VALUES (
  'fc800000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'Synthetic food drive', 'Sort synthetic donations.', 'required', 'published'
);
INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, opportunity_id, source,
  description, claimed_points, point_type, status, submitted_by
) VALUES (
  'fc810000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'fc800000-0000-4000-8000-000000000001', 'student',
  'Synthetic point claim with finalized evidence.', 3, 'non_drive',
  'submitted', 'fc000000-0000-4000-8000-000000000002'
);
INSERT INTO plugin_data.csf_submission_files (
  id, organization_id, submission_id, profile_id, term_id, bucket,
  object_path, original_filename, mime_type, size_bytes, uploaded_by,
  upload_status, upload_token, finalized_at
) VALUES (
  'fc820000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc810000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001', 'csf-private',
  'merge-fixture/proof.pdf', 'proof.pdf', 'application/pdf', 512,
  'fc000000-0000-4000-8000-000000000002', 'finalized', NULL, now()
);
INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, submission_id, opportunity_id,
  source, points, point_type, status, verified_by, verified_at
) VALUES (
  'fc830000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'fc810000-0000-4000-8000-000000000001',
  'fc800000-0000-4000-8000-000000000001',
  'submission', 3, 'non_drive', 'verified',
  'fc000000-0000-4000-8000-000000000001', now()
);
INSERT INTO plugin_data.csf_meeting_attendance (
  id, organization_id, profile_id, term_id, meeting_key, meeting_label,
  status, source, recorded_by
) VALUES (
  'fc840000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'fall-general', 'Fall general meeting', 'attended', 'manual',
  'fc000000-0000-4000-8000-000000000001'
);

INSERT INTO plugin_data.csf_onboarding_links (
  id, organization_id, term_id, cohort_id, code, title, link_type,
  invitation_scope, recipient_profile_id, recipient_email, delivery_status,
  expires_at, accepted_by, accepted_at, is_active, created_by
) VALUES
  ('fc900000-0000-4000-8000-000000000001', 'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001', 'production-shape-open-direct-token-0001', 'Open direct invitation', 'profile_connect', 'direct', 'fc400000-0000-4000-8000-000000000001', 'quinn.harbor@local.test', 'link_ready', now() + interval '7 days', NULL, NULL, true, 'fc000000-0000-4000-8000-000000000001'),
  ('fc900000-0000-4000-8000-000000000002', 'fc100000-0000-4000-8000-000000000001', 'fc200000-0000-4000-8000-000000000001', 'fc300000-0000-4000-8000-000000000001', 'production-shape-accepted-token-0002', 'Accepted direct invitation', 'profile_connect', 'direct', 'fc400000-0000-4000-8000-000000000001', 'quinn.harbor@local.test', 'accepted', now() + interval '7 days', 'fc000000-0000-4000-8000-000000000002', now() - interval '1 hour', false, 'fc000000-0000-4000-8000-000000000001');

INSERT INTO plugin_data.csf_profile_link_requests (
  id, organization_id, term_id, cohort_id, user_id, signed_in_email,
  first_name, last_name, normalized_first_name, normalized_last_name,
  matched_profile_id, candidate_profile_ids, match_status
) VALUES (
  'fca00000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001',
  'fc300000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000002', 'merge-member@local.test',
  'Quinn', 'Harbor', 'quinn', 'harbor',
  'fc400000-0000-4000-8000-000000000001',
  ARRAY[
    'fc400000-0000-4000-8000-000000000001',
    'fc400000-0000-4000-8000-000000000002',
    'fc400000-0000-4000-8000-000000000001'
  ]::uuid[], 'needs_review'
);

INSERT INTO plugin_data.csf_partner_clubs (id, organization_id, name, status)
VALUES (
  'fcb00000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001', 'Synthetic Robotics', 'active'
);
INSERT INTO plugin_data.csf_partner_club_terms (
  id, organization_id, partner_club_id, term_id,
  relationship_status, workflow_status
) VALUES (
  'fcc00000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fcb00000-0000-4000-8000-000000000001',
  'fc200000-0000-4000-8000-000000000001', 'new', 'active'
);
INSERT INTO plugin_data.csf_communication_broadcast_preferences (
  id, organization_id, topic_key, recipient_email, profile_id,
  subscription_state, last_decision_at, decision_actor_kind,
  decision_actor_identity, decision_correlation_id
) VALUES (
  'fce00000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001', 'chapter_news',
  'quinn.harbor@local.test', 'fc400000-0000-4000-8000-000000000001',
  'subscribed', now(), 'system', 'fixture', 'production-shape-preference'
);

INSERT INTO plugin_data.csf_admin_audit_events (
  id, organization_id, actor_user_id, actor_profile_id, action,
  target_type, target_id, before_data, after_data, correlation_id,
  source_type, source_id, reason_code
) VALUES (
  'fcf00000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000002',
  'fc400000-0000-4000-8000-000000000001',
  'profile.fixture_history', 'csf_profiles',
  'fc400000-0000-4000-8000-000000000001', '{}', '{}',
  'fcf10000-0000-4000-8000-000000000001',
  'fixture', 'synthetic-history', 'synthetic_history_retained'
);

SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE production_shape_merge_result AS
SELECT plugin_data.csf_merge_profiles(
  'fc100000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000001',
  'fc400000-0000-4000-8000-000000000002',
  'One synthetic student was imported twice across production workflows.',
  'fc000000-0000-4000-8000-000000000001',
  'fcf20000-0000-4000-8000-000000000001'
) AS payload;

SELECT extensions.is(
  (SELECT payload->>'targetProfileId' FROM production_shape_merge_result),
  'fc400000-0000-4000-8000-000000000002',
  'the production-shaped duplicate completes a valid merge'
);
SELECT extensions.ok(
  (SELECT (payload->>'zeroLiveSourceReferences')::boolean FROM production_shape_merge_result),
  'the merge receipt reports the enforced zero-live-source postcondition'
);
SELECT extensions.is(
  (SELECT merged_into_profile_id FROM plugin_data.csf_profiles
    WHERE id = 'fc400000-0000-4000-8000-000000000003'),
  'fc400000-0000-4000-8000-000000000002'::uuid,
  'a prior tombstone is flattened directly to the canonical target'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE id = 'fc600000-0000-4000-8000-000000000003'
      AND profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND status = 'verified'
      AND is_primary
  )
  AND EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE id = 'fc600000-0000-4000-8000-000000000001'
      AND profile_id = 'fc400000-0000-4000-8000-000000000001'
      AND status = 'revoked'
      AND NOT is_primary
  ),
  'duplicate account rows consolidate safely into one verified primary target binding while retaining revoked source evidence'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_accounts
    WHERE id = 'fc600000-0000-4000-8000-000000000002'
      AND profile_id = 'fc400000-0000-4000-8000-000000000001'
      AND status = 'revoked'
  ),
  'the revoked account binding deliberately remains on the historical source'
);
SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 2 FROM plugin_data.csf_onboarding_links
    WHERE id IN ('fc900000-0000-4000-8000-000000000001', 'fc900000-0000-4000-8000-000000000002')
      AND recipient_profile_id = 'fc400000-0000-4000-8000-000000000002')
  AND EXISTS (SELECT 1 FROM plugin_data.csf_onboarding_links
    WHERE id = 'fc900000-0000-4000-8000-000000000001'
      AND delivery_status = 'link_ready' AND is_active)
  AND EXISTS (SELECT 1 FROM plugin_data.csf_onboarding_links
    WHERE id = 'fc900000-0000-4000-8000-000000000002'
      AND delivery_status = 'accepted' AND NOT is_active
      AND accepted_by = 'fc000000-0000-4000-8000-000000000002'),
  'open and accepted direct invitations rebind without changing delivery or acceptance semantics'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM plugin_data.csf_term_applications
    WHERE id = 'fc700000-0000-4000-8000-000000000001'
      AND profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND decision_status = 'approved')
  AND EXISTS (SELECT 1 FROM plugin_data.csf_application_correction_requests
    WHERE id = 'fc710000-0000-4000-8000-000000000001'
      AND profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND status = 'submitted'),
  'application ownership and its open correction request move together'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM plugin_data.csf_point_submissions
    WHERE id = 'fc810000-0000-4000-8000-000000000001'
      AND profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND status = 'submitted')
  AND EXISTS (SELECT 1 FROM plugin_data.csf_submission_files
    WHERE id = 'fc820000-0000-4000-8000-000000000001'
      AND profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND upload_status = 'finalized')
  AND EXISTS (SELECT 1 FROM plugin_data.csf_credit_records
    WHERE id = 'fc830000-0000-4000-8000-000000000001'
      AND profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND status = 'verified'),
  'point claim, finalized evidence, and awarded credit keep their state on the target'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM plugin_data.csf_meeting_attendance
    WHERE id = 'fc840000-0000-4000-8000-000000000001'
      AND profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND status = 'attended'),
  'meeting attendance moves to the canonical profile'
);
SELECT extensions.is(
  (SELECT candidate_profile_ids FROM plugin_data.csf_profile_link_requests
    WHERE id = 'fca00000-0000-4000-8000-000000000001'),
  ARRAY['fc400000-0000-4000-8000-000000000002']::uuid[],
  'profile-link candidates rewrite and collapse duplicate target identifiers'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM plugin_data.csf_communication_broadcast_preferences
    WHERE id = 'fce00000-0000-4000-8000-000000000001'
      AND profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND subscription_state = 'subscribed'),
  'the current communication preference rebinds without changing consent'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM plugin_data.csf_admin_audit_events
    WHERE id = 'fcf00000-0000-4000-8000-000000000001'
      AND actor_profile_id = 'fc400000-0000-4000-8000-000000000001'),
  'immutable actor history deliberately retains the source profile snapshot'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_profile_merge_reviews AS review
    WHERE review.source_profile_id = 'fc400000-0000-4000-8000-000000000001'
      AND review.target_profile_id = 'fc400000-0000-4000-8000-000000000002'
      AND review.status = 'approved'
      AND (review.evidence->>'zeroLiveSourceReferences')::boolean
      AND review.evidence ? 'profileReferencePlan'
      AND review.evidence ? 'referenceRewriteCounts'
      AND review.evidence ? 'retainedHistoryAfterMerge'
  ),
  'the approved review stores catalog, rewrite counts, retained-history counts, and the live-reference proof'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fc100000-0000-4000-8000-000000000001'
      AND audit.target_type = 'csf_profile_reference_rewrites'
      AND audit.reason_code = 'duplicate_profile_references_reconciled'
      AND (audit.after_data->>'zeroLiveSourceReferences')::boolean
  ),
  'the merge writes a separate immutable reference-reconciliation audit receipt'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_onboarding_links
    WHERE recipient_profile_id = 'fc400000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_application_correction_requests
    WHERE profile_id = 'fc400000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1 FROM plugin_data.csf_communication_broadcast_preferences
    WHERE profile_id = 'fc400000-0000-4000-8000-000000000001'
  ),
  'all later-schema live ownership references are absent from the source'
);
SELECT extensions.is(
  (SELECT record_status FROM plugin_data.csf_profiles
    WHERE id = 'fc400000-0000-4000-8000-000000000001'),
  'merged',
  'the source is retained only as the merged tombstone'
);
SELECT extensions.ok(
  (
    SELECT pg_catalog.bool_and(
      audit.before_data::text !~* '(quinn|harbor|local\.test|@)'
      AND audit.after_data::text !~* '(quinn|harbor|local\.test|@)'
    )
    FROM plugin_data.csf_admin_audit_events AS audit
    WHERE audit.organization_id = 'fc100000-0000-4000-8000-000000000001'
      AND audit.target_type IN (
        'csf_profiles', 'csf_profile_reference_rewrites',
        'csf_profile_cohort_memberships'
      )
      AND audit.action = 'profile.merge'
  ),
  'all merge audit evidence remains non-PII'
);

SELECT * FROM extensions.finish();

ROLLBACK;
