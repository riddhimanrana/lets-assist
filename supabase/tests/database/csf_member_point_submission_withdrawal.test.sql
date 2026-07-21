BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(23);

SELECT extensions.ok(
  NOT has_function_privilege(
    'anon',
    'plugin_data.csf_withdraw_point_submission(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot withdraw a CSF point submission'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_withdraw_point_submission(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the privileged withdrawal RPC directly'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_withdraw_point_submission(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the server role can execute point-submission withdrawal'
);

INSERT INTO auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    'e0000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'csf-withdraw-owner@local.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    'e0000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'csf-withdraw-other@local.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    'e0000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'csf-withdraw-submitter@local.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'e1000000-0000-4000-8000-000000000001',
    'CSF Withdrawal Primary',
    'csf-withdrawal-primary',
    'school',
    '839901'
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    'CSF Withdrawal Other',
    'csf-withdrawal-other',
    'school',
    '839902'
  );

INSERT INTO plugin_data.csf_terms (
  id, organization_id, code, label, school_year, semester
) VALUES
  (
    'e2000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'S31',
    'Spring 2031',
    '2030-2031',
    'spring'
  ),
  (
    'e2000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'S31',
    'Spring 2031',
    '2030-2031',
    'spring'
  );

INSERT INTO plugin_data.csf_profiles (
  id, organization_id, first_name, last_name, normalized_first_name, normalized_last_name
) VALUES
  (
    'e3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'Withdrawal',
    'Member',
    'withdrawal',
    'member'
  ),
  (
    'e3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'Other',
    'Member',
    'other',
    'member'
  );

INSERT INTO plugin_data.csf_profile_accounts (
  organization_id, profile_id, user_id, status, is_primary
) VALUES (
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'verified',
  true
);

INSERT INTO plugin_data.csf_point_submissions (
  id, organization_id, profile_id, term_id, description, claimed_points,
  point_type, status, submitted_by, reviewed_by, reviewed_at
) VALUES
  (
    'e4000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'Verified account ownership fixture',
    2,
    'non_drive',
    'submitted',
    'e0000000-0000-4000-8000-000000000003',
    NULL,
    NULL
  ),
  (
    'e4000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'Original submitter ownership fixture',
    1,
    'non_drive',
    'submitted',
    'e0000000-0000-4000-8000-000000000003',
    NULL,
    NULL
  ),
  (
    'e4000000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'Wrong actor and organization fixture',
    1,
    'non_drive',
    'submitted',
    'e0000000-0000-4000-8000-000000000003',
    NULL,
    NULL
  ),
  (
    'e4000000-0000-4000-8000-000000000004',
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'Reviewed fixture',
    2,
    'drive',
    'submitted',
    'e0000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000001',
    now()
  ),
  (
    'e4000000-0000-4000-8000-000000000005',
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'Credited fixture',
    2,
    'non_drive',
    'submitted',
    'e0000000-0000-4000-8000-000000000003',
    NULL,
    NULL
  ),
  (
    'e4000000-0000-4000-8000-000000000006',
    'e1000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'Already needs action fixture',
    2,
    'non_drive',
    'needs_action',
    'e0000000-0000-4000-8000-000000000003',
    NULL,
    NULL
  );

INSERT INTO plugin_data.csf_credit_records (
  id, organization_id, profile_id, term_id, submission_id, source, points,
  point_type, status
) VALUES (
  'e5000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000005',
  'submission',
  2,
  'non_drive',
  'verified'
);

CREATE TEMP TABLE csf_withdrawal_results (
  label text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_withdrawal_results (label, payload)
    SELECT 'verified-account', plugin_data.csf_withdraw_point_submission(
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000001'
    )
  $$,
  'a verified profile-account owner can withdraw an untouched submission'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'e4000000-0000-4000-8000-000000000001'),
  'withdrawn',
  'successful withdrawal updates the submission status'
);

SELECT extensions.ok(
  (
    SELECT payload->>'submissionId' = 'e4000000-0000-4000-8000-000000000001'
      AND payload->>'profileId' = 'e3000000-0000-4000-8000-000000000001'
      AND payload->>'previousStatus' = 'submitted'
      AND payload->>'status' = 'withdrawn'
      AND nullif(payload->>'correlationId', '') IS NOT NULL
    FROM csf_withdrawal_results
    WHERE label = 'verified-account'
  ),
  'withdrawal returns the affected record, state transition, and correlation id'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'e4000000-0000-4000-8000-000000000001'
      AND action = 'point_submission.withdraw'
  ),
  1,
  'successful withdrawal writes exactly one audit event'
);

SELECT extensions.ok(
  (
    SELECT audit.organization_id = 'e1000000-0000-4000-8000-000000000001'
      AND audit.actor_user_id = 'e0000000-0000-4000-8000-000000000001'
      AND audit.actor_profile_id = 'e3000000-0000-4000-8000-000000000001'
      AND audit.term_id = 'e2000000-0000-4000-8000-000000000001'
      AND audit.correlation_id::text = result.payload->>'correlationId'
      AND audit.source_type = 'point_submission'
      AND audit.source_id = 'e4000000-0000-4000-8000-000000000001'
      AND audit.reason_code = 'point_submission_withdrawn_by_member'
      AND audit.before_data->>'status' = 'submitted'
      AND audit.after_data->>'status' = 'withdrawn'
    FROM plugin_data.csf_admin_audit_events AS audit
    JOIN csf_withdrawal_results AS result ON result.label = 'verified-account'
    WHERE audit.target_id = 'e4000000-0000-4000-8000-000000000001'
      AND audit.action = 'point_submission.withdraw'
  ),
  'withdrawal audit retains tenant, actor, source, state, and correlation provenance'
);

SELECT extensions.throws_ok(
  $$
    UPDATE plugin_data.csf_admin_audit_events
    SET after_data = '{}'::jsonb
    WHERE target_id = 'e4000000-0000-4000-8000-000000000001'
      AND action = 'point_submission.withdraw'
  $$,
  'P0001',
  'CSF audit events are immutable.',
  'withdrawal audit evidence is immutable'
);

SELECT extensions.lives_ok(
  $$
    INSERT INTO csf_withdrawal_results (label, payload)
    SELECT 'original-submitter', plugin_data.csf_withdraw_point_submission(
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000002',
      'e0000000-0000-4000-8000-000000000003'
    )
  $$,
  'the original submitter can withdraw without a verified account link'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'e4000000-0000-4000-8000-000000000002'),
  'withdrawn',
  'original-submitter withdrawal updates the submission'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id = 'e4000000-0000-4000-8000-000000000002'
      AND action = 'point_submission.withdraw'
  ),
  1,
  'original-submitter withdrawal is audited'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_withdraw_point_submission(
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000003',
      'e0000000-0000-4000-8000-000000000002'
    )
  $$,
  'P0001',
  'You can only withdraw your own point submission.',
  'an unrelated actor cannot withdraw another member submission'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'e4000000-0000-4000-8000-000000000003'),
  'submitted',
  'wrong-actor rejection leaves the submission unchanged'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_withdraw_point_submission(
      'e1000000-0000-4000-8000-000000000002',
      'e3000000-0000-4000-8000-000000000002',
      'e4000000-0000-4000-8000-000000000003',
      'e0000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'Point submission was not found.',
  'a submission cannot be withdrawn through another organization and profile'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'e4000000-0000-4000-8000-000000000003'),
  'submitted',
  'wrong-organization rejection leaves the submission unchanged'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_withdraw_point_submission(
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000004',
      'e0000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'Only submitted point submissions that have not been reviewed can be withdrawn.',
  'a reviewed point submission cannot be withdrawn'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'e4000000-0000-4000-8000-000000000004'),
  'submitted',
  'reviewed rejection leaves the submission unchanged'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_withdraw_point_submission(
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000005',
      'e0000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'Point submissions with awarded credit cannot be withdrawn.',
  'a point submission with linked credit cannot be withdrawn'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'e4000000-0000-4000-8000-000000000005'),
  'submitted',
  'credited rejection leaves the submission unchanged'
);

SELECT extensions.throws_ok(
  $$
    SELECT plugin_data.csf_withdraw_point_submission(
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000006',
      'e0000000-0000-4000-8000-000000000003'
    )
  $$,
  'P0001',
  'Only submitted point submissions that have not been reviewed can be withdrawn.',
  'a non-submitted point submission cannot be withdrawn'
);

SELECT extensions.is(
  (SELECT status FROM plugin_data.csf_point_submissions WHERE id = 'e4000000-0000-4000-8000-000000000006'),
  'needs_action',
  'non-submitted rejection leaves the submission unchanged'
);

SELECT extensions.is(
  (
    SELECT count(*)::integer
    FROM plugin_data.csf_admin_audit_events
    WHERE target_id IN (
      'e4000000-0000-4000-8000-000000000003',
      'e4000000-0000-4000-8000-000000000004',
      'e4000000-0000-4000-8000-000000000005',
      'e4000000-0000-4000-8000-000000000006'
    )
      AND action = 'point_submission.withdraw'
  ),
  0,
  'failed withdrawals never write audit events'
);

SELECT * FROM extensions.finish();

ROLLBACK;
