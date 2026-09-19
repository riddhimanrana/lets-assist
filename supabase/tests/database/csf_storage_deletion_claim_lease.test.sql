-- Abandoned Storage cleanup claims have a bounded, token-fenced takeover path.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(16);

SELECT extensions.has_index(
  'plugin_data', 'csf_storage_deletion_queue',
  'csf_storage_deletion_queue_stale_claim_idx',
  'stale global cleanup claims have a partial lookup index'
);
SELECT extensions.has_index(
  'plugin_data', 'csf_storage_deletion_queue',
  'csf_storage_deletion_queue_org_stale_claim_idx',
  'stale organization cleanup claims have a partial lookup index'
);
SELECT extensions.ok(
  has_function_privilege(
    'service_role',
    'plugin_data.csf_claim_storage_deletion_queue(integer)', 'EXECUTE'
  ) AND has_function_privilege(
    'service_role',
    'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)',
    'EXECUTE'
  ),
  'service role can use both leased claim RPCs'
);
SELECT extensions.ok(
  NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_claim_storage_deletion_queue(integer)', 'EXECUTE'
  ) AND NOT has_function_privilege(
    'authenticated',
    'plugin_data.csf_claim_organization_storage_deletion_queue(uuid,integer)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot take over cleanup claims'
);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES
  (
    'd7100000-0000-4000-8000-000000000001',
    'Storage Claim Lease', 'storage-claim-lease', 'school', '995413'
  ),
  (
    'd7100000-0000-4000-8000-000000000002',
    'Other Storage Claim Lease', 'other-storage-claim-lease', 'school', '995414'
  );

INSERT INTO plugin_data.csf_storage_deletion_queue (
  id, organization_id, bucket, object_path, attempt_count,
  claim_token, claimed_at
) VALUES
  (
    'd7600000-0000-4000-8000-000000000001',
    'd7100000-0000-4000-8000-000000000001', 'plugins',
    'd7100000-0000-4000-8000-000000000001/dvhs-csf/orphans/stale.jpg',
    2, 'd7610000-0000-4000-8000-000000000001',
    now() - interval '16 minutes'
  ),
  (
    'd7600000-0000-4000-8000-000000000002',
    'd7100000-0000-4000-8000-000000000001', 'plugins',
    'd7100000-0000-4000-8000-000000000001/dvhs-csf/orphans/fresh.jpg',
    0, 'd7610000-0000-4000-8000-000000000002',
    now() - interval '14 minutes'
  ),
  (
    'd7600000-0000-4000-8000-000000000003',
    'd7100000-0000-4000-8000-000000000002', 'plugins',
    'd7100000-0000-4000-8000-000000000002/dvhs-csf/orphans/other.jpg',
    0, 'd7610000-0000-4000-8000-000000000003',
    now() - interval '16 minutes'
  );

CREATE TEMP TABLE leased_org_claim AS
SELECT *
FROM plugin_data.csf_claim_organization_storage_deletion_queue(
  'd7100000-0000-4000-8000-000000000001', 10
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM leased_org_claim), 1,
  'organization claim takes over only its expired lease'
);
SELECT extensions.is(
  (SELECT id FROM leased_org_claim),
  'd7600000-0000-4000-8000-000000000001'::uuid,
  'organization takeover returns the expired row'
);
SELECT extensions.ok(
  (SELECT claim_token <> 'd7610000-0000-4000-8000-000000000001'::uuid
      AND claimed_at > now() - interval '1 minute'
      AND attempt_count = 3
   FROM leased_org_claim),
  'takeover replaces the token, renews the lease, and records the abandoned attempt'
);
SELECT extensions.ok(
  (SELECT attempt_count = 3
      AND last_attempt_at IS NOT NULL
      AND last_error = 'Storage deletion claim lease expired.'
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'd7600000-0000-4000-8000-000000000001'),
  'takeover persists bounded retry metadata'
);
SELECT extensions.is(
  (SELECT claim_token
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'd7600000-0000-4000-8000-000000000002'),
  'd7610000-0000-4000-8000-000000000002'::uuid,
  'a fresh lease remains owned by its current worker'
);
SELECT extensions.is(
  (SELECT claim_token
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'd7600000-0000-4000-8000-000000000003'),
  'd7610000-0000-4000-8000-000000000003'::uuid,
  'organization takeover leaves another organization untouched'
);
SELECT extensions.throws_ok(
  $$ SELECT plugin_data.csf_ack_storage_deletion_claim(
    'd7600000-0000-4000-8000-000000000001',
    'd7610000-0000-4000-8000-000000000001', true
  ) $$,
  '55000', 'The storage deletion claim is no longer current.',
  'the abandoned worker token cannot acknowledge after takeover'
);
SELECT extensions.is(
  (SELECT plugin_data.csf_ack_storage_deletion_claim(
      'd7600000-0000-4000-8000-000000000001', claim_token, true
    ) ->> 'status'
   FROM leased_org_claim),
  'deleted',
  'the replacement token can acknowledge confirmed Storage deletion'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_queue
   WHERE id = 'd7600000-0000-4000-8000-000000000001'),
  0,
  'successful replacement acknowledgement removes the queue row'
);

UPDATE plugin_data.csf_storage_deletion_queue
SET claimed_at = now() - interval '16 minutes'
WHERE id = 'd7600000-0000-4000-8000-000000000003';
CREATE TEMP TABLE leased_global_claim AS
SELECT * FROM plugin_data.csf_claim_storage_deletion_queue(10);
SELECT extensions.is(
  (SELECT count(*)::integer FROM leased_global_claim), 1,
  'global claim also takes over an expired lease'
);
SELECT extensions.ok(
  (SELECT id = 'd7600000-0000-4000-8000-000000000003'
      AND claim_token <> 'd7610000-0000-4000-8000-000000000003'::uuid
   FROM leased_global_claim),
  'global takeover replaces the abandoned token'
);
SELECT extensions.is(
  (SELECT count(*)::integer
   FROM plugin_data.csf_storage_deletion_receipts
   WHERE queue_id = 'd7600000-0000-4000-8000-000000000001'
     AND claim_token = 'd7610000-0000-4000-8000-000000000001'),
  0,
  'a fenced abandoned token creates no durable acknowledgement receipt'
);

DELETE FROM plugin_data.csf_storage_deletion_queue
WHERE organization_id IN (
  'd7100000-0000-4000-8000-000000000001',
  'd7100000-0000-4000-8000-000000000002'
);
DELETE FROM plugin_data.csf_storage_deletion_receipts
WHERE organization_id IN (
  'd7100000-0000-4000-8000-000000000001',
  'd7100000-0000-4000-8000-000000000002'
);
DELETE FROM public.organizations
WHERE id IN (
  'd7100000-0000-4000-8000-000000000001',
  'd7100000-0000-4000-8000-000000000002'
);

SELECT * FROM extensions.finish();
ROLLBACK;
