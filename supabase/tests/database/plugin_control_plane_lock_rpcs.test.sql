-- Lease RPCs that serialize plugin control-plane transitions.
--
-- Every organization-scoped plugin transition runs inside one of these leases,
-- so their contract is load-bearing: a lease that can be stolen while live
-- would let two opposite lifecycle transitions interleave, and a lease that
-- cannot be stolen after expiry would strand an organization's plugin forever
-- after a crashed transition. Until now the RPCs were exercised only through
-- mocked TypeScript clients, which cannot observe the SQL-side conditions.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(18);

INSERT INTO public.organizations (id, name, username, type, join_code)
VALUES (
  'ed100000-0000-4000-8000-000000000001',
  'Lock Contract Org',
  'lock-contract-org',
  'school',
  '884201'
);

-- Left inactive so the catalog does not require a published release row.
INSERT INTO public.plugins (key, name, visibility, is_active, latest_version)
VALUES (
  'lock-contract-test-plugin',
  'Lock Contract Test Plugin',
  'global',
  false,
  '1.0.0'
);

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ed000000-0000-4000-8000-000000000001","role":"service_role"}';

-- Acquiring a free lease succeeds and records the caller's token.
SELECT extensions.is(
  public.acquire_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'lock-contract-test-plugin',
    'ed200000-0000-4000-8000-00000000000a'
  ),
  true,
  'acquiring an unheld lease succeeds'
);

-- The lease table is unreadable even by service_role: it is reachable only
-- through the SECURITY DEFINER RPCs. Inspect it as the migration owner.
RESET ROLE;
SELECT extensions.is(
  (
    SELECT lock_token
    FROM private.plugin_control_plane_transition_locks
    WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'
      AND plugin_key = 'lock-contract-test-plugin'
  ),
  'ed200000-0000-4000-8000-00000000000a'::uuid,
  'the acquired lease records the first caller token'
);
SET LOCAL ROLE service_role;

-- A second caller must not take a live lease.
SELECT extensions.is(
  public.acquire_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'lock-contract-test-plugin',
    'ed200000-0000-4000-8000-00000000000b'
  ),
  false,
  'a live lease cannot be acquired by a second caller'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT lock_token
    FROM private.plugin_control_plane_transition_locks
    WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'
      AND plugin_key = 'lock-contract-test-plugin'
  ),
  'ed200000-0000-4000-8000-00000000000a'::uuid,
  'a refused acquisition leaves the holder token untouched'
);
SET LOCAL ROLE service_role;

-- Refresh and release are scoped to the exact token.
SELECT extensions.is(
  public.refresh_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'lock-contract-test-plugin',
    'ed200000-0000-4000-8000-00000000000b'
  ),
  false,
  'refreshing with a foreign token fails'
);

SELECT extensions.is(
  public.refresh_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'lock-contract-test-plugin',
    'ed200000-0000-4000-8000-00000000000a'
  ),
  true,
  'refreshing with the holder token succeeds'
);

SELECT extensions.is(
  public.release_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'lock-contract-test-plugin',
    'ed200000-0000-4000-8000-00000000000b'
  ),
  false,
  'releasing with a foreign token fails'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT count(*)
    FROM private.plugin_control_plane_transition_locks
    WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'
      AND plugin_key = 'lock-contract-test-plugin'
  ),
  1::bigint,
  'a refused release leaves the lease in place'
);
SET LOCAL ROLE service_role;

SELECT extensions.is(
  public.release_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'lock-contract-test-plugin',
    'ed200000-0000-4000-8000-00000000000a'
  ),
  true,
  'releasing with the holder token succeeds'
);

RESET ROLE;
SELECT extensions.is(
  (
    SELECT count(*)
    FROM private.plugin_control_plane_transition_locks
    WHERE organization_id = 'ed100000-0000-4000-8000-000000000001'
      AND plugin_key = 'lock-contract-test-plugin'
  ),
  0::bigint,
  'releasing removes the lease row'
);
SET LOCAL ROLE service_role;

-- TTL bounds are enforced before any row is touched.
SELECT extensions.throws_ok(
  $$
    SELECT public.acquire_plugin_control_plane_transition_lock(
      'ed100000-0000-4000-8000-000000000001',
      'lock-contract-test-plugin',
      'ed200000-0000-4000-8000-00000000000c',
      29
    )
  $$,
  '22023',
  'lock TTL must be between 30 and 3600 seconds',
  'a TTL below the floor is refused'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.acquire_plugin_control_plane_transition_lock(
      'ed100000-0000-4000-8000-000000000001',
      'lock-contract-test-plugin',
      'ed200000-0000-4000-8000-00000000000c',
      3601
    )
  $$,
  '22023',
  'lock TTL must be between 30 and 3600 seconds',
  'a TTL above the ceiling is refused'
);

-- An expired lease must be reclaimable, or a crashed transition strands the
-- organization's plugin permanently.
RESET ROLE;

INSERT INTO private.plugin_control_plane_transition_locks (
  organization_id, plugin_key, lock_token, acquired_at, expires_at
)
VALUES (
  'ed100000-0000-4000-8000-000000000001',
  'lock-contract-test-plugin',
  'ed200000-0000-4000-8000-00000000000d',
  now() - interval '2 hours',
  now() - interval '1 hour'
);

SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ed000000-0000-4000-8000-000000000001","role":"service_role"}';

SELECT extensions.is(
  public.refresh_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'lock-contract-test-plugin',
    'ed200000-0000-4000-8000-00000000000d'
  ),
  false,
  'an expired lease cannot be refreshed back to life'
);

SELECT extensions.is(
  public.acquire_plugin_control_plane_transition_lock(
    'ed100000-0000-4000-8000-000000000001',
    'lock-contract-test-plugin',
    'ed200000-0000-4000-8000-00000000000e'
  ),
  true,
  'an expired lease is reclaimed by the next caller'
);

-- Browser roles never reach the lease surface. They are stopped at the EXECUTE
-- grant, before the in-body service_role check runs, so the guard is two
-- independent layers deep. Asserting the grant-level message here keeps a
-- silent widening of the grant from passing as "still 42501".
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" =
  '{"sub":"ed000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT extensions.throws_ok(
  $$
    SELECT public.acquire_plugin_control_plane_transition_lock(
      'ed100000-0000-4000-8000-000000000001',
      'lock-contract-test-plugin',
      'ed200000-0000-4000-8000-00000000000f'
    )
  $$,
  '42501',
  'permission denied for function acquire_plugin_control_plane_transition_lock',
  'authenticated callers cannot acquire a lease'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.refresh_plugin_control_plane_transition_lock(
      'ed100000-0000-4000-8000-000000000001',
      'lock-contract-test-plugin',
      'ed200000-0000-4000-8000-00000000000e'
    )
  $$,
  '42501',
  'permission denied for function refresh_plugin_control_plane_transition_lock',
  'authenticated callers cannot refresh a lease'
);

SELECT extensions.throws_ok(
  $$
    SELECT public.release_plugin_control_plane_transition_lock(
      'ed100000-0000-4000-8000-000000000001',
      'lock-contract-test-plugin',
      'ed200000-0000-4000-8000-00000000000e'
    )
  $$,
  '42501',
  'permission denied for function release_plugin_control_plane_transition_lock',
  'authenticated callers cannot release a lease'
);

-- The lease table itself stays unreachable from the browser role even though
-- the RPCs are the only sanctioned path to it.
SELECT extensions.throws_ok(
  $$
    SELECT count(*) FROM private.plugin_control_plane_transition_locks
  $$,
  '42501',
  'permission denied for table plugin_control_plane_transition_locks',
  'authenticated callers cannot read the lease table directly'
);

SELECT * FROM extensions.finish();

ROLLBACK;
